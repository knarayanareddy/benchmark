/**
 * Second stage (spec Analysis 3): do panel forecasts of a risk's triggers, combined by a rule fixed before outcomes,
 * rank the risk's own outcome better than ACAPS's band? Compared by AUC difference on the same risks (paired bootstrap
 * over risks), and by Brier as a secondary. Descriptive until several hundred risks exist. Synthetic, never a result.
 */
import { wilson } from '@benchmark/core/stats';
import { hashSeed, makeRng } from './rng.js';
import { drawPanel, makeRoster } from './model.js';
import { aucRank } from './crosscorr.js';
import { riskOfTriggers } from './triggers.js';

/** The three rules of the spec, in report order. */
export const RULES = Object.freeze(['max', 'noisy_or', 'mean']);

/**
 * One risk's score from its trigger forecasts. Fixed rules; none uses ACAPS's formula (ACAPS says there is none).
 * @param {number[]} ps trigger probabilities, each in [0, 1], at least one
 * @param {'max'|'noisy_or'|'mean'} rule
 * @returns {number}
 */
export function combineRule(ps, rule) {
  if (!Array.isArray(ps) || ps.length === 0) throw new RangeError('combineRule needs at least one trigger forecast');
  for (const p of ps) {
    if (!(p >= 0 && p <= 1)) throw new RangeError(`trigger forecast ${p} is outside [0, 1]`);
  }
  switch (rule) {
    case 'max':
      return Math.max(...ps);
    case 'noisy_or':
      return 1 - ps.reduce((acc, p) => acc * (1 - p), 1);
    case 'mean':
      return ps.reduce((s, p) => s + p, 0) / ps.length;
    default:
      throw new RangeError(`unknown rule ${String(rule)}`);
  }
}

/** Median of a panel's reports (the standard median; equal to the repo's weighted median with equal weights). */
function medianOf(xs) {
  const s = [...xs].sort((a, b) => a - b);
  const n = s.length;
  return n % 2 === 1 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
}

/**
 * AUC from the repo-wide rank AUC (crosscorr.js), with NaN instead of null when a class is missing, so arithmetic on
 * it cannot silently become 0.
 * @param {number[]} p scores
 * @param {number[]} y 0/1 outcomes
 * @returns {number}
 */
function auc(p, y) {
  const v = aucRank(p, y);
  return v === null ? NaN : v;
}

/** @param {number[]} p @param {number[]} y @returns {number} mean squared error */
function brierOf(p, y) {
  return p.reduce((s, x, i) => s + (x - y[i]) ** 2, 0) / p.length;
}

/** Linear-interpolated quantile of a sorted array. */
function quantileSorted(sorted, q) {
  const pos = q * (sorted.length - 1);
  const i = Math.floor(pos);
  const frac = pos - i;
  return i + 1 < sorted.length ? sorted[i] * (1 - frac) + sorted[i + 1] * frac : sorted[i];
}

/**
 * One row per risk that has a risk-card panel and at least one analysable trigger. Trigger and risk forecasts are panel
 * medians. `kFixed` sets the responders per card (bypasses dropout and the floor, as in model.js); without it the
 * dropout model applies and cards below the floor are withheld. `rules` picks the rule columns (default: all three).
 * @param {import('./types.js').Params} params
 * @param {{ G:number, seed:number|string, rules?:string[], kFixed?:number|null }} opts
 * @returns {Array<{ y:0|1, a:number, direct:number, m:number, max?:number, noisy_or?:number, mean?:number }>}
 */
export function simulateSecondStage(params, opts) {
  const rules = opts.rules ?? [...RULES];
  if (rules.length === 0 || rules.some((r) => !RULES.includes(r))) {
    throw new RangeError(`rules must be a non-empty subset of ${RULES.join(', ')}`);
  }
  const rng = makeRng(opts.seed);
  const roster = makeRoster(params, rng.fork('roster'));
  const groups = riskOfTriggers(params, rng.fork('risks'), opts.G);
  const panelRng = rng.fork('panels');
  const panelOpts = opts.kFixed === undefined || opts.kFixed === null ? undefined : { kFixed: opts.kFixed };

  /** @type {Array<{ y:0|1, a:number, direct:number, m:number, max?:number, noisy_or?:number, mean?:number }>} */
  const rows = [];
  for (const { risk, triggers } of groups) {
    if (risk.y === null) throw new Error(`risk ${risk.id} has no simulated outcome`);
    const riskPanel = drawPanel(risk, roster, params, panelRng, panelOpts);
    if (riskPanel === null) continue;
    /** @type {number[]} */
    const ps = [];
    for (const t of triggers) {
      const panel = drawPanel(t, roster, params, panelRng, panelOpts);
      if (panel !== null) ps.push(medianOf(panel.ps));
    }
    if (ps.length === 0) continue;
    const row = { y: risk.y, a: risk.a, direct: medianOf(riskPanel.ps), m: ps.length };
    for (const rule of rules) row[rule] = combineRule(ps, rule);
    rows.push(row);
  }
  return rows;
}

