// Spinning 3D ASCII version of the SneakPeek eye, shown by the `sneakpeek` command.
// MASK: the logo sampled into a grid ('#' = part of the eye), made once from assets/sneakpeek.svg.
const MASK = [
  '........................############........................',
  '....................###################.....................',
  '..................########################..................',
  '................############################................',
  '..............################################..............',
  '............###################################.............',
  '...........#############............#############...........',
  '.........############..................############.........',
  '.......############......................############.......',
  '.....############..........................###########......',
  '....###########.............................############....',
  '..############..........###########...........############..',
  '############..........###############...........############',
  '##########..........###################...........##########',
  '########..........#######################..........#########',
  '#######..........##########################..........#######',
  '######.........#############...#############...........#####',
  '########.....############..........###########...........###',
  '#########..############.....####....############..........##',
  '#####################......######.....############..........',
  '.###################......########......###########.........',
  '...###############.......##########.......###########.......',
  '.....############........##########........############.....',
  '......############.......##########.......###############...',
  '........############......########......###################.',
  '..........############....########....######################',
  '#...........###########....######...############..##########',
  '###..........############..........###########......########',
  '#####..........#############....#############.........######',
  '######...........##########################..........#######',
  '########...........######################..........#########',
  '##########..........###################...........##########',
  '############..........################..........###########.',
  '..###########...........###########...........############..',
  '...############.............................############....',
  '.....############..........................###########......',
  '.......############......................###########........',
  '.........############..................############.........',
  '..........##############............#############...........',
  '............###################################.............',
  '..............################################..............',
  '................############################................',
  '..................########################..................',
  '....................###################.....................',
  '........................############........................',
];

// The eye as a thin 3D slab: points on the front and back faces, plus the side walls along its edges,
// each with a surface normal so it can be shaded as it turns.
const T = 0.1; // half the slab's thickness (the eye is 2 units wide)
function buildPoints() {
  const R = MASK.length, C = MASK[0].length, pts = [];
  const filled = (r, c) => r >= 0 && r < R && c >= 0 && c < C && MASK[r][c] === '#';
  for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) {
    if (!filled(r, c)) continue;
    const x = ((c + 0.5) / C) * 2 - 1, y = (((r + 0.5) / R) * 2 - 1) * (R / C);
    pts.push({ x, y, z: T, n: [0, 0, 1] }, { x, y, z: -T, n: [0, 0, -1] });
    // Edge cell: add side-wall points facing away from the empty neighbours.
    let nx = 0, ny = 0;
    if (!filled(r, c - 1)) nx -= 1; if (!filled(r, c + 1)) nx += 1;
    if (!filled(r - 1, c)) ny -= 1; if (!filled(r + 1, c)) ny += 1;
    const len = Math.hypot(nx, ny);
    if (len) for (const z of [-T * 0.6, 0, T * 0.6]) pts.push({ x, y, z, n: [nx / len, ny / len, 0] });
  }
  return pts;
}

const RAMP = '.,:-=+*#%@'; // dark to bright
const LIGHT = (() => { const v = [-0.65, -0.6, 0.55], l = Math.hypot(...v); return v.map((a) => a / l); })();

// One frame: spin around the vertical axis by `a`, tip slightly by `t`, perspective-project, keep the nearest point per cell.
function render(pts, a, t, cols, rows) {
  const grid = Array.from({ length: rows }, () => Array(cols).fill(' '));
  const depth = new Float64Array(rows * cols).fill(-Infinity);
  const ca = Math.cos(a), sa = Math.sin(a), ct = Math.cos(t), st = Math.sin(t);
  const turn = ([x, y, z]) => { const x1 = x * ca + z * sa, z1 = -x * sa + z * ca; return [x1, y * ct - z1 * st, y * st + z1 * ct]; };
  const scale = cols * 0.47;
  for (const p of pts) {
    const [x, y, z] = turn([p.x, p.y, p.z]), n = turn(p.n);
    const persp = 3.2 / (3.2 - z);
    const sx = Math.round(cols / 2 + x * persp * scale), sy = Math.round(rows / 2 + y * persp * scale * 0.5); // characters are ~2x tall
    if (sx < 0 || sx >= cols || sy < 0 || sy >= rows || z <= depth[sy * cols + sx]) continue;
    depth[sy * cols + sx] = z;
    const lit = n[0] * LIGHT[0] + n[1] * LIGHT[1] + n[2] * LIGHT[2];
    grid[sy][sx] = RAMP[Math.max(0, Math.min(RAMP.length - 1, Math.floor(((lit + 1) / 2) ** 1.4 * RAMP.length)))];
  }
  return grid.map((line) => line.join('').replace(/\s+$/, ''));
}

const COLS = 50, ROWS = 19, INDENT = '  ';
const center = (s) => INDENT + ' '.repeat(Math.max(0, Math.floor((COLS - s.length) / 2))) + s;
const credits = (version) => ['', center(`SneakPeek ${version}`), center('built by Loyd De Guzman'), ''];

// Plays one smooth turn (~1.8s) that eases to a stop facing you, then prints the credits.
// Not a terminal (piped / redirected): prints the still logo instead. Ctrl+C restores the cursor.
async function play(version) {
  const out = process.stdout, pts = buildPoints();
  const still = () => render(pts, 0, 0.12, COLS, ROWS).map((l) => INDENT + l);
  if (!out.isTTY) { out.write([...still(), ...credits(version)].join('\n') + '\n'); return; }
  const restore = () => out.write('\x1b[?25h');
  const onInt = () => { restore(); process.exit(130); };
  process.once('SIGINT', onInt);
  out.write('\x1b[?25l'); // hide the cursor while drawing
  const FRAMES = 54, FRAME_MS = 33, start = Date.now();
  for (let i = 0; i <= FRAMES; i++) {
    const k = i / FRAMES, ease = 1 - (1 - k) ** 3;
    const lines = render(pts, -2 * Math.PI * (1 - ease), 0.12 + 0.18 * Math.sin(k * Math.PI), COLS, ROWS).map((l) => INDENT + l);
    out.write((i ? `\x1b[${ROWS}A` : '') + lines.map((l) => l + '\x1b[K').join('\n') + '\n');
    // Wait until this frame's slot on the clock (Windows timers round short waits up, which would slow the spin).
    await new Promise((r) => setTimeout(r, Math.max(0, start + (i + 1) * FRAME_MS - Date.now())));
  }
  restore();
  process.removeListener('SIGINT', onInt);
  out.write(credits(version).join('\n') + '\n');
}

module.exports = { play, render, buildPoints };
