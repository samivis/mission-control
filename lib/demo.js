// Fixture data for MC_DEMO=1. Lets you see the board without any Claude Code sessions,
// and keeps real session names out of screenshots.
const HOME = '/Users/you';
const now = Date.now();
const min = (n) => now - n * 60 * 1000;
const hr = (n) => min(n * 60);
const day = (n) => hr(n * 24);

const item = (o) => ({
  autoStatus: o.status, overridden: false, turnKey: o.lastActivity, reason: '', last: '', cwd: `${HOME}/code/${o.dir}`,
  live: o.status === 'waiting' || o.status === 'working' || o.status === 'done', windows: 1, pids: [], archived: false, archivedAt: null, hasTranscript: true, ...o,
});

const ACTIVE = [
  item({ id: 'demo-1', name: 'migrate billing to new webhook schema', status: 'waiting', reason: 'Needs a permission approval', last: 'Using Bash', dir: 'billing-service', lastActivity: min(2) }),
  item({ id: 'demo-2', name: 'write release notes for 2.4', status: 'waiting', reason: 'Asked you a question', last: 'Should I lead with the performance work or the new export?', dir: 'docs', lastActivity: min(9) }),
  item({ id: 'demo-3', name: 'flaky checkout test', status: 'working', last: 'Running the suite again with the retry removed to confirm the fix.', dir: 'storefront', lastActivity: min(1), windows: 2 }),
  item({ id: 'demo-4', name: 'weekly metrics pull', status: 'working', last: 'Using Read', dir: 'analytics', lastActivity: min(4) }),
  item({ id: 'demo-5', name: 'tidy up onboarding copy', status: 'done', last: 'Done. Three screens updated, screenshots are in the PR description.', dir: 'storefront', lastActivity: hr(1) }),
  item({ id: 'demo-6', name: 'research: competitor pricing pages', status: 'ended', last: 'Summary saved to notes/pricing-landscape.md.', dir: 'notes', lastActivity: day(1), windows: 0, live: false }),
  item({ id: 'demo-7', name: 'rotate the staging secrets', status: 'ended', last: 'All four secrets rotated and the deploy is green.', dir: 'infra', lastActivity: day(2), windows: 0, live: false }),
];

const ARCHIVED = [
  item({ id: 'demo-8', name: 'q3 roadmap draft', status: 'ended', dir: 'notes', lastActivity: day(12), windows: 0, live: false, archived: true, archivedAt: day(5) }),
  item({ id: 'demo-9', name: 'upgrade to node 22', status: 'ended', dir: 'billing-service', lastActivity: day(20), windows: 0, live: false, archived: true, archivedAt: day(13) }),
];

export function demoBoard() {
  return {
    active: ACTIVE, archived: ARCHIVED,
    recentCwds: [`${HOME}/code/storefront`, `${HOME}/code/billing-service`, `${HOME}/code/notes`],
    agentsUpdatedAt: now,
    learning: { lastRunAt: null, lastResult: null, pending: 0, every: 3 },
    config: { autoArchiveDays: 7, skipPermissions: false },
  };
}

export function demoTranscript(id) {
  const it = [...ACTIVE, ...ARCHIVED].find((x) => x.id === id);
  if (!it) return [];
  return [
    { who: 'you', text: it.name },
    { tool: 'Read' },
    { who: 'claude', text: 'Looked through the relevant files and the recent history.' },
    { tool: 'Bash' },
    { who: 'claude', text: it.last || 'Done.' },
  ];
}
