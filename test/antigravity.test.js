const test = require('node:test'), assert = require('node:assert/strict');
const { pickDaemons, parseQuota, isRunning, nextSession } = require('../antigravity');

test('pickDaemons: newest first, at most 5, skips incomplete files', () => {
  const f = (n, json) => ({ file: `hub_${n}.json`, mtimeMs: n, json });
  const files = [f(1, { httpsPort: 1, csrfToken: 'a' }), f(9, { httpsPort: 9, httpPort: 10, csrfToken: 'b' }), f(5, { httpPort: 5, csrfToken: 'c' }),
    f(2, { httpsPort: 2, csrfToken: 'd' }), f(3, { httpsPort: 3, csrfToken: 'e' }), f(4, { httpsPort: 4, csrfToken: 'f' }), f(8, { httpsPort: 8 }), f(7, { httpsPort: 7, csrfToken: 'g' })];
  assert.deepEqual(pickDaemons(files), [{ port: 9, token: 'b' }, { port: 7, token: 'g' }, { port: 4, token: 'f' }, { port: 3, token: 'e' }, { port: 2, token: 'd' }]);
});

test('parseQuota: groups and windows, as % used', () => {
  const q = parseQuota({ groups: [
    { displayName: 'Gemini Models', buckets: [
      { displayName: 'Weekly Limit Remaining', window: 'weekly', remainingFraction: 0.81, resetTime: '2026-11-28T15:08:00Z' },
      { displayName: 'Five Hour Limit Remaining', window: '5h', remainingFraction: 0.67, resetTime: '2026-11-22T12:17:34Z' }] },
    { displayName: 'Gemini 4 Argon', buckets: [{ window: 'weekly', remainingFraction: 1, resetTime: '2026-11-29T07:39:25Z' }] }] });
  assert.deepEqual(q.windows, [
    { group: 'Gemini Models', label: 'Weekly', pct: 19, resetsAt: Date.parse('2026-11-28T15:08:00Z') },
    { group: 'Gemini Models', label: '5-hour', pct: 33, resetsAt: Date.parse('2026-11-22T12:17:34Z') },
    { group: 'Gemini 4 Argon', label: 'Weekly', pct: 0, resetsAt: Date.parse('2026-11-29T07:39:25Z') }]);
});

test('parseQuota: missing remainingFraction means used up', () => {
  const q = parseQuota({ groups: [{ displayName: 'G', buckets: [{ window: '5h', resetTime: '2026-11-22T12:00:00Z' }, { window: 'weekly' }] }] });
  assert.deepEqual(q.windows.map((w) => [w.label, w.pct]), [['5-hour', 100]]); // no fraction and no reset time: skipped
});

test('parseQuota: accepts snake_case and a response wrapper', () => {
  const q = parseQuota({ response: { groups: [{ display_name: 'G', buckets: [{ window: 'weekly', remaining_fraction: 0.5, reset_time: '2026-11-22T12:00:00Z' }] }] } });
  assert.deepEqual(q.windows, [{ group: 'G', label: 'Weekly', pct: 50, resetsAt: Date.parse('2026-11-22T12:00:00Z') }]);
});

test('isRunning: any running conversation counts', () => {
  assert.equal(isRunning({ trajectorySummaries: { a: { status: 'CASCADE_RUN_STATUS_IDLE' }, b: { status: 'CASCADE_RUN_STATUS_RUNNING' } } }), true);
  assert.equal(isRunning({ trajectorySummaries: { a: { status: 'CASCADE_RUN_STATUS_IDLE' } } }), false);
});

test('isRunning: empty trajectories are idle', () => {
  assert.equal(isRunning({}), false);
  assert.equal(isRunning(null), false);
});

test('nextSession: a run keeps its start time, and ends with it', () => {
  const a = nextSession(null, true, 1000);
  assert.deepEqual(a, { working: true, at: 1000, since: 1000, project: '' });
  const b = nextSession(a, true, 4000);
  assert.deepEqual(b, { working: true, at: 4000, since: 1000, project: '' });
  assert.deepEqual(nextSession(b, false, 7000), { working: false, at: 7000, since: 1000, project: '' });
});

test('nextSession: idle polls keep the time it stopped', () => {
  const stopped = { working: false, at: 7000, since: 1000, project: '' };
  assert.deepEqual(nextSession(stopped, false, 60000), stopped);
  assert.equal(nextSession(null, false, 5000).at, 0); // never seen working: not "recently used"
});
