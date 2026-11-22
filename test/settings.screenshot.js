// Settings check in a real browser (not part of `npm test`): the glow row, with a stand-in for main.js.
// Usage: node test/settings.screenshot.js [folder for the screenshot]
const { chromium } = require('playwright');
const path = require('path'), os = require('os');
const out = process.argv[2] || os.tmpdir();

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 460, height: 900 }, deviceScaleFactor: 2 });
  await page.addInitScript(() => {
    const snap = { settings: { claude: true, codex: true, antigravity: true, music: true, songNotes: true, sounds: true, doneNotes: true, doneMinSec: 10,
      alerts: true, alertLevels: [80, 90], scale: 0.75, offset: 50, glow: true, glowColor: 'ai' },
      integrations: { 'claude.installed': true, 'codex.installed': true }, startup: false, version: '0.2.2', update: {} };
    window.__patches = [];
    const same = async () => snap;
    window.sneakpeek = { get: same, setIntegration: same, removeAll: same, setStartup: same, checkUpdate: same, runUpdate: same, onChanged() {},
      set: async (patch) => { window.__patches.push(patch); Object.assign(snap.settings, patch); return snap; } };
  });
  await page.goto('file://' + path.join(__dirname, '..', 'settings.html'));
  await page.waitForTimeout(300);
  const fail = [];
  const check = (ok, msg) => { if (!ok) fail.push(msg); };
  const visible = () => page.evaluate(() => { const p = document.querySelector('#glowColor'); return !!p && !p.hidden && getComputedStyle(p).display !== 'none'; });

  check(!!(await page.$('#glowMode')) && !!(await page.$('[data-set="glow"]')), 'no "Glow while waiting" row');
  if (!fail.length) {
    check(await page.$eval('#glowMode', (e) => e.value) === 'ai', 'mode does not start at "Match the AI"');
    // Windows draws the open list with the options' own colours: they must be dark with light text, like Settings.
    const opt = await page.$eval('#glowMode option[value="one"]', (o) => { const c = getComputedStyle(o), sel = getComputedStyle(o.parentElement);
      return { bg: c.backgroundColor, fg: c.color, scheme: sel.colorScheme }; });
    const lum = (rgb) => { const [r, g, b] = rgb.match(/\d+/g).map(Number); return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255; };
    check(opt.bg !== 'rgba(0, 0, 0, 0)' && lum(opt.bg) < 0.25 && lum(opt.fg) > 0.75, 'dropdown options not dark with light text: ' + JSON.stringify(opt));
    check(opt.scheme === 'dark', 'dropdown not in dark colour scheme: ' + opt.scheme);
    check(!(await visible()), 'colour picker shown for "Match the AI"');
    await page.selectOption('#glowMode', 'one');
    await page.waitForTimeout(200);
    const patches = await page.evaluate(() => window.__patches);
    check(JSON.stringify(patches.at(-1)) === JSON.stringify({ glowColor: '#ffffff' }), 'choosing "One colour" saved ' + JSON.stringify(patches.at(-1)));
    check(await visible(), 'colour picker hidden for "One colour"');
    const row = await page.$('#glowMode');
    await row.evaluate((e) => e.closest('.row').scrollIntoView({ block: 'center' }));
    await page.screenshot({ path: path.join(out, 'settings-glow.png') });
  }
  await browser.close();
  if (fail.length) { console.error('FAIL:\n  ' + fail.join('\n  ')); process.exit(1); }
  console.log('OK: screenshot in ' + out);
})();
