#!/usr/bin/env node
/**
 * The backtest harness.
 *
 * ⚠ The predictors below are SYNTHETIC. The numbers are not results — they
 * prove that the scoring plumbing works end-to-end on the 104 resolved blocks.
 * To get the real answer, replace panelPredictor() with actual panel medians.
 */
import fs from 'node:fs';
import path from 'node:path';
import { bootstrapBrier, paired, calibration, LADDER } from '../packages/core/src/scoring.js';

const ROOT = new URL('..', import.meta.url).pathname;
const file = path.join(ROOT, 'data/risk-radar.json');
if (!fs.existsSync(file)) {
  console.error('data/risk-radar.json missing — run: python3 scripts/ingest.py');
  process.exit(2);
}

const blocks = JSON.parse(fs.readFileSync(file, 'utf8'));
const resolved = blocks.filter((b) => b.outcome === 0 || b.outcome === 1);
console.log(`blocks: ${blocks.length}   resolved: ${resolved.length}   active: ${blocks.length - resolved.length}\n`);

const baseRate = resolved.reduce((a, b) => a + b.outcome, 0) / resolved.length;

// SYNTHETIC predictor: hazard intensity is coded 1–5 and is the one field with
// obvious monotone structure. Stands in for the structured-field logistic fit.
const intensityP = (b) => {
  const n = Number(b.intensity);
  if (!Number.isFinite(n)) return baseRate;
  return [0.25, 0.4, 0.55, 0.7, 0.85][Math.min(4, Math.max(0, n - 1))];
};

const panelPlusIntensity = resolved.map((b) => ({ id: b.id, p: intensityP(b), y: b.outcome }));
const constant = resolved.map((b) => ({ id: b.id, p: baseRate, y: b.outcome }));

const fmt = (r) => (r.score === null ? 'n/a' : `${r.score.toFixed(4)}  [${r.lo.toFixed(4)}, ${r.hi.toFixed(4)}]  n=${r.n}`);

console.log('constant (base rate) :', fmt(bootstrapBrier(constant)));
console.log('intensity predictor  :', fmt(bootstrapBrier(panelPlusIntensity)));

const p = paired(panelPlusIntensity, constant);
console.log('paired difference    :', p.diff === null ? 'n/a' :
  `${p.diff.toFixed(4)}  [${p.lo.toFixed(4)}, ${p.hi.toFixed(4)}]  ${p.note}`);

console.log('\ncalibration of the intensity predictor:');
calibration(panelPlusIntensity, 4).forEach((b) =>
  console.log(`  predicted ${b.meanPredicted.toFixed(2)} → observed ${b.observedRate.toFixed(2)}   (n=${b.n})`));

console.log('\nreference ladder:');
console.log(`  naive floor           ${LADDER.naiveFloor}`);
console.log(`  ACAPS judgement       ${LADDER.acapsRatings}`);
console.log(`  structured logistic   ${LADDER.fourFieldLogistic}   ← out of sample; loses to ACAPS`);
console.log('\n⚠ synthetic predictor — this proves the harness, not the panel.');
