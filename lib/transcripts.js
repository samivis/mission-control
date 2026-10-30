import fs from 'node:fs';
import path from 'node:path';
import { PROJECTS_DIR } from './paths.js';

const TAIL_BYTES = 64 * 1024;
const HEAD_BYTES = 32 * 1024;
const NOISE_PREFIXES = ['<local-command', '<command-name', '<command-message', '<system-reminder', '<bash-input', '<bash-stdout', '<task-notification', '<fork-boilerplate'];

export function parseLines(text) {
  const out = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try { out.push(JSON.parse(line)); } catch { /* partial or corrupt line */ }
  }
  return out;
}

function stripNoise(s) {
  // Drop leading machine-generated blocks like <local-command-caveat>…</local-command-caveat>
  let t = s.trim();
  let guard = 0;
  while (guard++ < 10 && t.startsWith('<')) {
    const m = t.match(/^<([a-zA-Z_-]+)[^>]*>[\s\S]*?<\/\1>\s*/);
    if (!m) break;
    t = t.slice(m[0].length).trim();
  }
  return t;
}

/** Human-visible text of a user line, or null if it's meta/tool-result/noise. */
export function userText(rec) {
  if (!rec || rec.type !== 'user' || rec.isMeta || rec.isSidechain) return null;
  const c = rec.message?.content;
  let text = '';
  if (typeof c === 'string') text = c;
  else if (Array.isArray(c)) {
    const parts = c.filter((p) => p && p.type === 'text').map((p) => p.text || '');
    if (!parts.length) return null; // tool_result only
    text = parts.join('\n');
  } else return null;
  if (NOISE_PREFIXES.some((p) => text.trimStart().startsWith(p))) {
    const cmd = text.match(/<command-name>([^<]+)<\/command-name>/);
    const args = text.match(/<command-args>([^<]*)<\/command-args>/);
    text = stripNoise(text);
    if (!text && cmd) text = (cmd[1].trim() + ' ' + (args ? args[1].trim() : '')).trim();
    if (!text) return null;
  }
  return text.trim() || null;
}

/** {text, tools:[names]} for an assistant line, or null. */
export function assistantParts(rec) {
  if (!rec || rec.type !== 'assistant' || rec.isSidechain) return null;
  const c = rec.message?.content;
  if (!Array.isArray(c)) return null;
  const text = c.filter((p) => p?.type === 'text').map((p) => p.text || '').join('\n').trim();
  const tools = c.filter((p) => p?.type === 'tool_use').map((p) => p.name || 'tool');
  if (!text && !tools.length) return null;
  return { text, tools };
}

export function oneLine(s, max = 160) {
  const t = (s || '').replace(/\s+/g, ' ').trim();
  return t.length > max ? t.slice(0, max - 1) + '…' : t;
}

/** Derive the default session name from the first real user prompt. */
export function firstPrompt(records) {
  let command = '';
  for (const r of records) {
    const t = userText(r);
    if (!t) continue;
    if (t.startsWith('/')) { if (!command) command = t; continue; } // slash command: keep looking for a real prompt
    return oneLine(t, 80);
  }
  return oneLine(command, 80);
}

/**
 * Summarize the tail of a transcript.
 * Returns {last, lastTs, cwd, endsWithQuestion, danglingTool, lastRole}.
 */
export function tailSummary(records) {
  let last = '';
  let lastTs = null;
  let cwd = null;
  let endsWithQuestion = false;
  let lastAssistantText = '';
  let lastAssistantTools = [];
  let danglingTool = false;
  let lastRole = null;

  for (const r of records) {
    if (r.cwd && !cwd) cwd = r.cwd;
    if (r.timestamp) {
      const t = Date.parse(r.timestamp);
      if (!Number.isNaN(t) && (!lastTs || t > lastTs)) lastTs = t;
    }
    const a = assistantParts(r);
    if (a) {
      lastRole = 'assistant';
      if (a.text) { lastAssistantText = a.text; lastAssistantTools = []; }
      if (a.tools.length) { lastAssistantTools = a.tools; danglingTool = true; }
      continue;
    }
    if (r.type === 'user') {
      const c = r.message?.content;
      if (Array.isArray(c) && c.some((p) => p?.type === 'tool_result')) { danglingTool = false; continue; }
      if (userText(r)) { lastRole = 'user'; danglingTool = false; }
    }
  }
  if (lastAssistantTools.length && danglingTool) last = `Using ${lastAssistantTools[lastAssistantTools.length - 1]}`;
  else if (lastAssistantText) last = oneLine(lastAssistantText.split('\n').filter(Boolean).pop() || lastAssistantText);
  else if (lastAssistantTools.length) last = `Used ${lastAssistantTools[lastAssistantTools.length - 1]}`;
  endsWithQuestion = !!lastAssistantText && /\?\s*$/.test(lastAssistantText.trim()) && lastRole === 'assistant';
  return { last, lastTs, cwd, endsWithQuestion, danglingTool, lastRole };
}

