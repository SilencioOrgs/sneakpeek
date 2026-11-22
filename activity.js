// Hook for Claude Code and Codex: records when each one starts and stops working, for SneakPeek's logo.
// Usage: node activity.js <claude|codex> <start|stop|end>   (the hook's event JSON arrives on stdin)
const fs = require('fs'), os = require('os'), path = require('path');
const [ai, what] = process.argv.slice(2);
const dir = path.join(os.homedir(), '.sneakpeek'), file = path.join(dir, 'activity.json');

let input = '';
process.stdin.on('data', (d) => (input += d)).on('end', () => {
  let ev = {};
  try { ev = JSON.parse(input); } catch {}
  const sid = ev.session_id || ev.sessionId || 'default';
  let state = {};
  try { state = JSON.parse(fs.readFileSync(file, 'utf8')); } catch {}
  const now = Date.now(), sessions = (state[ai] ??= {});
  for (const [id, s] of Object.entries(sessions)) if (now - s.at > 86400000) delete sessions[id]; // forget day-old sessions
  if (what === 'end') delete sessions[sid];
  else {
    const prev = sessions[sid], working = what === 'start';
    // since = when this stretch of work began (kept across heartbeats), so SneakPeek knows how long it ran.
    sessions[sid] = { working, at: now, since: working && prev?.working ? prev.since ?? now : working ? now : prev?.since ?? now,
      project: path.basename(ev.cwd || '') || prev?.project || '' };
  }
  try {
    fs.mkdirSync(dir, { recursive: true });
    const tmp = `${file}.${process.pid}`;
    fs.writeFileSync(tmp, JSON.stringify(state));
    fs.renameSync(tmp, file); // atomic, so SneakPeek never reads a half-written file
  } catch {}
});
