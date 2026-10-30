import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { validateRules, DEFAULT_RULES, saveRules, loadRules, revertLastRules, listRuleBackups, appendCorrection, unprocessedCorrections } from '../lib/rules.js';
import { asksForInput } from '../lib/transcripts.js';
import { runLearning, parseModelJson, buildPrompt } from '../lib/learn.js';
import { buildBoard } from '../lib/classify.js';
import { groupAgents } from '../lib/agents.js';
import { setLane, clearLane } from '../lib/meta.js';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'mc-rules-'));

test('validateRules: accepts defaults, normalizes case/space, dedupes', () => {
  const v = validateRules({ askPhrases: ['Tell  Me', 'tell me', 'Want me to'], reportPhrases: [] });
  assert.ok(v.ok);
  assert.deepEqual(v.rules.askPhrases, ['tell me', 'want me to']);
});

test('validateRules: rejects bad shapes', () => {
  assert.equal(validateRules(null).ok, false);
  assert.equal(validateRules({ askPhrases: 'tell me' }).ok, false);
  assert.equal(validateRules({ askPhrases: [42] }).ok, false);
  assert.equal(validateRules({ askPhrases: ['one two three four five six seven'] }).ok, false);
  assert.equal(validateRules({ askPhrases: ['the'] }).ok, false, 'one-word phrases are rejected');
  assert.equal(validateRules({ askPhrases: ['confirm'] }).ok, true, 'except a clear verb');
  assert.equal(validateRules({ askPhrases: Array.from({ length: 61 }, (_, i) => `p ${i}`) }).ok, false);
});

test('asksForInput reads phrases from rules; reportPhrases win over an inner ?', () => {
  const rules = { askPhrases: ['ping me'], reportPhrases: ['no action needed'] };
  assert.equal(asksForInput('All done. Ping me if anything breaks.', rules), true);
  assert.equal(asksForInput('All done. Tell me if anything breaks.', rules), false, 'default phrase not in custom rules');
  assert.equal(asksForInput('Is it fixed? Yes. No action needed.', rules), false);
  assert.equal(asksForInput('No action needed, unless you disagree?', rules), true, 'trailing ? always wins');
  assert.equal(asksForInput('Done. Tests pass.', DEFAULT_RULES), false);
});

test('saveRules backs up, loadRules picks up the change, revert restores', () => {
  const dir = tmp(); const f = path.join(dir, 'rules.json');
  const r0 = loadRules(f);
  assert.deepEqual(r0.askPhrases, DEFAULT_RULES.askPhrases);
  saveRules({ ...r0, askPhrases: ['ping me'] }, f);
  assert.deepEqual(loadRules(f).askPhrases, ['ping me']);
  assert.equal(listRuleBackups(f).length, 1);
  assert.throws(() => saveRules({ askPhrases: ['x'] }, f), /one-word/);
  revertLastRules(f);
  assert.deepEqual(loadRules(f).askPhrases, DEFAULT_RULES.askPhrases);
  assert.equal(listRuleBackups(f).length, 0);
});

test('corrections: appended and filtered by lastProcessedTs', () => {
  const dir = tmp(); const f = path.join(dir, 'corrections.jsonl');
  appendCorrection({ sessionId: 'a', from: 'done', to: 'waiting', lastText: 'Ping me when ready.' }, f);
  const all = unprocessedCorrections({ lastProcessedTs: 0 }, f);
  assert.equal(all.length, 1); assert.equal(all[0].to, 'waiting');
  assert.equal(unprocessedCorrections({ lastProcessedTs: Date.now() + 1000 }, f).length, 0);
});

test('runLearning: mocked runner updates rules, logs the real diff, marks corrections processed', async () => {
  const dir = tmp(); const rulesFile = path.join(dir, 'rules.json'); const cFile = path.join(dir, 'c.jsonl'); const log = path.join(dir, 'log.jsonl');
  appendCorrection({ sessionId: 'a', from: 'done', to: 'waiting', lastText: 'Ping me when ready.' }, cFile);
  appendCorrection({ sessionId: 'b', from: 'waiting', to: 'done', lastText: 'Shipped. Your call whether to announce.' }, cFile);
  let seenPrompt = '';
  const runner = async (prompt) => {
    seenPrompt = prompt;
    const r = loadRules(rulesFile);
    return '```json\n' + JSON.stringify({ askPhrases: [...r.askPhrases.filter((p) => p !== 'your call'), 'ping me'], reportPhrases: r.reportPhrases, changes: [{ op: 'add', list: 'askPhrases', phrase: 'ping me', why: 'user wants pings treated as asks' }, { op: 'remove', list: 'askPhrases', phrase: 'your call', why: 'false positive' }] }) + '\n```';
  };
  const r = await runLearning({ runner, rulesFile, correctionsFile: cFile, logFile: log, min: 2 });
  assert.ok(r.ran);
  assert.ok(seenPrompt.includes('Ping me when ready.'));
  assert.deepEqual(r.changes.map((c) => c.op + ':' + c.phrase).sort(), ['add:ping me', 'remove:your call']);
  assert.equal(r.changes.find((c) => c.phrase === 'ping me').why, 'user wants pings treated as asks');
  assert.ok(loadRules(rulesFile).askPhrases.includes('ping me'));
  assert.equal(unprocessedCorrections(loadRules(rulesFile), cFile).length, 0, 'corrections marked processed');
  assert.equal(fs.readFileSync(log, 'utf8').split('\n').filter(Boolean).length, 1);
  // second run: nothing new
  const r2 = await runLearning({ runner, rulesFile, correctionsFile: cFile, logFile: log, min: 1 });
  assert.equal(r2.ran, false);
});

