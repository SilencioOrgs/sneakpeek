# Glow While Waiting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The tab glows and breathes in the waiting AI's colour (or one chosen colour) while an approval or question waits, with a switch and colour choice in Settings.

**Architecture:** `config.js` gains `glow` and `glowColor`. `index.html` already sets `body.asking` while cards wait; CSS puts an animated `drop-shadow` in `--glow` on `#shape` under `body.asking.glow`. `settings.html` gets one row.

**Tech Stack:** plain HTML/CSS/JS, `node:test`, Playwright (pre-installed) for page checks.

**Spec:** `docs/superpowers/specs/2026-11-22-waiting-glow-design.md`

## Global Constraints

- `glowColor` is `'ai'` or `#rrggbb` (lowercase or uppercase hex); anything else → `'ai'`. `glow` default `true`.
- Colours: Claude `var(--claude)`, Codex `var(--codex)`, from the top (longest-waiting) card's `ai`.
- Breathing cycle 2.5 s; `prefers-reduced-motion` keeps a steady glow (the existing rule already stops animations).
- The glow never takes pointer events; no new IPC channels or files besides tests.

## Review Focus

1. **Answering the last card turns the glow off**, even if the panel stays pinned open. → Task 2 check "no cards: no glow".
2. **Glow switched off in Settings while a card waits** turns it off at once. → Task 2 check "switch off: no glow".
3. **A bad saved colour** (`'red'`, `'#12345'`) falls back to the AI colour. → Task 1 test.
4. **Two AIs waiting**: the top card's AI colour. → Task 2 check "Codex first: green".
5. **The glow fits in the window**: blur must not be clipped at the panel's top or bottom at the open size. → Task 2 screenshot, looked at.

---

### Task 1: Settings values

**Files:** Modify `config.js`; Modify `test/config.test.js`

**Interfaces:** Produces `cfg.glow: boolean` (default `true`), `cfg.glowColor: 'ai' | '#rrggbb'` (default `'ai'`).

- [ ] **Step 1: Failing test** in `test/config.test.js`:
```js
test('glow: on by default, colour "ai" or a #rrggbb hex', () => {
  assert.equal(DEFAULTS.glow, true);
  assert.equal(DEFAULTS.glowColor, 'ai');
  assert.equal(clean({ glow: false }).glow, false);
  assert.equal(clean({ glowColor: '#Ff8800' }).glowColor, '#Ff8800');
  for (const bad of ['red', '#12345', 42, null]) assert.equal(clean({ glowColor: bad }).glowColor, 'ai');
});
```
- [ ] **Step 2:** `npm test` → FAIL (`DEFAULTS.glow` undefined)
- [ ] **Step 3:** add both to `DEFAULTS` (comments: "glow behind the tab while an AI waits for an answer", "'ai' = the asking AI's colour, or one #rrggbb colour") and to `clean`.
- [ ] **Step 4:** `npm test` → PASS, 21 tests
- [ ] **Step 5:** commit `Glow: settings for the waiting glow`

### Task 2: The glow on the tab

**Files:** Modify `index.html`; Modify `test/panel.screenshot.js`

**Interfaces:** Consumes `cfg.glow`, `cfg.glowColor`; `asks` (array, oldest first, each with `ai`).

- [ ] **Step 1: Failing checks** appended to `test/panel.screenshot.js` (before the short-window part), using `window.__cb.requests([...])` with cards `{ id: <36-char uuid>, ai, tool: 'Bash', verb: 'run', detail: 'npm test', project: 'x', at, pid: 1 }`:
  - one Claude card → `getComputedStyle(#shape).filter` contains `drop-shadow` and the Claude colour `rgb(217, 119, 87)`; save `glow-claude.png`.
  - Codex card first, then a Claude card → filter contains `rgb(0, 255, 200)` ("Codex first: green").
  - settings with `glowColor: '#ff00ff'` → filter contains `rgb(255, 0, 255)`.
  - settings with `glow: false` → filter is `none` ("switch off: no glow").
  - `requests([])` with glow on → filter is `none` ("no cards: no glow").
- [ ] **Step 2:** `node test/panel.screenshot.js <scratchpad>` → exit 1 (no drop-shadow)
- [ ] **Step 3:** In `index.html`: `--glow` variable; `body.asking.glow #shape { filter: drop-shadow(0 0 var(--glow-r) var(--glow)); animation: breathe 2.5s ease-in-out infinite; }` with `@keyframes breathe` easing `--glow-r` (registered with `@property` as `<length>`, 6px → 16px) and opacity of the shadow colour; `body.glow` toggled from `cfg.glow`; `--glow` set in a `paintGlow()` called from `renderAsks` and `onSettings`: `cfg.glowColor !== 'ai' ? cfg.glowColor : asks[0]?.ai === 'codex' ? 'var(--codex)' : 'var(--claude)'`.
- [ ] **Step 4:** run the check → exit 0; open `glow-claude.png`: an orange glow around the open panel, not clipped at top or bottom.
- [ ] **Step 5:** commit `Glow: light the tab while an AI waits for an answer`

### Task 3: Settings row

**Files:** Modify `settings.html`

**Interfaces:** Consumes `cfg.glow`, `cfg.glowColor` through the existing `window.sneakpeek.set(patch)`.

- [ ] **Step 1:** Under Notifications, after "Usage alerts": row "Glow while waiting", description "Lights up the tab while an AI waits for your answer"; a `<select id="glowMode">` (`ai` "Match the AI", `one` "One colour"), an `<input type="color" id="glowColor">` shown only for `one` (starts at `#ffffff` when switched to `one` from `ai`), and `<label class="sw"><input type="checkbox" data-set="glow"></label>`. Select and picker styled like `.num`.
- [ ] **Step 2:** wiring: `render()` sets the select from `c.glowColor === 'ai'`, the picker value and visibility; changing the select to `ai` → `set({ glowColor: 'ai' })`, to `one` → `set({ glowColor: picker.value || '#ffffff' })`; picker `change` → `set({ glowColor: value })`.
- [ ] **Step 3: Check** with Playwright and a stub `window.sneakpeek` whose `set()` records patches: the row exists; picker hidden for `'ai'`; choosing "One colour" records `{ glowColor: '#ffffff' }` and shows the picker; screenshot to the scratchpad and look at it.
- [ ] **Step 4:** `npm test` and `node test/panel.screenshot.js <scratchpad>` → PASS / exit 0
- [ ] **Step 5:** commit `Glow: Settings switch and colour choice`