/** Full transcript for the drawer: [{who:'you'|'claude', text}|{tool:name}] */
export function fullTranscript(records) {
  const out = [];
  for (const r of records) {
    const u = userText(r);
    if (u) { out.push({ who: 'you', text: u }); continue; }
    const a = assistantParts(r);
    if (a) {
      if (a.text) out.push({ who: 'claude', text: a.text });
      for (const t of a.tools) out.push({ tool: t });
    }
  }
  return out;
}

function readSlice(file, start, end) {
  const fd = fs.openSync(file, 'r');
  try {
    const len = Math.max(0, end - start);
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, start);
    return buf.toString('utf8');
  } finally { fs.closeSync(fd); }
}

export function readHead(file, size) {
  const text = readSlice(file, 0, Math.min(size, HEAD_BYTES));
  return parseLines(text);
}

export function readTail(file, size) {
  const start = Math.max(0, size - TAIL_BYTES);
  let text = readSlice(file, start, size);
  if (start > 0) text = text.slice(text.indexOf('\n') + 1); // drop the partial first line
  return parseLines(text);
}

const cache = new Map(); // path -> {mtimeMs, size, info}

/** Scan ~/.claude/projects for session transcripts. Returns Map<sessionId, info>. Never writes. */
export function indexTranscripts() {
  const out = new Map();
  let projectDirs = [];
  try { projectDirs = fs.readdirSync(PROJECTS_DIR, { withFileTypes: true }).filter((d) => d.isDirectory()); } catch { return out; }
  for (const d of projectDirs) {
    const dir = path.join(PROJECTS_DIR, d.name);
    let files = [];
    try { files = fs.readdirSync(dir); } catch { continue; }
    for (const f of files) {
      if (!f.endsWith('.jsonl')) continue;
      const file = path.join(dir, f);
      const sessionId = f.slice(0, -6);
      let st;
      try { st = fs.statSync(file); } catch { continue; }
      if (!st.isFile() || st.size === 0) continue;
      const c = cache.get(file);
      let info;
      if (c && c.mtimeMs === st.mtimeMs && c.size === st.size) info = c.info;
      else {
        try {
          let head = readHead(file, st.size);
          let defaultName = firstPrompt(head);
          if ((!defaultName || defaultName.startsWith("/")) && st.size > HEAD_BYTES) { head = parseLines(readSlice(file, 0, Math.min(st.size, 1024 * 1024))); defaultName = firstPrompt(head); }
          const tail = st.size > HEAD_BYTES ? readTail(file, st.size) : head;
          const sum = tailSummary(tail);
          info = {
            sessionId, path: file, mtimeMs: st.mtimeMs, size: st.size,
            defaultName,
            cwd: sum.cwd || head.find((r) => r.cwd)?.cwd || null,
            last: sum.last,
            lastTs: sum.lastTs || st.mtimeMs,
            endsWithQuestion: sum.endsWithQuestion,
            danglingTool: sum.danglingTool,
          };
        } catch { continue; }
        cache.set(file, { mtimeMs: st.mtimeMs, size: st.size, info });
      }
      const prev = out.get(sessionId);
      if (!prev || info.mtimeMs > prev.mtimeMs) out.set(sessionId, info);
    }
  }
  return out;
}

export function loadFullTranscript(file) {
  return fullTranscript(parseLines(fs.readFileSync(file, 'utf8')));
}
