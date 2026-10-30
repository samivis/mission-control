import test from 'node:test';
import assert from 'node:assert/strict';
import { buildBoard } from '../lib/classify.js';
import { groupAgents } from '../lib/agents.js';

const NOW = Date.parse('2026-10-30T12:00:00Z');
const DAY = 24 * 60 * 60 * 1000;
const t = (over = {}) => ({ defaultName: 'do the thing', cwd: '/w/proj', last: 'All done.', lastTs: NOW - 60_000, endsWithQuestion: false, danglingTool: false, path: '/x', ...over });
const agentRow = (sessionId, status = 'idle', pid = 100) => ({ pid, cwd: '/w/proj', kind: 'interactive', startedAt: NOW - 3_600_000, sessionId, name: 'x', status });

function run({ agents = [], transcripts = {}, events = {}, meta = {}, onAutoArchive } = {}) {
  return buildBoard({ now: NOW, agents: groupAgents(agents), transcripts: new Map(Object.entries(transcripts)), events: new Map(Object.entries(events)), meta, autoArchiveDays: 7, onAutoArchive });
}

test('busy live session is working', () => {
  const { active } = run({ agents: [agentRow('a', 'busy')], transcripts: { a: t() } });
  assert.equal(active[0].status, 'working');
});

test('idle live session with no signals is done', () => {
  const { active } = run({ agents: [agentRow('a')], transcripts: { a: t() } });
  assert.equal(active[0].status, 'done');
});

test('idle live session whose last message is a question is waiting', () => {
  const { active } = run({ agents: [agentRow('a')], transcripts: { a: t({ endsWithQuestion: true }) } });
  assert.equal(active[0].status, 'waiting');
  assert.equal(active[0].reason, 'Asked you a question');
});

test('permission hook event makes an idle session waiting, busy session stays working', () => {
  const ev = { a: { lastEvent: 'PermissionRequest', lastTs: NOW, notificationType: 'permission_prompt' }, b: { lastEvent: 'PermissionRequest', lastTs: NOW, notificationType: 'permission_prompt' } };
  const { active } = run({ agents: [agentRow('a', 'idle', 1), agentRow('b', 'busy', 2)], transcripts: { a: t(), b: t() }, events: ev });
  assert.equal(active.find((i) => i.id === 'a').status, 'waiting');
  assert.equal(active.find((i) => i.id === 'b').status, 'working');
});

test('idle_prompt notification after a plain completion is done, after a question is waiting', () => {
  const ev = { a: { lastEvent: 'Notification', lastTs: NOW, notificationType: 'idle_prompt' }, b: { lastEvent: 'Notification', lastTs: NOW, notificationType: 'idle_prompt' } };
  const { active } = run({ agents: [agentRow('a', 'idle', 1), agentRow('b', 'idle', 2)], transcripts: { a: t(), b: t({ endsWithQuestion: true }) }, events: ev });
  assert.equal(active.find((i) => i.id === 'a').status, 'done');
  assert.equal(active.find((i) => i.id === 'b').status, 'waiting');
});

test('a Stop after a dangling tool call is done, a dangling tool call with no Stop is waiting', () => {
  const { active } = run({ agents: [agentRow('a', 'idle', 1), agentRow('b', 'idle', 2)], transcripts: { a: t({ danglingTool: true }), b: t({ danglingTool: true }) }, events: { a: { lastEvent: 'Stop', lastTs: NOW } } });
  assert.equal(active.find((i) => i.id === 'a').status, 'done');
  assert.equal(active.find((i) => i.id === 'b').status, 'waiting');
});

test('no live pid is ended; several pids on one session are counted as windows', () => {
  const { active } = run({ agents: [agentRow('a', 'idle', 1), agentRow('a', 'idle', 2), agentRow('a', 'busy', 3)], transcripts: { a: t(), b: t() } });
  const a = active.find((i) => i.id === 'a'); const b = active.find((i) => i.id === 'b');
  assert.equal(a.windows, 3); assert.equal(a.status, 'working');
  assert.equal(b.status, 'ended'); assert.equal(b.windows, 0);
});

test('8 days idle auto-archives (persisted); 6 days stays; live never auto-archives; explicit meta wins', () => {
  const persisted = [];
  const { active, archived } = run({
    agents: [agentRow('live')],
    transcripts: { old: t({ lastTs: NOW - 8 * DAY }), fresh: t({ lastTs: NOW - 6 * DAY }), live: t({ lastTs: NOW - 30 * DAY }), reopened: t({ lastTs: NOW - 20 * DAY }) },
    meta: { reopened: { archived: false } },
    onAutoArchive: (id, reason) => persisted.push([id, reason]),
  });
  assert.deepEqual(archived.map((i) => i.id), ['old']);
  assert.deepEqual(persisted, [['old', 'auto-7d']]);
  assert.deepEqual(active.map((i) => i.id).sort(), ['fresh', 'live', 'reopened']);
});

test('ordering: waiting, then working, then done, then ended; custom name wins over default', () => {
  const { active } = run({
    agents: [agentRow('w', 'busy', 1), agentRow('q', 'idle', 2), agentRow('d', 'idle', 3)],
    transcripts: { w: t(), q: t({ endsWithQuestion: true }), d: t(), e: t() },
    meta: { d: { name: 'My name' } },
  });
  assert.deepEqual(active.map((i) => i.status), ['waiting', 'working', 'done', 'ended']);
  assert.equal(active.find((i) => i.id === 'd').name, 'My name');
});
