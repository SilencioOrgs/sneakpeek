// Reads usage limits using the logins Claude Code and Codex CLI already store on this machine.
// ponytail: both endpoints are the undocumented ones the CLIs call for /usage and /status; if they change, update here.
const fs = require('fs');
const os = require('os');
const path = require('path');

const home = os.homedir();
const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));

async function getJson(url, headers) {
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(10000) });
  if (res.status === 401 || res.status === 403) throw authError('Login expired - open the CLI once to refresh');
  if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}`), { status: res.status });
  return res.json();
}

// Name a window from its length: 18000s -> "5-hour", 604800s -> "Weekly", 2592000s -> "30-day".
const span = (s, fallback) => !s ? fallback : s < 86400 ? `${Math.round(s / 3600)}-hour` : s === 604800 ? 'Weekly' : `${Math.round(s / 86400)}-day`;
const authError = (msg) => Object.assign(new Error(msg), { auth: true });
const win = (label, pct, resetsAt) => ({ label, pct: Math.max(0, Math.min(100, Math.round(pct ?? 0))), resetsAt });

const CLAUDE_CRED = path.join(home, '.claude', '.credentials.json');

// Refresh tokens rotate, so the new pair must be written back or the CLI's own login breaks.
async function refreshClaude(file) {
  const o = file.claudeAiOauth;
  const res = await fetch('https://console.anthropic.com/v1/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ grant_type: 'refresh_token', refresh_token: o.refreshToken, client_id: '9d1c250a-e61b-44d9-88ed-5944d1962f5e' }),
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw authError('Login expired - run `claude` and /login');
  const t = await res.json();
  o.accessToken = t.access_token;
  if (t.refresh_token) o.refreshToken = t.refresh_token;
  o.expiresAt = Date.now() + t.expires_in * 1000;
  const tmp = CLAUDE_CRED + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(file, null, 2));
  fs.renameSync(tmp, CLAUDE_CRED); // atomic replace, never a half-written file
  return o;
}

async function claude() {
  let file, cred;
  try { file = readJson(CLAUDE_CRED); cred = file.claudeAiOauth; } catch { cred = null; }
  if (!cred?.accessToken) throw authError('Not logged in - run `claude` and /login');
  if (cred.expiresAt < Date.now() + 60000) cred = await refreshClaude(file);
  const d = await getJson('https://api.anthropic.com/api/oauth/usage', {
    Authorization: `Bearer ${cred.accessToken}`,
    'anthropic-beta': 'oauth-2025-04-20',
  });
  const t = (w) => (w?.resets_at ? Date.parse(w.resets_at) : null);
  return {
    plan: cred.subscriptionType || '',
    windows: [win('5-hour', d.five_hour?.utilization, t(d.five_hour)), win('Weekly', d.seven_day?.utilization, t(d.seven_day))],
  };
}

async function codex() {
  let tok;
  try { tok = readJson(path.join(home, '.codex', 'auth.json')).tokens; } catch { tok = null; }
  if (!tok?.access_token) throw authError('Not logged in - run `codex login`');
  const d = await getJson('https://chatgpt.com/backend-api/wham/usage', {
    Authorization: `Bearer ${tok.access_token}`,
    'ChatGPT-Account-Id': tok.account_id || '',
    'User-Agent': 'codex-cli',
  });
  const rl = d.rate_limit || {};
  const t = (w) => (w?.reset_at ? w.reset_at * 1000 : w?.reset_after_seconds ? Date.now() + w.reset_after_seconds * 1000 : null);
  return {
    plan: d.plan_type || '',
    // Free plans have a single 30-day window and no secondary one.
    windows: [[rl.primary_window, '5-hour'], [rl.secondary_window, 'Weekly']].filter(([w]) => w)
      .map(([w, fb]) => win(span(w.limit_window_seconds, fb), w.used_percent, t(w))),
  };
}

// Anthropic's usage endpoint rate-limits hard (429), so Claude is checked at most every 5 min and backs off
// 5 -> 10 -> 20 -> 30 min after a 429. The last good numbers per provider are saved to disk, so they survive
// restarts and keep showing (marked stale) while offline or rate-limited. Login problems are always shown.
const CACHE_FILE = path.join(home, '.sneakpeek', 'usage-cache.json');
const cache = {};
try { for (const [k, v] of Object.entries(readJson(CACHE_FILE))) cache[k] = { fails: 0, next: 0, data: v.data, at: v.at }; } catch {}
function saveCache() {
  try {
    fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
    const keep = Object.fromEntries(Object.entries(cache).filter(([, c]) => c.data).map(([k, c]) => [k, { data: c.data, at: c.at }]));
    fs.writeFileSync(CACHE_FILE + '.tmp', JSON.stringify(keep));
    fs.renameSync(CACHE_FILE + '.tmp', CACHE_FILE);
  } catch {}
}

async function guarded(name, fn, gapMs) {
  const c = (cache[name] ??= { fails: 0, next: 0 });
  if (Date.now() >= c.next) {
    try {
      c.data = await fn(); c.at = Date.now(); c.fails = 0; c.stale = null; c.error = null; c.next = Date.now() + gapMs;
      saveCache();
    } catch (e) {
      if (e.auth) { c.error = e.message; c.next = 0; return { ok: false, error: e.message }; }
      if (e.status === 429) {
        const min = Math.min(30, 5 * 2 ** c.fails++);
        c.stale = 'Rate-limited'; c.next = Date.now() + min * 60000;
        c.error = `Rate-limited by the server - retrying in ${min} min`;
      } else {
        c.stale = 'Offline'; c.next = 0;
        c.error = e.status ? e.message : "Can't reach the server - check your connection";
      }
    }
  }
  if (c.error && !c.data) return { ok: false, error: c.error };
  return { ok: true, ...c.data, at: c.at, ...(c.stale && { staleAt: c.at, staleWhy: c.stale }) };
}

// Live Claude numbers written by statusline.js after every Claude Code reply (no network, no rate limit).
const FEED = path.join(home, '.claude', 'ai-limits-feed.json');
const toMs = (v) => (v == null ? null : typeof v === 'number' ? (v < 1e12 ? v * 1000 : v) : Date.parse(v));
function claudeFeed() {
  let f, plan = '';
  try { f = readJson(FEED); } catch { return null; }
  try { plan = readJson(CLAUDE_CRED).claudeAiOauth.subscriptionType || ''; } catch {}
  const rl = f.rate_limits || {};
  const windows = [[rl.five_hour, '5-hour'], [rl.seven_day, 'Weekly']].filter(([w]) => w?.used_percentage != null)
    .map(([w, label]) => win(label, w.used_percentage, toMs(w.resets_at)));
  return windows.length ? { ok: true, plan, windows, at: f.at } : null;
}

const FRESH = 5 * 60000;
async function getClaude() {
  const feed = claudeFeed();
  if (feed && Date.now() - feed.at < FRESH) return feed; // Claude Code reported recently: skip the API entirely
  const api = await guarded('claude', claude, FRESH);
  // API down or rate-limited: an older Claude Code reading still beats nothing.
  const apiDown = !api.ok || api.staleAt;
  if (feed && (apiDown || feed.at > api.at)) return { ...feed, ...(apiDown && { staleAt: feed.at, staleWhy: api.staleWhy || api.error }) };
  return api;
}

// Instant startup: whatever was saved last time, without touching the network.
function cachedUsage() {
  const saved = (c) => (c?.data ? { ok: true, ...c.data, at: c.at } : null);
  const feed = claudeFeed(), cc = saved(cache.claude), cx = saved(cache.codex);
  const claude = feed && (!cc || feed.at > cc.at) ? feed : cc;
  if (!claude && !cx) return null;
  const wait = { ok: false, error: 'Checking…' };
  return { claude: claude || wait, codex: cx || wait, at: Math.max(claude?.at || 0, cx?.at || 0) };
}

// on = which tools are switched on in Settings; switched-off ones aren't checked at all.
async function getUsage(on = { claude: true, codex: true }) {
  const off = { ok: false, off: true, error: 'Turned off in Settings' };
  const [c, x] = await Promise.all([on.claude ? getClaude() : off, on.codex ? guarded('codex', codex, 30000) : off]);
  return { claude: c, codex: x, at: Date.now() };
}

module.exports = { getUsage, cachedUsage };

if (require.main === module) getUsage().then((u) => console.log(JSON.stringify(u, null, 2)));
