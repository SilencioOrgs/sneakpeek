#!/usr/bin/env node
// The `sneakpeek` command (installed by `npm install -g github:loyd000/sneakpeek`).
//   sneakpeek           start SneakPeek (or open its Settings if it's already running)
//   sneakpeek --remove  take SneakPeek's hooks, status line and startup entry out of Claude Code, Codex and Windows.
//                       Run this before `npm uninstall -g sneakpeek`, or the hooks keep pointing at a deleted folder.
const { spawn, execFileSync } = require('child_process');
const path = require('path');

const args = process.argv.slice(2);

if (args.includes('--remove')) {
  let problems = 0;
  try { require('./integrations').removeAll(); console.log('Removed the hooks and status line from Claude Code and Codex.'); }
  catch (e) { problems++; console.error('Some integrations could not be removed: ' + e.message); }
  try {
    execFileSync('reg', ['delete', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run', '/v', 'SneakPeek', '/f'], { stdio: 'ignore' });
    console.log('Removed the "Start with Windows" entry.');
  } catch { /* no startup entry: nothing to remove */ }
  console.log(problems ? 'Fix the problem above, then run this again.' : 'Done. You can now run: npm uninstall -g sneakpeek');
  process.exit(problems ? 1 : 0);
}

if (args.includes('--help') || args.includes('-h')) {
  console.log('sneakpeek           start SneakPeek (or open Settings if it is already running)\nsneakpeek --remove  remove its hooks and startup entry before uninstalling');
  process.exit(0);
}

// From Node, require('electron') gives the path to the Electron that npm installed with SneakPeek.
const electron = require('electron');
const child = spawn(electron, [path.join(__dirname), ...args], { detached: true, stdio: 'ignore' });
child.unref();
console.log('SneakPeek is starting. Look for its tab on the right edge of your screen, and its icon in the tray.');
