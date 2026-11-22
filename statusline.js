// Claude Code status line. After each reply Claude Code pipes session JSON to stdin, including the plan's
// rate limits from the server's response headers. We save those for the widget (live, no API polling)
// and print a short line for the terminal.
const fs = require('fs'), os = require('os'), path = require('path');
const FEED = path.join(os.homedir(), '.claude', 'ai-limits-feed.json');

let input = '';
process.stdin.on('data', (d) => (input += d)).on('end', () => {
  let rl = null;
  try { rl = JSON.parse(input).rate_limits; } catch {}
  if (rl && (rl.five_hour || rl.seven_day)) {
    try {
      const tmp = `${FEED}.${process.pid}`;
      fs.writeFileSync(tmp, JSON.stringify({ at: Date.now(), rate_limits: rl }));
      fs.renameSync(tmp, FEED); // atomic, so the widget never reads a half-written file
    } catch {}
  }
  const pct = (label, w) => (w?.used_percentage == null ? null : `${label} ${Math.round(w.used_percentage)}%`);
  console.log([pct('5h', rl?.five_hour), pct('wk', rl?.seven_day)].filter(Boolean).join(' · '));
});
