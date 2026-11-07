/**
 * Endpoints for Analysis 1 (absolute accuracy) and Analysis 2 (panel vs ACAPS), power-spec §Analysis 1-2.
 *
 * Sign convention (spec §0): gain = Brier(comparator) − Brier(panel). A positive gain favours the panel; δ = −Δ.
 * Two implementations of each comparison:
 *   - real: the repo's `aggregate()` (reps 100) for pooling and `paired()` for the interval;
 *   - fast: the median pooled in-house (exact against aggregate().estimate, tested on 500 panels) and a z-decision on
 *     the per-card gains. `aggregate()` is still called for log_odds / outlier_weighted and for extremised panels.
 * Only cards whose outcome is observed (y ∈ {0,1}) and whose panel reaches the floor are scored; nothing else reaches
 * `paired()`.
 */

import { aggregate, MIN_PANEL_SIZE } from '@benchmark/core/aggregate';
import { paired as repoPaired, brierItem } from '@benchmark/core/scoring';
import { clusterBootstrapMean, clusterRobustSe, iccOfScores, designEffect } from './cluster.js';

/** @typedef {import('./types.js').Panel} Panel */
/** @typedef {import('./types.js').Card} Card */

/** @typedef {{ id: string, cluster: number, p: number, y: 0|1, a: number, panel?: Panel }} Scored */

/**
 * Acklam's rational approximation to the standard normal quantile (relative error about 1e-9).
 * @param {number} p in (0, 1)
 */
export function normalQuantile(p) {
  if (!(p > 0 && p < 1)) throw new RangeError(`normalQuantile needs p in (0, 1), got ${p}`);
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1, 2.506628277459239];
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
  const plow = 0.02425;
  if (p < plow) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (p > 1 - plow) return -normalQuantile(1 - p);
  const q = p - 0.5;
  const r = q * q;
  return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

/**
 * Two-sided normal critical value for alpha.
 * @param {number} [alpha]
 */
export function zCritical(alpha = 0.05) {
  return normalQuantile(1 - alpha / 2);
}

/**
 * Standard normal CDF via the complementary error function (Numerical Recipes Chebyshev fit, error below 1.2e-7).
 * @param {number} x
 */
export function normalCdf(x) {
  const z = Math.abs(x) / Math.SQRT2;
  const t = 1 / (1 + 0.5 * z);
  const poly =
    -z * z - 1.26551223 + t * (1.00002368 + t * (0.37409196 + t * (0.09678418 + t * (-0.18628806 +
      t * (0.27886807 + t * (-1.13520398 + t * (1.48851587 + t * (-0.82215223 + t * 0.17087277))))))));
  const erfc = t * Math.exp(poly);
  return x >= 0 ? 1 - erfc / 2 : erfc / 2;
}

/**
 * @param {number} floor
 * @returns {number} the floor the repo's aggregate() will actually apply
 */
function effectiveFloor(floor) {
  if (!Number.isInteger(floor) || floor < 1) throw new RangeError(`floor must be a positive integer, got ${floor}`);
  return Math.max(MIN_PANEL_SIZE, floor);
}

/** @param {number[]} values */
export function median(values) {
  const s = [...values].sort((a, b) => a - b);
  const n = s.length;
  if (n === 0) throw new RangeError('median of no values');
  return n % 2 === 1 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
}

/**
 * The panel's pooled forecast. Median and mean are computed here; every other method, and any extremised pool, goes
 * through the repo's aggregate(). `viaAggregate` forces aggregate() for every method (the real tier).
 * @param {Panel} panel
 * @param {{ method?: string, extremiseD?: number, floor: number, viaAggregate?: boolean }} opts
 * @returns {number | null} null when the panel is below the floor
 */
