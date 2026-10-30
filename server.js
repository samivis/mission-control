import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { readConfig, MC_DIR, EVENTS_FILE } from './lib/paths.js';
import { fetchAgents, groupAgents } from './lib/agents.js';
import { indexTranscripts, loadFullTranscript } from './lib/transcripts.js';
import { loadEvents } from './lib/events.js';
import { loadMeta, saveMeta, setArchived, setName, setLane, clearLane } from './lib/meta.js';
import { loadRules, saveRules, revertLastRules, listRuleBackups, appendCorrection, readLearningLog, unprocessedCorrections } from './lib/rules.js';
import { makeAutoLearner, LEARN_EVERY } from './lib/learn.js';
import { buildBoard } from './lib/classify.js';
import { focusSession, resumeInTerminal, startInTerminal } from './lib/terminal.js';
import { demoBoard, demoTranscript } from './lib/demo.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(__dirname, 'public');
const config = readConfig();
const PORT = Number(process.env.PORT || config.port);
// MC_DEMO=1 serves fixture sessions (for screenshots and trying the UI without Claude Code data).
const DEMO = process.env.MC_DEMO === '1';
const learner = makeAutoLearner();

// ---- state: agents poll + cached board ----
let agents = new Map();
let agentsUpdatedAt = 0;
let polling = false;
async function pollAgents() {
  if (polling) return;
  polling = true;
  try { agents = groupAgents(await fetchAgents()); agentsUpdatedAt = Date.now(); } finally { polling = false; }
}
setInterval(pollAgents, config.pollMs).unref();
await pollAgents();

function board() {
  if (DEMO) return demoBoard();
  const transcripts = indexTranscripts();
  const events = loadEvents();
  const meta = loadMeta();
  const rules = loadRules();
  let dirty = false;
  const result = buildBoard({
    now: Date.now(), agents, transcripts, events, meta, rules,
    autoArchiveDays: config.autoArchiveDays,
    onAutoArchive: (id, reason) => { setArchived(meta, id, true, reason); dirty = true; },
  });
  if (dirty) saveMeta(meta);
  const recentCwds = [...new Set([...result.active, ...result.archived].map((i) => i.cwd).filter(Boolean))].slice(0, 12);
  const learning = { lastRunAt: learner.state.lastRunAt, lastResult: learner.state.lastResult, pending: unprocessedCorrections(rules).length, every: LEARN_EVERY };
  return { ...result, recentCwds, agentsUpdatedAt, learning, config: { autoArchiveDays: config.autoArchiveDays, skipPermissions: config.skipPermissions } };
}

function findItem(id) {
  const b = board();
  return [...b.active, ...b.archived].find((i) => i.id === id) || null;
}

