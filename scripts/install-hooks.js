#!/usr/bin/env node
// Merge Mission Control hooks into ~/.claude/settings.json (backs the file up first).
// `node scripts/install-hooks.js --uninstall` removes only our entries.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CLAUDE_DIR } from '../lib/paths.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HOOK = path.resolve(__dirname, '..', 'hooks', 'mc-hook.sh');
const SETTINGS = path.join(CLAUDE_DIR, 'settings.json');
const EVENTS = ['SessionStart', 'SessionEnd', 'UserPromptSubmit', 'Stop', 'Notification', 'PermissionRequest'];
const uninstall = process.argv.includes('--uninstall');

const isOurs = (h) => h && typeof h.command === 'string' && h.command.includes('mc-hook.sh');

let settings = {};
try { settings = JSON.parse(fs.readFileSync(SETTINGS, 'utf8')); } catch { settings = {}; }
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const backup = `${SETTINGS}.bak-${stamp}`;
if (fs.existsSync(SETTINGS)) fs.copyFileSync(SETTINGS, backup);

settings.hooks = settings.hooks || {};
for (const ev of EVENTS) {
  const groups = Array.isArray(settings.hooks[ev]) ? settings.hooks[ev] : [];
  // strip our previous entries
  const kept = groups
    .map((g) => ({ ...g, hooks: (g.hooks || []).filter((h) => !isOurs(h)) }))
    .filter((g) => g.hooks.length > 0);
  if (!uninstall) kept.push({ hooks: [{ type: 'command', command: `${HOOK} ${ev}`, timeout: 5, async: true }] });
  if (kept.length) settings.hooks[ev] = kept; else delete settings.hooks[ev];
}
if (!Object.keys(settings.hooks).length) delete settings.hooks;

fs.chmodSync(HOOK, 0o755);
fs.writeFileSync(SETTINGS, JSON.stringify(settings, null, 2) + '\n');
console.log(`${uninstall ? 'Removed' : 'Installed'} Mission Control hooks for: ${EVENTS.join(', ')}`);
console.log(`Backup of previous settings: ${backup}`);
console.log('Hooks apply to sessions started from now on (existing sessions keep their old hook set).');
