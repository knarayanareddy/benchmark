/**
 * Calibration of the panel's forecasts: reliability bins with the release floor, the 5-bin resolution estimate and its
 * upward bias, and interpolation of the cards needed to reach a target power. Pure.
 */
import { wilson } from '@benchmark/core/stats';
import { MIN_RELEASE_PANEL_SIZE } from '@benchmark/core/aggregate';
import { hashSeed, makeRng } from './rng.js';
import { aucRank, logisticSlope, normalQuantile } from './crosscorr.js';
import { paramTable, resolveParams } from './params.js';
import { drawPanel, makeRiskCards, makeRoster } from './model.js';
import { couplingToParams, makeTriggerCards } from './triggers.js';

/**
 * @typedef {object} ReliabilityBin
 * @property {number} lo lower edge of the bin (inclusive)
 * @property {number} hi upper edge (exclusive, except the last bin)
 * @property {number} n cards in the bin (always shown, so a reader can see the bin is small)
 * @property {boolean} withheld true when n is below the release floor; then meanP and observed are null
 * @property {number|null} meanP mean forecast in the bin
 * @property {number|null} observed observed frequency of y = 1 in the bin
 * @property {number|null} halfWidth 95% Wilson half-width of `observed`
 */

/**
 * Reliability bins over equal-width forecast bins (the same binning as core scoring `calibration()`), with the
 * release floor: a bin with fewer than `floor` cards is withheld and shows no forecast or outcome figures. The
 * resolution uses every bin, withheld or not, because it is an estimate of the whole panel and not a figure shown.
 * @param {number[]} p forecasts in [0, 1]
 * @param {(0|1)[]} y outcomes
 * @param {{ bins?: number, floor?: number }} [opts]
 * @returns {{ bins: ReliabilityBin[], resolution: number, n: number, base: number }}
 */
export function reliabilityBins(p, y, opts = {}) {
  const B = opts.bins ?? 5;
  const floor = opts.floor ?? MIN_RELEASE_PANEL_SIZE;
  if (!Number.isInteger(B) || B < 1) throw new RangeError(`bins must be a positive integer, got ${B}`);
  if (!Array.isArray(p) || !Array.isArray(y) || p.length !== y.length || p.length === 0) {
    throw new TypeError('reliabilityBins needs two equal-length, non-empty arrays');
  }
  const n = p.length;
  const counts = new Array(B).fill(0);
  const sumP = new Array(B).fill(0);
  const sumY = new Array(B).fill(0);
  let totalY = 0;
  for (let i = 0; i < n; i++) {
    if (!(p[i] >= 0 && p[i] <= 1)) throw new RangeError(`forecast ${p[i]} is outside [0, 1]`);
    if (y[i] !== 0 && y[i] !== 1) throw new RangeError(`outcome must be 0 or 1, got ${JSON.stringify(y[i])}`);
    const b = Math.min(B - 1, Math.floor(p[i] * B));
    counts[b] += 1;
    sumP[b] += p[i];
    sumY[b] += y[i];
    totalY += y[i];
  }
  const base = totalY / n;
  let resolution = 0;
  /** @type {ReliabilityBin[]} */
  const bins = [];
  for (let b = 0; b < B; b++) {
    const c = counts[b];
    const withheld = c < floor;
    const ci = c > 0 ? wilson(sumY[b], c) : null;
    if (c > 0) resolution += (c * (sumY[b] / c - base) ** 2) / n;
    bins.push({
      lo: b / B,
      hi: (b + 1) / B,
      n: c,
      withheld,
      meanP: withheld || c === 0 ? null : sumP[b] / c,
      observed: withheld || c === 0 ? null : sumY[b] / c,
      halfWidth: withheld || !ci ? null : (ci.hi - ci.lo) / 2,
    });
  }
  return { bins, resolution, n, base };
}

