// Panel check in a real browser (not part of `npm test`): loads index.html with a stand-in for main.js,
// fills it with Claude, ChatGPT, Antigravity and music, and checks the Antigravity section and tab.
// Usage: node test/panel.screenshot.js [folder for the screenshots]
const { chromium } = require('playwright');
const path = require('path'), os = require('os');
const out = process.argv[2] || os.tmpdir();
const H = Number(process.env.PANEL_H || 760);

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 380, height: H }, deviceScaleFactor: 2 });
  await page.addInitScript(() => {
    window.__cb = {};
    const on = (name) => (fn) => { window.__cb[name] = fn; };
    window.widget = { onUsage: on('usage'), onActivity: on('activity'), onRequests: on('requests'), onDone: on('done'), onSettings: on('settings'),
      onMedia: on('media'), mediaCmd() {}, answer() {}, refresh() {}, interactive() {}, menu() {} };
  });
  await page.goto('file://' + path.join(__dirname, '..', 'index.html'));
  const fail = [];
  const check = (ok, msg) => { if (!ok) fail.push(msg); };

  const now = Date.now(), h = 3600_000;
  await page.evaluate(({ now, h }) => {
    const w = (label, pct, inH, group) => ({ label, pct, resetsAt: now + inH * h, ...(group && { group }) });
    window.__cb.settings({ claude: true, codex: true, antigravity: true, music: true, songNotes: false, sounds: false, doneNotes: true, doneMinSec: 10,
      alerts: false, alertLevels: [80, 90], scale: 1, offset: 50 });
    window.__cb.media({ app: 'Spotify.exe', title: 'A song', artist: 'Someone', status: 'playing', pos: 30000, dur: 200000, at: now });
    window.__cb.usage({ at: now,
      claude: { ok: true, plan: 'max', windows: [w('5-hour', 42, 2), w('Weekly', 18, 90)], at: now },
      codex: { ok: true, plan: 'plus', windows: [w('5-hour', 10, 3), w('Weekly', 5, 100)], at: now },
      antigravity: { ok: true, plan: '', at: now, windows: [w('Weekly', 19, 151, 'Gemini Models'), w('5-hour', 33, 4.5, 'Gemini Models'),
        w('Weekly', 0, 168, 'Claude and GPT models'), w('5-hour', 0, 5, 'Claude and GPT models'), w('Weekly', 0, 168, 'Gemini 4 Argon')] } });
  }, { now, h });

  if (!(await page.$('#antigravity'))) { console.error('FAIL: no #antigravity section'); await browser.close(); process.exit(1); }
  await page.evaluate(() => document.querySelector('#icon').click()); // pin the panel open
  await page.waitForTimeout(1800);

  const r = await page.evaluate(() => {
    const panel = document.querySelector('#panel'), metas = [...document.querySelectorAll('#antigravity .meter')];
    const p = panel.getBoundingClientRect(), last = metas[metas.length - 1]?.getBoundingClientRect();
    return { groups: [...document.querySelectorAll('#antigravity .grp')].map((g) => g.textContent), meters: metas.length,
      lastInside: !!last && last.bottom <= p.bottom + 1, scrolls: panel.scrollHeight > panel.clientHeight + 1,
      panelInsideBlob: p.bottom <= CY + OPEN.h + 1 && p.top >= CY - OPEN.h - 1, display: getComputedStyle(document.querySelector('#antigravity')).display,
      more: panel.classList.contains('more') };
  });
  check(JSON.stringify(r.groups) === JSON.stringify(['Gemini Models', 'Claude and GPT models', 'Gemini 4 Argon']), 'group headings: ' + JSON.stringify(r.groups));
  check(r.meters === 5, 'meters: ' + r.meters);
  check(r.display !== 'none', 'section hidden');
  check(r.lastInside || r.scrolls, 'last Antigravity limit is cut off and the panel does not scroll');
  check(r.panelInsideBlob, 'panel spills outside the open shape');
  check(!r.scrolls || r.more, 'panel scrolls but nothing shows there is more below');
  await page.screenshot({ path: path.join(out, 'panel-antigravity.png') });

  // Close the panel, then: Antigravity working.
  await page.evaluate(() => { togglePin(); setOpen(false); }); // unpin and close (no real mouse here)
  await page.evaluate(() => window.__cb.activity({ ai: 'antigravity', working: true }));
  await page.waitForTimeout(1500);
  const t = await page.evaluate(() => ({ ai: document.body.dataset.ai, working: document.body.classList.contains('working'),
    mark: getComputedStyle(document.querySelector('.mark.antigravity') || document.body).opacity, title: document.querySelector('#icon').title }));
  check(t.ai === 'antigravity' && t.working, 'tab state: ' + JSON.stringify(t));
  check(t.mark === '1', 'Antigravity logo not shown in the tab');
  check(/^Antigravity/.test(t.title), 'tab title: ' + t.title);
  await page.screenshot({ path: path.join(out, 'tab-antigravity-working.png'), clip: { x: 260, y: H / 2 - 60, width: 120, height: 120 } });

  // Glow while an AI waits: on with a card, in its colour; off without cards or when switched off.
  const SET = { claude: true, codex: true, antigravity: true, music: true, songNotes: false, sounds: false, doneNotes: true, doneMinSec: 10,
    alerts: false, alertLevels: [80, 90], scale: 1, offset: 50, glow: true, glowColor: 'ai' };
  const card = (n, ai) => ({ id: `0000000${n}-0000-4000-8000-000000000000`, ai, tool: 'Bash', verb: 'run', detail: 'npm test', project: 'sneakpeek', at: Date.now() + n, pid: 1 });
  const glowAfter = async (fn, arg) => { await page.evaluate(fn, arg); await page.waitForTimeout(700); return page.evaluate(() => getComputedStyle(document.querySelector('#shape')).filter); };
  let g = await glowAfter(([c]) => window.__cb.requests([c]), [card(1, 'claude')]);
  check(/drop-shadow/.test(g) && /rgb\(217, 119, 87/.test(g), 'Claude waiting: no orange glow (' + g + ')');
  await page.screenshot({ path: path.join(out, 'glow-claude.png') });
  g = await glowAfter(([a, b]) => window.__cb.requests([a, b]), [card(1, 'codex'), card(2, 'claude')]);
  check(/rgb\(0, 255, 200/.test(g), 'Codex first: glow not green (' + g + ')');
  g = await glowAfter((s) => window.__cb.settings({ ...s, glowColor: '#ff00ff' }), SET);
  check(/rgb\(255, 0, 255/.test(g), 'one colour: glow not #ff00ff (' + g + ')');
  g = await glowAfter((s) => window.__cb.settings({ ...s, glow: false }), SET);
  check(g === 'none', 'switch off: still glowing (' + g + ')');
  await page.evaluate((s) => window.__cb.settings(s), SET);
  g = await glowAfter(() => window.__cb.requests([]));
  check(g === 'none', 'no cards: still glowing (' + g + ')');

  // A shorter window (main.js keeps the window inside small screens): the tab stays centred and the panel fits.
  await page.setViewportSize({ width: 380, height: 560 });
  await page.waitForTimeout(300);
  await page.evaluate(() => { togglePin(); });
  await page.waitForTimeout(1800);
  const s = await page.evaluate(() => { const p = document.querySelector('#panel').getBoundingClientRect();
    return { cy: CY, toastTop: parseFloat(getComputedStyle(document.querySelector('#toast')).top), inside: p.bottom <= CY + OPEN.h + 1 && p.top >= CY - OPEN.h - 1 && p.top >= 0 && p.bottom <= innerHeight }; });
  check(s.cy === 280, 'short window: tab not centred, CY = ' + s.cy);
  check(s.toastTop === 280, 'short window: note not beside the tab, top = ' + s.toastTop);
  check(s.inside, 'short window: panel spills outside the open shape or the window');
  await page.screenshot({ path: path.join(out, 'panel-short-window.png') });

  await browser.close();
  if (fail.length) { console.error('FAIL:\n  ' + fail.join('\n  ')); process.exit(1); }
  console.log('OK: screenshots in ' + out);
})();
