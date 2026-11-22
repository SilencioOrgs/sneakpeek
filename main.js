const { app, BrowserWindow, ipcMain, screen, Menu, Tray, nativeImage } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

// Renamed from Clio: merge the old ~/.clio data folder into ~/.sneakpeek before anything reads it.
// (Hooks may already have created ~/.sneakpeek, so move entry by entry instead of renaming the folder.)
(() => {
  const old = path.join(os.homedir(), '.clio'), dir = path.join(os.homedir(), '.sneakpeek');
  try {
    if (!fs.existsSync(old)) return;
    fs.mkdirSync(dir, { recursive: true });
    for (const f of fs.readdirSync(old)) { const to = path.join(dir, f); if (!fs.existsSync(to)) fs.renameSync(path.join(old, f), to); }
    fs.rmSync(old, { recursive: true, force: true });
  } catch {}
})();
const { getUsage, cachedUsage } = require('./usage');
const config = require('./config');
const integrations = require('./integrations');

// No settings file yet = first start on this computer: open Settings so integrations can be switched on.
const firstRun = !fs.existsSync(path.join(os.homedir(), '.sneakpeek', 'settings.json'));
let cfg = config.load();
// The page is laid out at 380x620 and zoomed by cfg.scale (Settings → Size).
const size = () => ({ w: Math.round(380 * cfg.scale), h: Math.round(620 * cfg.scale) });
const POLL_MS = 60_000;
// A session counts as working until its Stop hook, or this long after its last hook event
// (Stop doesn't fire when you interrupt Claude, so this is the safety net).
const STALE_MS = 3 * 60_000;
const ACTIVITY = path.join(os.homedir(), '.sneakpeek', 'activity.json');
// Approvals: ask.js (a PermissionRequest hook) drops <id>.json here and waits for <id>.answer.
const REQS = path.join(os.homedir(), '.sneakpeek', 'requests');
const PIDFILE = path.join(os.homedir(), '.sneakpeek', 'sneakpeek.pid');
let win, settingsWin, tray, last = null;

// Start with Windows: a per-user startup entry that runs this same Electron with this app folder.
const LOGIN = { path: process.execPath, args: [path.resolve(__dirname)], name: 'SneakPeek' };
// openAtLogin isn't reliable for a named entry on Windows; the launchItems list is.
const hasStartupEntry = (name) => (app.getLoginItemSettings(LOGIN).launchItems || []).some((i) => i.name === name && i.enabled !== false);
const startsWithWindows = () => hasStartupEntry(LOGIN.name);
const setStartup = (on) => app.setLoginItemSettings({ ...LOGIN, openAtLogin: on });
// Renamed from Clio: swap the old "Clio" startup entry for a "SneakPeek" one, keeping whether it was on.
function migrateStartup() {
  const old = { ...LOGIN, name: 'Clio' };
  if (hasStartupEntry('Clio')) { app.setLoginItemSettings({ ...old, openAtLogin: false }); setStartup(true); }
}

if (!app.requestSingleInstanceLock()) app.quit();
app.on('second-instance', () => openSettings()); // launching SneakPeek again opens Settings

// Docked to the right edge of the primary screen; Settings → Position moves it up or down.
function dock() {
  const a = screen.getPrimaryDisplay().workArea, { w, h } = size();
  win.setBounds({ x: a.x + a.width - w, y: Math.round(a.y + (a.height - h) * cfg.offset / 100), width: w, height: h });
}

async function refresh() {
  last = await getUsage({ claude: cfg.claude, codex: cfg.codex });
  win?.webContents.send('usage', last);
}

// Settings changed (from the Settings window): save, then apply what changed.
// Applied at once; written to disk at most every 300ms, so dragging a slider doesn't hammer the file.
let saveTimer = 0, saveError = null;
function saveSoon() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { config.save(cfg); saveError = null; } catch (e) { saveError = `Couldn't save settings (${e.code || e.message}). They'll reset when SneakPeek restarts.`; }
  }, 300);
}
app.on('will-quit', () => { if (saveTimer) { clearTimeout(saveTimer); try { config.save(cfg); } catch {} } });

function applySettings(next) {
  const prev = cfg;
  cfg = config.clean(next);
  saveSoon();
  if (prev.scale !== cfg.scale || prev.offset !== cfg.offset) { dock(); win.webContents.setZoomFactor(cfg.scale); }
  if (prev.scale !== cfg.scale && lastArt) win.webContents.send('media', { artOnly: true, ...sizedArt(lastArt) }); // re-fit covers to the new size
  win.webContents.send('settings', cfg);
  if (prev.claude !== cfg.claude || prev.codex !== cfg.codex) { lastActivity = ''; activity(); refresh(); }
  if (prev.music !== cfg.music) cfg.music ? startMedia() : stopMedia();
  return cfg;
}

