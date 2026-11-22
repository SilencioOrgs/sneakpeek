#!/usr/bin/env node
// THROWAWAY CHECK, not part of SneakPeek. It finds out, on your own PC, what SneakPeek could read from the
// Antigravity IDE: (1) its local language server and the quota it reports, (2) which files change while the
// agent works, so SneakPeek can tell "working" from "done".
//
//   node antigravity-probe.js                 run with the Antigravity IDE open
//   node antigravity-probe.js --port N --token T   skip the process search (if it can't find the server)
//
// It only reads. Nothing leaves your computer: the quota request goes to 127.0.0.1.
// At the end it writes antigravity-probe-report.json next to where you ran it, with the CSRF token,
// emails and other personal fields removed. Send that file back.
const fs = require('fs'), os = require('os'), path = require('path'), https = require('https'), http = require('http');
const { execFileSync } = require('child_process');
const readline = require('readline');

const arg = (name) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : undefined; };
const report = { at: new Date().toISOString(), platform: `${process.platform} ${os.release()} ${process.arch}`, node: process.version,
  processes: [], ports: [], quota: {}, files: { watched: [], events: [], marks: [] }, notes: [] };
const log = (...a) => console.log(...a);
const note = (s) => { report.notes.push(s); log('  ! ' + s); };

// ---- Personal data never goes in the report ----
const SECRET_KEY = /token|secret|apikey|api_key|password|cookie|auth|email|^name$|username|userid|user_id|accountid|account_id/i;
function scrub(v, key = '') {
  if (SECRET_KEY.test(key) && v != null && typeof v !== 'object') return '<removed>';
  if (typeof v === 'string') return v.replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '<email>');
  if (Array.isArray(v)) return v.map((x) => scrub(x));
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, scrub(x, k)]));
  return v;
}
// Hide every long random-looking value (tokens, ids), keeping the flag names so we can see where a token lives.
const hideToken = (cmd) => cmd.replace(/(--csrf_token[=\s]+)\S+/gi, '$1<removed>')
  .replace(/(--[\w-]+)([=\s]+)("?)((?!--)[^\s"]+)\3/g, (m, f, sep, q, v) => (/^[A-Za-z0-9_\-+/=.]{16,}$/.test(v) && !/[\\/]/.test(v) ? `${f}${sep}<hidden ${v.length} chars>` : m))
  .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '<hidden id>');

