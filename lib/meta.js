import fs from 'node:fs';
import { META_FILE, ensureDir } from './paths.js';

/** meta.json: { [sessionId]: { name?, archived?, archivedAt?, archiveReason?, cwd?, createdAt?, lane?: {lane, setAt, turnKey} } } */
export function loadMeta(file = META_FILE) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) || {}; } catch { return {}; }
}

export function saveMeta(meta, file = META_FILE) {
  ensureDir();
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(meta, null, 2) + '\n');
  fs.renameSync(tmp, file);
}

export function setArchived(meta, id, archived, reason = 'manual') {
  const m = meta[id] || {};
  meta[id] = { ...m, archived, archivedAt: archived ? Date.now() : m.archivedAt, archiveReason: archived ? reason : undefined, touchedAt: Date.now() };
  return meta;
}

export function setName(meta, id, name) {
  const m = meta[id] || {};
  const n = (name || '').trim();
  meta[id] = { ...m, name: n || undefined, touchedAt: Date.now() };
  return meta;
}

export const LANES = ['waiting', 'working', 'done', 'ended'];

/** Pin a session to a lane until it takes another turn (turnKey changes). */
export function setLane(meta, id, lane, turnKey) {
  if (!LANES.includes(lane)) throw Object.assign(new Error('unknown lane'), { status: 400 });
  const m = meta[id] || {};
  meta[id] = { ...m, lane: { lane, setAt: Date.now(), turnKey: turnKey || 0 }, archived: m.archived === true ? false : m.archived, touchedAt: Date.now() };
  return meta;
}

export function clearLane(meta, id) {
  const m = meta[id] || {};
  const { lane, ...rest } = m;
  meta[id] = { ...rest, touchedAt: Date.now() };
  return meta;
}