// ---- Music: media.ps1 reads Windows' now-playing and takes play/pause/skip commands ----
let media = null, mediaRetry = 0, lastArt = null;
// Covers arrive at ~300px but are drawn at ~26-43 device pixels; letting the GPU shrink them every frame
// while they spin looks blurry. So shrink once, high quality, to the exact drawn sizes (panel / tab).
function sizedArt(art) {
  if (!art) return { art: null, artSmall: null };
  try {
    const img = nativeImage.createFromDataURL(art), dpr = screen.getPrimaryDisplay().scaleFactor;
    const px = (css) => Math.max(16, Math.round(css * cfg.scale * dpr));
    return { art: img.resize({ width: px(64), height: px(64), quality: 'best' }).toDataURL(),
             artSmall: img.resize({ width: px(28), height: px(28), quality: 'best' }).toDataURL() };
  } catch { return { art, artSmall: art }; }
}
function sendMedia(msg) {
  if ('art' in msg) { lastArt = msg.art; Object.assign(msg, sizedArt(msg.art)); }
  win?.webContents.send('media', msg);
}
function startMedia() {
  if (media || !cfg.music) return;
  // -EncodedCommand runs our own script text directly, so no script file or execution-policy change is needed.
  const script = fs.readFileSync(path.join(__dirname, 'media.ps1'), 'utf8');
  media = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { windowsHide: true });
  let buf = '';
  media.stdout.on('data', (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
      if (!line.startsWith('{')) continue;
      try { mediaRetry = 0; sendMedia(JSON.parse(line)); } catch {}
    }
  });
  media.on('exit', () => {
    media = null;
    win?.webContents.send('media', { none: true });
    if (cfg.music) setTimeout(startMedia, Math.min(60_000, 2000 * 2 ** mediaRetry++)); // crashed: retry, backing off
  });
}
function stopMedia() { if (media) { const m = media; media = null; m.removeAllListeners('exit'); m.kill(); win?.webContents.send('media', { none: true }); } }
ipcMain.on('media:cmd', (_, cmd) => { if (['toggle', 'next', 'prev'].includes(cmd)) media?.stdin.write(cmd + '\n'); });
app.on('will-quit', stopMedia);

function openSettings() {
  if (settingsWin && !settingsWin.isDestroyed()) { settingsWin.show(); settingsWin.focus(); return; }
  settingsWin = new BrowserWindow({
    width: 460, height: 680, minWidth: 400, minHeight: 420, title: 'SneakPeek Settings', icon: path.join(__dirname, 'assets', 'sneakpeek.ico'),
    backgroundColor: '#0a0a0a', autoHideMenuBar: true, show: false,
    webPreferences: { preload: path.join(__dirname, 'settings-preload.js') },
  });
  settingsWin.loadFile('settings.html');
  settingsWin.once('ready-to-show', () => settingsWin.show());
}

// Logo = the AI that's working now (most recent if both), else whichever was used last.
let lastActivity = '', wasWorking = null; // session -> working, as of the last read

function activity() {
  let f = {};
  try { f = JSON.parse(fs.readFileSync(ACTIVITY, 'utf8')); } catch {}
  let latest = null, busy = null;
  const now = new Map();
  for (const ai of ['claude', 'codex'].filter((x) => cfg[x])) for (const [sid, s] of Object.entries(f[ai] || {})) {
    now.set(ai + ':' + sid, s.working);
    // Was working at the last read, now stopped: tell the page it's done (toast + sound).
    if (wasWorking?.get(ai + ':' + sid) && !s.working) win?.webContents.send('done', { ai, project: s.project || '', ranMs: s.at - (s.since ?? s.at) });
    if (!latest || s.at > latest.at) latest = { ai, at: s.at };
    if (s.working && Date.now() - s.at < STALE_MS && (!busy || s.at > busy.at)) busy = { ai, at: s.at };
  }
  wasWorking = now;
  const a = { ai: (busy || latest)?.ai || (cfg.claude ? 'claude' : 'codex'), working: !!busy };
  const key = JSON.stringify(a);
  if (key !== lastActivity) { lastActivity = key; win?.webContents.send('activity', a); }
}

const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
let reqTimer = 0;
function requests() {
  let list = [];
  try {
    for (const f of fs.readdirSync(REQS).filter((n) => n.endsWith('.json'))) {
      const p = path.join(REQS, f);
      let r = null;
      try { r = JSON.parse(fs.readFileSync(p, 'utf8')); } catch {}
      // A hook that was killed (timeout, interrupted session) can't clean up on Windows: drop its card.
      if (r && alive(r.pid) && Date.now() - r.at < 120_000) list.push(r);
      else try { fs.unlinkSync(p); } catch {}
    }
  } catch {}
  list.sort((a, b) => a.at - b.at);
  win?.webContents.send('requests', list);
  clearTimeout(reqTimer);
  if (list.length) reqTimer = setTimeout(requests, 2000); // keep checking while cards are up
}

