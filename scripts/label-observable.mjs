#!/usr/bin/env node
/**
 * Re-measure the lexical `observable` check on a larger labelled set, without
 * inventing labels. The first 50 were labelled by one rater; at n=50 the 86%
 * warn precision is only good to about +/-12 points. This tool makes the
 * next measurement properly:
 *
 *   node scripts/label-observable.mjs sample
 *       writes data/labelling/observable-to-label.csv: the risk headlines not yet
 *       labelled, with empty rater_a / rater_b columns for TWO people to fill
 *       independently with `resolvable` or `needs_criterion`.
 *
 *   node scripts/label-observable.mjs score data/labelling/observable-to-label.csv
 *       checks the raters agree (Cohen's kappa >= 0.6) and only then reports the
 *       check's precision, recall and false-warn rate with 95% intervals, alone
 *       and pooled with the original 50. If they do not agree it says so and
 *       lists the rows to adjudicate. It never produces a number from raters
 *       who disagree.
 *
 * Question for the raters: "Could an external source (ACLED, IPC, UNHCR, IMF, an
 * official decree) settle this statement as written, by a date, without anyone
 * reading intent into it?"
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCsvObjects, toCsv } from '@benchmark/core/csv';
import { scoreRaters } from '@benchmark/core/authoring';
import { evaluateObservable } from '@benchmark/core/gate';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const FIXTURE = path.join(ROOT, 'packages/benchmark/test/fixtures/observable-labelled-50.json');
const OUT = path.join(ROOT, 'data/labelling/observable-to-label.csv');
const [mode, file] = process.argv.slice(2);
const pct = (x) => `${(x * 100).toFixed(1)}%`;
const ci = (r) => (r ? `[${pct(r.lo)}, ${pct(r.hi)}]` : 'n/a');

function report(label, r) {
  console.log(`\n${label} (n=${r.n})`);
  console.log(`  warn precision   ${pct(r.warnPrecision)}  ${ci(r.warnPrecisionCI)}`);
  console.log(`  warn recall      ${pct(r.warnRecall)}  ${ci(r.warnRecallCI)}`);
  console.log(`  false-warn rate  ${pct(r.falseWarnRate)}  ${ci(r.falseWarnRateCI)}`);
}

if (mode === 'sample') {
  const done = new Set(JSON.parse(fs.readFileSync(FIXTURE, 'utf8')).map((x) => x.id));
  const blocks = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/risk-radar.json'), 'utf8'));
  const rows = blocks.filter((b) => b.title && !done.has(b.id))
    .map((b) => ({ id: b.id, statement: b.title, objective: '', rater_a: '', rater_b: '', note: '' }));
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, toCsv(['id', 'statement', 'objective', 'rater_a', 'rater_b', 'note'], rows));
  console.log(`wrote ${rows.length} unlabelled headlines to ${path.relative(ROOT, OUT)}`);
  console.log('two people fill rater_a and rater_b independently (resolvable | needs_criterion), then run: score <file>');
} else if (mode === 'score' && file) {
  const rows = parseCsvObjects(fs.readFileSync(path.resolve(file), 'utf8'));
  const s = scoreRaters(rows);
  if (!s.ok) {
    console.error(`cannot score: ${s.reason}`);
    if (s.disagreements?.length) console.error(`rows to adjudicate: ${s.disagreements.join(', ')}`);
    process.exit(1);
  }
  console.log(`raters: n=${s.n} agreed rows, kappa ${s.kappa.kappa.toFixed(2)}, ${s.disagreements.length} disagreements${s.disagreements.length ? ` (${s.disagreements.join(', ')})` : ''}`);
  report('new set alone', s.result);
  const original = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
  report('pooled with the original 50', evaluateObservable([...original, ...s.consensus]));
} else {
  console.error('usage: label-observable.mjs sample | score <csv>');
  process.exit(2);
}
