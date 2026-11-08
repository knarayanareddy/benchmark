#!/usr/bin/env node
/**
 * Check the export against ACAPS' OWN published methodology.
 *
 * organiser/acaps/risk-methodology.md publishes a 5×5 matrix deriving Risk
 * Level from Probability × Impact (Risk = Probability × Impact).
 *
 * Applied to the 125 rows carrying all three fields: 97 agree, 28 depart
 * (22 higher than the matrix, 6 lower). Across all 128 rows carrying both
 * Probability and Risk Level, Risk Level is a pure function of Probability
 * alone (128/128), and across all 19 occupied (Probability, Impact) cells not
 * one cell is mixed. There are no case-by-case analyst overrides in the export:
 * Impact is collected and ignored by the Risk Level lookup.
 *
 * The check asserts 97/125, 128/128, and 0 mixed cells across 19 cells, and
 * fails loudly if a re-ingest changes any of them.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

// D1: two byte-identical exports, only one of them read. `ingest.py` reads
// data/, so refreshing the organiser copy would leave every gate green on a
// stale file. Assert they match instead of assuming they do.
const exportPaths = [
  path.join(ROOT, 'data/risk-radar-export.csv'),
  path.join(ROOT, 'organiser/acaps/data/risk-radar-export.csv'),
].filter((f) => fs.existsSync(f));
if (exportPaths.length === 2) {
  const hash = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
  const [a, b] = exportPaths.map(hash);
  if (a !== b) {
    console.error(
      `\n✗ the two committed exports have diverged (${a.slice(0, 8)} vs ${b.slice(0, 8)}).\n` +
        '  ingest.py reads data/ only, so the published figures would be measured\n' +
        '  against a stale export while every gate stayed green.'
    );
    process.exit(1);
  }
} else if (exportPaths.length === 1) {
  console.error(`\n✗ only one of the two declared exports exists — ${path.relative(ROOT, exportPaths[0])}`);
  process.exit(1);
}
const blocks = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'risk-radar.json'), 'utf8'));

const P = { 'Very High': 5, High: 4, Medium: 3, Low: 2, 'Very Low': 1 };
const PROB_TO_LEVEL = {
  'Very Low': 'Low',
  Low: 'Medium',
  Medium: 'Medium',
  High: 'High',
  'Very High': 'High',
};
const RANK = { Low: 1, Medium: 2, High: 3 };
// Verbatim from organiser/acaps/risk-methodology.md.
const MATRIX = {
  5: { 1: 'Medium', 2: 'Medium', 3: 'High', 4: 'High', 5: 'High' },
  4: { 1: 'Low', 2: 'Medium', 3: 'Medium', 4: 'High', 5: 'High' },
  3: { 1: 'Low', 2: 'Medium', 3: 'Medium', 4: 'Medium', 5: 'High' },
  2: { 1: 'Low', 2: 'Low', 3: 'Medium', 4: 'Medium', 5: 'Medium' },
  1: { 1: 'Low', 2: 'Low', 3: 'Low', 4: 'Low', 5: 'Medium' },
};

const probAndLevel = blocks.filter((b) => P[b.probability] && b.riskLevel);
const probOnlyAgree = probAndLevel.filter((b) => PROB_TO_LEVEL[b.probability] === b.riskLevel).length;

const rows = blocks.filter((b) => P[b.probability] && b.riskLevel && Number(b.impact) >= 1);
if (rows.length === 0) {
  console.error('no rows carry both Probability and Impact — check the ingest mapping');
  process.exit(2);
}

let agree = 0;
let higher = 0;
let lower = 0;
const mismatched = [];
const cells = new Map();
for (const b of rows) {
  const want = MATRIX[P[b.probability]][Number(b.impact)];
  const cellKey = `${b.probability}|${b.impact}`;
  const cell = cells.get(cellKey) || { agree: 0, depart: 0 };
  if (want === b.riskLevel) {
    agree++;
    cell.agree++;
  } else {
    mismatched.push({ b, want });
    cell.depart++;
    if (RANK[b.riskLevel] > RANK[want]) higher++;
    else lower++;
  }
  cells.set(cellKey, cell);
}
const mixedCells = [...cells.values()].filter((c) => c.agree > 0 && c.depart > 0).length;

const byProb = {};
for (const b of blocks) {
  if (P[b.probability] && (b.outcome === 0 || b.outcome === 1)) {
    byProb[b.probability] = byProb[b.probability] || { s: 0, n: 0 };
    byProb[b.probability].s += b.outcome;
    byProb[b.probability].n++;
  }
}
const resolved = mismatched.filter((m) => m.b.outcome === 0 || m.b.outcome === 1);
const obsRate = resolved.reduce((a, m) => a + m.b.outcome, 0) / resolved.length;
const expRate =
  resolved.reduce((a, m) => a + byProb[m.b.probability].s / byProb[m.b.probability].n, 0) /
  resolved.length;

const pct = (100 * agree) / rows.length;
console.log(`rows with Probability, Impact and Risk Level : ${rows.length}`);
console.log(`agree with ACAPS' published 5x5             : ${agree}  (${pct.toFixed(1)}%)`);
console.log(`depart from it                              : ${mismatched.length}  (${higher} higher, ${lower} lower)`);
console.log(`Risk Level = f(Probability alone)           : ${probOnlyAgree}/${probAndLevel.length}`);
console.log(`occupied (Probability, Impact) cells        : ${cells.size}  (mixed cells: ${mixedCells})`);
console.log(
  `resolved departures (n=${resolved.length})                 : observed ${obsRate.toFixed(3)} vs ${expRate.toFixed(3)} expected from Probability (+${((obsRate - expRate) * 100).toFixed(1)} pts)`
);

if (
  rows.length !== 125 ||
  agree !== 97 ||
  higher !== 22 ||
  lower !== 6 ||
  probAndLevel.length !== 128 ||
  probOnlyAgree !== 128 ||
  cells.size !== 19 ||
  mixedCells !== 0
) {
  console.error('\n✗ methodology check drifted from recorded counts (97/125, 128/128, 19 cells, 0 mixed).');
  process.exit(1);
}
console.log('\n✓ 97/125 against 5x5, 128/128 pure function of Probability, 19/19 deterministic cells.');
