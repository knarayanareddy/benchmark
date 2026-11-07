/**
 * Cross-question correlation: how strongly two forecasts that should move together (linked cards, or cards in the
 * same stratum) correlate, and how many pairs a Pearson test needs to see it. Closed forms (Fisher z, exact t), a
 * Monte Carlo of the exact-t test with optional panel noise and a spurious shared-error null, the rank AUC used by the
 * second stage, and a logistic recalibration slope. Pure: no storage, no clock.
 */
import { makeRng } from './rng.js';
import { wilson } from '@benchmark/core/stats';

/** Standard normal CDF. erfc is Numerical Recipes' Chebyshev fit, fractional error below 1.2e-7. */
export function normalCdf(x) {
  const z = -x / Math.SQRT2;
  const t = 1 / (1 + 0.5 * Math.abs(z));
  const poly =
    -z * z - 1.26551223 + t * (1.00002368 + t * (0.37409196 + t * (0.09678418 + t * (-0.18628806 +
      t * (0.27886807 + t * (-1.13520398 + t * (1.48851587 + t * (-0.82215223 + t * 0.17087277))))))));
  const erfc = t * Math.exp(poly);
  return 0.5 * (z >= 0 ? erfc : 2 - erfc);
}

/**
 * Standard normal quantile by bisection on normalCdf (accurate to about 1e-6).
 * @param {number} p strictly inside (0, 1)
 * @returns {number}
 */
export function normalQuantile(p) {
  if (!(p > 0 && p < 1)) throw new RangeError(`normalQuantile needs p in (0, 1), got ${p}`);
  let lo = -12;
  let hi = 12;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    if (normalCdf(mid) < p) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

function checkRho(rho) {
  if (!(Math.abs(rho) > 0 && Math.abs(rho) < 1)) throw new RangeError(`rho must be in (-1, 1) and not 0, got ${rho}`);
}
function checkAlpha(alpha) {
  if (!(alpha > 0 && alpha < 1)) throw new RangeError(`alpha must be in (0, 1), got ${alpha}`);
}
function checkPower(power) {
  if (!(power > 0 && power < 1)) throw new RangeError(`power must be in (0, 1), got ${power}`);
}

/**
 * Pairs needed for a two-sided Pearson test at the given alpha and power, by the Fisher z closed form
 * n = ((z_{1-α/2} + z_power) / atanh ρ)² + 3, rounded to the nearest integer. That is Cohen's (1988) convention:
 * r = 0.5, α = 0.05, power 0.8 gives 29 (the exact value 29.02 rounds down; a ceiling would give 30).
 * @param {number} rho
 * @param {number} alpha two-sided
 * @param {number} power
 * @returns {number}
 */
export function fisherN(rho, alpha, power) {
  checkRho(rho);
  checkAlpha(alpha);
  checkPower(power);
  const z = normalQuantile(1 - alpha / 2) + normalQuantile(power);
  return Math.round(3 + (z / Math.atanh(Math.abs(rho))) ** 2);
}

/**
 * Closed-form power of a two-sided Fisher z test of ρ = 0 with n pairs (both tails).
 * @param {number} n pairs, n > 3
 * @param {number} rho true correlation
 * @param {number} alpha two-sided
 * @returns {number}
 */
export function fisherPower(n, rho, alpha) {
  if (!(n > 3)) throw new RangeError(`fisherPower needs n > 3, got ${n}`);
  checkAlpha(alpha);
  const shift = Math.sqrt(n - 3) * Math.atanh(rho);
  const zc = normalQuantile(1 - alpha / 2);
  return normalCdf(shift - zc) + normalCdf(-shift - zc);
}

/**
 * How many comparisons' worth of alpha the study can spend at n pairs and the given power: the m such that a
 * Bonferroni threshold alpha/m gives exactly that power. A study with n = 50 at ρ = 0.5 and 80% power can afford about
 * 14 comparisons, not 50.
 * @param {number} n @param {number} rho @param {number} alpha @param {number} power
 * @returns {number}
 */
export function impliedComparisons(n, rho, alpha, power) {
  checkRho(rho);
  checkAlpha(alpha);
  checkPower(power);
  const zc = Math.sqrt(n - 3) * Math.atanh(Math.abs(rho)) - normalQuantile(power);
  const alphaImplied = 2 * (1 - normalCdf(zc));
  return alpha / alphaImplied;
}

const LANCZOS = [
  0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61503916999285,
  12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
];

/** log Γ(x) by the Lanczos approximation (g = 7). */
function lgamma(x) {
  if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - lgamma(1 - x);
  const y = x - 1;
  let a = LANCZOS[0];
  const t = y + 7.5;
  for (let i = 1; i < 9; i++) a += LANCZOS[i] / (y + i);
  return 0.5 * Math.log(2 * Math.PI) + (y + 0.5) * Math.log(t) - t + Math.log(a);
}

/** Continued fraction for the incomplete beta function (modified Lentz). */
function betacf(x, a, b) {
  const tiny = 1e-300;
  const qab = a + b;
  const qap = a + 1;
  const qam = a - 1;
  let c = 1;
  let d = 1 - (qab * x) / qap;
  if (Math.abs(d) < tiny) d = tiny;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= 500; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < tiny) d = tiny;
    c = 1 + aa / c;
    if (Math.abs(c) < tiny) c = tiny;
    d = 1 / d;
    h *= d * c;
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < tiny) d = tiny;
    c = 1 + aa / c;
    if (Math.abs(c) < tiny) c = tiny;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 3e-14) break;
  }
  return h;
}

