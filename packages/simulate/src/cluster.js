/**
 * Cluster-robust estimators for cards that nest in risks (power-spec A.6, Analysis 1 "nested trigger cards").
 *
 * Trigger cards under one risk describe the same situation, so their score differences can move together. Three
 * tools here: a cluster-robust standard error (CR1, used by the power engine's cluster tier), a percentile cluster
 * bootstrap (used by analyseAbsoluteCluster), and the one-way ANOVA intraclass correlation that reports the realised
 * ρ_D. With unit clusters every one of them reduces to its iid counterpart.
 */

import { makeRng } from './rng.js';

/**
 * @param {number[]} values
 * @param {unknown[]} clusterIds
 */
function checkInputs(values, clusterIds) {
  if (!Array.isArray(values) || !Array.isArray(clusterIds)) throw new TypeError('values and clusterIds must be arrays');
  if (values.length !== clusterIds.length) throw new RangeError('values and clusterIds must have the same length');
  if (values.length === 0) throw new RangeError('at least one value is required');
  for (const v of values) {
    if (typeof v !== 'number' || !Number.isFinite(v)) throw new TypeError(`values must be finite numbers, got ${v}`);
  }
}

/**
 * Indices of each cluster, in first-seen order.
 * @param {unknown[]} clusterIds
 * @returns {number[][]}
 */
function groupIndices(clusterIds) {
  /** @type {Map<unknown, number[]>} */
  const map = new Map();
  clusterIds.forEach((c, i) => {
    const g = map.get(c);
    if (g) g.push(i);
    else map.set(c, [i]);
  });
  return [...map.values()];
}

/**
 * Linear-interpolated quantile of a sorted array (the repo's convention in scoring.js).
 * @param {ArrayLike<number>} sorted
 * @param {number} q
 */
function quantileSorted(sorted, q) {
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

/**
 * Percentile bootstrap of the mean that resamples whole clusters with replacement and keeps each sampled cluster's
 * values together. With unit clusters this is the ordinary bootstrap of the mean.
 * @param {number[]} values
 * @param {unknown[]} clusterIds same length as values
 * @param {{ B: number, seed: number }} opts B resamples (at least 100)
 * @returns {{ mean: number, lo: number, hi: number }} 95% percentile interval
 */
export function clusterBootstrapMean(values, clusterIds, opts) {
  checkInputs(values, clusterIds);
  const { B, seed } = opts;
  if (!Number.isInteger(B) || B < 100) throw new RangeError(`B must be an integer >= 100, got ${B}`);
  const groups = groupIndices(clusterIds);
  const G = groups.length;
  const sums = groups.map((g) => g.reduce((s, i) => s + values[i], 0));
  const counts = groups.map((g) => g.length);
  const mean = values.reduce((s, v) => s + v, 0) / values.length;

  const rng = makeRng(seed);
  const boot = new Float64Array(B);
  for (let b = 0; b < B; b++) {
    let s = 0;
    let c = 0;
    for (let j = 0; j < G; j++) {
      const k = rng.int(G);
      s += sums[k];
      c += counts[k];
    }
    boot[b] = s / c;
  }
  boot.sort();
  return { mean, lo: quantileSorted(boot, 0.025), hi: quantileSorted(boot, 0.975) };
}

/**
 * Cluster-robust (CR1) estimate of the mean and its standard error. Residuals are summed within each cluster, so
 * correlated cards inflate the variance. With every card its own cluster this equals sd / √n (ddof 1).
 * @param {number[]} values
 * @param {unknown[]} clusterIds
 * @returns {{ mean: number, se: number, df: number, clusters: number, n: number } | null} null with fewer than two clusters
 */
export function clusterRobustSe(values, clusterIds) {
  checkInputs(values, clusterIds);
  const groups = groupIndices(clusterIds);
  const G = groups.length;
  const n = values.length;
  if (G < 2) return null;
  const mean = values.reduce((s, v) => s + v, 0) / n;
  let meat = 0;
  for (const g of groups) {
    let s = 0;
    for (const i of g) s += values[i] - mean;
    meat += s * s;
  }
  // CR1 small-sample factor G/(G-1); (n-1)/(n-K) is 1 for the one-parameter mean.
  const variance = ((G / (G - 1)) * meat) / (n * n);
  return { mean, se: Math.sqrt(variance), df: G - 1, clusters: G, n };
}

/** Lanczos log-gamma (g = 7, nine coefficients). */
function logGamma(z) {
  if (z < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * z)) - logGamma(1 - z);
  const c = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61503916999385,
    12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
  ];
  const x = z - 1;
  let a = c[0];
  const t = x + 7.5;
  for (let i = 1; i < 9; i++) a += c[i] / (x + i);
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}

