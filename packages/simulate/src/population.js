/**
 * Population-level truth: the gain of the panel over a comparator, solved σ, and the headroom table (power-spec §B.3,
 * §A.2, §A.6). Each call draws the same cards and panel draws for the same seed (common random numbers), so the σ
 * solver compares like with like.
 *
 * The pooled panel forecast follows the repo's aggregate(): the pooling method from params (median, mean or log_odds),
 * extremising by extremiseD, which the real aggregate() suppresses on a contested panel. outlier_weighted is not
 * implemented here; the real aggregate() path (WP3) covers it.
 */
import { BAND_MIDPOINT, ACAPS_BANDS, DISPATCH_THRESHOLDS, extremise } from '@benchmark/core/aggregate';
import { makeRng, expit, logit } from './rng.js';
import { loadHistorical } from './data.js';
import { makeRiskCards, makeRoster, drawPanel, modelConstants } from './model.js';
import { riskOfTriggers } from './triggers.js';

/** @typedef {import('./types.js').Params} Params */

const SOLVE_LO = 0.05;
const SOLVE_HI = 6;
const SOLVE_STEPS = 14;
const DEFAULT_M = 60000;

const mean = (xs) => xs.reduce((s, x) => s + x, 0) / xs.length;

/** Sample variance (n − 1). */
function sampleVar(xs) {
  const m = mean(xs);
  return xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1);
}