/** Regularised incomplete beta I_x(a, b). */
function betaI(x, a, b) {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const front = Math.exp(lgamma(a + b) - lgamma(a) - lgamma(b) + a * Math.log(x) + b * Math.log(1 - x));
  if (x < (a + 1) / (a + b + 2)) return (front * betacf(x, a, b)) / a;
  return 1 - (front * betacf(1 - x, b, a)) / b;
}

/**
 * Two-sided critical value of Student's t: P(|T| > t) = alpha on df degrees of freedom.
 * @param {number} df positive
 * @param {number} alpha two-sided
 * @returns {number}
 */
export function tCritical(df, alpha) {
  if (!(df > 0)) throw new RangeError(`tCritical needs df > 0, got ${df}`);
  checkAlpha(alpha);
  let lo = 0;
  let hi = 1000;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    const tail = betaI(df / (df + mid * mid), df / 2, 0.5);
    if (tail > alpha) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/**
 * Average ranks (1-based); tied values share the mean of the ranks they would occupy.
 * @param {number[]} values
 * @returns {number[]}
 */
export function averageRanks(values) {
  const order = values.map((_, i) => i).sort((a, b) => values[a] - values[b]);
  const ranks = new Array(values.length);
  let i = 0;
  while (i < order.length) {
    let j = i;
    while (j + 1 < order.length && values[order[j + 1]] === values[order[i]]) j++;
    const avg = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) ranks[order[k]] = avg;
    i = j + 1;
  }
  return ranks;
}

/** @param {number[]} x @param {number[]} y */
function pearson(x, y) {
  const n = x.length;
  let mx = 0;
  let my = 0;
  for (let i = 0; i < n; i++) {
    mx += x[i];
    my += y[i];
  }
  mx /= n;
  my /= n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = x[i] - mx;
    const dy = y[i] - my;
    sxy += dx * dy;
    sxx += dx * dx;
    syy += dy * dy;
  }
  return sxy / Math.sqrt(sxx * syy);
}

/** @param {number} p @returns {number} */
function roundPercent(p) {
  return Math.min(0.99, Math.max(0.01, Math.round(p * 100) / 100));
}