/** Continued fraction for the regularised incomplete beta (Lentz's method). */
function betaContinuedFraction(a, b, x) {
  const EPS = 3e-14;
  const FPMIN = 1e-300;
  const qab = a + b;
  const qap = a + 1;
  const qam = a - 1;
  let c = 1;
  let d = 1 - (qab * x) / qap;
  if (Math.abs(d) < FPMIN) d = FPMIN;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= 300; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    h *= d * c;
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < EPS) break;
  }
  return h;
}

/** Regularised incomplete beta I_x(a, b). */
function regIncBeta(a, b, x) {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const bt = Math.exp(logGamma(a + b) - logGamma(a) - logGamma(b) + a * Math.log(x) + b * Math.log(1 - x));
  if (x < (a + 1) / (a + b + 2)) return (bt * betaContinuedFraction(a, b, x)) / a;
  return 1 - (bt * betaContinuedFraction(b, a, 1 - x)) / b;
}

/**
 * Two-sided Student-t critical value: P(|T| > t) = alpha on df degrees of freedom.
 * @param {number} df positive
 * @param {number} [alpha]
 */
export function crCritical(df, alpha = 0.05) {
  if (!(df > 0)) throw new RangeError(`df must be positive, got ${df}`);
  if (!(alpha > 0 && alpha < 1)) throw new RangeError(`alpha must be in (0, 1), got ${alpha}`);
  // Two-sided tail probability at t is I_{df/(df+t²)}(df/2, 1/2); it decreases in t, so bisect.
  const tail = (t) => regIncBeta(df / 2, 0.5, df / (df + t * t));
  let lo = 0;
  let hi = 1e3;
  for (let it = 0; it < 200; it++) {
    const mid = (lo + hi) / 2;
    if (tail(mid) > alpha) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/**
 * One-way ANOVA intraclass correlation for unbalanced clusters (Searle's n0 correction). This is the realised ρ_D of
 * per-card score differences: 0 when cards are independent, near 1 when a cluster's cards are copies of each other.
 * Can be slightly negative in a sample; returns 0 when the estimate is undefined.
 * @param {number[]} values
 * @param {unknown[]} clusterIds
 * @returns {number}
 */
export function iccOfScores(values, clusterIds) {
  checkInputs(values, clusterIds);
  const groups = groupIndices(clusterIds);
  const G = groups.length;
  const N = values.length;
  if (G < 2 || N <= G) return 0;
  const grand = values.reduce((s, v) => s + v, 0) / N;
  let ssb = 0;
  let ssw = 0;
  let sumSq = 0;
  for (const g of groups) {
    const m = g.reduce((s, i) => s + values[i], 0) / g.length;
    ssb += g.length * (m - grand) ** 2;
    for (const i of g) ssw += (values[i] - m) ** 2;
    sumSq += g.length * g.length;
  }
  const msb = ssb / (G - 1);
  const msw = ssw / (N - G);
  const n0 = (N - sumSq / N) / (G - 1);
  const denom = msb + (n0 - 1) * msw;
  if (!(denom > 0)) return 0;
  return (msb - msw) / denom;
}

/**
 * Design effect of clustering: 1 + (m̄ − 1)·ρ, with ρ floored at 0 so a negative sample ICC cannot inflate the sample.
 * @param {number} meanClusterSize m̄ ≥ 1
 * @param {number} rhoD
 */
export function designEffect(meanClusterSize, rhoD) {
  return 1 + (meanClusterSize - 1) * Math.max(0, rhoD);
}

/**
 * Effective number of independent cards: n / DEFF.
 * @param {number} n cards
 * @param {number} meanClusterSize average cards per risk
 * @param {number} rhoD intra-risk correlation of the score differences
 */
export function effectiveN(n, meanClusterSize, rhoD) {
  return n / designEffect(meanClusterSize, rhoD);
}