/** Linear-interpolation quantile of a sorted array (the same rule as the repo's aggregate()). */
function quantileSorted(sorted, q) {
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

/**
 * Pooled panel forecast from reports (equal weights): pooling method, then extremising unless the panel is contested.
 * @param {number[]} ps
 * @param {Params} params
 * @returns {number}
 */
function pooled(ps, params) {
  const method = params.poolMethod;
  const sorted = [...ps].sort((a, b) => a - b);
  let raw;
  if (method === 'median') raw = quantileSorted(sorted, 0.5);
  else if (method === 'mean') raw = mean(ps);
  else if (method === 'log_odds') raw = expit(mean(ps.map((p) => logit(p))));
  else throw new RangeError(`poolMethod ${String(method)} is not implemented in the population model (use the real aggregate())`);

  const iqr = quantileSorted(sorted, 0.75) - quantileSorted(sorted, 0.25);
  const contested = iqr >= DISPATCH_THRESHOLDS.contestedIqr;
  const d = /** @type {number} */ (params.extremiseD);
  return d !== 1 && !contested ? extremise(raw, { d }) : raw;
}

/**
 * Rank AUC with midranks for ties: P(score of a positive > score of a negative), by the Mann–Whitney identity.
 * @param {number[]} p @param {number[]} y 0/1
 */
function rankAuc(p, y) {
  const order = p.map((_, i) => i).sort((a, b) => p[a] - p[b]);
  const ranks = new Float64Array(p.length);
  for (let i = 0; i < order.length; ) {
    let j = i;
    while (j + 1 < order.length && p[order[j + 1]] === p[order[i]]) j++;
    const midrank = (i + j) / 2 + 1;
    for (let t = i; t <= j; t++) ranks[order[t]] = midrank;
    i = j + 1;
  }
  let n1 = 0;
  let sumPos = 0;
  for (let i = 0; i < y.length; i++) {
    if (y[i] === 1) {
      n1++;
      sumPos += ranks[i];
    }
  }
  const n0 = y.length - n1;
  return (sumPos - (n1 * (n1 + 1)) / 2) / (n1 * n0);
}

/**
 * One-way ANOVA ICC for unbalanced clusters (the estimator in §B.1 and §C.12).
 * @param {number[]} values @param {number[]} clusters
 */
function anovaIcc(values, clusters) {
  /** @type {Map<number, number[]>} */
  const byCluster = new Map();
  values.forEach((v, i) => {
    const arr = byCluster.get(clusters[i]);
    if (arr) arr.push(v);
    else byCluster.set(clusters[i], [v]);
  });
  const G = byCluster.size;
  const N = values.length;
  const grand = mean(values);
  let ssb = 0;
  let ssw = 0;
  let sumSq = 0;
  for (const arr of byCluster.values()) {
    const m = mean(arr);
    ssb += arr.length * (m - grand) ** 2;
    for (const x of arr) ssw += (x - m) ** 2;
    sumSq += arr.length * arr.length;
  }
  const msb = ssb / (G - 1);
  const msw = ssw / (N - G);
  const n0 = (N - sumSq / N) / (G - 1);
  return (msb - msw) / (msb + (n0 - 1) * msw);
}

/** Standard-normal grid for the headroom quadrature (trapezoid on [-10, 10]; exact to far beyond 1e-6 for a Gaussian). */
const ZGRID = (() => {
  const h = 0.005;
  const zs = [];
  const ws = [];
  for (let i = -2000; i <= 2000; i++) {
    const z = i * h;
    zs.push(z);
    ws.push((h * Math.exp(-0.5 * z * z)) / Math.sqrt(2 * Math.PI));
  }
  return { zs, ws };
})();

/**
 * Gain of the pooled panel over a comparator, on a population of M cards (§B.1). Gain = Brier(comparator) − Brier(panel),
 * so a positive gain favours the panel (δ in the spec's sign convention).
 *
 * Cards: 'risk' (default) or 'trigger'. Benchmark 'acaps' compares with the band midpoint (risk cards only); 'base_rate'
 * compares with the mean outcome of the same cards. k is the number of responders per card (opts.k, or params.kFixed).
 * σ is params.sigma when set, else sigmaRef (risk) or sigmaRefTrigger (trigger): the fixed-skill view.
 * @param {Params} params
 * @param {{ benchmark:'acaps'|'base_rate', M?:number, seed?:number, k?:number, cards?:'risk'|'trigger' }} opts
 * @returns {{ gain:number, se:number, sdDiff:number, comparatorBrier:number, panelBrier:number, perfectBrier:number, auc:number, rhoD?:number, deff?:number }}
 */
export function populationGain(params, opts) {
  const { benchmark } = opts;
  const kind = opts.cards ?? 'risk';
  if (benchmark !== 'acaps' && benchmark !== 'base_rate') throw new RangeError(`unknown benchmark ${String(benchmark)}`);
  if (kind !== 'risk' && kind !== 'trigger') throw new RangeError(`unknown card kind ${String(kind)}`);
  if (benchmark === 'acaps' && kind === 'trigger') throw new RangeError('triggers have no ACAPS comparator (power-spec F2)');
  const M = opts.M ?? DEFAULT_M;
  const seed = opts.seed ?? /** @type {number} */ (params.masterSeed);
  const k = opts.k ?? params.kFixed;
  if (k === null || k === undefined) throw new RangeError('populationGain needs k, the responders per card');

  const base = makeRng(seed);
  /** @type {import('./types.js').Card[]} */
  let cards;
  /** @type {number[] | null} */
  let clusters = null;
  if (kind === 'risk') {
    cards = makeRiskCards(params, base.fork('cards'), M);
  } else {
    const counts = loadHistorical().active.triggersPerRisk;
    const nRisks = Math.ceil(M / mean(counts));
    const groups = riskOfTriggers(params, base.fork('cards'), nRisks);
    cards = groups.flatMap((g) => g.triggers);
    clusters = groups.flatMap((g) => g.triggers.map((t) => t.risk));
  }

  const roster = makeRoster(params, base.fork('roster'));
  const panelRoot = base.fork('panels');
  const n = cards.length;
  const y = new Float64Array(n);
  const p = new Float64Array(n);
  const pi = new Float64Array(n);
  const aCard = new Float64Array(n);
  const ps = new Array(n);
  for (let i = 0; i < n; i++) {
    const card = cards[i];
    const panel = /** @type {{ ps: number[] }} */ (drawPanel(card, roster, params, panelRoot.fork(String(i)), { kFixed: k }));
    ps[i] = panel.ps;
    p[i] = pooled(panel.ps, params);
    y[i] = card.y;
    pi[i] = card.pi;
    aCard[i] = card.a;
  }

  const yList = Array.from(y);
  const comparator = new Float64Array(n);
  if (benchmark === 'acaps') {
    comparator.set(aCard);
  } else {
    comparator.fill(mean(yList));
  }

  const dSeries = new Array(n);
  let compBrier = 0;
  let panelBrier = 0;
  let perfect = 0;
  for (let i = 0; i < n; i++) {
    const cb = (y[i] - comparator[i]) ** 2;
    const pb = (y[i] - p[i]) ** 2;
    dSeries[i] = cb - pb;
    compBrier += cb;
    panelBrier += pb;
    perfect += pi[i] * (1 - pi[i]);
  }
  compBrier /= n;
  panelBrier /= n;
  perfect /= n;
  const gain = compBrier - panelBrier;
  const sdDiff = Math.sqrt(sampleVar(dSeries));
  const out = {
    gain,
    se: sdDiff / Math.sqrt(n),
    sdDiff,
    comparatorBrier: compBrier,
    panelBrier,
    perfectBrier: perfect,
    auc: rankAuc(Array.from(p), yList),
  };
  if (clusters !== null) {
    const rhoD = anovaIcc(dSeries, clusters);
    const clusterCount = new Set(clusters).size;
    const meanSize = n / clusterCount;
    return { ...out, rhoD, deff: 1 + (meanSize - 1) * rhoD };
  }
  return out;
}

/**
 * The σ that gives a target gain over the comparator, by bisection on [0.05, 6] (14 steps, §B.3). Unattainable if the
 * gain at σ = 0.05 is below the target, or at σ = 6 is still above it.
 * @param {number} targetGain
 * @param {Params} params
 * @param {{ benchmark:'acaps'|'base_rate', M?:number, seed?:number, k?:number, cards?:'risk'|'trigger' }} opts
 * @returns {{ attainable:boolean, sigma:number|null, achieved:number|null, se:number|null, sdDiff:number|null, auc:number|null }}
 */
export function solveSigma(targetGain, params, opts) {
  const unattainable = { attainable: false, sigma: null, achieved: null, se: null, sdDiff: null, auc: null };
  /** @param {number} sigma */
  const at = (sigma) => populationGain({ ...params, sigma }, opts);
  if (at(SOLVE_LO).gain < targetGain) return unattainable;
  if (at(SOLVE_HI).gain > targetGain) return unattainable;
  let lo = SOLVE_LO;
  let hi = SOLVE_HI;
  for (let step = 0; step < SOLVE_STEPS; step++) {
    const mid = (lo + hi) / 2;
    if (at(mid).gain > targetGain) lo = mid;
    else hi = mid;
  }
  const sigma = (lo + hi) / 2;
  const res = at(sigma);
  return { attainable: true, sigma, achieved: res.gain, se: res.se, sdDiff: res.sdDiff, auc: res.auc };
}

/**
 * How much room an ideal forecaster has over ACAPS's bands, for each latent spread τ (§A.2). ACAPS's Brier is the
 * measured band mix with each band's hit rate; the perfect forecaster knows the latent. Headroom = ACAPS − perfect.
 * @param {Params} params
 * @param {number[]} taus
 * @returns {Array<{ tau:number, acapsBrier:number, perfectBrier:number, headroom:number }>}
 */
export function headroomTable(params, taus) {
  return taus.map((tau) => {
    const p = { ...params, tau };
    const { offsets } = modelConstants(p);
    const counts = /** @type {number[]} */ (p.bandCounts);
    const active = /** @type {number[]} */ (p.activeMix);
    const src = p.bandMix === 'active' ? active : counts;
    const total = src.reduce((s, x) => s + x, 0);
    let acaps = 0;
    let perfect = 0;
    for (let b = 0; b < 5; b++) {
      const w = src[b] / total;
      const a = BAND_MIDPOINT[ACAPS_BANDS[b].label];
      let ep = 0;
      let epp = 0;
      for (let i = 0; i < ZGRID.zs.length; i++) {
        const q = expit(offsets[b] + tau * ZGRID.zs[i]);
        ep += ZGRID.ws[i] * q;
        epp += ZGRID.ws[i] * q * (1 - q);
      }
      acaps += w * (a * a - 2 * a * ep + ep);
      perfect += w * epp;
    }
    return { tau, acapsBrier: acaps, perfectBrier: perfect, headroom: acaps - perfect };
  });
}
