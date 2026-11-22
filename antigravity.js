// Antigravity IDE: quota and whether its agent is running, read from its own language server on this computer.
// ponytail: the daemon files and these requests are undocumented (found on Antigravity 2.34); if they change, update here.
// Never uses the Google login and never reads conversations: only quota numbers and the run status.

// Antigravity writes ~/.gemini/antigravity/daemon/hub_<port>.json each time its language server starts.
// Old ones stay behind, so try the newest few.
function pickDaemons(files) {
  return [...files].sort((a, b) => b.mtimeMs - a.mtimeMs)
    .map((f) => ({ port: Number(f.json?.httpsPort), token: f.json?.csrfToken }))
    .filter((d) => d.port > 0 && typeof d.token === 'string' && d.token)
    .slice(0, 5);
}

const WINDOWS = { '5h': '5-hour', weekly: 'Weekly' };
// RetrieveUserQuotaSummary: groups (Gemini Models, Claude and GPT models...) of buckets (5h, weekly).
function parseQuota(summary) {
  const groups = summary?.groups ?? summary?.response?.groups ?? [];
  const windows = [];
  for (const g of groups) {
    const group = g.displayName ?? g.display_name ?? '';
    for (const b of g.buckets || []) {
      const frac = b.remainingFraction ?? b.remaining_fraction, reset = b.resetTime ?? b.reset_time;
      if (frac == null && !reset) continue;
      // Protobuf JSON leaves out zero values, so a missing fraction next to a reset time means nothing is left.
      const pct = Math.max(0, Math.min(100, Math.round((1 - (frac ?? 0)) * 100)));
      const label = WINDOWS[b.window] || b.displayName || b.display_name || b.window || '';
      windows.push({ group, label, pct, resetsAt: reset ? Date.parse(reset) : null });
    }
  }
  return { plan: '', windows };
}

// GetAllCascadeTrajectories: one entry per conversation, each with a run status. Empty until one exists.
function isRunning(trajectories) {
  if (!trajectories || typeof trajectories !== 'object') return false;
  return Object.entries(trajectories).some(([k, v]) =>
    (k === 'status' && v === 'CASCADE_RUN_STATUS_RUNNING') || (v && typeof v === 'object' && isRunning(v)));
}

// The session record main.js keeps for Antigravity, in activity.json's shape. While idle, `at` stays at the time
// it stopped, so an idle Antigravity never looks more recently used than Claude or Codex.
function nextSession(prev, running, now) {
  if (running) return { working: true, at: now, since: prev?.working ? prev.since : now, project: '' };
  if (prev?.working) return { working: false, at: now, since: prev.since, project: '' };
  return prev || { working: false, at: 0, since: 0, project: '' };
}

module.exports = { pickDaemons, parseQuota, isRunning, nextSession };
