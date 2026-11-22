// Antigravity IDE: quota and whether its agent is running, read from its own language server on this computer.
// ponytail: the daemon files and these requests are undocumented (found on Antigravity 2.34); if they change, update here.
// Never uses the Google login and never reads conversations: only quota numbers and the run status.

// Antigravity writes ~/.gemini/antigravity/daemon/hub_<port>.json each time its language server starts.
// Old ones stay behind, so try the newest few.
function pickDaemons(files) {
  return [...files].sort((a, b) => b.mtimeMs - a.mtimeMs)
    .map((f) => ({ port: Number(f.json?.httpsPort), token: f.json?.csrfToken }))
    .filter((d) => d.port > 0 && typeof d.token === 'string' && d.token)
    .slice(0, 5);
}

const WINDOWS = { '5h': '5-hour', weekly: 'Weekly' };
// RetrieveUserQuotaSummary: groups (Gemini Models, Claude and GPT models...) of buckets (5h, weekly).
function parseQuota(summary) {
  const groups = summary?.groups ?? summary?.response?.groups ?? [];
  const windows = [];
  for (const g of groups) {
    const group = g.displayName ?? g.display_name ?? '';
    for (const b of g.buckets || []) {
      const frac = b.remainingFraction ?? b.remaining_fraction, reset = b.resetTime ?? b.reset_time;
      if (frac == null && !reset) continue;
      // Protobuf JSON leaves out zero values, so a missing fraction next to a reset time means nothing is left.
      const pct = Math.max(0, Math.min(100, Math.round((1 - (frac ?? 0)) * 100)));
      const label = WINDOWS[b.window] || b.displayName || b.display_name || b.window || '';
      windows.push({ group, label, pct, resetsAt: reset ? Date.parse(reset) : null });
    }
  }
  return { plan: '', windows };
}

// GetAllCascadeTrajectories: one entry per conversation, each with a run status. Empty until one exists.
function isRunning(trajectories) {
  if (!trajectories || typeof trajectories !== 'object') return false;
  return Object.entries(trajectories).some(([k, v]) =>
    (k === 'status' && v === 'CASCADE_RUN_STATUS_RUNNING') || (v && typeof v === 'object' && isRunning(v)));
}

// The session record main.js keeps for Antigravity, in activity.json's shape. While idle, `at` stays at the time
// it stopped, so an idle Antigravity never looks more recently used than Claude or Codex.
function nextSession(prev, running, now) {
  if (running) return { working: true, at: now, since: prev?.working ? prev.since : now, project: '' };
  if (prev?.working) return { working: false, at: now, since: prev.since, project: '' };
  return prev || { working: false, at: 0, since: 0, project: '' };
}

// ---- Talking to it ----
const fs = require('fs'), os = require('os'), path = require('path'), https = require('https');
const DAEMON_DIR = path.join(os.homedir(), '.gemini', 'antigravity', 'daemon');
const BODY = JSON.stringify({ metadata: { ideName: 'antigravity', extensionName: 'antigravity', locale: 'en' } });

function readDaemons() {
  let names = [];
  try { names = fs.readdirSync(DAEMON_DIR).filter((n) => n.endsWith('.json')); } catch { return []; }
  const out = [];
  for (const file of names) {
    const p = path.join(DAEMON_DIR, file);
    try { out.push({ file, mtimeMs: fs.statSync(p).mtimeMs, json: JSON.parse(fs.readFileSync(p, 'utf8')) }); } catch {}
  }
  return out;
}

// One request to the language server. It uses a self-signed certificate on 127.0.0.1, so that isn't checked.
function rpc(port, token, method) {
  return new Promise((resolve, reject) => {
    const req = https.request({ host: '127.0.0.1', port, method: 'POST', path: `/exa.language_server_pb.LanguageServerService/${method}`,
      rejectUnauthorized: false, timeout: 3000,
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(BODY), 'Connect-Protocol-Version': '1', 'X-Codeium-Csrf-Token': token } },
    (res) => {
      let s = '';
      res.on('data', (d) => (s += d));
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) return reject(Object.assign(new Error(`HTTP ${res.statusCode}`), { status: res.statusCode }));
        try { resolve(s ? JSON.parse(s) : {}); } catch { reject(Object.assign(new Error('Unexpected answer from Antigravity'), { status: res.statusCode })); }
      });
    });
    req.on('timeout', () => req.destroy(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' })));
    req.on('error', reject);
    req.end(BODY);
  });
}

const closedError = () => Object.assign(new Error("Antigravity isn't open"), { closed: true });
// Gone for sure: nothing listens there any more, or the token changed (Antigravity restarted, maybe on the same port).
const gone = (e) => e.code === 'ECONNREFUSED' || e.code === 'ECONNRESET' || e.status === 401 || e.status === 403;

function createClient({ readDaemons: read = readDaemons, rpc: send = rpc } = {}) {
  let conn = null, stalls = 0; // the server that answered last, and how many times in a row it hasn't since
  async function call(method) {
    let dead = null;
    if (conn) {
      try { const r = await send(conn.port, conn.token, method); stalls = 0; return r; }
      catch (e) {
        if (e.status && !gone(e)) throw e; // it answered, with an error: still the right server
        // Slow (it's busiest while the agent runs): keep it. Only three stalls in a row mean look again.
        if (!gone(e) && ++stalls < 3) throw e;
        dead = conn; conn = null; stalls = 0;
      }
    }
    let answered = null; // an HTTP error from a port during the search: only reported if nothing better answers
    for (const d of pickDaemons(read()).filter((x) => !(dead && x.port === dead.port && x.token === dead.token))) {
      try { const r = await send(d.port, d.token, method); conn = d; return r; }
      catch (e) { if (e.status && !gone(e)) answered ??= e; }
    }
    throw answered || closedError();
  }
  return {
    quota: async () => parseQuota(await call('RetrieveUserQuotaSummary')),
    running: async () => isRunning(await call('GetAllCascadeTrajectories')),
  };
}

const client = createClient();
module.exports = { pickDaemons, parseQuota, isRunning, nextSession, createClient, quota: client.quota, running: client.running };
