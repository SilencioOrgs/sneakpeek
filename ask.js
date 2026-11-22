// PermissionRequest hook for Claude Code and Codex: shows the approval in SneakPeek and waits for Allow/Deny.
// Usage: node ask.js <claude|codex>   (the hook's event JSON arrives on stdin)
// If SneakPeek isn't running, or nobody answers in time, it exits silently and the normal prompt takes over.
const fs = require('fs'), os = require('os'), path = require('path'), crypto = require('crypto');
const ai = process.argv[2];
const dir = path.join(os.homedir(), '.sneakpeek');
const REQS = path.join(dir, 'requests');
const WAIT_MS = 60_000; // keep below the hook timeout in settings (90s), so we always exit cleanly

function appRunning() {
  try { process.kill(Number(fs.readFileSync(path.join(dir, 'sneakpeek.pid'), 'utf8')), 0); return true; } catch { return false; }
}

// One readable line for what's being approved.
function describe(tool = '', input = {}) {
  const cmd = Array.isArray(input.command) ? input.command.join(' ') : input.command || input.cmd;
  if (cmd) return { verb: 'run', detail: String(cmd) };
  const file = input.file_path || input.path || input.notebook_path;
  if (file) return { verb: /write/i.test(tool) ? 'write' : 'edit', detail: String(file) };
  if (input.url) return { verb: 'open', detail: String(input.url) };
  if (input.patch || input.input) return { verb: 'apply a patch', detail: String(input.patch || input.input).split('\n').filter((l) => /^\*\*\* (Add|Update|Delete) File/.test(l)).join('\n') || 'files' };
  return { verb: `use ${tool || 'a tool'}`, detail: JSON.stringify(input).slice(0, 300) };
}

let input = '';
process.stdin.on('data', (d) => (input += d)).on('end', () => {
  if (!appRunning()) return;
  let ev = {};
  try { ev = JSON.parse(input); } catch { return; }
  const id = crypto.randomUUID(), file = path.join(REQS, id + '.json'), answer = path.join(REQS, id + '.answer');
  const { verb, detail } = describe(ev.tool_name, ev.tool_input || {});
  const req = { id, ai, tool: ev.tool_name || '', verb, detail, project: path.basename(ev.cwd || process.cwd()), at: Date.now(), pid: process.pid };
  // Claude's multiple-choice questions get a question card; the pick goes back as the tool's `answers`.
  const qs = ev.tool_name === 'AskUserQuestion' && Array.isArray(ev.tool_input?.questions) ? ev.tool_input.questions : null;
  if (qs) req.questions = qs.map((q) => ({ question: String(q.question), multiSelect: !!q.multiSelect, options: (q.options || []).map((o) => String(o.label)) }));
  try {
    fs.mkdirSync(REQS, { recursive: true });
    fs.writeFileSync(file + '.tmp', JSON.stringify(req));
    fs.renameSync(file + '.tmp', file);
  } catch { return; }

  const done = () => { for (const f of [file, answer]) try { fs.unlinkSync(f); } catch {} };
  process.on('SIGTERM', () => { done(); process.exit(0); }); // hook timed out or the session was interrupted
  // (On Windows a killed hook skips this; SneakPeek drops cards whose hook process is gone.)
  const t0 = Date.now();
  const poll = setInterval(() => {
    let a = null;
    try { a = fs.readFileSync(answer, 'utf8').trim(); } catch {}
    let decision = null;
    if (a === 'allow') decision = { behavior: 'allow' };
    else if (a === 'deny') decision = { behavior: 'deny', message: 'Denied from SneakPeek' };
    else if (a?.startsWith('{')) try { decision = { behavior: 'allow', updatedInput: { ...ev.tool_input, answers: JSON.parse(a).answers } }; } catch {}
    if (a === 'skip') { clearInterval(poll); done(); } // answer it in the app instead
    else if (decision) {
      clearInterval(poll); done();
      process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PermissionRequest', decision } }));
    } else if (Date.now() - t0 > WAIT_MS || !appRunning()) {
      clearInterval(poll); done(); // fall back to the normal prompt
    }
  }, 200);
});