app.whenReady().then(() => {
  migrateStartup();
  if (firstRun) { try { config.save(cfg); } catch {} setTimeout(openSettings, 1200); }
  fs.mkdirSync(REQS, { recursive: true });
  for (const f of fs.readdirSync(REQS)) try { fs.unlinkSync(path.join(REQS, f)); } catch {} // leftovers from a crash
  fs.writeFileSync(PIDFILE, String(process.pid)); // ask.js only waits for an answer while this process is alive
  if (process.argv.includes('--enable-startup')) setStartup(true); // one-time switch: npm start -- --enable-startup
  const { w, h } = size();
  win = new BrowserWindow({
    width: w, height: h, frame: false, transparent: true, resizable: false, movable: false,
    skipTaskbar: true, focusable: false, hasShadow: false, show: false, title: 'SneakPeek',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), autoplayPolicy: 'no-user-gesture-required' }, // chime without a click first
  });
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setVisibleOnAllWorkspaces(true);
  win.setIgnoreMouseEvents(true, { forward: true }); // transparent area clicks pass through to the desktop
  dock();
  win.webContents.on('did-finish-load', () => { win.webContents.setZoomFactor(cfg.scale); win.webContents.send('settings', cfg); lastActivity = ''; activity(); requests(); });
  win.loadFile('index.html');
  win.once('ready-to-show', () => {
    win.showInactive();
    const saved = cachedUsage(); // last session's numbers, shown at once while the fresh check runs
    if (saved) win.webContents.send('usage', saved);
    refresh();
    startMedia();
  });
  screen.on('display-metrics-changed', dock);

  tray = new Tray(path.join(__dirname, 'assets', 'sneakpeek.ico'));
  tray.setToolTip('SneakPeek');
  tray.on('click', openSettings);
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Settings…', click: openSettings },
    { label: 'Refresh now', click: refresh },
    { type: 'separator' },
    { label: 'Quit SneakPeek', click: () => app.quit() },
  ]));
  setInterval(refresh, POLL_MS);
  setInterval(activity, 10_000); // expire stale "working" sessions

  // statusline.js rewrites the feed after every Claude Code reply; activity.js rewrites activity on every hook.
  let t, rt;
  const watch = (dir, file, fn) => {
    try {
      fs.mkdirSync(dir, { recursive: true });
      fs.watch(dir, (_, f) => { if (f === file) fn(); });
    } catch {}
  };
  watch(path.join(os.homedir(), '.claude'), 'ai-limits-feed.json', () => { clearTimeout(t); t = setTimeout(refresh, 500); });
  watch(path.dirname(ACTIVITY), 'activity.json', activity);
  try { fs.watch(REQS, () => { clearTimeout(rt); rt = setTimeout(requests, 50); }); } catch {}
});

// Only a well-formed answer for a request that's still waiting gets written:
// 'allow' | 'deny' | 'skip', or { answers: { question: label } } for Claude's questions.
const okAnswers = (o) => o && typeof o.answers === 'object' && Object.keys(o.answers).length <= 10 &&
  Object.entries(o.answers).every(([k, v]) => typeof v === 'string' && k.length < 2000 && v.length < 2000);
ipcMain.on('answer', (_, id, decision) => {
  if (!/^[0-9a-f-]{36}$/.test(id) || !fs.existsSync(path.join(REQS, id + '.json'))) return;
  const text = ['allow', 'deny', 'skip'].includes(decision) ? decision : okAnswers(decision) ? JSON.stringify({ answers: decision.answers }) : null;
  if (!text) return;
  const f = path.join(REQS, id + '.answer');
  fs.writeFileSync(f + '.tmp', text);
  fs.renameSync(f + '.tmp', f);
});
app.on('will-quit', () => { try { fs.unlinkSync(PIDFILE); } catch {} });

ipcMain.on('interactive', (_, on) => win.setIgnoreMouseEvents(!on, { forward: true }));
ipcMain.on('refresh', () => { if (!last || Date.now() - last.at > 15_000) refresh(); });
ipcMain.on('menu', () =>
  Menu.buildFromTemplate([
    { label: 'Settings…', click: openSettings },
    { label: 'Refresh now', click: refresh },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() },
  ]).popup({ window: win })
);

// Settings window API. Only the Settings window may call these.
const fromSettings = (e) => settingsWin && !settingsWin.isDestroyed() && e.sender === settingsWin.webContents;
const snapshot = () => ({ settings: cfg, integrations: integrations.state(), startup: startsWithWindows(), version: app.getVersion() });
// Every call answers with the real state afterwards, plus an error message if the change didn't happen.
const guarded = (e, fn) => {
  if (!fromSettings(e)) return null;
  try { fn(); return { ...snapshot(), error: saveError }; } catch (err) { return { ...snapshot(), error: err.message }; }
};
ipcMain.handle('cfg:get', (e) => guarded(e, () => {}));
ipcMain.handle('cfg:set', (e, patch) => guarded(e, () => { if (patch && typeof patch === 'object') applySettings({ ...cfg, ...patch }); }));
ipcMain.handle('int:set', (e, key, on) => guarded(e, () => { if (typeof key === 'string') integrations.set(key, !!on); }));
ipcMain.handle('int:removeAll', (e) => guarded(e, () => integrations.removeAll()));
ipcMain.handle('startup:set', (e, on) => guarded(e, () => setStartup(!!on)));