/**
 * Monte Carlo power of the exact-t test of ρ = 0 (two-sided) for n pairs of latent normal scores with correlation ρ.
 *
 * Optional, each off by default:
 * - `noise`: each observed score is the latent plus panel noise of variance σ²(icc + (1 − icc)/k) (the reliability of
 *   §Analysis 6 model 1: observed r ≈ ρ·R with R = 1 / (1 + σ²(icc + (1 − icc)/k)) for latent variance 1).
 * - `rhoShared`: the two noises share a narrative error with correlation `rhoShared` (model 2's spurious null).
 * - `roundToPercent`: scores are probabilities expit(score) rounded to whole percents and clamped to [0.01, 0.99].
 * - `method: 'spearman'`: Pearson on average ranks, with the same t test.
 *
 * @param {{ n:number, rho:number, alpha:number, noise?:{sigma:number, icc:number, k:number}, rhoShared?:number,
 *   method?:'pearson'|'spearman', roundToPercent?:boolean }} spec
 * @param {{ R:number, seed:number|string }} opts
 * @returns {{ power:number, lo:number, hi:number, meanObservedR:number, R:number }}
 */
export function simulateCorrPower(spec, opts) {
  const { n, rho, alpha, noise = null, rhoShared = 0, method = 'pearson', roundToPercent = false } = spec;
  if (!Number.isInteger(n) || n < 4) throw new RangeError(`n must be an integer >= 4, got ${n}`);
  if (!(Math.abs(rho) < 1)) throw new RangeError(`rho must be in (-1, 1), got ${rho}`);
  checkAlpha(alpha);
  if (!(rhoShared >= 0 && rhoShared < 1)) throw new RangeError(`rhoShared must be in [0, 1), got ${rhoShared}`);
  if (method !== 'pearson' && method !== 'spearman') throw new RangeError(`unknown method ${method}`);
  if (!Number.isInteger(opts.R) || opts.R < 1) throw new RangeError(`R must be a positive integer, got ${opts.R}`);
  if (noise && !(noise.sigma > 0 && noise.icc >= 0 && noise.icc <= 1 && noise.k >= 1)) {
    throw new RangeError(`noise needs sigma > 0, icc in [0, 1], k >= 1, got ${JSON.stringify(noise)}`);
  }

  const rng = makeRng(opts.seed);
  const tc = tCritical(n - 2, alpha);
  const vNoise = noise ? noise.sigma ** 2 * (noise.icc + (1 - noise.icc) / noise.k) : 0;
  const sShared = Math.sqrt(rhoShared);
  const sIdio = Math.sqrt(1 - rhoShared);
  const sd = Math.sqrt(vNoise);
  const sRho = Math.sqrt(1 - rho * rho);

  const xs = new Array(n);
  const ys = new Array(n);
  let hits = 0;
  let sumR = 0;
  for (let r = 0; r < opts.R; r++) {
    for (let i = 0; i < n; i++) {
      const z1 = rng.normal();
      const z2 = rng.normal();
      let x = z1;
      let y = rho * z1 + sRho * z2;
      if (noise) {
        const w = rng.normal();
        const a = rng.normal();
        const b = rng.normal();
        x += sd * (sShared * w + sIdio * a);
        y += sd * (sShared * w + sIdio * b);
      }
      if (roundToPercent) {
        x = roundPercent(1 / (1 + Math.exp(-x)));
        y = roundPercent(1 / (1 + Math.exp(-y)));
      }
      xs[i] = x;
      ys[i] = y;
    }
    const u = method === 'spearman' ? averageRanks(xs) : xs;
    const v = method === 'spearman' ? averageRanks(ys) : ys;
    const rr = pearson(u, v);
    sumR += rr;
    const t = (rr * Math.sqrt(n - 2)) / Math.sqrt(Math.max(1 - rr * rr, 1e-300));
    if (Math.abs(t) > tc) hits++;
  }
  const ci = wilson(hits, opts.R);
  return { power: hits / opts.R, lo: ci.lo, hi: ci.hi, meanObservedR: sumR / opts.R, R: opts.R };
}