export function pooledForecast(panel, opts) {
  const { method = 'median', extremiseD = 1, floor, viaAggregate = false } = opts;
  const min = effectiveFloor(floor);
  if (panel.ps.length < min) return null;
  if (!viaAggregate && extremiseD === 1) {
    if (method === 'median') return median(panel.ps);
    if (method === 'mean') return panel.ps.reduce((s, p) => s + p, 0) / panel.ps.length;
  }
  const estimates = panel.ps.map((p, j) => ({ p, expertId: String(panel.experts[j] ?? `slot${j}`) }));
  const agg = aggregate(estimates, { method, reps: 100, minPanel: min, extremiseD });
  return agg.suppressed ? null : agg.estimate;
}

/**
 * Forecast of the comparator for a card: the ACAPS band midpoint (`midpoint`, the protocol headline) or the rating
 * divided by five (`ordinal`, sensitivity S10).
 * @param {Card} card
 * @param {string} comparator
 */
export function comparatorP(card, comparator = 'midpoint') {
  if (comparator === 'midpoint' || comparator === 'ordinal') {
    if (card.kind === 'trigger') {
      throw new RangeError('trigger cards have no ACAPS comparator (power-spec F2); compare them with the base rate');
    }
    return comparator === 'midpoint' ? card.a : (card.band + 1) / 5;
  }
  throw new RangeError(`unknown comparator ${comparator}`);
}

/**
 * Scored records for the cards that can be analysed: outcome observed and panel at the floor.
 * @param {Panel[]} panels
 * @param {{ floor?: number, method?: string, extremiseD?: number, comparator?: string, viaAggregate?: boolean }} [opts]
 * @returns {Scored[]}
 */
export function scoredRecords(panels, opts = {}) {
  const floor = opts.floor ?? MIN_PANEL_SIZE;
  /** @type {Scored[]} */
  const out = [];
  for (const panel of panels) {
    const { card } = panel;
    if (card.y !== 0 && card.y !== 1) continue;
    const p = pooledForecast(panel, { method: opts.method, extremiseD: opts.extremiseD, floor, viaAggregate: opts.viaAggregate });
    if (p === null) continue;
    // Triggers carry no ACAPS reading: a is NaN and only the base-rate endpoints may use them.
    const a = card.kind === 'trigger' ? NaN : comparatorP(card, opts.comparator);
    out.push({ id: card.id, cluster: card.risk, p, y: card.y, a, panel });
  }
  return out;
}

/**
 * The in-sample base rate of the analysed cards, or the fixed constant.
 * @param {Scored[]} records
 * @param {'in_sample_base_rate'|'fixed'} benchmark
 * @param {number} [constant]
 */
export function baseRateOf(records, benchmark, constant) {
  if (benchmark === 'in_sample_base_rate') {
    if (records.length === 0) return NaN;
    return records.reduce((s, r) => s + r.y, 0) / records.length;
  }
  if (benchmark === 'fixed') {
    if (typeof constant !== 'number' || !(constant >= 0 && constant <= 1)) {
      throw new RangeError('benchmark "fixed" needs a constant in [0, 1]');
    }
    return constant;
  }
  throw new RangeError(`unknown benchmark ${benchmark}`);
}

/**
 * Per-card gains (positive favours the panel) for the endpoint.
 * @param {Scored[]} records
 * @param {'vs_acaps'|'absolute'} endpoint
 * @param {{ benchmark?: 'in_sample_base_rate'|'fixed', constant?: number }} [opts]
 * @returns {{ gains: number[], clusters: number[], base: number | null }}
 */
export function gainsOf(records, endpoint, opts = {}) {
  if (endpoint === 'vs_acaps' && records.some((r) => Number.isNaN(r.a))) {
    throw new RangeError('vs_acaps needs an ACAPS comparator on every card; trigger cards have none (power-spec F2)');
  }
  let base = null;
  if (endpoint === 'absolute') base = baseRateOf(records, opts.benchmark ?? 'in_sample_base_rate', opts.constant);
  const gains = records.map((r) => {
    const panelLoss = brierItem({ p: r.p, y: r.y });
    const comparatorLoss = endpoint === 'vs_acaps' ? brierItem({ p: r.a, y: r.y }) : brierItem({ p: /** @type {number} */ (base), y: r.y });
    return comparatorLoss - panelLoss;
  });
  return { gains, clusters: records.map((r) => r.cluster), base };
}

