import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

export const HOME = os.homedir();
export const CLAUDE_DIR = process.env.CLAUDE_CONFIG_DIR || path.join(HOME, '.claude');
export const PROJECTS_DIR = path.join(CLAUDE_DIR, 'projects');
export const MC_DIR = process.env.MISSION_CONTROL_DIR || path.join(HOME, '.mission-control');
export const EVENTS_FILE = path.join(MC_DIR, 'events.jsonl');
export const META_FILE = path.join(MC_DIR, 'meta.json');
export const CONFIG_FILE = path.join(MC_DIR, 'config.json');

export const DEFAULT_CONFIG = {
  port: 3011,
  // Sam's usual mode for terminal sessions. Set to false to get normal permission prompts.
  skipPermissions: true,
  // Days idle/ended before a session is auto-archived (never for live sessions).
  autoArchiveDays: 7,
  // How often to poll `claude agents --json` (ms).
  pollMs: 3000,
};

export function ensureDir() {
  fs.mkdirSync(MC_DIR, { recursive: true });
}

export function readConfig() {
  ensureDir();
  try {
    const raw = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    return { ...DEFAULT_CONFIG, ...raw };
  } catch {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(DEFAULT_CONFIG, null, 2) + '\n');
    return { ...DEFAULT_CONFIG };
  }
}
