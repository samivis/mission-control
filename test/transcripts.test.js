import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseLines, firstPrompt, tailSummary, fullTranscript, readTail, readHead } from '../lib/transcripts.js';
import { reduceEvents } from '../lib/events.js';

const l = (o) => JSON.stringify(o);
const user = (text, extra = {}) => ({ type: 'user', message: { role: 'user', content: text }, timestamp: '2026-10-30T10:00:00Z', cwd: '/w/proj', ...extra });
const asst = (content) => ({ type: 'assistant', message: { role: 'assistant', content }, timestamp: '2026-10-30T10:01:00Z', cwd: '/w/proj' });
const toolResult = () => ({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', content: 'ok' }] }, timestamp: '2026-10-30T10:02:00Z' });

test('firstPrompt skips meta/caveat lines and uses the first real prompt', () => {
  const recs = parseLines([
    l({ type: 'last-prompt', sessionId: 'x' }),
    l(user('<local-command-caveat>ran a thing</local-command-caveat>')),
    l(user('fix the autopay copy', { isMeta: false })),
  ].join('\n'));
  assert.equal(firstPrompt(recs), 'fix the autopay copy');
});

test('tailSummary: last assistant text wins, question is detected, cwd + lastTs captured', () => {
  const recs = [user('go'), asst([{ type: 'text', text: 'Done with step 1.\nWhich half should I do first?' }])];
  const s = tailSummary(recs);
  assert.equal(s.last, 'Which half should I do first?');
  assert.equal(s.endsWithQuestion, true);
  assert.equal(s.cwd, '/w/proj');
  assert.equal(s.lastTs, Date.parse('2026-10-30T10:01:00Z'));
});

test('tailSummary: a question followed by a user reply is no longer waiting', () => {
  const recs = [asst([{ type: 'text', text: 'Which one?' }]), user('the first')];
  assert.equal(tailSummary(recs).endsWithQuestion, false);
});

test('tailSummary: dangling tool call is flagged; a tool_result clears it', () => {
  const dangling = [asst([{ type: 'text', text: 'Running it.' }, { type: 'tool_use', name: 'Bash', input: {} }])];
  assert.equal(tailSummary(dangling).danglingTool, true);
  assert.equal(tailSummary(dangling).last, 'Using Bash');
  const completed = [...dangling, toolResult(), asst([{ type: 'text', text: 'All green.' }])];
  const s = tailSummary(completed);
  assert.equal(s.danglingTool, false);
  assert.equal(s.last, 'All green.');
});

test('fullTranscript renders you/claude/tool items and skips tool results + meta', () => {
  const recs = [user('hi'), asst([{ type: 'text', text: 'hello' }, { type: 'tool_use', name: 'Read' }]), toolResult(), user('x', { isMeta: true })];
  assert.deepEqual(fullTranscript(recs), [{ who: 'you', text: 'hi' }, { who: 'claude', text: 'hello' }, { tool: 'Read' }]);
});

test('readTail drops the partial first line; readHead reads from the start', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-'));
  const f = path.join(dir, 's.jsonl');
  const big = Array.from({ length: 3000 }, (_, i) => l(user('line ' + i + ' ' + 'x'.repeat(50)))).join('\n') + '\n' + l(asst([{ type: 'text', text: 'the end' }])) + '\n';
  fs.writeFileSync(f, big);
  const size = fs.statSync(f).size;
  const tail = readTail(f, size);
  assert.ok(tail.length > 10);
  assert.equal(tailSummary(tail).last, 'the end');
  assert.equal(firstPrompt(readHead(f, size)), 'line 0 ' + 'x'.repeat(50));
});

test('reduceEvents keeps the latest meaningful event per session', () => {
  const ev = reduceEvents([
    { ts: 1, event: 'SessionStart', session_id: 'a' },
    { ts: 2, event: 'UserPromptSubmit', session_id: 'a' },
    { ts: 3, event: 'Notification', session_id: 'a', notification_type: 'permission_prompt', message: 'Bash needs approval' },
    { ts: 4, event: 'SessionEnd', session_id: 'b' },
    { event: 'garbage' },
  ]);
  assert.equal(ev.get('a').lastEvent, 'Notification');
  assert.equal(ev.get('a').notificationType, 'permission_prompt');
  assert.equal(ev.get('a').message, 'Bash needs approval');
  assert.equal(ev.get('b').ended, true);
});

test('a session started with a slash command is named after the command', () => {
  const recs = [user('<command-message>context-restore</command-message>\n<command-name>/context-restore</command-name>')];
  assert.equal(firstPrompt(recs), '/context-restore');
});
