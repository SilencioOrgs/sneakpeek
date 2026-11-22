# Glow while an AI waits: design

Date: 2026-11-22. Status: approved by the owner.

## Why

The owner wants to notice at a glance, from the corner of the eye, that an AI is waiting on them.

## Goals

- While at least one approval or question card is waiting, the tab (open as the panel at that moment)
  glows from behind and breathes slowly (about one cycle every 2.5 s).
- It turns off as soon as no card is waiting: answered, skipped, or timed out.
- Colour: by default the colour of the AI that has waited longest (the top card): Claude `--claude`,
  Codex `--codex`. Optionally one colour of the user's choice for every AI.
- Settings → Notifications: "Glow while waiting" with an on/off switch, and a choice of
  "Match the AI" (default) or "One colour" with a colour picker.
- `prefers-reduced-motion`: a steady glow, no breathing.

## Non-goals and anti-goals

- No glow for done notes, usage alerts, songs or "working". The glow only ever means "waiting on you".
- Never block clicks on the desktop: the glow takes no pointer events.
- No new windows, libraries or IPC channels.

## Approaches

| Approach | Trade-off | Decision |
|---|---|---|
| **CSS `drop-shadow` on the tab's SVG shape**, coloured and animated | Follows the morphing outline for free; a few lines of CSS | **Chosen** |
| A second blurred copy of the outline | Must mirror every frame of the morph | Dropped: same look, more code |
| A canvas or a separate glow window | Most work, more resources | Dropped |

## Design

- `config.js`: `glow: true`, `glowColor: 'ai'` (default) or a `#rrggbb` string. Anything else falls back to `'ai'`.
- `index.html`: `body.waiting` while `asks.length > 0`; `--glow` set to the chosen colour.
  `body.waiting #shape { filter: drop-shadow(...) }` in `--glow`, breathing with a keyframe animation.
  The window's see-through margin (left of the open panel and above/below it) leaves room for the blur.
- `settings.html`: the new row under Notifications; the colour picker shows only for "One colour".

## Calls made by Claude

- Breathing: shadow blur and opacity ease between a soft and a strong glow over 2.5 s.
- Two AIs waiting at once: the top card's AI (it has waited longest).
- The picker is the system colour picker (`<input type="color">`), starting at white when first chosen.
