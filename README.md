# SneakPeek

A small tab that peeks out from the right edge of your screen. Hover it to see:
- **Your AI usage.** How much of your Claude Code and ChatGPT/Codex limits you've used, and when they reset.
- **Which AI is working.** Claude's spinner or ChatGPT's shimmer while it works, and a quiet "done" note when it finishes.
- **Approvals and questions.** When Claude Code or Codex asks permission, or Claude asks you a question, answer it right there in SneakPeek.
- **What's playing.** Song, cover art and play/pause/skip for Spotify, YouTube, Apple Music and other players.

Windows 10 and 11 only, for now.

## Install

You need [Node.js](https://nodejs.org) 18 or newer, plus Claude Code and/or Codex signed in on this computer.

```
npm install -g github:loyd000/sneakpeek
sneakpeek
```

The first install downloads Electron (about 100 MB) once.

On the first start, SneakPeek opens its Settings. Switch on the integrations you want under **Claude Code integration** and **Codex integration**:
- **Claude Code:** start a new `claude` session afterwards. Running sessions don't pick up new hooks.
- **Codex:** it asks you to approve the new hooks. Type `/hooks` in Codex, approve the SneakPeek entries, then restart the Codex desktop app.

Turn on **Start with Windows** in Settings if you want SneakPeek to start with Windows.

## Using it

- **Hover** the tab to open the panel. **Click** it to keep the panel open.
- **Right-click** the tab, or click the tray icon, for Settings, Refresh and Quit.
- Running `sneakpeek` again while it's running opens Settings.

## Update

```
npm install -g github:loyd000/sneakpeek
```

Then quit SneakPeek from the tray and start it again.

## Uninstall

Remove SneakPeek's hooks first. Otherwise Claude Code and Codex keep calling a script that no longer exists:

```
sneakpeek --remove
npm uninstall -g sneakpeek
```

`--remove` takes SneakPeek's hooks and status line out of Claude Code and Codex, and removes its startup entry. Your own settings and other hooks aren't touched.

## Your data

- **No accounts.** SneakPeek reuses the sign-ins Claude Code and Codex already store on your computer (`~/.claude/.credentials.json` and `~/.codex/auth.json`).
- **Where your tokens go.** They're only sent to Anthropic and OpenAI, to the same usage endpoints the CLIs use for `/usage` and `/status`. When Claude's token expires, SneakPeek refreshes it and saves the new one to the same file, as Claude Code does.
- **What SneakPeek stores.** Its own settings, cached usage and activity live in `~/.sneakpeek/`.
- **How it changes your config.** It only ever adds or removes its own entries in `~/.claude/settings.json` and `~/.codex/hooks.json`, and saves a backup (`.bak-sneakpeek`) next to the file before each change. It refuses to touch a file that isn't valid JSON.
- **Music.** It reads Windows' own "now playing" info, the same as the volume-key popup. No Spotify login is needed.

## How it works

| File | What it does |
|---|---|
| `main.js` | The app: the tab window, tray, Settings window, polling |
| `index.html` | The tab and panel |
| `settings.html` | The Settings window |
| `usage.js` | Reads Claude and ChatGPT usage, with backoff for rate limits and a saved cache |
| `statusline.js` | Claude Code status line: passes live usage to SneakPeek after every reply |
| `activity.js` | Hook: records when Claude Code / Codex start and stop working |
| `ask.js` | Hook: shows permission prompts and questions in SneakPeek and returns your answer |
| `media.ps1` | PowerShell helper that reads Windows' now-playing info |
| `integrations.js` | Adds and removes SneakPeek's hooks safely |
| `cli.js` | The `sneakpeek` command |

The usage endpoints are undocumented. If Anthropic or OpenAI change them, `usage.js` needs updating. To see what SneakPeek reads, without the UI, run `node usage.js` in the install folder.

Running from a clone instead: `git clone`, then `npm install`, then `npm start`.
