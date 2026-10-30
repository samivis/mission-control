import { execFile } from 'node:child_process';
import {
  loadRules, saveRules, validateRules, unprocessedCorrections, appendLearningLog, RULES_FILE, CORRECTIONS_FILE, LEARNING_LOG,
} from './rules.js';

export const LEARN_EVERY = 3;        // auto-run once this many new corrections pile up
export const LEARN_DEBOUNCE_MS = 5000;
const TIMEOUT_MS = 90_000;

export function buildPrompt(rules, corrections) {
  const slim = corrections.map((c) => ({ from: c.from, to: c.to, classifierReason: c.reason || '', lastMessage: String(c.lastText || '').slice(0, 1500) }));
  return [
    'You tune a tiny classifier for a personal "which Claude Code session needs me" board.',
    'A session whose last assistant message ASKS the user for something belongs in the "waiting" lane; a message that merely REPORTS belongs in "done".',
    'Fixed base rules you cannot change: a message ending in "?" is always waiting; a "?" anywhere in the last paragraph is waiting unless a reportPhrase matches.',
    'Tunable lists (case-insensitive substring match against the LAST PARAGRAPH of the message):',
    '  askPhrases    -> force waiting',
    '  reportPhrases -> force done (even with a "?" inside the last paragraph; a trailing "?" still wins)',
    '',
    'The user dragged these sessions to a different lane than the classifier chose. Each item: from = what the classifier said, to = what the user wanted, lastMessage = the message that was judged.',
    'Generalize CONSERVATIVELY: add or remove specific phrases (2-6 words each, lowercase, no regex) that explain the corrections. Do not add anything that would misfile ordinary reports or ordinary asks. Prefer removing a phrase that caused a false "waiting" over adding broad phrases. If a correction looks like a one-off, do nothing for it.',
    'Keep every phrase that is still right. Return the COMPLETE new lists.',
    '',
    'CURRENT RULES:',
    JSON.stringify({ askPhrases: rules.askPhrases, reportPhrases: rules.reportPhrases, notes: rules.notes }, null, 2),
    '',
    'CORRECTIONS:',
    JSON.stringify(slim, null, 2),
    '',
    'Reply with ONLY one JSON object, no prose, no code fences:',
    '{"askPhrases":[...],"reportPhrases":[...],"changes":[{"op":"add"|"remove","list":"askPhrases"|"reportPhrases","phrase":"...","why":"one short sentence"}]}',
  ].join('\n');
}

/** Default runner: headless `claude -p`, prompt on stdin, no tools, no saved transcript (so learning runs never show up on the board). Resolves to the model's text. */
export function claudeRunner(prompt) {
  return new Promise((resolve, reject) => {
    const env = { ...process.env };
    for (const k of Object.keys(env)) if (k === 'CLAUDECODE' || k.startsWith('CLAUDE_CODE_')) delete env[k]; // allow running from inside a Claude session
    const child = execFile('claude', ['-p', '--output-format', 'json', '--no-session-persistence', '--tools', ''], { env, timeout: TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) return reject(new Error(`claude -p failed: ${(stderr || err.message || '').toString().trim().slice(0, 300)}`));
      try {
        const j = JSON.parse(stdout);
        if (j.is_error) return reject(new Error(`claude -p error: ${String(j.result || '').slice(0, 300)}`));
        resolve(String(j.result || ''));
      } catch { resolve(String(stdout || '')); }
    });
    child.stdin.on('error', () => {});
    child.stdin.end(prompt);
  });
}

export function parseModelJson(text) {
  let t = String(text || '').trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();
  const start = t.indexOf('{'); const end = t.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('model returned no JSON object');
  return JSON.parse(t.slice(start, end + 1));
}

/**
 * Run one learning pass. Pure given {runner}; all file paths injectable for tests.
 * Returns {ran:boolean, reason?, changes?, rules?}.
 */
export async function runLearning({ runner = claudeRunner, rulesFile = RULES_FILE, correctionsFile = CORRECTIONS_FILE, logFile = LEARNING_LOG, min = 1, now = Date.now } = {}) {
  const rules = loadRules(rulesFile);
  const corrections = unprocessedCorrections(rules, correctionsFile);
  if (corrections.length < min) return { ran: false, reason: `only ${corrections.length} new correction(s)` };

  let out;
  try { out = parseModelJson(await runner(buildPrompt(rules, corrections))); }
  catch (err) { appendLearningLog({ skipped: true, error: err.message, corrections: corrections.length }, logFile); return { ran: false, reason: `learning skipped: ${err.message}` }; }

  const v = validateRules({ askPhrases: out.askPhrases, reportPhrases: out.reportPhrases, notes: rules.notes, lastProcessedTs: Math.max(...corrections.map((c) => c.ts || 0), rules.lastProcessedTs || 0) }, rules);
  if (!v.ok) { appendLearningLog({ skipped: true, error: `rejected: ${v.error}`, corrections: corrections.length }, logFile); return { ran: false, reason: `learning rejected: ${v.error}` }; }

  // Derive the real diff (don't trust the model's `changes` list for what was applied).
  const changes = [];
  for (const list of ['askPhrases', 'reportPhrases']) {
    const before = new Set(rules[list]); const after = new Set(v.rules[list]);
    const why = (op, phrase) => (Array.isArray(out.changes) ? out.changes.find((c) => c && c.op === op && c.list === list && String(c.phrase || '').trim().toLowerCase() === phrase)?.why : '') || '';
    for (const p of after) if (!before.has(p)) changes.push({ op: 'add', list, phrase: p, why: why('add', p) });
    for (const p of before) if (!after.has(p)) changes.push({ op: 'remove', list, phrase: p, why: why('remove', p) });
  }
  const saved = saveRules(v.rules, rulesFile);
  appendLearningLog({ ts: now(), corrections: corrections.length, changes }, logFile);
  return { ran: true, changes, rules: saved, corrections: corrections.length };
}

/** Debounced, non-blocking auto-trigger. Call after every correction. */
export function makeAutoLearner(opts = {}) {
  let timer = null; let running = false; let pending = false;
  const state = { lastRunAt: 0, lastResult: null };
  async function fire() {
    if (running) { pending = true; return; }
    running = true;
    try {
      const r = await runLearning({ ...opts, min: LEARN_EVERY });
      if (r.ran || /skipped|rejected/.test(r.reason || '')) { state.lastRunAt = Date.now(); state.lastResult = r; }
    } catch (err) { state.lastRunAt = Date.now(); state.lastResult = { ran: false, reason: err.message }; }
    finally { running = false; if (pending) { pending = false; fire(); } }
  }
  return {
    state,
    poke() { clearTimeout(timer); timer = setTimeout(fire, opts.debounceMs ?? LEARN_DEBOUNCE_MS); timer.unref?.(); },
    runNow: () => runLearning({ ...opts, min: 1 }).then((r) => { state.lastRunAt = Date.now(); state.lastResult = r; return r; }),
  };
}
