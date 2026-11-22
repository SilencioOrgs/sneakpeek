const test = require('node:test'), assert = require('node:assert/strict');
const { clean, DEFAULTS } = require('../config');

test('antigravity defaults to on and keeps a boolean', () => {
  assert.equal(DEFAULTS.antigravity, true);
  assert.equal(clean({ antigravity: false }).antigravity, false);
  assert.equal(clean({ antigravity: 'yes' }).antigravity, true);
});
