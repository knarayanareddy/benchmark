#!/usr/bin/env node
/**
 * Fit the bar — logistic regression on the structured fields, with leave-one-out
 * cross-validation.
 *
 * WHY THIS FILE EXISTS
 * The LADDER carried fourFieldLogistic = 0.1981 as a number quoted from an
 * earlier fitting pass whose script was never in this repo. A bar you cannot
 * recompute is not a bar; it is a rumour. This script fits the model, in this
 * repo, on the data in this repo, and reports it honestly.
 *
 * THE METHODOLOGICAL POINT
 * An in-sample fit always beats a human. That is arithmetic, not skill: the
 * model gets to see the answers while fitting. So this reports THREE numbers
 * and the honest one is the third:
 *
 *   in-sample   — fitted on all 104, scored on all 104. Optimistic. Reported
 *                 only so the gap to the next line is visible.
 *   LOO-CV      — each risk predicted by a model that never saw it. This is
 *                 the number that can be compared to a panel that also never
 *                 saw the outcome. ← this is the bar
 *   ACAPS       — the analyst's own rating, also never having seen the outcome.
 *
 * This mirrors the Eggstaff/Mazzuchi/Sarkani out-of-sample caution that governs
 * the aggregation choice in this project: performance weighting looks better
 * in-sample than it is, every time.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { bootstrapBrier, paired, observed } from '../packages/core/src/scoring.js';
import { BAND_MIDPOINT } from '../packages/core/src/aggregate.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const blocks = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/risk-radar.json'), 'utf8'));
const resolved = blocks.filter((b) => b.outcome === 0 || b.outcome === 1);

// Missing means missing, not zero. `Number(v) || 0` silently codes an absent
// intensity as "very low hazard", which is a substantive claim about the risk
// that the analyst never made. Use add-one imputation on the observed mean.
const num = (v) => (Number(v) || 0) / 5;
const SCALE = { 'Very Low': 1, Low: 2, Medium: 3, High: 4, 'Very High': 5 };

// The four fields a model can see without reading the sentence.
// Any field that is blank on this risk is replaced by the mean of the OBSERVED
// values for that field (computed over the resolved set), flagged by its own
// indicator column so the model can tell imputed from real.
const meanOr = (vals) => { const k = vals.filter((v) => v !== null); return k.length ? k.reduce((a, v) => a + v, 0) / k.length : 0; };
const PROB = { 'Very Low': 1, Low: 2, Medium: 3, High: 4, 'Very High': 5 };
const LEVEL = { Low: 1, Medium: 3, High: 5 };
const rawIntensity = (b) => (Number(b.intensity) ? Number(b.intensity) / 5 : null);
const rawProb = (b) => (PROB[b.probability] ? PROB[b.probability] / 5 : null);
const rawLevel = (b) => (LEVEL[b.riskLevel] ? LEVEL[b.riskLevel] / 5 : null);
const M_INT = meanOr(resolved.map(rawIntensity));
const M_PROB = meanOr(resolved.map(rawProb));
const M_LEV = meanOr(resolved.map(rawLevel));

// COLLINEARITY, established from the data and recorded so nobody re-adds it:
// Risk Level matches a pure function of Probability on 128/128 rows where both
// are present (Very Low→Low, Low/Medium→Medium, High/Very High→High), and
// Impact never changes it. So a model containing Probability AND Risk Level is
// fitting the same field twice and pretending it has two fields. The earlier
// "four-field regression" was in fact a one-field model with a duplicate column.
// Risk Level is therefore DROPPED from the feature set.
const features = (b) => {
  const i = rawIntensity(b), p = rawProb(b);
  return [1, i ?? M_INT, p ?? M_PROB, i === null ? 1 : 0, p === null ? 1 : 0];
};

// ── minimal IRLS logistic regression ─────────────────────────────────────────
function solve(A, b) {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
    [M[c], M[piv]] = [M[piv], M[c]];
    if (Math.abs(M[c][c]) < 1e-12) continue;
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c] / M[c][c];
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  return M.map((row, i) => (Math.abs(row[i]) < 1e-12 ? 0 : row[n] / row[i]));
}

function fit(rows, k) {
  let beta = new Array(k).fill(0);
  for (let iter = 0; iter < 60; iter++) {
    const XtWX = Array.from({ length: k }, () => new Array(k).fill(0));
    const XtWz = new Array(k).fill(0);
    for (const r of rows) {
      const eta = r.x.reduce((a, v, i) => a + v * beta[i], 0);
      const p = 1 / (1 + Math.exp(-Math.max(-30, Math.min(30, eta))));
      const w = Math.max(p * (1 - p), 1e-6);
      const z = eta + (r.y - p) / w;
      for (let i = 0; i < k; i++) {
        for (let j = 0; j < k; j++) XtWX[i][j] += w * r.x[i] * r.x[j];
        XtWz[i] += w * r.x[i] * z;
      }
    }
    const next = solve(XtWX, XtWz);
    const delta = next.reduce((a, v, i) => a + Math.abs(v - beta[i]), 0);
    beta = next;
    if (delta < 1e-9) break;
  }
  return beta;
}

const predict = (beta, x) => {
  const eta = x.reduce((a, v, i) => a + v * beta[i], 0);
  return 1 / (1 + Math.exp(-Math.max(-30, Math.min(30, eta))));
};

// ── run ──────────────────────────────────────────────────────────────────────
const rows = resolved.map((b) => ({ id: b.id, x: features(b), y: b.outcome }));
const k = rows[0].x.length;
console.log(`imputation means            : intensity ${M_INT.toFixed(3)}, probability ${M_PROB.toFixed(3)}`);
console.log(`rows with >=1 imputed field : ${resolved.filter((b) => rawIntensity(b) === null || rawProb(b) === null).length}\n`);

const beta = fit(rows, k);
const inSample = rows.map((r) => ({ id: r.id, p: predict(beta, r.x), y: r.y }));

// Leave-one-out: refit without each row.
const loo = rows.map((r, i) => {
  const b = fit(rows.filter((_, j) => j !== i), k);
  return { id: r.id, p: predict(b, r.x), y: r.y };
});

const base = resolved.reduce((a, b) => a + b.outcome, 0) / resolved.length;
// HEADLINE: ACAPS' rating read off its own published percentage bands (midpoints,
// "Very High" = 0.905). SENSITIVITY: the ordinal n/5 reading ("Very High" = 1.00),
// kept because earlier documents quoted it. A certain forecast is infinitely
// overconfident under a log score, so the midpoint is the defensible headline.
const acaps = resolved.map((b) => ({ id: b.id, p: BAND_MIDPOINT[b.probability] ?? base, y: b.outcome }));
const acapsOrdinal = resolved.map((b) => ({ id: b.id, p: SCALE[b.probability] ? SCALE[b.probability] / 5 : base, y: b.outcome }));
const constant = resolved.map((b) => ({ id: b.id, p: base, y: b.outcome }));

const fmt = (r) =>
  r.score === null ? 'n/a' : `${r.score.toFixed(4)}  [${r.lo.toFixed(4)}, ${r.hi.toFixed(4)}]  n=${r.n}`;
const cmp = (a, c, label) => {
  const p = paired(a, c);
  console.log(`  ${label.padEnd(34)} ${p.diff.toFixed(4)}  [${p.lo.toFixed(4)}, ${p.hi.toFixed(4)}]  ${p.note}`);
};

console.log(`resolved n = ${rows.length}   columns = ${k} (intercept + 2 independent fields + 2 missing-indicators)\n`);
console.log(`beta                       : [${beta.map((v) => v.toFixed(3)).join(', ')}]`);

console.log('Brier scores:');
console.log('  constant (base rate)             ', fmt(bootstrapBrier(constant)));
console.log('  ACAPS rating, band midpoints     ', fmt(bootstrapBrier(acaps)), '   <- headline');
console.log('  ACAPS rating, ordinal /5         ', fmt(bootstrapBrier(acapsOrdinal)), '   <- sensitivity');
console.log('  logistic, IN-SAMPLE  (optimistic)', fmt(bootstrapBrier(inSample)));
console.log('  logistic, LOO-CV     (the bar)   ', fmt(bootstrapBrier(loo)));
console.log();

console.log('paired comparisons (same 104 risks):');
cmp(inSample, constant, 'in-sample vs constant');
cmp(loo, constant, 'LOO-CV vs constant');
cmp(loo, acaps, 'LOO-CV vs ACAPS rating');
cmp(loo, acapsOrdinal, 'LOO-CV vs ACAPS (ordinal)');
console.log();

const gap = bootstrapBrier(acaps).score - bootstrapBrier(loo).score;
console.log(`out-of-sample improvement over ACAPS: ${gap.toFixed(4)}`);
console.log(`in-sample  improvement over ACAPS: ${(bootstrapBrier(acaps).score - bootstrapBrier(inSample).score).toFixed(4)}`);
console.log('\nIf LOO-CV does not beat the constant with an interval excluding zero, then');
console.log('the honest claim is: "we can reproduce the naive floor and we cannot yet');
console.log('show a model beats it on this data." Say that. It is a stronger position');
console.log('than a number nobody can recompute.');

fs.writeFileSync(
  path.join(ROOT, 'data', 'baseline-fit.json'),
  JSON.stringify({ n: rows.length, beta, brier: { constant: bootstrapBrier(constant).score, baseRate: base, inSample: bootstrapBrier(inSample).score, loo: bootstrapBrier(loo).score, acaps: bootstrapBrier(acaps).score, acapsOrdinal: bootstrapBrier(acapsOrdinal).score } }, null, 2)
);
console.log('\nwritten: data/baseline-fit.json');