// ---- http helpers ----
const json = (res, code, body) => { res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(JSON.stringify(body)); };
const readBody = (req) => new Promise((resolve) => { let d = ''; req.on('data', (c) => { d += c; if (d.length > 1e6) req.destroy(); }); req.on('end', () => { try { resolve(d ? JSON.parse(d) : {}); } catch { resolve({}); } }); });
const ID_RE = /^[A-Za-z0-9._-]{1,80}$/;
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' };

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const parts = url.pathname.split('/').filter(Boolean);
  try {
    if (parts[0] === 'api') {
      if (req.method === 'GET' && parts[1] === 'board') return json(res, 200, board());
      if (parts[1] === 'sessions' && parts[2]) {
        const id = parts[2];
        if (!ID_RE.test(id)) return json(res, 400, { error: 'bad id' });
        const action = parts[3];
        if (req.method === 'GET' && action === 'transcript') {
          const item = findItem(id);
          if (DEMO) return json(res, 200, { item, transcript: demoTranscript(id) });
          const t = indexTranscripts().get(id);
          if (!t) return json(res, 200, { item, transcript: [] });
          return json(res, 200, { item, transcript: loadFullTranscript(t.path) });
        }
        if (req.method === 'POST') {
          const body = await readBody(req);
          const meta = loadMeta();
          if (action === 'archive') { saveMeta(setArchived(meta, id, true)); return json(res, 200, { ok: true }); }
          if (action === 'unarchive') { saveMeta(setArchived(meta, id, false)); return json(res, 200, { ok: true }); }
          if (action === 'rename') { saveMeta(setName(meta, id, body.name)); return json(res, 200, { ok: true }); }
          if (action === 'lane') {
            const item = findItem(id);
            if (!item) return json(res, 404, { error: 'Session not found.' });
            const lane = body.lane;
            if (lane === null || lane === undefined || lane === 'auto') { saveMeta(clearLane(meta, id)); return json(res, 200, { ok: true, cleared: true }); }
            if (lane === 'archived') { saveMeta(setArchived(meta, id, true)); return json(res, 200, { ok: true, archived: true }); }
            const from = item.autoStatus;
            saveMeta(setLane(meta, id, lane, item.turnKey));
            let logged = false;
            const judged = new Set(['waiting', 'done']);
            if (from !== lane && judged.has(from) && judged.has(lane)) {
              const t = indexTranscripts().get(id);
              appendCorrection({ sessionId: id, from, to: lane, reason: item.reason || '', lastText: t?.lastText || '' });
              logged = true;
              learner.poke();
            }
            return json(res, 200, { ok: true, from, to: lane, logged });
          }
          if (action === 'focus') {
            await pollAgents();
            const item = findItem(id);
            if (!item) return json(res, 404, { error: 'Session not found.' });
            if (item.live) {
              const r = await focusSession(item.pids);
              return json(res, r.ok ? 200 : 409, r);
            }
            if (!item.cwd) return json(res, 409, { error: 'No working directory known for this session.' });
            await resumeInTerminal({ cwd: item.cwd, sessionId: id, skipPermissions: config.skipPermissions });
            return json(res, 200, { ok: true, resumed: true });
          }
        }
      }
      if (req.method === 'POST' && parts[1] === 'sessions' && !parts[2]) {
        const body = await readBody(req);
        const cwd = String(body.cwd || '').trim();
        if (!cwd || !fs.existsSync(cwd)) return json(res, 400, { error: 'Working directory does not exist.' });
        const sessionId = await startInTerminal({ cwd, prompt: String(body.prompt || '').trim(), skipPermissions: config.skipPermissions });
        const meta = loadMeta();
        meta[sessionId] = { ...(meta[sessionId] || {}), name: (body.name || '').trim() || undefined, cwd, createdAt: Date.now() };
        saveMeta(meta);
        return json(res, 200, { ok: true, sessionId });
      }
      if (parts[1] === 'rules' && !parts[2]) {
        if (req.method === 'GET') return json(res, 200, { rules: loadRules(), log: readLearningLog(10), backups: listRuleBackups().length, learning: learner.state });
        if (req.method === 'PUT') {
          const body = await readBody(req);
          try { return json(res, 200, { ok: true, rules: saveRules({ ...loadRules(), ...body }) }); }
          catch (e) { return json(res, e.status || 500, { error: e.message }); }
        }
      }
      if (req.method === 'POST' && parts[1] === 'rules' && parts[2] === 'learn') {
        const r = await learner.runNow();
        return json(res, 200, r);
      }
      if (req.method === 'POST' && parts[1] === 'rules' && parts[2] === 'revert') {
        const r = revertLastRules();
        if (!r) return json(res, 409, { error: 'No earlier rules to go back to.' });
        return json(res, 200, { ok: true, rules: r });
      }
      if (req.method === 'GET' && parts[1] === 'health') return json(res, 200, { ok: true, mcDir: MC_DIR, eventsFile: EVENTS_FILE, eventsExists: fs.existsSync(EVENTS_FILE), liveSessions: agents.size });
      return json(res, 404, { error: 'not found' });
    }
    // static
    const file = path.join(PUBLIC, parts.length ? parts.join('/') : 'index.html');
    if (!file.startsWith(PUBLIC) || !fs.existsSync(file)) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
    fs.createReadStream(file).pipe(res);
  } catch (err) {
    json(res, 500, { error: err?.stderr?.toString().trim() || err?.message || String(err) });
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Mission Control → http://localhost:${PORT}   (data: ${MC_DIR})`);
});
