import fs from 'node:fs';
import path from 'node:path';
import { MC_DIR, ensureDir } from './paths.js';

export const RULES_FILE = path.join(MC_DIR, 'rules.json');
export const CORRECTIONS_FILE = path.join(MC_DIR, 'corrections.jsonl');
export const LEARNING_LOG = path.join(MC_DIR, 'learning-log.jsonl');

/**
 * Waiting-vs-done phrase rules. Fixed base rules (trailing "?", "?" in the last paragraph)
 * live in asksForInput(); these lists tune the rest.
 *  - askPhrases:    a last paragraph containing one of these = Waiting on you
 *  - reportPhrases: a last paragraph containing one of these = Done, even if it has a "?"
 *                   somewhere inside (a trailing "?" still wins)
 */
export const DEFAULT_RULES = {
  version: 1,
  askPhrases: [
    'tell me', 'let me know', 'want me to', 'would you like', 'should i', 'shall i', 'do you want',
    'confirm', 'your call', 'which one', 'which of these', 'which do you', 'pick one', 'say go',
    'say yes', 'say the word', 'give me the go',
  ],
  reportPhrases: ['no action needed', 'nothing needed from you', 'fyi only', 'for your information only'],
  notes: [],
  lastProcessedTs: 0,
};

const MAX_PHRASES = 60;
const MAX_WORDS = 6;
const ONE_WORD_OK = new Set(['confirm', 'approve', 'decide', 'choose', 'thoughts?']);

/** Validate a rules object. Returns {ok, rules, error}. Unknown keys are dropped. */
export function validateRules(input, base = DEFAULT_RULES) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { ok: false, error: 'rules must be an object' };
  const out = { version: 1, askPhrases: [], reportPhrases: [], notes: [], lastProcessedTs: 0 };
  for (const key of ['askPhrases', 'reportPhrases']) {
    const arr = input[key] === undefined ? base[key] : input[key];
    if (!Array.isArray(arr)) return { ok: false, error: `${key} must be an array of strings` };
    if (arr.length > MAX_PHRASES) return { ok: false, error: `${key} has more than ${MAX_PHRASES} phrases` };
    const seen = new Set();
    for (const raw of arr) {
      if (typeof raw !== 'string') return { ok: false, error: `${key} contains a non-string` };
      const p = raw.trim().toLowerCase().replace(/\s+/g, ' ');
      if (!p) continue;
      if (p.length > 80) return { ok: false, error: `phrase too long: "${p.slice(0, 30)}…"` };
      const words = p.split(' ');
      if (words.length > MAX_WORDS) return { ok: false, error: `phrase longer than ${MAX_WORDS} words: "${p}"` };
      if (words.length < 2 && !ONE_WORD_OK.has(p)) return { ok: false, error: `one-word phrase not allowed: "${p}"` };
      if (!seen.has(p)) { seen.add(p); out[key].push(p); }
    }
  }
  const notes = input.notes === undefined ? base.notes : input.notes;
  if (!Array.isArray(notes) || notes.some((n) => typeof n !== 'string')) return { ok: false, error: 'notes must be an array of strings' };
  out.notes = notes.slice(0, 40).map((n) => n.slice(0, 300));
  const lp = input.lastProcessedTs === undefined ? base.lastProcessedTs : input.lastProcessedTs;
  out.lastProcessedTs = Number.isFinite(lp) ? lp : 0;
  return { ok: true, rules: out };
}

let cache = { mtimeMs: -1, rules: null };

/** Load rules with an mtime cache; creates the file with defaults on first run. */
export function loadRules(file = RULES_FILE) {
  let st;
  try { st = fs.statSync(file); } catch {
    try { ensureDir(); fs.writeFileSync(file, JSON.stringify(DEFAULT_RULES, null, 2) + '\n'); } catch { /* read-only env */ }
    cache = { mtimeMs: -1, rules: { ...DEFAULT_RULES } };
    return cache.rules;
  }
  if (cache.rules && cache.mtimeMs === st.mtimeMs) return cache.rules;
  try {
    const v = validateRules(JSON.parse(fs.readFileSync(file, 'utf8')));
    cache = { mtimeMs: st.mtimeMs, rules: v.ok ? v.rules : { ...DEFAULT_RULES } };
  } catch { cache = { mtimeMs: st.mtimeMs, rules: { ...DEFAULT_RULES } }; }
  return cache.rules;
}

/** Validate, back up the previous file, write atomically. Returns the saved rules. Throws on invalid. */
export function saveRules(input, file = RULES_FILE, { backup = true } = {}) {
  const v = validateRules(input, loadRules(file));
  if (!v.ok) { const e = new Error(v.error); e.status = 400; throw e; }
  ensureDir();
  if (backup && fs.existsSync(file)) fs.copyFileSync(file, `${file}.bak-${Date.now()}`);
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(v.rules, null, 2) + '\n');
  fs.renameSync(tmp, file);
  cache = { mtimeMs: -1, rules: null };
  return v.rules;
}

export function listRuleBackups(file = RULES_FILE) {
  const dir = path.dirname(file); const base = path.basename(file) + '.bak-';
  try {
    return fs.readdirSync(dir).filter((f) => f.startsWith(base)).map((f) => ({ file: path.join(dir, f), ts: Number(f.slice(base.length)) || 0 })).sort((a, b) => b.ts - a.ts);
  } catch { return []; }
}

/** Restore the most recent backup (no new backup is made). Returns the restored rules or null. */
export function revertLastRules(file = RULES_FILE) {
  const [latest] = listRuleBackups(file);
  if (!latest) return null;
  const parsed = JSON.parse(fs.readFileSync(latest.file, 'utf8'));
  const restored = saveRules(parsed, file, { backup: false });
  fs.unlinkSync(latest.file);
  return restored;
}

// ---- corrections + learning log ----

export function appendCorrection(c, file = CORRECTIONS_FILE) {
  ensureDir();
  fs.appendFileSync(file, JSON.stringify({ ts: Date.now(), ...c }) + '\n');
}

export function readCorrections(file = CORRECTIONS_FILE) {
  try {
    return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  } catch { return []; }
}

export function unprocessedCorrections(rules, file = CORRECTIONS_FILE) {
  const since = rules?.lastProcessedTs || 0;
  return readCorrections(file).filter((c) => (c.ts || 0) > since);
}

export function appendLearningLog(entry, file = LEARNING_LOG) {
  ensureDir();
  fs.appendFileSync(file, JSON.stringify({ ts: Date.now(), ...entry }) + '\n');
}

export function readLearningLog(limit = 10, file = LEARNING_LOG) {
  try {
    const all = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
    return all.slice(-limit).reverse();
  } catch { return []; }
}
