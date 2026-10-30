import fs from 'node:fs';
import { EVENTS_FILE } from './paths.js';
import { parseLines } from './transcripts.js';

/**
 * Reduce hook events (one JSON object per line: {ts, event, session_id, cwd, message?, notification_type?})
 * into the latest meaningful state per session.
 * Returns Map<session_id, {lastEvent, lastTs, notificationType, message, ended, endedTs, started}>.
 */
export function reduceEvents(records) {
  const out = new Map();
  for (const r of records) {
    if (!r || !r.session_id || !r.event) continue;
    const ts = typeof r.ts === 'number' ? r.ts : Date.parse(r.ts) || 0;
    let s = out.get(r.session_id);
    if (!s) { s = { lastEvent: null, lastTs: 0, notificationType: null, message: null, ended: false, endedTs: 0, started: false }; out.set(r.session_id, s); }
    switch (r.event) {
      case 'SessionStart':
        s.started = true; s.ended = false; s.lastEvent = 'SessionStart'; s.lastTs = ts; s.notificationType = null; break;
      case 'SessionEnd':
        s.ended = true; s.endedTs = ts; s.lastEvent = 'SessionEnd'; s.lastTs = ts; break;
      case 'UserPromptSubmit':
        s.lastEvent = 'UserPromptSubmit'; s.lastTs = ts; s.notificationType = null; s.message = null; s.ended = false; break;
      case 'Stop':
        s.lastEvent = 'Stop'; s.lastTs = ts; s.ended = false; break;
      case 'Notification':
        s.lastEvent = 'Notification'; s.lastTs = ts; s.notificationType = r.notification_type || 'notification'; s.message = r.message || null; break;
      case 'PermissionRequest':
        s.lastEvent = 'PermissionRequest'; s.lastTs = ts; s.notificationType = 'permission_prompt'; s.message = r.message || null; break;
      default:
        break;
    }
  }
  return out;
}

export function loadEvents() {
  try { return reduceEvents(parseLines(fs.readFileSync(EVENTS_FILE, 'utf8'))); } catch { return new Map(); }
}
