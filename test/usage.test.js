const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path');
// A fresh home folder, so no real cache or login is read.
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'sneakpeek-test-'));
process.env.HOME = process.env.USERPROFILE = home;
const usage = require('../usage');

// In order: the second test relies on the numbers the first one cached.
test('antigravity: numbers when open', async () => {
  usage._setAntigravity(async () => ({ plan: '', windows: [{ group: 'G', label: 'Weekly', pct: 19, resetsAt: 1 }] }));
  const u = await usage.getUsage({ claude: false, codex: false, antigravity: true });
  assert.equal(u.antigravity.ok, true);
  assert.equal(u.antigravity.windows[0].pct, 19);
});

test('antigravity: closed keeps the last numbers, marked stale', async () => {
  usage._setAntigravity(async () => { throw Object.assign(new Error("Antigravity isn't open"), { closed: true }); });
  const u = await usage.getUsage({ claude: false, codex: false, antigravity: true });
  assert.equal(u.antigravity.ok, true);
  assert.equal(u.antigravity.staleWhy, "Antigravity isn't open");
});

test('antigravity: switched off is not checked', async () => {
  let called = false;
  usage._setAntigravity(async () => { called = true; return { plan: '', windows: [] }; });
  const u = await usage.getUsage({ claude: false, codex: false, antigravity: false });
  assert.equal(u.antigravity.off, true);
  assert.equal(called, false);
});
