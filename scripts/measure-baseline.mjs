#!/usr/bin/env node
/**
 * Measure the baseline — ACAPS's own probability rating, scored as a forecast.
 *
 * This exists because the LADDER in packages/core/src/scoring.js carried
 * acapsRatings = 0.2204 as a quoted number. It is not reproducible from the
 * export in this repo. Every plain reading of "ACAPS's rating as a probability"
 * lands somewhere in 0.2121 – 0.2261, and no combination of outcome definition,
 * scale divisor and missing-value handling reproduces 0.2204.
 *
 * Rule adopted here and written down so it cannot drift:
 *
 *   outcome   = Status field. "Materialised" → 1, "Not materialised" → 0.
 *               Active and blank Status are UNOBSERVABLE and excluded.
 *   p         = Probability field / 5   (Very Low 1 … Very High 5)
 *               blank Probability imputed at the base rate.
 *   scoring   = Brier over the resulting pairs, bootstrap interval always.
 *   comparison= PAIRED against the constant base-rate predictor, same items.
 *
 * Any other reading is printed alongside, labelled, with its n. The point is
 * that the number you quote can be reproduced by whoever is checking it.
 */
import fs from 'node:fs';
import path from 'node:path';
import { brier, bootstrapBrier, paired, calibration } from '../packages/core/src/scoring.js';

const ROOT = new URL('..', import.meta.url).pathname;
const file = path.join(ROOT, 'data/risk-radar.json');
if (!fs.existsSync(file)) {
  console.error('data/risk-radar.json missing — run: python3 scripts/ingest.py');
  process.exit(2);
}

const blocks = JSON.parse(fs.readFileSync(file, 'utf8'));

// ACAPS publishes the percentage bands behind their five-point scale in
// docs/references/acaps-risk-methodology-infographic.png:
//   Very Low 0-20 · Low 21-40 · Medium 41-60 · High 61-80 · Very High 81-100
// We use the band midpoint. This is their mapping, not our guess — an earlier
// revision divided the ordinal 1-5 by 5, which put "Medium" at 0.60 when their
// own band says 41-60%. The two readings differ by 0.0003 Brier, so nothing
// downstream moves, but the midpoint is the one that can be defended from a
// document in this repo.
const BANDS = {
  'Very Low': [0, 20],
  Low: [21, 40],
  Medium: [41, 60],
  High: [61, 80],
  'Very High': [81, 100],
};
const SCALE = Object.fromEntries(
  Object.entries(BANDS).map(([k, [a, b]]) => [k, (a + b) / 200])
);
// The adopted reading stays the ordinal n/5 (0.2168) because that is what
// data/baseline-fit.json and every document in this repo quote. The band
// midpoint is reported alongside it so the difference is visible, not hidden.
const ORDINAL = { 'Very Low': 1, Low: 2, Medium: 3, High: 4, 'Very High': 5 };

const resolved = blocks.filter((b) => b.outcome === 0 || b.outcome === 1);
const baseRate = resolved.reduce((a, b) => a + b.outcome, 0) / resolved.length;

const fmt = (r) =>
  r.score === null ? 'n/a' : `${r.score.toFixed(4)}  [${r.lo.toFixed(4)}, ${r.hi.toFixed(4)}]  n=${r.n}`;

// ── the adopted reading ────────────────────────────────────────────────────
const adopted = resolved.map((b) => ({
  id: b.id,
  p: ORDINAL[b.probability] ? ORDINAL[b.probability] / 5 : baseRate,
  y: b.outcome,
}));

console.log(`blocks            : ${blocks.length}`);
console.log(`resolved          : ${resolved.length}  (${resolved.filter((b) => b.outcome === 1).length} materialised)`);
console.log(`base rate         : ${baseRate.toFixed(4)}\n`);

const constant = resolved.map((b) => ({ id: b.id, p: baseRate, y: b.outcome }));
console.log('naive floor       :', fmt(bootstrapBrier(constant)));
console.log('ACAPS rating /5   :', fmt(bootstrapBrier(adopted)), '   ← adopted reading');

const p = paired(adopted, constant);
console.log('paired vs floor   :', `${p.diff.toFixed(4)}  [${p.lo.toFixed(4)}, ${p.hi.toFixed(4)}]  ${p.note}`);

console.log('\ncalibration of the ACAPS rating:');
calibration(adopted, 5).forEach((b) =>
  console.log(`  predicted ${b.meanPredicted.toFixed(2)} → observed ${b.observedRate.toFixed(2)}   (n=${b.n})`)
);

// ── the readings that do NOT reproduce, kept visible ───────────────────────
console.log('\nother readings of "ACAPS as a forecast" (not adopted, for completeness):');
const variants = [
  ['band midpoint (their published %s)', resolved.map((b) => ({ p: SCALE[b.probability] ?? baseRate, y: b.outcome }))],
  ['drop blank Probability', resolved.filter((b) => ORDINAL[b.probability]).map((b) => ({ p: ORDINAL[b.probability] / 5, y: b.outcome }))],
  ['blank Probability = 0.5', resolved.map((b) => ({ p: ORDINAL[b.probability] ? ORDINAL[b.probability] / 5 : 0.5, y: b.outcome }))],
  ['band lower edge', resolved.map((b) => { const n = BANDS[b.probability]; return { p: n ? n[0] / 100 : baseRate, y: b.outcome }; })],
  ['Intensity of hazard / 5', resolved.filter((b) => Number(b.intensity)).map((b) => ({ p: Number(b.intensity) / 5, y: b.outcome }))],
  ['Risk Level Low/Med/High /3', resolved.filter((b) => ['Low', 'Medium', 'High'].includes(b.riskLevel)).map((b) => ({ p: { Low: 1, Medium: 2, High: 3 }[b.riskLevel] / 3, y: b.outcome }))],
];
for (const [label, pairs] of variants) console.log(`  ${label.padEnd(28)} ${brier(pairs).score.toFixed(4)}  n=${pairs.length}`);

console.log('\nThe figure 0.2204 circulated as "ACAPS\' own judgement" in an earlier revision.');
console.log('It is reproducible — but as the leave-one-out score of the logistic model,');
console.log('not as any reading of ACAPS\' rating. The regression and the analyst were');
console.log('swapped. Quote the adopted reading above, and quote it WITH its interval.');