/**
 * Where a power curve first reaches the target, interpolated linearly in log N between the two grid points either side.
 * Censored (n80 null) when the curve never reaches the target on the grid, or already does at the first point.
 * @param {Array<{ N:number, power:number }>} curve sorted by N ascending
 * @param {number} target
 * @returns {{ n80:number|null, censored: 'above'|'below'|null }}
 */
export function crossingN(curve, target) {
  if (curve.length === 0) throw new RangeError('crossingN needs at least one point');
  for (let i = 1; i < curve.length; i++) {
    if (!(curve[i].N > curve[i - 1].N)) throw new RangeError('crossingN needs N strictly ascending');
  }
  if (curve[0].power >= target) return { n80: null, censored: 'below' };
  for (let i = 1; i < curve.length; i++) {
    const a = curve[i - 1];
    const b = curve[i];
    if (b.power >= target) {
      const f = (target - a.power) / (b.power - a.power);
      const logN = Math.log(a.N) + f * (Math.log(b.N) - Math.log(a.N));
      return { n80: Math.exp(logN), censored: null };
    }
  }
  return { n80: null, censored: 'above' };
}

/**
 * Median: the middle value, or the mean of the two middle values. For a panel's answers this equals aggregate()'s
 * median with equal weights (checked in the tests).
 * @param {number[]} xs @returns {number}
 */
export function median(xs) {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** @param {number[]} xs @returns {number} */
function mean(xs) {
  return xs.reduce((s, x) => s + x, 0) / xs.length;
}

/** @param {number[]} xs @returns {number} */
function sd(xs) {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1));
}

/**
 * The model functions calibration needs, injected so the core can be tested on hand-built fixtures. The real ones are
 * model.js (makeRoster, makeRiskCards, drawPanel) and triggers.js (makeTriggerCards).
 * @typedef {object} CalibrationGenerators
 * @property {(params: any, rng: any) => any[]} makeRoster
 * @property {(params: any, rng: any, n: number) => import('./types.js').Card[]} makeRiskCards
 * @property {(params: any, rng: any, nRisks: number) => import('./types.js').Card[]} makeTriggerCards
 * @property {(card: import('./types.js').Card, roster: any[], params: any, rng: any, opts: { kFixed: number })
 *   => { ps: number[] } | null} drawPanel
 */

/**
 * Calibration precision of the pooled panel forecast, by replicate. Each replicate draws a roster, N cards (the first N
 * trigger cards when `cards` is 'trigger'), k answers per card, pools each card's answers by median (the same as
 * aggregate() with equal weights), and measures the logistic recalibration slope and intercept, the rank AUC, the
 * reliability bins and the resolution. A replicate's slope counts as a rejection when its Wald interval excludes 1.
 *
 * The slope and the reliability bins treat cards as independent. Nested trigger cards are not independent; divide the
 * effective counts by the design effect (power-spec Analysis 1), do not read these as nested results.
 *
 * @param {CalibrationGenerators} gen
 * @param {{ params: any, N: number, k: number, cards?: 'risk'|'trigger' }} spec
 * @param {{ R: number, seed: number|string }} opts
 */