// ---- 1. Find the language server ----
const ps = (script) => execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8', windowsHide: true, timeout: 20000 });
function findServers() {
  if (process.platform !== 'win32') { note('Not Windows: skipping the process search.'); return []; }
  let rows = [];
  try {
    const out = ps("Get-CimInstance Win32_Process | Where-Object { $_.Name -like 'language_server*' -or $_.Name -eq 'agy.exe' -or $_.Name -like 'Antigravity*' } | Select-Object ProcessId,ParentProcessId,Name,CommandLine | ConvertTo-Json -Compress");
    rows = out.trim() ? [].concat(JSON.parse(out)) : [];
  } catch (e) { note('PowerShell process search failed: ' + e.message.split('\n')[0]); }
  const servers = [];
  for (const r of rows) {
    const cmd = r.CommandLine || '';
    const isServer = /^language_server|^agy\.exe$/i.test(r.Name);
    report.processes.push({ pid: r.ProcessId, name: r.Name, commandLine: hideToken(cmd).slice(0, 1500) });
    if (!isServer) continue;
    const token = (cmd.match(/--csrf_token[=\s]+([a-zA-Z0-9-]+)/i) || [])[1];
    const extPort = Number((cmd.match(/--(?:extension_server_port|hub-port)[=\s]+(\d+)/i) || [])[1]) || 0;
    const appData = (cmd.match(/--app_data_dir[=\s]+("?)([^"\s]+)\1/i) || [])[2] || '';
    servers.push({ pid: r.ProcessId, name: r.Name, token, extPort, appData, antigravity: /antigravity/i.test(cmd), parent: r.ParentProcessId,
      flags: hideToken(cmd).replace(/^("[^"]*"|\S+)\s*/, '') });
  }
  return servers;
}
function listeningPorts(pid) {
  try {
    const out = ps(`Get-NetTCPConnection -OwningProcess ${Number(pid)} -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty LocalPort`);
    const ports = out.split(/\s+/).map(Number).filter(Boolean);
    if (ports.length) return [...new Set(ports)].sort((a, b) => a - b);
  } catch {}
  try { // fallback
    const out = execFileSync('netstat', ['-ano', '-p', 'tcp'], { encoding: 'utf8', windowsHide: true });
    const ports = out.split('\n').filter((l) => /LISTENING/.test(l) && l.trim().endsWith(' ' + pid))
      .map((l) => Number((l.match(/(?:127\.0\.0\.1|0\.0\.0\.0|\[::1?\]):(\d+)/) || [])[1])).filter(Boolean);
    return [...new Set(ports)].sort((a, b) => a - b);
  } catch { return []; }
}

// ---- 2. Ask it for quota ----
function rpc(proto, port, token, method, body) {
  return new Promise((resolve) => {
    const data = JSON.stringify(body);
    const lib = proto === 'https' ? https : http;
    const req = lib.request({ host: '127.0.0.1', port, method: 'POST', path: `/exa.language_server_pb.LanguageServerService/${method}`,
      rejectUnauthorized: false, timeout: 5000, // the server uses a self-signed certificate on localhost
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data), 'Connect-Protocol-Version': '1', ...(token && { 'X-Codeium-Csrf-Token': token }) } },
    (res) => { let s = ''; res.on('data', (d) => (s += d)); res.on('end', () => { let json = null; try { json = JSON.parse(s); } catch {} resolve({ status: res.statusCode, json, text: json ? undefined : s.slice(0, 300) }); }); });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', (e) => resolve({ error: e.message }));
    req.end(data);
  });
}
const META = { metadata: { ideName: 'antigravity', extensionName: 'antigravity', locale: 'en' } };
async function connect(port, token) {
  for (const proto of ['https', 'http']) {
    const r = await rpc(proto, port, token, 'GetUnleashData', { wrapper_data: {} });
    report.ports.push({ port, proto, status: r.status, error: r.error });
    if (r.status === 200) return proto;
  }
  return null;
}
const pct = (f) => (typeof f === 'number' ? Math.round((1 - f) * 100) + '% used' : '?');
function printQuota(summary, status) {
  const groups = summary?.groups || summary?.response?.groups || [];
  for (const g of groups) for (const b of g.buckets || []) log(`    ${g.displayName || g.display_name || ''} / ${b.displayName || b.display_name || b.bucketId}: ${pct(b.remainingFraction ?? b.remaining_fraction)}, resets ${b.resetTime || b.reset_time || '?'}, window ${b.window || '?'}`);
  const models = status?.userStatus?.cascadeModelConfigData?.clientModelConfigs || [];
  for (const m of models) log(`    model ${m.label}: ${pct(m.quotaInfo?.remainingFraction)}, resets ${m.quotaInfo?.resetTime || '?'}`);
  const plan = status?.userStatus?.planStatus;
  if (plan) log(`    prompt credits: ${plan.availablePromptCredits ?? '?'} of ${plan.planInfo?.monthlyPromptCredits ?? '?'}`);
  if (!groups.length && !models.length) log('    (no quota fields where expected: the raw answers are in the report)');
}
async function quota() {
  log('\n1) Antigravity language server');
  let targets;
  if (arg('--port')) targets = [{ pid: 0, token: arg('--token'), ports: [Number(arg('--port'))] }];
  else {
    const servers = findServers();
    log(`  found ${servers.length} language server process(es)` + (servers.length ? ':' : ' (is the Antigravity IDE open?)'));
    for (const s of servers) {
      log(`    pid ${s.pid} ${s.name}  token: ${s.token ? 'yes' : 'NO'}  antigravity: ${s.antigravity}  ext port: ${s.extPort || '-'}  app data: ${s.appData || '-'}`);
      log(`      started with (secrets hidden): ${s.flags.slice(0, 1200) || '(no arguments)'}`);
    }
    // No token on the command line: still try, some versions accept requests without one.
    targets = servers.map((s) => ({ ...s, ports: [...new Set([...listeningPorts(s.pid), ...(s.extPort ? [s.extPort] : [])])] }));
  }
  for (const t of targets) {
    log(`  pid ${t.pid}: listening on ${t.ports.join(', ') || 'nothing found'}`);
    for (const port of t.ports) {
      const proto = await connect(port, t.token);
      const tries = report.ports.filter((p) => p.port === port).map((p) => `${p.proto} ${p.status ?? p.error}`).join(', ');
      log(`    port ${port}: ${tries}`);
      if (!proto) continue;
      log(`  connected: ${proto}://127.0.0.1:${port}`);
      const [sum, st] = await Promise.all([rpc(proto, port, t.token, 'RetrieveUserQuotaSummary', META), rpc(proto, port, t.token, 'GetUserStatus', META)]);
      report.quota = { port, proto, RetrieveUserQuotaSummary: scrub(sum), GetUserStatus: scrub(st) };
      log(`  RetrieveUserQuotaSummary: HTTP ${sum.status ?? sum.error}   GetUserStatus: HTTP ${st.status ?? st.error}`);
      printQuota(sum.json, st.json);
      return;
    }
  }
  note('Could not get quota from any language server port.');
}

