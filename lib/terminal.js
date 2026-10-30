import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';

const run = (cmd, args, opts = {}) => new Promise((resolve, reject) => {
  execFile(cmd, args, { timeout: 15000, ...opts }, (err, stdout, stderr) => (err ? reject(Object.assign(err, { stderr })) : resolve(stdout)));
});

export const shQuote = (v) => `'${String(v).replace(/'/g, `'\\''`)}'`;
const osaStr = (v) => `"${String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

export async function ttyForPid(pid) {
  const out = (await run('ps', ['-o', 'tty=', '-p', String(pid)])).trim();
  if (!out || out === '??') return null;
  return out.startsWith('/dev/') ? out : `/dev/${out}`;
}

async function appRunning(name) {
  try { await run('pgrep', ['-x', name]); return true; } catch { return false; }
}

/** Bring the Terminal.app or iTerm2 tab that owns `tty` to the front. Returns the app name used, or null. */
export async function focusTty(tty) {
  if (await appRunning('Terminal')) {
    const script = `
tell application "Terminal"
  repeat with w in windows
    repeat with t in tabs of w
      if (tty of t) is ${osaStr(tty)} then
        set selected tab of w to t
        set index of w to 1
        activate
        return "Terminal"
      end if
    end repeat
  end repeat
end tell
return ""`;
    const r = (await run('osascript', ['-e', script])).trim();
    if (r) return r;
  }
  if (await appRunning('iTerm2')) {
    const script = `
tell application "iTerm2"
  repeat with w in windows
    repeat with tb in tabs of w
      repeat with s in sessions of tb
        if (tty of s) is ${osaStr(tty)} then
          select tb
          select s
          activate
          return "iTerm2"
        end if
      end repeat
    end repeat
  end repeat
end tell
return ""`;
    const r = (await run('osascript', ['-e', script])).trim();
    if (r) return r;
  }
  return null;
}

/** Focus the first pid whose tty we can find in a terminal app. */
export async function focusSession(pids) {
  for (const pid of pids) {
    const tty = await ttyForPid(pid).catch(() => null);
    if (!tty) continue;
    const app = await focusTty(tty).catch(() => null);
    if (app) return { ok: true, pid, tty, app };
  }
  return { ok: false, error: 'Could not find a terminal window for this session.' };
}

/** Open a new Terminal.app window running `shellCmd` (a single shell line). */
export async function openTerminal(shellCmd) {
  const script = `tell application "Terminal"\n  do script ${osaStr(shellCmd)}\n  activate\nend tell`;
  await run('osascript', ['-e', script]);
}

export function buildClaudeCmd({ cwd, resumeId, sessionId, prompt, skipPermissions }) {
  const parts = ['claude'];
  if (resumeId) parts.push('--resume', shQuote(resumeId));
  if (sessionId) parts.push('--session-id', shQuote(sessionId));
  if (skipPermissions) parts.push('--dangerously-skip-permissions');
  if (prompt) parts.push(shQuote(prompt));
  return `cd ${shQuote(cwd)} && ${parts.join(' ')}`;
}

export async function resumeInTerminal({ cwd, sessionId, skipPermissions }) {
  await openTerminal(buildClaudeCmd({ cwd, resumeId: sessionId, skipPermissions }));
}

export async function startInTerminal({ cwd, prompt, skipPermissions }) {
  const sessionId = randomUUID();
  await openTerminal(buildClaudeCmd({ cwd, sessionId, prompt, skipPermissions }));
  return sessionId;
}
