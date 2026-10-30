import { execFile } from 'node:child_process';

/**
 * Group raw `claude agents --json` rows by sessionId.
 * Several pids can share one sessionId (several terminal windows attached to it).
 * Returns Map<sessionId, {sessionId, cwd, kind, status, pids:[{pid,startedAt,name}]}>.
 */
export function groupAgents(rows) {
  const out = new Map();
  for (const r of rows || []) {
    if (!r || !r.sessionId) continue;
    let g = out.get(r.sessionId);
    if (!g) {
      g = { sessionId: r.sessionId, cwd: r.cwd, kind: r.kind, status: 'idle', pids: [] };
      out.set(r.sessionId, g);
    }
    g.pids.push({ pid: r.pid, startedAt: r.startedAt, name: r.name });
    if (r.status === 'busy') g.status = 'busy';
    if (!g.cwd && r.cwd) g.cwd = r.cwd;
  }
  return out;
}

/** Run `claude agents --json`; resolves to [] on any failure (never throws). */
export function fetchAgents() {
  return new Promise((resolve) => {
    execFile('claude', ['agents', '--json'], { timeout: 15000, maxBuffer: 8 * 1024 * 1024 }, (err, stdout) => {
      if (err) return resolve([]);
      try {
        const parsed = JSON.parse(stdout);
        resolve(Array.isArray(parsed) ? parsed : []);
      } catch {
        resolve([]);
      }
    });
  });
}
