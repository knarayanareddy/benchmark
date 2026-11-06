#!/usr/bin/env node
/**
 * Runs the deterministic gate over the real Risk Radar blocks and reports the
 * failure list. Acceptance test #9: "the gate rejects at least one real
 * statement, with a reason."
 *
 * Reads data/risk-radar.json — produced by scripts/ingest.py, which uses
 * Python's csv module because the export contains quoted multi-line fields.
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
const results = blocks.map((b) => ({ b, g: gate({ statement: b.title, window: { from: b.id, to: b.status || 'open' } }) }));
const failed = results.filter((x) => !x.g.ok);

const byCheck = {};
for (const f of failed) for (const k of f.g.failed) byCheck[k.check] = (byCheck[k.check] || 0) + 1;

console.log(`blocks      : ${blocks.length}`);
console.log(`passed      : ${results.length - failed.length}`);
console.log(`failed      : ${failed.length}  (${((failed.length / blocks.length) * 100).toFixed(1)}%)`);
console.log(`by check    :`, byCheck);

// A gate that rejects almost everything is as useless as one that rejects nothing.
const rate = failed.length / blocks.length;
if (rate > 0.4) console.warn('\n⚠ rejection rate above 40% — this is probably a false-positive problem, not a quality problem.');

console.log('\nfirst five rejections (read these aloud in the pitch):');
failed.slice(0, 5).forEach(({ b, g }) => {
  console.log(`  · ${b.id}  ${b.title.slice(0, 84)}…`);
  g.failed.forEach((f) => console.log(`      - ${f.check}: ${f.reason}`));
});
