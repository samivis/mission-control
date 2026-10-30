/**
 * Pure board builder. No I/O.
 *
 * @param {object} args
 * @param {number} args.now                     ms
 * @param {Map} args.agents                     from groupAgents(): sessionId -> {status:'busy'|'idle', pids:[], cwd}
 * @param {Map} args.transcripts                from indexTranscripts(): sessionId -> {defaultName,cwd,last,lastTs,endsWithQuestion,danglingTool,path}
 * @param {Map} args.events                     from reduceEvents(): sessionId -> {lastEvent,lastTs,notificationType,message,ended}
 * @param {object} args.meta                    from loadMeta()
 * @param {number} args.autoArchiveDays
 * @param {(id:string, reason:string)=>void} [args.onAutoArchive]  persist callback
 * @returns {{active: Item[], archived: Item[]}}
 */
export function buildBoard({ now, agents, transcripts, events, meta, autoArchiveDays = 7, onAutoArchive }) {
  const ids = new Set([...agents.keys(), ...transcripts.keys()]);
  const cutoff = now - autoArchiveDays * 24 * 60 * 60 * 1000;
  const active = [];
  const archived = [];

  for (const id of ids) {
    const a = agents.get(id);
    const t = transcripts.get(id);
    const e = events.get(id);
    const m = meta[id] || {};
    const live = !!a && a.pids.length > 0;

    const lastActivity = Math.max(t?.lastTs || 0, e?.lastTs || 0, ...(a?.pids || []).map((p) => p.startedAt || 0)) || 0;
    const cwd = a?.cwd || t?.cwd || m.cwd || '';
    const name = m.name || t?.defaultName || (cwd ? cwd.split('/').pop() : 'Untitled session');

    // Archive state
    let isArchived = !!m.archived;
    if (!isArchived && !live && m.archived === undefined && lastActivity && lastActivity < cutoff) {
      isArchived = true;
      if (onAutoArchive) onAutoArchive(id, `auto-${autoArchiveDays}d`);
    }

    // Status
    let status;
    let reason = '';
    if (!live) {
      status = 'ended';
    } else if (a.status === 'busy') {
      status = 'working';
    } else {
      // live + idle: decide between waiting and done
      const le = e?.lastEvent;
      const eventFresh = e && e.lastTs >= (t?.lastTs || 0) - 5000; // events after (or around) the last transcript write
      if (le === 'PermissionRequest' || (le === 'Notification' && e.notificationType === 'permission_prompt')) {
        status = 'waiting'; reason = 'Needs a permission approval';
      } else if (le === 'Notification' && eventFresh && (e.notificationType === 'idle_prompt' || !e.notificationType || e.notificationType === 'notification')) {
        status = t?.endsWithQuestion ? 'waiting' : 'done';
        reason = status === 'waiting' ? 'Asked you a question' : '';
      } else if (le === 'UserPromptSubmit' && eventFresh) {
        status = 'working';
      } else if (t?.danglingTool && le !== 'Stop') {
        status = 'waiting'; reason = 'Needs a permission approval';
      } else if (t?.endsWithQuestion) {
        status = 'waiting'; reason = 'Asked you a question';
      } else {
        status = 'done';
      }
    }

    const item = {
      id,
      name,
      status,
      reason,
      last: t?.last || (e?.message ? String(e.message) : '') || '',
      cwd,
      dir: cwd ? cwd.split('/').filter(Boolean).pop() || cwd : '',
      lastActivity,
      live,
      windows: a ? a.pids.length : 0,
      pids: a ? a.pids.map((p) => p.pid) : [],
      archived: isArchived,
      archivedAt: m.archivedAt || null,
      hasTranscript: !!t,
    };
    (isArchived ? archived : active).push(item);
  }

  const rank = { waiting: 0, working: 1, done: 2, ended: 3 };
  active.sort((x, y) => (rank[x.status] - rank[y.status]) || (y.lastActivity - x.lastActivity));
  archived.sort((x, y) => (y.archivedAt || y.lastActivity) - (x.archivedAt || x.lastActivity));
  return { active, archived };
}