/**
 * Mean, sample SD and z of the gains, and the z-decision at two-sided alpha.
 * @param {number[]} gains
 * @param {number} zc two-sided critical value
 */
export function zDecision(gains, zc) {
  const n = gains.length;
  if (n < 2) return { n, mean: null, sd: null, z: null, better: false, worse: false };
  const mean = gains.reduce((s, g) => s + g, 0) / n;
  const sd = Math.sqrt(gains.reduce((s, g) => s + (g - mean) ** 2, 0) / (n - 1));
  let z;
  if (sd === 0) z = mean === 0 ? 0 : Math.sign(mean) * Infinity;
  else z = mean / (sd / Math.sqrt(n));
  return { n, mean, sd, z, better: z > zc, worse: z < -zc };
}

/**
 * Fast panel vs ACAPS: z-decision on per-card (ACAPS − panel) Brier differences. Reports the difference Δ =
 * Brier(panel) − Brier(ACAPS), negative favouring the panel.
 * @param {Panel[]} panels
 * @param {{ floor: number, method?: string, extremiseD?: number, comparator?: string, alpha?: number }} opts
 */
export function analyseVsAcapsFast(panels, opts) {
  const records = scoredRecords(panels, opts);
  const { gains } = gainsOf(records, 'vs_acaps');
  const d = zDecision(gains, zCritical(opts.alpha));
  return {
    n: d.n,
    diff: d.mean === null ? null : -d.mean,
    sd: d.sd,
    z: d.z === null ? null : -d.z,
    better: d.better,
    worse: d.worse,
  };
}

/**
 * Real panel vs ACAPS: repo aggregate() pooling and repo paired() with the ACAPS midpoints as B.
 * @param {Panel[]} panels
 * @param {{ floor: number, method?: string, extremiseD?: number, comparator?: string, reps?: number, seed?: number, paired?: typeof repoPaired }} opts
 */
export function analyseVsAcapsReal(panels, opts) {
  return pairedVsAcapsRecords(scoredRecords(panels, { ...opts, viaAggregate: true }), opts);
}

/**
 * The paired() step of the real vs-ACAPS analysis, on records already pooled. Split out so the power engine can pool
 * each card once and reuse the records for every prefix N.
 * @param {Scored[]} records
 * @param {{ reps?: number, seed?: number, paired?: typeof repoPaired }} [opts]
 */
export function pairedVsAcapsRecords(records, opts = {}) {
  const run = opts.paired ?? repoPaired;
  const A = records.map((r) => ({ id: r.id, p: r.p, y: r.y }));
  const B = records.map((r) => ({ id: r.id, p: r.a, y: r.y }));
  const r = run(A, B, { reps: opts.reps, seed: opts.seed });
  if (r.diff === null) return { n: r.n, diff: null, lo: null, hi: null, better: false, worse: false };
  return { n: r.n, diff: r.diff, lo: r.lo, hi: r.hi, better: r.hi < 0, worse: r.lo > 0 };
}

/**
 * Fast absolute accuracy against a constant forecast: the in-sample base rate (default) or a fixed value.
 * @param {Panel[]} panels
 * @param {{ floor: number, benchmark?: 'in_sample_base_rate'|'fixed', constant?: number, method?: string, extremiseD?: number, alpha?: number }} opts
 */
export function analyseAbsoluteFast(panels, opts) {
  const records = scoredRecords(panels, opts);
  const benchmark = opts.benchmark ?? 'in_sample_base_rate';
  const { gains, base } = gainsOf(records, 'absolute', { benchmark, constant: opts.constant });
  const d = zDecision(gains, zCritical(opts.alpha));
  return {
    n: d.n,
    gain: d.mean,
    bss: bss(d.mean, base),
    sd: d.sd,
    z: d.z,
    better: d.better,
    worse: d.worse,
  };
}

/** Brier skill score: gain / (b(1−b)); null when the benchmark is 0 or 1 or the gain is null. */
function bss(gain, base) {
  if (gain === null || base === null) return null;
  const v = base * (1 - base);
  return v > 0 ? gain / v : null;
}