// ---- 3. Watch which files change while the agent works ----
const home = os.homedir(), appdata = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
const WATCH = [path.join(home, '.gemini'), path.join(home, '.antigravity'), path.join(appdata, 'Antigravity')];
const t0 = Date.now();
const since = () => ((Date.now() - t0) / 1000).toFixed(1) + 's';
// Group paths so ids don't make every file look different: .../conversations/<id>.pb
const shape = (p) => p.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '<id>').replace(/\d{6,}/g, '<n>');
function watchFiles() {
  log('\n2) Watching for file changes in:');
  for (const dir of WATCH) {
    if (!fs.existsSync(dir)) { log(`    ${dir}  (not there)`); continue; }
    try {
      fs.watch(dir, { recursive: true }, (type, f) => {
        if (!f) return;
        const full = path.join(dir, f);
        let size = null; try { size = fs.statSync(full).size; } catch {}
        const rel = path.join(path.basename(dir), String(f));
        report.files.events.push({ t: Date.now() - t0, type, path: shape(rel), size });
        if (!/\.log$|[\\/]logs?[\\/]|Cache|GPUCache|blob_storage/i.test(rel)) log(`    ${since().padStart(7)}  ${type.padEnd(6)} ${shape(rel)}`);
      });
      report.files.watched.push(dir);
      log(`    ${dir}`);
    } catch (e) { log(`    ${dir}  (can't watch: ${e.code || e.message})`); }
  }
}

// ---- Summary: which paths changed, and how long they went quiet while the agent was working ----
function summarize() {
  const ev = report.files.events, marks = report.files.marks;
  const start = marks.find((m) => m.what === 'start')?.t, end = marks.find((m) => m.what === 'done')?.t;
  const byPath = {};
  for (const e of ev) (byPath[e.path] ??= []).push(e.t);
  report.files.byPath = Object.entries(byPath).map(([p, ts]) => {
    const during = start != null ? ts.filter((t) => t >= start && t <= (end ?? Infinity)) : ts;
    let gap = 0; for (let i = 1; i < during.length; i++) gap = Math.max(gap, during[i] - during[i - 1]);
    const after = end != null ? ts.filter((t) => t > end).length : null;
    return { path: p, total: ts.length, duringWork: during.length, longestQuietMsDuringWork: gap,
      firstAfterStartMs: start != null && during.length ? during[0] - start : null,
      lastBeforeDoneMs: end != null && during.length ? end - during[during.length - 1] : null, afterDone: after };
  }).sort((a, b) => b.duringWork - a.duringWork);
  log('\n3) Paths that changed most while the agent worked:');
  for (const r of report.files.byPath.slice(0, 15)) log(`    ${String(r.duringWork).padStart(4)}x  quiet up to ${(r.longestQuietMsDuringWork / 1000).toFixed(1)}s  after done: ${r.afterDone ?? '-'}  ${r.path}`);
  if (!report.files.byPath.length) log('    (nothing changed)');
}

function finish() {
  summarize();
  const out = path.resolve('antigravity-probe-report.json');
  // Folder paths carry your Windows user name: show your home folder as ~ instead (in either slash style).
  let text = JSON.stringify(report, null, 2);
  for (const h of new Set([home, home.replace(/\\/g, '/')])) text = text.split(JSON.stringify(h).slice(1, -1)).join('~');
  text = text.replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '<email>');
  fs.writeFileSync(out, text);
  log(`\nSaved ${out}\nSend that file back. It has no token, email or name in it, but feel free to look first.`);
  process.exit(0);
}

(async () => {
  log('Antigravity check for SneakPeek (read-only).');
  await quota();
  watchFiles();
  log(`
Now, in the Antigravity IDE:
  1. Press Enter here, then right away send the agent a prompt that takes a minute or so
     (for example: "read this project and write a short summary in NOTES.md").
  2. Press Enter here again the moment the agent finishes.
  3. Wait about 30 seconds, then press Enter a third time (or Ctrl+C) to save the report.
`);
  const rl = readline.createInterface({ input: process.stdin });
  const steps = ['start', 'done', 'end'];
  let i = 0;
  rl.on('line', () => {
    const what = steps[i++];
    report.files.marks.push({ what, t: Date.now() - t0 });
    log(`  --- ${since()}  ${what === 'start' ? 'START: send your prompt now' : what === 'done' ? 'DONE marked: now wait ~30s, then Enter' : 'saving'} ---`);
    if (what === 'end') finish();
  });
  rl.on('close', finish);
  process.on('SIGINT', finish);
})();
