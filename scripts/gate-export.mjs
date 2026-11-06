#!/usr/bin/env node
/**
 * Audit the real Risk Radar blocks against the deterministic gate — WITHOUT
 * fabricating synthetic resolution windows.
 *
 * Reports two honest views:
 *   1. Raw export rows (`gate({ statement: b.title })`): 0 of 139 pass as-is,
 *      because `risk-radar-export.csv` carries no resolution deadline column
 *      (`139/139` fail `window`) and 91 of 139 headlines state directional
 *      trends without a measurable threshold or discrete event.
 *   2. Statement-only breakdown (the 4 text checks apart from `window`): shows
 *      exactly which headlines already carry a concrete event/quantity (47/139)
 *      and which require an analyst-written resolution `objective` before a
 *      card can open.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gate } from '../packages/core/src/gate.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const file = path.join(ROOT, 'data/risk-radar.json');
if (!fs.existsSync(file)) {
  console.error('data/risk-radar.json missing — run: python3 scripts/ingest.py');
  process.exit(2);
}

const blocks = JSON.parse(fs.readFileSync(file, 'utf8')).filter((b) => b.title);
const results = blocks.map((b) => ({ b, g: gate({ statement: b.title }) }));
const failed = results.filter((x) => !x.g.ok);

const byCheck = {};
for (const f of failed) {
  for (const k of f.g.failed) byCheck[k.check] = (byCheck[k.check] || 0) + 1;
}

const textOnlyPass = results.filter((x) =>
  x.g.results.filter((r) => r.check !== 'window').every((r) => r.ok)
).length;

console.log(`blocks                  : ${blocks.length}`);
console.log(`pass raw (as exported)  : ${results.length - failed.length}  (export has no resolution end-date column)`);
console.log(`rejected raw            : ${failed.length}  (${((failed.length / blocks.length) * 100).toFixed(1)}%)`);
console.log(`pass 4 text checks      : ${textOnlyPass}/${blocks.length}  (once an analyst supplies a resolution window)`);
console.log(`failures by check       :`, byCheck);

if (failed.length === 0) {
  console.error('\n✗ gate failed to reject any raw statement from the export');
  process.exit(1);
}

console.log('\nfirst five text-level rejections (beyond the missing CSV window column):');
const textFailed = results.filter((x) => x.g.failed.some((f) => f.check !== 'window'));
textFailed.slice(0, 5).forEach(({ b, g }) => {
  console.log(`  · ${b.id}  ${b.title.slice(0, 84)}…`);
  g.failed
    .filter((f) => f.check !== 'window')
    .forEach((f) => console.log(`      - ${f.check}: ${f.reason}`));
});
