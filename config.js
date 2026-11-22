// SneakPeek's own settings, kept in ~/.sneakpeek/settings.json. Unknown or bad values fall back to the defaults.
const fs = require('fs'), os = require('os'), path = require('path');
const FILE = path.join(os.homedir(), '.sneakpeek', 'settings.json');

const DEFAULTS = {
  claude: true,          // show Claude Code (usage, logo, alerts)
  codex: true,           // show ChatGPT / Codex
  antigravity: true,     // show Antigravity (usage, logo, alerts)
  music: true,           // now playing from any media app (Spotify, browsers...)
  songNotes: true,       // ...with a small note when the song changes
  sounds: true,          // master switch for every chime
  doneNotes: true,       // "Claude is done" note when work finishes
  doneMinSec: 10,        // ...only for work that ran at least this long
  alerts: true,          // usage alerts
  alertLevels: [80, 90], // ...at these percentages
  glow: true,            // glow behind the tab while an AI waits for an answer
  glowColor: 'ai',       // ...'ai' = the asking AI's colour, or one #rrggbb colour
  scale: 0.75,           // widget size
  offset: 50,            // vertical position on the screen edge, 0 = top, 100 = bottom
};

const num = (v, lo, hi, d) => (typeof v === 'number' && v >= lo && v <= hi ? v : d);
function clean(s) {
  const d = DEFAULTS, bool = (k) => (typeof s[k] === 'boolean' ? s[k] : d[k]);
  const levels = Array.isArray(s.alertLevels) ? [...new Set(s.alertLevels.filter((n) => Number.isInteger(n) && n > 0 && n < 100))].sort((a, b) => a - b) : d.alertLevels;
  return {
    claude: bool('claude'), codex: bool('codex'), antigravity: bool('antigravity'), music: bool('music'), songNotes: bool('songNotes'), sounds: bool('sounds'), doneNotes: bool('doneNotes'), alerts: bool('alerts'),
    doneMinSec: num(s.doneMinSec, 0, 600, d.doneMinSec),
    alertLevels: levels.length ? levels.slice(0, 3) : d.alertLevels,
    glow: bool('glow'),
    glowColor: typeof s.glowColor === 'string' && /^#[0-9a-f]{6}$/i.test(s.glowColor) ? s.glowColor : d.glowColor,
    scale: num(s.scale, 0.5, 1.25, d.scale),
    offset: num(s.offset, 0, 100, d.offset),
  };
}

function load() {
  try { return clean(JSON.parse(fs.readFileSync(FILE, 'utf8'))); } catch { return { ...DEFAULTS }; }
}

function save(s) {
  const c = clean(s);
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE + '.tmp', JSON.stringify(c, null, 2));
  fs.renameSync(FILE + '.tmp', FILE);
  return c;
}

module.exports = { load, save, clean, DEFAULTS };
