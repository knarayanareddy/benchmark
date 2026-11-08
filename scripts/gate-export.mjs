#!/usr/bin/env node
/**
 * Audit the real Risk Radar blocks against the deterministic gate — WITHOUT
 * fabricating synthetic resolution windows — and report the measured precision
 * of the `observable` lexical warning on 50 labelled corpus statements.
 *
 * Reports three honest views:
 *   1. Raw export rows (`gate({ statement: b.title })`): 0 of 139 pass as-is,
 *      because `risk-radar-export.csv` carries no resolution deadline column
 *      (`139/139` fail the `window` blocker).
 *   2. Prose-level blocker vs warning split (the 4 text checks apart from
 *      `window`): only 3 of 139 headlines hit hard structural blockers
 *      (`single` / `no_leak`), 89 of 139 surface an `observable` authoring
 *      warning (`dispatchable: true` once given a window, prompting an
 *      analyst-written `objective`), and 49 of 139 pass all 4 text checks.
 *   3. Calibrated precision on 50 labelled ACAPS statements
 *      (`packages/benchmark/test/fixtures/observable-labelled-50.json`),
 *      documenting why `observable` is a warning rather than a silent blocker.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SEVERITY, gate, evaluateObservable } from '@benchmark/core/gate';

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

const textHardBlocked = results.filter((x) =>
  x.g.blockers.some((b) => b.check !== 'window')
).length;

const labelledPath = path.join(
  ROOT,
  'packages/benchmark/test/fixtures/observable-labelled-50.json'
);
const labelled = JSON.parse(fs.readFileSync(labelledPath, 'utf8'));
const prec = evaluateObservable(labelled);

console.log(`blocks                  : ${blocks.length}`);
console.log(`pass raw (as exported)  : ${results.length - failed.length}  (export has no resolution end-date column)`);
console.log(`rejected raw            : ${failed.length}  (${((failed.length / blocks.length) * 100).toFixed(1)}%)`);
console.log(`text hard-blocked       : ${textHardBlocked}/${blocks.length}  (single / no_leak / condition blockers)`);
console.log(`dispatchable w/ window  : ${blocks.length - textHardBlocked}/${blocks.length}  (${byCheck.observable || 0} carry observable warning)`);
console.log(`pass all 4 text checks  : ${textOnlyPass}/${blocks.length}  (clean without extra objective)`);
console.log(`flags by check          :`, byCheck);
console.log(
  `observable 50-item eval : warnPrecision=${(prec.warnPrecision * 100).toFixed(1)}% (${prec.tpWarn}/${prec.tpWarn + prec.fpWarn})  warnRecall=${(prec.warnRecall * 100).toFixed(1)}% (${prec.tpWarn}/${prec.tpWarn + prec.fnPass})  falseWarn=${(prec.falseWarnRate * 100).toFixed(1)}% (${prec.fpWarn}/${prec.fpWarn + prec.tnPass})`
);

if (failed.length === 0) {
  console.error('\n✗ gate failed to reject any raw statement from the export');
  process.exit(1);
}

console.log('\nfirst five text-level flags (with blocker vs warning severity):');
const textFlagged = results.filter((x) => x.g.failed.some((f) => f.check !== 'window'));
textFlagged.slice(0, 5).forEach(({ b, g }) => {
  console.log(`  · ${b.id}  ${b.title.slice(0, 84)}…`);
  g.failed
    .filter((f) => f.check !== 'window')
    .forEach((f) => {
      const tag = f.severity === SEVERITY.BLOCKER ? 'BLOCK' : 'WARN ';
      console.log(`      - [${tag}] ${f.check}: ${f.reason}`);
    });
});
