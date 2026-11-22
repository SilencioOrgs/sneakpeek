const test = require('node:test'), assert = require('node:assert/strict');
const { clean, DEFAULTS } = require('../config');

test('antigravity defaults to on and keeps a boolean', () => {
  assert.equal(DEFAULTS.antigravity, true);
  assert.equal(clean({ antigravity: false }).antigravity, false);
  assert.equal(clean({ antigravity: 'yes' }).antigravity, true);
});

test('glow: on by default, colour "ai" or a #rrggbb hex', () => {
  assert.equal(DEFAULTS.glow, true);
  assert.equal(DEFAULTS.glowColor, 'ai');
  assert.equal(clean({ glow: false }).glow, false);
  assert.equal(clean({ glowColor: '#Ff8800' }).glowColor, '#Ff8800');
  for (const bad of ['red', '#12345', 42, null]) assert.equal(clean({ glowColor: bad }).glowColor, 'ai');
});
