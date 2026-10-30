#!/usr/bin/env node
// Run one rule-learning pass over unprocessed lane corrections. `npm run learn`
import { runLearning } from '../lib/learn.js';
const r = await runLearning({ min: 1 });
if (!r.ran) { console.log(r.reason); process.exit(0); }
console.log(`Rules updated from ${r.corrections} correction(s): ${r.changes.length} change(s)`);
for (const c of r.changes) console.log(`  ${c.op} ${c.list}: "${c.phrase}"${c.why ? ' — ' + c.why : ''}`);
