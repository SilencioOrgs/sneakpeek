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

const { createClient } = require('../antigravity');
const daemons = (...ports) => () => ports.map((p, i) => ({ file: `hub_${p}.json`, mtimeMs: 100 - i, json: { httpsPort: p, csrfToken: 't' + p } }));

test('client: uses the first daemon that answers, and keeps it', async () => {
  const calls = [];
  const rpc = async (port, token, method) => { calls.push(`${port}:${method}`); if (port !== 2) throw new Error('ECONNREFUSED');
    return method === 'GetAllCascadeTrajectories' ? { a: { status: 'CASCADE_RUN_STATUS_RUNNING' } } : { groups: [] }; };
  const c = createClient({ readDaemons: daemons(1, 2, 3), rpc });
  assert.equal(await c.running(), true);
  assert.deepEqual(await c.quota(), { plan: '', windows: [] });
  assert.deepEqual(calls, ['1:GetAllCascadeTrajectories', '2:GetAllCascadeTrajectories', '2:RetrieveUserQuotaSummary']);
});

test('client: reconnects after the server moves', async () => {
  let live = 1, files = daemons(1);
  const rpc = async (port) => { if (port !== live) throw Object.assign(new Error('refused'), { code: 'ECONNREFUSED' }); return {}; };
  const c = createClient({ readDaemons: () => files(), rpc });
  assert.equal(await c.running(), false);
  live = 2; files = daemons(2, 1); // Antigravity restarted on a new port
  assert.equal(await c.running(), false);
});

test('client: tries at most the newest 5 daemon files, then says closed', async () => {
  let n = 0;
  const c = createClient({ readDaemons: daemons(1, 2, 3, 4, 5, 6, 7), rpc: async () => { n++; throw new Error('ECONNREFUSED'); } });
  await assert.rejects(c.running(), (e) => e.closed === true && e.message === "Antigravity isn't open");
  assert.equal(n, 5);
});

test('client: an HTTP error from a live server is not "closed"', async () => {
  const rpc = async () => { throw Object.assign(new Error('HTTP 500'), { status: 500 }); };
  const c = createClient({ readDaemons: daemons(1), rpc });
  await assert.rejects(c.quota(), (e) => e.status === 500 && !e.closed);
});

test('client: one slow answer keeps the server (not "closed")', async () => {
  let slow = false; const calls = [];
  const rpc = async (port) => { calls.push(port); if (port === 1 && slow) { slow = false; throw Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' }); } return {}; };
  const c = createClient({ readDaemons: daemons(1), rpc });
  assert.equal(await c.running(), false);          // connects to 1
  slow = true;
  await assert.rejects(c.running(), (e) => !e.closed); // one timeout: an error, but not "closed"
  assert.equal(await c.running(), false);          // still on 1, no rescan needed
  assert.deepEqual(calls, [1, 1, 1]);
});

test('client: three slow answers in a row means look again', async () => {
  const rpc = async (port) => { if (port === 1) throw Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' }); return {}; };
  let files = daemons(1);
  const c = createClient({ readDaemons: () => files(), rpc: async (p, t, m) => (p === 1 && !c.started ? {} : rpc(p, t, m)) });
  assert.equal(await c.running(), false); c.started = true; // connected to 1, then it stalls
  files = daemons(2, 1);
  await assert.rejects(c.running(), (e) => !e.closed);
  await assert.rejects(c.running(), (e) => !e.closed);
  assert.equal(await c.running(), false); // third stall: rescans and finds 2
});

test('client: a wrong answer during a search does not lock onto that port', async () => {
  let agOpen = false; const calls = [];
  const rpc = async (port) => { calls.push(port);
    if (port === 9) throw Object.assign(new Error('HTTP 404'), { status: 404 }); // another program now owns this old port
    if (port === 1 && agOpen) return {}; throw Object.assign(new Error('refused'), { code: 'ECONNREFUSED' }); };
  let files = daemons(9);
  const c = createClient({ readDaemons: () => files(), rpc });
  await assert.rejects(c.running(), (e) => e.status === 404);
  agOpen = true; files = daemons(1, 9); // Antigravity starts
  assert.equal(await c.running(), false);
});

test('client: a restart on the same port with a new token is found at once', async () => {
  let token = 'old';
  const rpc = async (port, t) => { if (t !== token) throw Object.assign(new Error('HTTP 401'), { status: 401 }); return {}; };
  let files = () => [{ file: 'hub_1.json', mtimeMs: 1, json: { httpsPort: 1, csrfToken: token } }];
  const c = createClient({ readDaemons: () => files(), rpc });
  assert.equal(await c.running(), false);
  const stale = files(); token = 'new'; files = () => [{ file: 'hub_1.json', mtimeMs: 2, json: { httpsPort: 1, csrfToken: 'new' } }];
  void stale;
  assert.equal(await c.running(), false);
});