test('runLearning: invalid model output is rejected and logged, rules untouched', async () => {
  const dir = tmp(); const rulesFile = path.join(dir, 'rules.json'); const cFile = path.join(dir, 'c.jsonl'); const log = path.join(dir, 'log.jsonl');
  appendCorrection({ sessionId: 'a', from: 'done', to: 'waiting', lastText: 'x' }, cFile);
  const before = JSON.stringify(loadRules(rulesFile).askPhrases);
  const r = await runLearning({ runner: async () => '{"askPhrases":["a"],"reportPhrases":[]}', rulesFile, correctionsFile: cFile, logFile: log, min: 1 });
  assert.equal(r.ran, false); assert.match(r.reason, /rejected/);
  assert.equal(JSON.stringify(loadRules(rulesFile).askPhrases), before);
  const r3 = await runLearning({ runner: async () => 'sorry, no', rulesFile, correctionsFile: cFile, logFile: log, min: 1 });
  assert.match(r3.reason, /skipped/);
  assert.equal(fs.readFileSync(log, 'utf8').split('\n').filter(Boolean).length, 2);
  assert.throws(() => parseModelJson('nope'));
  assert.ok(buildPrompt(DEFAULT_RULES, []).includes('askPhrases'));
});

// ---- lane overrides ----
const NOW = Date.parse('2026-10-30T12:00:00Z');
const tr = (over = {}) => ({ defaultName: 'x', cwd: '/w', last: 'All done.', lastTs: NOW - 60_000, lastText: 'All done.', endsWithQuestion: false, danglingTool: false, path: '/x', ...over });
const agentRow = (sessionId, status = 'idle', pid = 100) => ({ pid, cwd: '/w', kind: 'interactive', startedAt: NOW - 3_600_000, sessionId, name: 'x', status });
const run = ({ agents = [], transcripts = {}, meta = {}, events = {} }) => buildBoard({ now: NOW, agents: groupAgents(agents), transcripts: new Map(Object.entries(transcripts)), events: new Map(Object.entries(events)), meta, rules: DEFAULT_RULES, autoArchiveDays: 7 });

test('lane override holds while turnKey matches, exposes autoStatus, expires on the next turn', () => {
  const t0 = tr();
  let { active } = run({ agents: [agentRow('a')], transcripts: { a: t0 } });
  assert.equal(active[0].status, 'done'); assert.equal(active[0].overridden, false);
  const meta = setLane({}, 'a', 'waiting', active[0].turnKey);
  ({ active } = run({ agents: [agentRow('a')], transcripts: { a: t0 }, meta }));
  assert.equal(active[0].status, 'waiting'); assert.equal(active[0].autoStatus, 'done'); assert.equal(active[0].overridden, true);
  // session takes another turn → transcript lastTs bumps → override expires
  ({ active } = run({ agents: [agentRow('a')], transcripts: { a: tr({ lastTs: NOW - 1000 }) }, meta }));
  assert.equal(active[0].status, 'done'); assert.equal(active[0].overridden, false);
  // undo clears it
  ({ active } = run({ agents: [agentRow('a')], transcripts: { a: t0 }, meta: clearLane(meta, 'a') }));
  assert.equal(active[0].overridden, false);
});

test('working/ended overrides are display-only: facts win once state changes', () => {
  const t0 = tr();
  let { active } = run({ agents: [agentRow('a')], transcripts: { a: t0 } });
  const meta = setLane({}, 'a', 'working', active[0].turnKey);
  ({ active } = run({ agents: [agentRow('a')], transcripts: { a: t0 }, meta }));
  assert.equal(active[0].status, 'working');
  // process gone → ended regardless of the override
  ({ active } = run({ agents: [], transcripts: { a: t0 }, meta }));
  assert.equal(active[0].status, 'ended');
  // 'ended' override on a live session is ignored
  const m2 = setLane({}, 'a', 'ended', active[0].turnKey);
  ({ active } = run({ agents: [agentRow('a')], transcripts: { a: t0 }, meta: m2 }));
  assert.equal(active[0].status, 'done');
  assert.throws(() => setLane({}, 'a', 'bogus', 1));
});

test('classify uses rules phrases on lastText (not the cached endsWithQuestion)', () => {
  const t0 = tr({ lastText: 'Shipped. Ping me if it breaks.', endsWithQuestion: false });
  let { active } = run({ agents: [agentRow('a')], transcripts: { a: t0 } });
  assert.equal(active[0].status, 'done');
  ({ active } = buildBoard({ now: NOW, agents: groupAgents([agentRow('a')]), transcripts: new Map([['a', t0]]), events: new Map(), meta: {}, rules: { askPhrases: ['ping me'], reportPhrases: [] } }));
  assert.equal(active[0].status, 'waiting');
});