/**
 * Rank AUC (Mann–Whitney): the probability that a random positive card has a higher forecast than a random negative
 * one, with ties counted as half. Equals the O(N²) pair count exactly. Null when one outcome class is missing.
 * @param {number[]} p forecasts
 * @param {(0|1)[]} y outcomes
 * @returns {number | null}
 */
export function aucRank(p, y) {
  if (!Array.isArray(p) || !Array.isArray(y) || p.length !== y.length) {
    throw new TypeError('aucRank needs two arrays of equal length');
  }
  const ranks = averageRanks(p);
  let n1 = 0;
  let sumRanksPos = 0;
  for (let i = 0; i < y.length; i++) {
    if (y[i] === 1) {
      n1++;
      sumRanksPos += ranks[i];
    } else if (y[i] !== 0) {
      throw new RangeError(`aucRank outcomes must be 0 or 1, got ${JSON.stringify(y[i])}`);
    }
  }
  const n0 = y.length - n1;
  if (n1 === 0 || n0 === 0) return null;
  return (sumRanksPos - (n1 * (n1 + 1)) / 2) / (n1 * n0);
}

/**
 * Logistic recalibration: y ~ logit(a + b·logit(p)) by Newton–Raphson. Slope b = 1 and a = 0 for a calibrated forecast;
 * b < 1 means too confident. Perfect separation makes the maximum-likelihood estimate infinite: that returns
 * converged false with null estimates.
 * @param {number[]} p forecasts in (0, 1)
 * @param {(0|1)[]} y outcomes
 * @returns {{ a:number|null, b:number|null, se:number|null, converged:boolean }}
 */
export function logisticSlope(p, y) {
  if (!Array.isArray(p) || !Array.isArray(y) || p.length !== y.length || p.length < 3) {
    throw new TypeError('logisticSlope needs two equal-length arrays of at least 3 items');
  }
  const eps = 1e-9;
  const x = p.map((v) => {
    const c = Math.min(1 - eps, Math.max(eps, v));
    return Math.log(c / (1 - c));
  });
  let a = 0;
  let b = 1;
  const fail = { a: null, b: null, se: null, converged: false };
  for (let it = 0; it < 100; it++) {
    let g0 = 0;
    let g1 = 0;
    let h00 = 0;
    let h01 = 0;
    let h11 = 0;
    for (let i = 0; i < x.length; i++) {
      const eta = a + b * x[i];
      const mu = 1 / (1 + Math.exp(-eta));
      const w = mu * (1 - mu);
      const r = y[i] - mu;
      g0 += r;
      g1 += r * x[i];
      h00 += w;
      h01 += w * x[i];
      h11 += w * x[i] * x[i];
    }
    const det = h00 * h11 - h01 * h01;
    if (!(det > 1e-12) || !Number.isFinite(det)) return fail;
    const da = (h11 * g0 - h01 * g1) / det;
    const db = (h00 * g1 - h01 * g0) / det;
    a += da;
    b += db;
    if (!Number.isFinite(a) || !Number.isFinite(b) || Math.abs(a) > 100 || Math.abs(b) > 100) return fail;
    if (Math.abs(da) < 1e-10 && Math.abs(db) < 1e-10) {
      let h00f = 0;
      let h01f = 0;
      let h11f = 0;
      for (let i = 0; i < x.length; i++) {
        const mu = 1 / (1 + Math.exp(-(a + b * x[i])));
        const w = mu * (1 - mu);
        h00f += w;
        h01f += w * x[i];
        h11f += w * x[i] * x[i];
      }
      const detf = h00f * h11f - h01f * h01f;
      if (!(detf > 1e-12)) return fail;
      return { a, b, se: Math.sqrt(h00f / detf), converged: true };
    }
  }
  return fail;
}
