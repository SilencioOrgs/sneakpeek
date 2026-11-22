# Antigravity Quota and Working Status Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** SneakPeek shows the Antigravity IDE's quota (grouped like Antigravity's Usage panel) and animates an Antigravity logo while its agent runs, with a "done" note and usage alerts, behind an Antigravity switch in Settings.

**Architecture:** A new `antigravity.js` finds the IDE's local language server through `~/.gemini/antigravity/daemon/hub_*.json`, and reads quota (`RetrieveUserQuotaSummary`) and run status (`GetAllCascadeTrajectories`) over `https://127.0.0.1`. `usage.js` adds it as a third provider. `main.js` polls run status every 3 s and feeds it into the existing activity logic as `ai: 'antigravity'`. The panel and Settings get an Antigravity section and switch.

**Tech Stack:** Node ≥18 CommonJS, Electron 45, plain HTML/CSS/JS, `node:test` for tests (no new dependencies).

**Spec:** `docs/superpowers/specs/2026-11-22-antigravity-design.md`

## Global Constraints

- No new npm dependencies. Tests use `node:test` and `node:assert/strict`, run with `npm test` (`node --test test/`).
- Never call Google's servers or use the owner's login: only `127.0.0.1`.
- Never read conversation content: only quota numbers and `status` enum values.
- Request: `POST https://127.0.0.1:<port>/exa.language_server_pb.LanguageServerService/<Method>`, `rejectUnauthorized: false`, headers `Content-Type: application/json`, `Connect-Protocol-Version: 1`, `X-Codeium-Csrf-Token: <token>`, body `{"metadata":{"ideName":"antigravity","extensionName":"antigravity","locale":"en"}}`, timeout 3000 ms.
- Running status value: `CASCADE_RUN_STATUS_RUNNING` (idle: `CASCADE_RUN_STATUS_IDLE`).
- Shown as **% used** (`round((1 - remainingFraction) * 100)`), labels `5-hour` / `Weekly`, name "Antigravity" everywhere.
- Status poll every 3 s while Antigravity answers, every 30 s while it doesn't; quota on the existing 60 s refresh.
- Match the existing code style: two-space indent, single quotes, short "why" comments, no build step.

## Review Focus