/**
 * Real absolute accuracy: repo aggregate() pooling and repo paired() with the constant as the comparator. The
 * comparator is A (base − panel), so paired()'s difference is already the gain.
 * @param {Panel[]} panels
 * @param {{ floor: number, benchmark?: 'in_sample_base_rate'|'fixed', constant?: number, comparator?: string, reps?: number, seed?: number, paired?: typeof repoPaired }} opts
 */
export function analyseAbsoluteReal(panels, opts) {
  return pairedAbsoluteRecords(scoredRecords(panels, { ...opts, viaAggregate: true }), opts);
}

/**
 * The paired() step of the real absolute analysis, on records already pooled (see pairedVsAcapsRecords).
 * @param {Scored[]} records
 * @param {{ benchmark?: 'in_sample_base_rate'|'fixed', constant?: number, reps?: number, seed?: number, paired?: typeof repoPaired }} [opts]
 */
export function pairedAbsoluteRecords(records, opts = {}) {
  const benchmark = opts.benchmark ?? 'in_sample_base_rate';
  const base = baseRateOf(records, benchmark, opts.constant);
  const run = opts.paired ?? repoPaired;
  const A = records.map((r) => ({ id: r.id, p: base, y: r.y }));
  const B = records.map((r) => ({ id: r.id, p: r.p, y: r.y }));
  const r = run(A, B, { reps: opts.reps, seed: opts.seed });
  if (r.diff === null) return { n: r.n, gain: null, bss: null, lo: null, hi: null, better: false, worse: false };
  return {
    n: r.n,
    gain: r.diff,
    bss: bss(r.diff, base),
    lo: r.lo,
    hi: r.hi,
    better: r.lo > 0,
    worse: r.hi < 0,
  };
}

/**
 * Absolute accuracy with cards nested in risks. The interval is a percentile cluster bootstrap over risks (the
 * constant is fixed at the in-sample rate, as in paired()). Also reports the realised ρ_D and the formula DEFF.
 * @param {Panel[]} panels
 * @param {{ floor: number, benchmark?: 'in_sample_base_rate'|'fixed', constant?: number, B?: number, seed?: number, method?: string, extremiseD?: number }} opts
 */
export function analyseAbsoluteCluster(panels, opts) {
  const records = scoredRecords(panels, opts);
  const benchmark = opts.benchmark ?? 'in_sample_base_rate';
  const { gains, clusters, base } = gainsOf(records, 'absolute', { benchmark, constant: opts.constant });
  const n = gains.length;
  if (n < 2) {
    return { n, clusters: 0, gain: null, bss: null, lo: null, hi: null, better: false, worse: false, rhoD: null, deffFormula: null };
  }
  const boot = clusterBootstrapMean(gains, clusters, { B: opts.B ?? 2000, seed: opts.seed ?? 7 });
  const nClusters = new Set(clusters).size;
  const rhoD = iccOfScores(gains, clusters);
  return {
    n,
    clusters: nClusters,
    gain: boot.mean,
    bss: bss(boot.mean, base),
    lo: boot.lo,
    hi: boot.hi,
    better: boot.lo > 0,
    worse: boot.hi < 0,
    rhoD,
    deffFormula: designEffect(n / nClusters, rhoD),
  };
}

/**
 * Cluster-robust t decision on gains (the power engine's cluster tier). Returns the same shape as zDecision.
 * @param {number[]} gains
 * @param {number[]} clusters
 * @param {number} tc two-sided t critical value with G − 1 degrees of freedom
 */
export function clusterTDecision(gains, clusters, tc) {
  const cr = clusterRobustSe(gains, clusters);
  if (cr === null || cr.se === 0 || !Number.isFinite(cr.se)) {
    const mean = gains.length ? gains.reduce((s, g) => s + g, 0) / gains.length : null;
    return { n: gains.length, mean, se: null, t: null, better: false, worse: false };
  }
  const t = cr.mean / cr.se;
  return { n: gains.length, mean: cr.mean, se: cr.se, t, better: t > tc, worse: t < -tc };
}
