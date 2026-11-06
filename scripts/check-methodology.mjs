#!/usr/bin/env node
/**
 * Check the export against ACAPS' OWN published methodology.
 *
 * docs/risk-methodology.md in the organisers' repo publishes a 5×5 matrix
 * deriving Risk Level from Probability × Impact. This script applies it to
 * every row that has all three fields and reports agreement.
 *
 * Why this is a product feature and not trivia:
 *
 * ACAPS' brief says analyst knowledge "travels through informal conversations
 * with peers and then disappears." The 28 rows where the recorded Risk Level
 * departs from the published matrix are that knowledge, made visible in the
 * data. The analyst looked at a risk, looked at a matrix that would put it in
 * Medium, and wrote High anyway — because of something the two axes do not
 * capture. That residual is precisely what a structured expert loop exists to
 * elicit and record.
 *
 * The check asserts 97/125 and fails loudly if a re-ingest changes it.
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const blocks = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'risk-radar.json'), 'utf8'));

const P = { 'Very High': 5, High: 4, Medium: 3, Low: 2, 'Very Low': 1 };
// Verbatim from docs/risk-methodology.md.
const MATRIX = {
  5: { 1: 'Medium', 2: 'Medium', 3: 'High', 4: 'High', 5: 'High' },
  4: { 1: 'Low', 2: 'Medium', 3: 'Medium', 4: 'High', 5: 'High' },
  3: { 1: 'Low', 2: 'Medium', 3: 'Medium', 4: 'Medium', 5: 'High' },
  2: { 1: 'Low', 2: 'Low', 3: 'Medium', 4: 'Medium', 5: 'Medium' },
  1: { 1: 'Low', 2: 'Low', 3: 'Low', 4: 'Low', 5: 'Medium' },
};

const testable = blocks.filter(
  (b) => P[b.probability] && Number(b.intensity === undefined ? NaN : 0) === 0 && b.riskLevel
);
// impact lives on the raw export only; ingest keeps intensity, so re-read via title-free map
// — use the CSV-derived fields the ingest carries, and fall back to skipping.
const impact = (b) => b.impact;

const rows = blocks.filter((b) => P[b.probability] && b.riskLevel && Number(b.impact) >= 1);
if (rows.length === 0) {
  console.error('no rows carry both Probability and Impact — check the ingest mapping');
  process.exit(2);
}

let agree = 0;
const mismatched = [];
for (const b of rows) {
  const want = MATRIX[P[b.probability]][Number(b.impact)];
  if (want === b.riskLevel) agree++;
  else mismatched.push({ b, want });
}

const pct = (100 * agree) / rows.length;
console.log(`rows with Probability, Impact and Risk Level : ${rows.length}`);
console.log(`agree with ACAPS' published 5x5             : ${agree}  (${pct.toFixed(1)}%)`);
console.log(`depart from it                              : ${mismatched.length}`);

const resolved = mismatched.filter((m) => m.b.outcome === 0 || m.b.outcome === 1);
const mat = resolved.filter((m) => m.b.outcome === 1).length;
const baseRate = blocks.filter((b) => b.outcome === 0 || b.outcome === 1);
const base = baseRate.reduce((a, b) => a + b.outcome, 0) / baseRate.length;
console.log(`  of those with a resolved outcome         : ${resolved.length}`);
console.log(`  materialised                             : ${mat} (${((100 * mat) / resolved.length).toFixed(0)}% vs ${(100 * base).toFixed(0)}% base rate)`);
console.log('\nThe departures are not random error — n is far too small to claim that —');
console.log('but they are the visible trace of analyst judgement overriding the rule.');

const EXPECTED_AGREE = 97;
const EXPECTED_N = 125;
if (rows.length !== EXPECTED_N || agree !== EXPECTED_AGREE) {
  console.error(`\n✗ expected ${EXPECTED_AGREE}/${EXPECTED_N}. A change here means either the ingest`);
  console.error('  mapping changed or the export did. Both are worth knowing before a demo.');
  process.exit(1);
}
console.log(`\n✓ ${EXPECTED_AGREE}/${EXPECTED_N} as recorded — the export and the ingest agree.`);