/**
 * Paired bootstrap over risks of AUC(rule) − AUC(ACAPS band). Each resample draws risk rows once and scores both
 * forecasts on them, so the interval respects the pairing. Resamples missing a class are skipped.
 * @param {Array<Record<string, any>>} rows from simulateSecondStage
 * @param {string} ruleKey column holding the rule's score
 * @param {{ B:number, seed:number|string }} opts
 * @returns {{ dAuc:number, lo:number, hi:number, halfWidth:number, significantBetter:boolean }}
 */
export function aucDifferenceCI(rows, ruleKey, opts) {
  if (!Number.isInteger(opts.B) || opts.B < 1) throw new RangeError('B must be a positive integer');
  const n = rows.length;
  const y = rows.map((r) => r.y);
  const a = rows.map((r) => r.a);
  const s = rows.map((r) => r[ruleKey]);
  const dAuc = auc(s, y) - auc(a, y);
  if (!Number.isFinite(dAuc)) throw new RangeError('both classes are needed to compare AUCs');

  const rng = makeRng(opts.seed);
  /** @type {number[]} */
  const diffs = [];
  for (let b = 0; b < opts.B; b++) {
    const yb = new Array(n);
    const ab = new Array(n);
    const sb = new Array(n);
    for (let i = 0; i < n; i++) {
      const j = rng.int(n);
      yb[i] = y[j];
      ab[i] = a[j];
      sb[i] = s[j];
    }
    const auc1 = auc(sb, yb);
    const auc2 = auc(ab, yb);
    if (Number.isFinite(auc1) && Number.isFinite(auc2)) diffs.push(auc1 - auc2);
  }
  if (diffs.length === 0) throw new RangeError('no bootstrap resample had both classes');
  diffs.sort((x, z) => x - z);
  const lo = quantileSorted(diffs, 0.025);
  const hi = quantileSorted(diffs, 0.975);
  return { dAuc, lo, hi, halfWidth: (hi - lo) / 2, significantBetter: lo > 0 };
}

/**
 * Power of the second stage: the share of simulated datasets in which the interval for AUC(rule) − AUC(ACAPS) excludes 0
 * on the better side. Each dataset gets its own seed, so replicates are independent and reproducible.
 * @param {{ params:import('./types.js').Params, G:number, rule:'max'|'noisy_or'|'mean', kFixed?:number|null }} spec
 * @param {{ R:number, B:number, seed:number|string }} opts
 * @returns {{ power:number, lo:number, hi:number, meanDAuc:number, halfWidth:number }}
 */
export function secondStagePower(spec, opts) {
  if (!Number.isInteger(opts.R) || opts.R < 1) throw new RangeError('R must be a positive integer');
  let hits = 0;
  let sumD = 0;
  let sumHalf = 0;
  for (let r = 0; r < opts.R; r++) {
    const repSeed = hashSeed(opts.seed, 'second-stage', r);
    const rows = simulateSecondStage(spec.params, { G: spec.G, seed: repSeed, rules: [spec.rule], kFixed: spec.kFixed });
    const ci = aucDifferenceCI(rows, spec.rule, { B: opts.B, seed: hashSeed(repSeed, 'bootstrap') });
    if (ci.significantBetter) hits += 1;
    sumD += ci.dAuc;
    sumHalf += ci.halfWidth;
  }
  const w = wilson(hits, opts.R);
  return {
    power: hits / opts.R,
    lo: w === null ? 0 : w.lo,
    hi: w === null ? 1 : w.hi,
    meanDAuc: sumD / opts.R,
    halfWidth: sumHalf / opts.R,
  };
}

/**
 * AUC and Brier of ACAPS's band and of every rule and the panel's direct risk forecast, on one large simulated population.
 * @param {import('./types.js').Params} params
 * @param {{ G:number, seed:number|string, kFixed?:number|null }} opts
 */
export function populationAucs(params, opts) {
  const rows = simulateSecondStage(params, { G: opts.G, seed: opts.seed, kFixed: opts.kFixed });
  const y = rows.map((r) => r.y);
  const col = (key) => rows.map((r) => r[key]);
  const acaps = col('a');
  const direct = col('direct');
  const max = col('max');
  const noisyOr = col('noisy_or');
  const mean = col('mean');
  return {
    n: rows.length,
    acaps: auc(acaps, y),
    direct: auc(direct, y),
    max: auc(max, y),
    noisy_or: auc(noisyOr, y),
    mean: auc(mean, y),
    brier: {
      acaps: brierOf(acaps, y),
      direct: brierOf(direct, y),
      max: brierOf(max, y),
      noisy_or: brierOf(noisyOr, y),
      mean: brierOf(mean, y),
    },
  };
}