1. **Antigravity restarted** (new `hub_<port>.json`, old port dead): the next call must find the new server, not stay "closed". → Task 2 test `reconnects after the server moves`.
2. **Dozens of stale daemon files** (57 on the owner's PC): finding the server must try only the newest 5, so a closed IDE costs at most 5 failed localhost calls. → Task 2 test `tries at most the newest 5 daemon files`.
3. **An exhausted limit**: protobuf JSON leaves out `remainingFraction` when it is 0, so a bucket with `resetTime` but no `remainingFraction` is 100% used, not 0%. → Task 1 test `missing remainingFraction means used up`.
4. **No conversation yet**: `GetAllCascadeTrajectories` answers `{}`; that's idle, not an error. → Task 1 test `empty trajectories are idle`.
5. **Idle Antigravity stealing the tab logo**: idle polls must not count as fresh activity, or the tab shows Antigravity whenever Claude/Codex are idle too. → Task 1 test `idle polls keep the time it stopped`.

---

### Task 1: Pure Antigravity parsing helpers, and the test setup

**Files:**
- Create: `antigravity.js`
- Create: `test/antigravity.test.js`
- Modify: `package.json` (add `"test": "node --test test/"` to `scripts`)

**Interfaces:**
- Produces (exported from `antigravity.js`):
  - `pickDaemons(files: {file: string, mtimeMs: number, json: object}[]) -> {port: number, token: string}[]` — newest first, max 5, one entry per file using its `httpsPort`; skips files without `httpsPort` or `csrfToken`.
  - `parseQuota(summary: object) -> {plan: '', windows: {group: string, label: '5-hour'|'Weekly', pct: number, resetsAt: number|null}[]}` — keeps server order.
  - `isRunning(trajectories: object) -> boolean`
  - `nextSession(prev: {working, at, since}|null, running: boolean, now: number) -> {working: boolean, at: number, since: number, project: ''}`

- [ ] **Step 1: Add the test script and write the failing tests** in `test/antigravity.test.js`:

```js
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
```

- [ ] **Step 2: Run the tests to make sure they fail**

Run: `npm test`
Expected: FAIL with `Cannot find module '../antigravity'`

- [ ] **Step 3: Implement the four functions in `antigravity.js`**

Header comment: what the file reads and that it is undocumented (one or two lines, like `usage.js`). `parseQuota`: read `summary.groups ?? summary.response?.groups ?? []`, accept camelCase and snake_case field names, map `window` `5h` → `5-hour` and `weekly` → `Weekly` (anything else: keep `displayName`), skip a bucket with neither a fraction nor a reset time, `pct` clamped 0–100. `isRunning`: walk the object for any `status` key whose value is `CASCADE_RUN_STATUS_RUNNING`. `nextSession` with `null` and not running returns `{ working: false, at: 0, since: 0, project: '' }`.

- [ ] **Step 4: Run the tests to make sure they pass**

Run: `npm test`
Expected: PASS, 8 tests

- [ ] **Step 5: Commit**

```bash
git add antigravity.js test/antigravity.test.js package.json
git commit -m "Antigravity: parse quota and run status from its language server"
```

---

### Task 2: Antigravity client (find the server, reconnect, read quota and status)

**Files:**
- Modify: `antigravity.js`
- Modify: `test/antigravity.test.js`

**Interfaces:**
- Consumes: `pickDaemons`, `parseQuota`, `isRunning` (Task 1).
- Produces:
  - `createClient({ readDaemons?: () => files[], rpc?: (port, token, method) => Promise<object> }) -> { quota(): Promise<{plan, windows}>, running(): Promise<boolean> }` — both reject with an error that has `closed: true` and message `Antigravity isn't open` when no daemon answers.
  - Module default client: `module.exports.quota`, `module.exports.running` (a `createClient()` with the real `readDaemons` reading `~/.gemini/antigravity/daemon/*.json` and the real HTTPS `rpc`).

- [ ] **Step 1: Write the failing tests**

```js
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
  const rpc = async (port) => { if (port !== live) throw new Error('ECONNREFUSED'); return {}; };
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
```

- [ ] **Step 2: Run the tests to make sure they fail**

Run: `npm test`
Expected: FAIL with `createClient is not a function`

- [ ] **Step 3: Implement `createClient` and the real `readDaemons` / `rpc`**

Keep the working `{port, token}` in the closure. On a call: try the kept one; if it fails without an HTTP `status` (connection refused, timeout, TLS error), drop it and try each of `pickDaemons(readDaemons())` in order, keeping the first that answers. An error with an HTTP `status` from a reachable server is rethrown as is (only a 401/403 also drops the kept server, since the token changed). Real `rpc`: `https.request` per Global Constraints; non-2xx → reject with `status`; body parsed as JSON. Real `readDaemons`: read every `*.json` in `~/.gemini/antigravity/daemon` with its `mtimeMs`, ignoring unreadable or invalid files; missing folder → `[]`.

- [ ] **Step 4: Run the tests to make sure they pass**

Run: `npm test`
Expected: PASS, 12 tests

- [ ] **Step 5: Commit**

```bash
git add antigravity.js test/antigravity.test.js
git commit -m "Antigravity: find its language server and reconnect when it moves"
```

---

### Task 3: Settings switch and the usage provider

**Files:**
- Modify: `config.js` (DEFAULTS and `clean`)
- Modify: `usage.js` (`guarded`, `cachedUsage`, `getUsage`)
- Create: `test/usage.test.js`, `test/config.test.js`

**Interfaces:**
- Consumes: `require('./antigravity').quota` (Task 2).
- Produces:
  - `cfg.antigravity: boolean`, default `true`.
  - `getUsage({ claude, codex, antigravity })` and `cachedUsage()` results gain `antigravity: { ok, plan, windows: [{group, label, pct, resetsAt}], at, staleAt?, staleWhy? } | { ok: false, error, off? }`.
  - `usage.js` exports `_setAntigravity(fn)` for tests only: swaps the quota function and sets the cached entry's `next` to 0, so the next `getUsage` calls it.

- [ ] **Step 1: Write the failing tests**

`test/config.test.js`:
```js
const test = require('node:test'), assert = require('node:assert/strict');
const { clean, DEFAULTS } = require('../config');
test('antigravity defaults to on and keeps a boolean', () => {
  assert.equal(DEFAULTS.antigravity, true);
  assert.equal(clean({ antigravity: false }).antigravity, false);
  assert.equal(clean({ antigravity: 'yes' }).antigravity, true);
});
```

`test/usage.test.js` (set `HOME`/`USERPROFILE` to a fresh temp folder before requiring `usage.js`, so no real cache is read):
```js
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
```
(Run them in this order in one file: the second relies on the first's cached numbers.)

- [ ] **Step 2: Run the tests to make sure they fail**

Run: `npm test`
Expected: FAIL (`DEFAULTS.antigravity` is undefined; `_setAntigravity` is not a function)

- [ ] **Step 3: Implement**

`config.js`: add `antigravity: true` with comment "show Antigravity (usage, logo, alerts)", and `antigravity: bool('antigravity')` in `clean`. `usage.js`: in `guarded`'s catch, `e.closed` → `c.stale = "Antigravity isn't open"`, `c.error = e.message`, `c.next = 0`; `getUsage` adds `antigravity: on.antigravity ? guarded('antigravity', agQuota, 30000) : off` (default `on.antigravity` to `true`); `cachedUsage` includes `antigravity: saved(cache.antigravity) || wait`; `agQuota` defaults to `require('./antigravity').quota`.

- [ ] **Step 4: Run the tests to make sure they pass**

Run: `npm test` and `node usage.js` (prints `antigravity` with "Antigravity isn't open" here, since this machine has no Antigravity)
Expected: PASS, 16 tests

- [ ] **Step 5: Commit**

```bash
git add config.js usage.js test/usage.test.js test/config.test.js
git commit -m "Antigravity: Settings switch and quota in the usage feed"
```

---

### Task 4: Run status in the main process

**Files:**
- Modify: `main.js` (`refresh`, `applySettings`, `activity`, startup in `app.whenReady`)

**Interfaces:**
- Consumes: `require('./antigravity').running`, `nextSession` (Tasks 1–2), `cfg.antigravity` (Task 3).
- Produces: `activity` IPC messages can carry `ai: 'antigravity'`; `done` IPC messages can carry `ai: 'antigravity'` with `project: ''`.

- [ ] **Step 1: Implement `pollAntigravity()` in `main.js`**

Module state `let agSession = null, agTimer = 0`. `pollAntigravity()`: clear `agTimer`; if `!cfg.antigravity`, set `agSession = null`, call `activity()`, return. Otherwise `await running()`: on success `agSession = nextSession(agSession, r, Date.now())` and schedule again in 3000 ms; on an error with `closed`, `agSession = null` and schedule in 30000 ms; on any other error keep `agSession` and schedule in 3000 ms. Then call `activity()`. Start it in `whenReady` after `startMedia()` is set up; in `applySettings`, call it when `cfg.antigravity` changed and add `antigravity` to the `refresh()` / `getUsage` switches.

- [ ] **Step 2: Merge it into `activity()`**

After reading `activity.json`: `if (agSession) f.antigravity = { ide: agSession };` and loop over `['claude', 'codex', 'antigravity'].filter((x) => cfg[x])`. Skip a session whose `at` is 0 when picking `latest`. Fallback `ai` when nothing is known: first switched-on of claude, codex, antigravity.

- [ ] **Step 3: Check it loads and the tests still pass**

Run: `node --check main.js && npm test`
Expected: no syntax error; PASS, 16 tests

- [ ] **Step 4: Commit**

```bash
git add main.js
git commit -m "Antigravity: poll its run status and feed the tab's working state"
```

---

### Task 5: Panel section, logo, notes, alerts, and room for it all

**Files:**
- Modify: `index.html`
- Modify: `main.js` (`size()`: layout height)
- Create: `test/panel.screenshot.js` (Playwright check, not part of `npm test`)

**Interfaces:**
- Consumes: `usage.antigravity` (Task 3), `activity`/`done` with `ai: 'antigravity'` (Task 4), `cfg.antigravity`.

- [ ] **Step 1: Write the screenshot check** `test/panel.screenshot.js`

Loads `index.html` in Playwright Chromium (pre-installed; `require('playwright')`) at 380×760 with an init script defining `window.widget` as stubs that capture the `on*` callbacks. Then it sends settings with all switches on, music playing, and usage for Claude (2 windows), ChatGPT (2) and Antigravity (the 5 windows from the spec: Gemini Models Weekly 19 / 5-hour 33, Claude and GPT models Weekly 0 / 5-hour 0, Gemini 4 Argon Weekly 0). It pins the panel open and checks:
- `#antigravity .grp` texts are `['Gemini Models', 'Claude and GPT models', 'Gemini 4 Argon']`;
- `#antigravity .meter` count is 5;
- the last meter's bottom is inside `#panel`'s visible area, or `#panel` scrolls to it (`scrollHeight > clientHeight`).

It then sends `activity { ai: 'antigravity', working: true }`, checks `body.dataset.ai === 'antigravity'` and `body.working`, and saves `panel-antigravity.png` and `tab-antigravity-working.png` to the scratchpad. It exits 1 on any failed check.

- [ ] **Step 2: Run it to make sure it fails**

Run: `node test/panel.screenshot.js`
Expected: exit 1, "no #antigravity section"

- [ ] **Step 3: Implement in `index.html`**

- `--antigravity: #5b8def;` in `:root`.
- `<section class="prov" id="antigravity" style="--c: var(--antigravity)">` with name "Antigravity", after `#codex`; `body.no-antigravity #antigravity { display: none; }`, toggled in `onSettings`.
- `render()` loops `['claude', 'codex', 'antigravity']`; a window with `group` gets a `<div class="grp">group</div>` heading when the group changes (11 px, muted, 10 px top margin; the first one has none).
- `.mark.antigravity` with an inline SVG: a simple arch (an upside-down U with rounded ends) in `var(--antigravity)`, 28×28 like the others. Working: the arch "lifts", translating up 3 px and back every 1.2 s (`@keyframes float`), only under `body.working`. `body.music` hides it like the others; `prefers-reduced-motion` already stops it.
- One name map `const NAMES = { claude: 'Claude', codex: 'Codex', antigravity: 'Antigravity' }` used by the done toast, `checkAlerts` (loop over all three; Codex alerts keep saying "ChatGPT") and `paintTitle`. Toast colors map the same way.
- Room: layout height 620 → **760** (`CY` 310 → 380, `#toast` `top` 310px → 380px, `main.js` `size()` 620 → 760), and `#panel` gets `max-height` equal to the open shape's inner height with `overflow-y: auto` and a hidden scrollbar, so nothing is ever cut off.

- [ ] **Step 4: Run the check and look at the screenshots**

Run: `node test/panel.screenshot.js`
Expected: exit 0. Open both PNGs: three group headings with five bars, colors as the others, tab shows the floating arch.

- [ ] **Step 5: Commit**

```bash
git add index.html main.js test/panel.screenshot.js
git commit -m "Antigravity: panel section, tab logo, done notes and alerts"
```

---

### Task 6: Settings row, README, and remove the check script

**Files:**
- Modify: `settings.html` (AI tools section)
- Modify: `README.md` ("What it does", "Your data", "How it works" table)
- Delete: `antigravity-probe.js`

- [ ] **Step 1: Settings row**

Under AI tools, after ChatGPT · Codex: name "Antigravity", description "Usage, logo and alerts for the Antigravity IDE. Nothing to set up: works while Antigravity is open", `data-set="antigravity"`. The existing `[data-set]` wiring saves it.

- [ ] **Step 2: README**

"What it does": add Antigravity to the usage and "which AI is working" bullets. "Your data": one bullet: "**Antigravity.** SneakPeek reads the address and key Antigravity saves for its own windows in `~/.gemini/antigravity/daemon/`, and asks Antigravity on your computer (127.0.0.1) for your quota and whether its agent is running. It never uses your Google login, and never reads your conversations." "How it works" table: a row for `antigravity.js`. Note under the table that Antigravity's local API is undocumented too.

- [ ] **Step 3: Delete the probe and check everything**

Run: `git rm antigravity-probe.js && for f in *.js; do node --check "$f"; done && npm test && node test/panel.screenshot.js`
Expected: no syntax errors; PASS, 16 tests; exit 0

- [ ] **Step 4: Settings screenshot**

Load `settings.html` in Playwright with a stub `window.sneakpeek` returning a snapshot with all settings on; screenshot to the scratchpad. Expected: the Antigravity row under AI tools, switched on.

- [ ] **Step 5: Commit**

```bash
git add settings.html README.md
git commit -m "Antigravity: Settings switch, README, remove the check script"
```
