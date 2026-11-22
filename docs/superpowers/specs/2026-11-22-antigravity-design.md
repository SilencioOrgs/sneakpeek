# Antigravity in SneakPeek: design

Date: 2026-11-22. Status: waiting for approval.

## Why

The owner uses the Antigravity IDE alongside Claude Code and Codex, and wants SneakPeek to show
Antigravity the same way: how much of its quota is used, and whether its agent is working.

## Goals

- Antigravity quota in the panel, grouped as Antigravity's own Usage panel groups it
  (Gemini Models, Claude and GPT models, Gemini 4 Argon), with 5-hour and weekly limits and reset times.
- Antigravity working status in the tab (its logo animates while the agent runs) and the usual
  "Antigravity is done" note when a run of at least `doneMinSec` ends.
- Usage alerts at the same 80% / 90% levels as Claude and ChatGPT.
- An **Antigravity** switch in Settings → AI tools, next to Claude Code and ChatGPT · Codex.

## Non-goals

- Approvals or questions from Antigravity (the IDE has no hooks for them).
- The Antigravity CLI. Only the IDE is covered.
- Per-model quota (the 20+ model rows). Groups only, as in Antigravity's Usage panel.

## Anti-goals

- Never use the owner's Google login or Antigravity's OAuth client, and never call Google's servers.
  Google's forum warns that can get accounts suspended.
- Never read conversation content. Only quota numbers and the run status enum are read.

## Constraints (found by the check script on the owner's PC, Antigravity 2.34)

- Antigravity's language server only answers with its token, which it gets privately at startup.
  Antigravity writes `~/.gemini/antigravity/daemon/hub_<port>.json` with `httpsPort`, `httpPort` and
  `csrfToken` each time it starts. Old files stay behind (57 on the owner's PC), so use the newest one
  that answers.
- Requests: `POST https://127.0.0.1:<httpsPort>/exa.language_server_pb.LanguageServerService/<Method>`,
  self-signed certificate, headers `Content-Type: application/json`, `Connect-Protocol-Version: 1`,
  `X-Codeium-Csrf-Token: <token>`, body `{"metadata":{"ideName":"antigravity","extensionName":"antigravity","locale":"en"}}`.
- Quota: `RetrieveUserQuotaSummary` → `groups[]` (`displayName`) → `buckets[]` (`displayName`, `window`
  = `5h` or `weekly`, `remainingFraction`, `resetTime`).
- Status: `GetAllCascadeTrajectories` → conversations with `status` `CASCADE_RUN_STATUS_RUNNING` or
  `CASCADE_RUN_STATUS_IDLE`. It is empty until a conversation exists. In the test, RUNNING showed
  within 1 s of the agent starting and IDLE within 2 s of it stopping.
- All of this is undocumented and may change with any Antigravity update.

## Approaches considered

| Approach | Trade-off | Decision |
|---|---|---|
| **Poll the language server's run status** every 3 s | Exact, ≤3 s delay, same connection as quota; undocumented | **Chosen** (owner agreed after the test) |
| Watch Antigravity's files, "done" after ~15 s of quiet | No token needed; but Antigravity writes files constantly even when idle, so it is late and gives false "done" notes | Dropped |
| Watch the language server's CPU use | Always available; can't tell indexing from the agent | Dropped |

Quota has one sensible way (the local language server). Signing in with Antigravity's login is ruled out above.

## Design

- **`antigravity.js`** (new): finds the newest daemon file that answers, keeps the connection,
  `quota()` and `running()` (true if any conversation is RUNNING). If the saved connection stops
  answering (Antigravity restarted), it looks again.
- **`usage.js`**: an `antigravity` provider. Each bucket becomes a window labelled
  `<group> · 5-hour` or `<group> · Weekly`, as % used. Same cache, stale marking and error handling as
  the others. Antigravity closed → last numbers, marked "Antigravity isn't open".
- **`main.js`**: while the switch is on, ask for the run status every 3 s (only when Antigravity is
  open; when it's closed, look for it again every 30 s). Feed it into the existing activity logic as
  `ai: 'antigravity'`, so the tab logo, "working" animation and "done" note work as they do for
  Claude and Codex. Refresh quota every 60 s like the others.
- **`index.html`**: an Antigravity section in the panel, grouped like the owner's screenshot. A group
  heading (Gemini Models, Claude and GPT models, Gemini 4 Argon), then its limits as SneakPeek meters.
  An Antigravity logo in the tab, and a working animation for it.
- **`settings.html` / `config.js`**: `antigravity: true` switch under AI tools. A note says no setup is
  needed and it works while the IDE is open.
- **`antigravity-probe.js`** is removed. It was a throwaway check.

## Calls made by Claude (correct any)

- **% used, not % left.** Antigravity's panel says "81% left". SneakPeek shows "% used" everywhere,
  and the alerts are at 80% / 90% used, so Antigravity matches the rest of SneakPeek.
- **Gemini 4 Argon** is shown like the other groups, because the owner's screenshot shows it.
- **Room in the panel.** With music, Claude, ChatGPT and five Antigravity limits on, the panel can
  outgrow its window. The builder makes the window tall enough, or tightens spacing, so nothing is cut off.
- **Logo.** A simple Antigravity-style mark drawn for SneakPeek, used the way the Claude and ChatGPT logos are.
- **Name in notes and alerts:** "Antigravity".

## Left to the builder

Exact spacing, the logo drawing and its working animation, and how retries back off when the
language server stops answering.