export function calibrationCore(gen, spec, opts) {
  const { params, N, k, cards = 'risk' } = spec;
  if (!Number.isInteger(N) || N < 3) throw new RangeError(`N must be an integer >= 3, got ${N}`);
  if (!Number.isInteger(k) || k < 1) throw new RangeError(`k must be a positive integer, got ${k}`);
  if (cards !== 'risk' && cards !== 'trigger') throw new RangeError(`cards must be risk or trigger, got ${cards}`);
  if (!Number.isInteger(opts.R) || opts.R < 1) throw new RangeError(`R must be a positive integer, got ${opts.R}`);
  const zc = normalQuantile(0.975);

  /** @type {number[]} */ const slopes = [];
  /** @type {number[]} */ const intercepts = [];
  /** @type {number[]} */ const aucs = [];
  /** @type {number[]} */ const smallest = [];
  /** @type {number[]} */ const worst = [];
  /** @type {number[]} */ const resolutions = [];
  /** @type {number[]} */ const nullResolutions = [];
  let slopeRejects = 0;

  for (let r = 0; r < opts.R; r++) {
    const rng = makeRng(hashSeed(opts.seed, 'calibration', r));
    const roster = gen.makeRoster(params, rng);
    const pool = cards === 'risk' ? gen.makeRiskCards(params, rng, N) : gen.makeTriggerCards(params, rng, N);
    if (pool.length < N) throw new RangeError(`the generator returned ${pool.length} cards, need ${N}`);
    const ps = [];
    const ys = [];
    for (const card of pool.slice(0, N)) {
      if (card.y !== 0 && card.y !== 1) throw new RangeError('calibration needs resolved cards (y = 0 or 1)');
      const panel = gen.drawPanel(card, roster, params, rng, { kFixed: k });
      if (!panel || panel.ps.length === 0) throw new RangeError('drawPanel returned no answers with kFixed set');
      ps.push(median(panel.ps));
      ys.push(card.y);
    }

    const fit = logisticSlope(ps, ys);
    if (fit.converged) {
      slopes.push(fit.b);
      intercepts.push(fit.a);
      if (Math.abs((fit.b - 1) / fit.se) > zc) slopeRejects++;
    }
    const auc = aucRank(ps, ys);
    if (auc !== null) aucs.push(auc);

    const rel = reliabilityBins(ps, ys);
    smallest.push(Math.min(...rel.bins.map((b) => b.n)));
    const halfWidths = rel.bins.filter((b) => !b.withheld && b.halfWidth !== null).map((b) => b.halfWidth);
    if (halfWidths.length > 0) worst.push(Math.max(...halfWidths));
    resolutions.push(rel.resolution);

    const shuffled = [...ys];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = rng.int(i + 1);
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    nullResolutions.push(reliabilityBins(ps, shuffled).resolution);
  }

  return {
    R: opts.R,
    N,
    k,
    cards,
    slopeMean: mean(slopes),
    slopeSd: sd(slopes),
    slopePower: slopeRejects / opts.R,
    slopeConvergedShare: slopes.length / opts.R,
    interceptMean: mean(intercepts),
    aucMean: mean(aucs),
    aucSd: sd(aucs),
    medianSmallestBin: median(smallest),
    medianWorstHalfWidth: worst.length ? median(worst) : null,
    resolutionEstimate: mean(resolutions),
    resolutionNullBias: mean(nullResolutions),
  };
}

/**
 * The same parameters with some overridden, validated against assumptions.json. Reads the current values of every key
 * from the parameter table, so it works on a resolved parameter object.
 * @param {any} params from resolveParams
 * @param {Record<string, number|string|boolean|null>} overrides
 */
export function withOverrides(params, overrides) {
  /** @type {Record<string, unknown>} */
  const values = {};
  for (const row of paramTable(params)) values[row.key] = row.value;
  return resolveParams({ ...values, ...overrides });
}

/** The model's own generators, for calibrationPrecision. */
const REAL_GENERATORS = { makeRoster, makeRiskCards, makeTriggerCards, drawPanel };

/**
 * Calibration precision with the real generators (model.js, triggers.js). A `coupling` dial c sets the three nesting
 * parameters by the §A.6 mapping (couplingToParams); the registered defaults are not used for it. The dial's mapping
 * can leave a parameter's registered range (rhoLatent 0 at c = 0, 0.9 at c = 1, against 0.1–0.8 in assumptions.json),
 * and then the resolution throws instead of running out of range.
 * @param {{ params: any, N: number, k: number, cards?: 'risk'|'trigger', coupling?: number }} spec
 * @param {{ R: number, seed: number|string }} opts
 */
export function calibrationPrecision(spec, opts) {
  const params = spec.coupling === undefined ? spec.params : withOverrides(spec.params, couplingToParams(spec.coupling));
  return calibrationCore(REAL_GENERATORS, { ...spec, params }, opts);
}
