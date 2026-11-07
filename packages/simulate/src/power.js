/**
 * Power engine (power-spec §B.2, §B.4, Analyses 1–2). For each replicate it draws one stream of analysable cards and
 * evaluates every N on prefixes of that stream, so one run gives every N and the N = 50 cell equals the N = 50 entry of
 * a longer run with the same seed.
 *
 * Power = share of replicates whose interval excludes zero with the panel ahead. Every power estimate carries a
 * Wilson interval over the replicate count (the Monte Carlo error bar).
 */

import { makeRng, hashSeed } from './rng.js';
import { wilson } from '@benchmark/core/stats';
import { MIN_PANEL_SIZE } from '@benchmark/core/aggregate';
import { gainsOf, zDecision, zCritical, clusterTDecision, pairedVsAcapsRecords, pairedAbsoluteRecords, scoredRecords } from './endpoint.js';
import { crCritical, iccOfScores, designEffect } from './cluster.js';
import { aucRank } from './crosscorr.js';
import { resolveParams, paramTable } from './params.js';
import { makeRiskCards, makeRoster, drawPanel } from './model.js';
import { riskOfTriggers, couplingToParams } from './triggers.js';
import { simCardId } from './label.js';

/** @typedef {import('./endpoint.js').Scored} Scored */
/** @typedef {import('./types.js').Card} Card */

const ENDPOINTS = Object.freeze(['vs_acaps', 'absolute']);
const TIERS = Object.freeze(['fast', 'real', 'cluster']);
/** Risks generated per riskOfTriggers call in the default trigger stream (fixed, so prefixes stay stable). */
const TRIGGER_RISK_BATCH = 32;

/**
 * Monte Carlo error bar on a power estimate: Wilson interval for `better` successes in R replicates.
 * @param {number} better integer count
 * @param {number} R replicates
 */
export function powerWithError(better, R) {
  const p = better / R;
  const w = wilson(better, R);
  if (w === null) throw new RangeError('powerWithError needs R > 0');
  return { power: p, lo: w.lo, hi: w.hi, halfWidth: (w.hi - w.lo) / 2 };
}

/** @param {number | number[]} N */
function normaliseNs(N) {
  const list = (Array.isArray(N) ? N : [N]).slice();
  if (list.length === 0) throw new RangeError('at least one N is required');
  for (const n of list) {
    if (!Number.isInteger(n) || n < 2) throw new RangeError(`N must be an integer >= 2, got ${n}`);
  }
  return [...new Set(list)].sort((a, b) => a - b);
}

/**
 * Two-sided critical value for the decision, given the tier. The fast tier uses the normal, the cluster tier the
 * Student-t with G − 1 degrees of freedom (G clusters in the prefix).
 * @param {string} tier @param {number} alpha @param {number} clusters
 */
function critical(tier, alpha, clusters) {
  if (tier === 'cluster') return clusters >= 2 ? crCritical(clusters - 1, alpha) : Infinity;
  return zCritical(alpha);
}

/**
 * Evaluate the decision on one prefix of scored records.
 * @param {Scored[]} recs
 * @param {{ endpoint: string, tier: string, alpha: number, benchmark: string, constant?: number }} ctx
 * @returns {{ better: boolean, worse: boolean, mean: number|null, sd: number|null, rhoD: number, clusters: number }}
 */
export function evaluatePrefix(recs, ctx) {
  const { gains, clusters } = gainsOf(recs, ctx.endpoint, { benchmark: ctx.benchmark, constant: ctx.constant });
  const nClusters = new Set(clusters).size;
  const rhoD = iccOfScores(gains, clusters);
  const moments = zDecision(gains, Infinity);
  if (ctx.tier === 'real') {
    // Real tier: records were pooled by aggregate() once per card; the decision is paired()'s interval.
    const r = ctx.endpoint === 'vs_acaps'
      ? pairedVsAcapsRecords(recs, { reps: ctx.reps, seed: ctx.seed })
      : pairedAbsoluteRecords(recs, { benchmark: ctx.benchmark, constant: ctx.constant, reps: ctx.reps, seed: ctx.seed });
    const mean = ctx.endpoint === 'vs_acaps' ? (r.diff === null ? null : -r.diff) : r.gain;
    return { better: r.better, worse: r.worse, mean, sd: moments.sd, rhoD, clusters: nClusters };
  }
  if (ctx.tier === 'cluster') {
    const d = clusterTDecision(gains, clusters, critical('cluster', ctx.alpha, nClusters));
    return { better: d.better, worse: d.worse, mean: moments.mean, sd: moments.sd, rhoD, clusters: nClusters };
  }
  const d = zDecision(gains, critical('fast', ctx.alpha, nClusters));
  return { better: d.better, worse: d.worse, mean: moments.mean, sd: moments.sd, rhoD, clusters: nClusters };
}

/**
 * The default card stream. Each card or risk is generated on its own fork of the stream, so the sequence of
 * analysable cards does not depend on how many are asked for (the prefix property). Ids are relabelled from a global
 * counter because the model's generators number from 1 on every call. A card is analysable when its outcome is
 * observed (drawn with the yield) and its panel reaches the floor. Kept cards are scored here: pooled with aggregate()
 * for the real tier, with the in-house pool otherwise.
 * @param {{ params: import('./types.js').Params, cards?: 'risk'|'trigger', k?: number|null }} spec
 * @returns {(rng: import('./types.js').Rng, tier: string) => { next(): Scored }}
 */
function defaultMakeStream(spec) {
  const { params } = spec;
  const cards = spec.cards ?? 'risk';
  const kFixed = spec.k ?? params.kFixed ?? undefined;
  // kFixed bypasses dropout and the floor (types.js / model.js); the aggregate() minimum still applies.
  const floor = kFixed !== undefined ? MIN_PANEL_SIZE : /** @type {number} */ (params.floor);
  const yieldP = cards === 'trigger' ? /** @type {number} */ (params.yieldTrigger) : /** @type {number} */ (params.yieldRisk);
  return (rng, tier) => {
    const roster = makeRoster(params, rng);
    const poolOpts = {
      floor,
      method: /** @type {string} */ (params.poolMethod),
      extremiseD: /** @type {number} */ (params.extremiseD),
      comparator: /** @type {string} */ (params.comparator),
      viaAggregate: tier === 'real',
    };
    /** @type {Scored[]} */
    const queue = [];
    let riskNo = 0;
    let trigNo = 0;
    let cardNo = 0;
    let batchNo = 0;
    /** @param {Card} card */
    const offer = (card) => {
      const panel = drawPanel(card, roster, params, rng, { kFixed });
      const observed = rng.bernoulli(yieldP) === 1;
      if (!observed || panel === null) return;
      for (const rec of scoredRecords([panel], poolOpts)) queue.push(rec);
    };
    const refill = () => {
      if (cards === 'trigger') {
        // riskOfTriggers re-solves the trigger intercept on each call, so risks are generated in fixed batches of 32.
        batchNo += 1;
        for (const { triggers } of riskOfTriggers(params, rng.fork(`batch:${batchNo}`), TRIGGER_RISK_BATCH)) {
          riskNo += 1;
          for (const t of triggers) {
            trigNo += 1;
            offer({ ...t, id: simCardId(trigNo, 'trigger'), risk: riskNo });
          }
        }
      } else {
        cardNo += 1;
        const [base] = makeRiskCards(params, rng.fork(`card:${cardNo}`), 1);
        offer({ ...base, id: simCardId(cardNo, 'risk'), risk: cardNo });
      }
    };
    return {
      next() {
        while (queue.length === 0) refill();
        return /** @type {Scored} */ (queue.shift());
      },
    };
  };
}

/**
 * Power curve for a list of sample sizes. Each replicate draws one stream of analysable cards up to the largest N and
 * evaluates every N on its prefix.
 * @param {{ params: object, N: number|number[], k?: number|null, endpoint: 'vs_acaps'|'absolute', tier: 'fast'|'real'|'cluster', cards?: 'risk'|'trigger', benchmark?: 'in_sample_base_rate'|'fixed', constant?: number, scenario?: string }} spec
 * @param {{ R: number, seed: number, reps?: number, auc?: boolean, makeStream?: (rng: import('./types.js').Rng, tier: string) => { next(): Scored } }} opts
 * @returns {Array<{ N:number, power:number, lo:number, hi:number, halfWidth:number, worse:number, meanGain:number|null, sdDiff:number|null, nAnalysed:number, clusters:number|null, rhoD:number|null, auc:number|null, R:number, endpoint:string, tier:string, k:number|null, cards:string }>}
 */
export function estimatePower(spec, opts) {
  const { params, endpoint, tier } = spec;
  if (!ENDPOINTS.includes(endpoint)) throw new RangeError(`unknown endpoint ${endpoint}`);
  if (!TIERS.includes(tier)) throw new RangeError(`unknown tier ${tier}`);
  if (!Number.isInteger(opts.R) || opts.R < 1) throw new RangeError(`R must be a positive integer, got ${opts.R}`);
  const Ns = normaliseNs(spec.N);
  const Nmax = Ns[Ns.length - 1];
  const cards = spec.cards ?? 'risk';
  const k = spec.k ?? null;
  const benchmark = spec.benchmark ?? 'in_sample_base_rate';
  const alpha = params.alpha;
  const makeStream = opts.makeStream ?? defaultMakeStream(spec);
  const ctx = { endpoint, tier, alpha, benchmark, constant: spec.constant, reps: opts.reps, seed: opts.seed };

  const acc = Ns.map(() => ({ better: 0, worse: 0, meanSum: 0, meanCount: 0, sdSum: 0, sdCount: 0, rhoSum: 0, clusterSum: 0, aucSum: 0, aucCount: 0 }));
  for (let r = 0; r < opts.R; r++) {
    const rng = makeRng(hashSeed(opts.seed, 'power', endpoint, tier, cards, k ?? 'params', spec.scenario ?? '', r));
    const stream = makeStream(rng, tier);
    const recs = [];
    for (let i = 0; i < Nmax; i++) recs.push(stream.next());
    Ns.forEach((N, j) => {
      const a = acc[j];
      const e = evaluatePrefix(recs.slice(0, N), ctx);
      if (e.better) a.better += 1;
      if (e.worse) a.worse += 1;
      if (e.mean !== null) {
        a.meanSum += e.mean;
        a.meanCount += 1;
      }
      if (e.sd !== null) {
        a.sdSum += e.sd;
        a.sdCount += 1;
      }
      a.rhoSum += e.rhoD;
      a.clusterSum += e.clusters;
      if (opts.auc) {
        const prefix = recs.slice(0, N);
        const auc = aucRank(prefix.map((x) => x.p), prefix.map((x) => x.y));
        if (auc !== null) {
          a.aucSum += auc;
          a.aucCount += 1;
        }
      }
    });
  }
  return Ns.map((N, j) => {
    const a = acc[j];
    const err = powerWithError(a.better, opts.R);
    return {
      N,
      power: err.power,
      lo: err.lo,
      hi: err.hi,
      halfWidth: err.halfWidth,
      worse: a.worse / opts.R,
      meanGain: a.meanCount ? a.meanSum / a.meanCount : null,
      sdDiff: a.sdCount ? a.sdSum / a.sdCount : null,
      nAnalysed: N,
      clusters: a.clusterSum / opts.R,
      rhoD: a.rhoSum / opts.R,
      auc: opts.auc && a.aucCount ? a.aucSum / a.aucCount : null,
      R: opts.R,
      endpoint,
      tier,
      k,
      cards,
    };
  });
}

/**
 * Median and interquartile range of the 95% half-width of the real paired interval, and the power, for the risk-level
 * panel vs ACAPS comparison (Analysis 2). Each card is pooled once per replicate, then every N is a prefix.
 * @param {{ params: object, k?: number|null, benchmark?: string, scenario?: string }} spec
 * @param {number[]} Ns
 * @param {{ R: number, seed: number, reps?: number, makeStream?: (rng: import('./types.js').Rng, tier: string) => { next(): Scored } }} opts
 */
export function ciHalfWidth(spec, Ns, opts) {
  const list = normaliseNs(Ns);
  const Nmax = list[list.length - 1];
  const widths = list.map(() => /** @type {number[]} */ ([]));
  const better = list.map(() => 0);
  const makeStream = opts.makeStream ?? defaultMakeStream({ ...spec, cards: 'risk' });
  for (let r = 0; r < opts.R; r++) {
    const rng = makeRng(hashSeed(opts.seed, 'ci', spec.scenario ?? '', r));
    const stream = makeStream(rng, 'real');
    const recs = [];
    for (let i = 0; i < Nmax; i++) recs.push(stream.next());
    list.forEach((N, j) => {
      const res = pairedVsAcapsRecords(recs.slice(0, N), { reps: opts.reps, seed: opts.seed });
      if (res.lo !== null && res.hi !== null) widths[j].push((res.hi - res.lo) / 2);
      if (res.better) better[j] += 1;
    });
  }
  return list.map((N, j) => {
    const w = widths[j].slice().sort((a, b) => a - b);
    return {
      N,
      medianHalfWidth: quantile(w, 0.5),
      p25: quantile(w, 0.25),
      p75: quantile(w, 0.75),
      power: better[j] / opts.R,
      R: opts.R,
    };
  });
}

/**
 * Linear-interpolated quantile of a sorted array, or null when empty.
 * @param {number[]} sorted
 * @param {number} q
 */
function quantile(sorted, q) {
  if (sorted.length === 0) return null;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

/**
 * Effective N of a nested design: the iid sample size whose power equals the nested power.
 * @param {Array<{N:number, power:number}>} curveIid iid power by N, ascending
 * @param {number} powerNested
 * @returns {number | null} null when the nested power is outside the iid curve
 */
export function matchedNeff(curveIid, powerNested) {
  const c = curveIid.slice().sort((a, b) => a.N - b.N);
  for (let i = 1; i < c.length; i++) {
    const [a, b] = [c[i - 1], c[i]];
    if (powerNested >= a.power && powerNested <= b.power && b.power > a.power) {
      return a.N + ((powerNested - a.power) * (b.N - a.N)) / (b.power - a.power);
    }
  }
  return null;
}

/**
 * N at which power first reaches 0.8, interpolated linearly between grid points, with the Wilson bounds giving lo and
 * hi. Never extrapolated: outside the grid it is null and censored.
 * @param {Array<{N:number, power:number, lo?:number, hi?:number}>} curve ascending by N
 * @returns {{ n80:number|null, lo:number|null, hi:number|null, censored:boolean }}
 */
export function n80(curve) {
  const c = curve.slice().sort((a, b) => a.N - b.N);
  const cross = (key) => {
    for (let i = 0; i < c.length; i++) {
      const p = key(c[i]);
      if (p === undefined || p === null) return null;
      if (p >= 0.8) {
        if (i === 0) return null;
        const q = key(c[i - 1]);
        if (q === undefined || q === null) return null;
        return c[i - 1].N + ((0.8 - q) * (c[i].N - c[i - 1].N)) / (p - q);
      }
    }
    return null;
  };
  const point = cross((x) => x.power);
  if (point === null) return { n80: null, lo: null, hi: null, censored: true };
  return {
    n80: point,
    lo: cross((x) => x.hi ?? x.power),
    hi: cross((x) => x.lo ?? x.power),
    censored: false,
  };
}

/**
 * Parameter set with some keys changed, built from a resolved parameter object.
 * @param {object} params
 * @param {Record<string, unknown>} changes
 */
export function withOverrides(params, changes) {
  const base = Object.fromEntries(paramTable(params).map((e) => [e.key, e.value]));
  return resolveParams({ ...base, ...changes });
}

/**
 * Absolute-endpoint grid with nested trigger cards: for each (gain, k), the iid (coupling 0) and nested curves, the
 * realised ρ_D, the formula N_eff, and the power-matched N_eff. `opts.sigmaFor(gain, k, params)` supplies σ (the
 * caller solves it with population.js).
 * @param {object} params resolved parameters
 * @param {{ gains: number[], ks: number[], Ns: number[], couplings: number[] }} grid
 * @param {{ R: number, seed: number, sigmaFor: (gain:number, k:number, params:object) => number|null, makeStream?: (rng: import('./types.js').Rng, tier: string) => { next(): Scored } }} opts
 */
export function runAbsoluteGrid(params, grid, opts) {
  /** @type {object[]} */
  const rows = [];
  for (const gain of grid.gains) {
    for (const k of grid.ks) {
      const sigma = opts.sigmaFor(gain, k, params);
      if (sigma === null) continue;
      for (const coupling of grid.couplings) {
        // The grid's coupling dial sets the three nesting keys through the §A.6 mapping; the stored `coupling` key is
        // not read by the trigger generator (see triggers.js).
        const p = withOverrides(params, { sigma, ...couplingToParams(coupling) });
        const shared = { params: p, N: grid.Ns, k, endpoint: 'absolute', cards: 'trigger', benchmark: 'in_sample_base_rate', scenario: `g${gain}-c${coupling}` };
        const naive = estimatePower({ ...shared, tier: 'fast' }, { R: opts.R, seed: opts.seed, makeStream: opts.makeStream });
        const cluster = estimatePower({ ...shared, tier: 'cluster' }, { R: opts.R, seed: opts.seed, makeStream: opts.makeStream, auc: true });
        // The iid reference is the naive z-curve of the same cards: that test ignores clusters, so its curve is the
        // iid power at this per-card SD. (Coupling 0 itself is outside the declared rhoLatent range.)
        const iid = naive.map((r) => ({ N: r.N, power: r.power }));
        cluster.forEach((c, j) => {
          const meanSize = c.clusters > 0 ? c.nAnalysed / c.clusters : 1;
          rows.push({
            gain_target: gain,
            k,
            N: c.N,
            coupling,
            rho_D: c.rhoD,
            deff: designEffect(meanSize, c.rhoD),
            neff_formula: c.N / designEffect(meanSize, c.rhoD),
            neff_power_matched: matchedNeff(iid, c.power),
            sigma,
            sd_diff: c.sdDiff,
            power_naive: naive[j].power,
            power_cluster: c.power,
            auc: c.auc,
            lo: c.lo,
            hi: c.hi,
            R: c.R,
          });
        });
      }
    }
  }
  return rows;
}

/**
 * Panel vs ACAPS power grid, risk cards, fast tier (Analysis 2 at fixed skill or gain-targeted σ).
 * `opts.sigmaFor(gain, k, params)` supplies σ.
 * @param {object} params
 * @param {{ gains: number[], ks: number[], Ns: number[] }} grid
 * @param {{ R: number, seed: number, sigmaFor: (gain:number, k:number, params:object) => number|null, makeStream?: (rng: import('./types.js').Rng, tier: string) => { next(): Scored } }} opts
 */
export function runVsAcapsGrid(params, grid, opts) {
  /** @type {object[]} */
  const rows = [];
  for (const gain of grid.gains) {
    for (const k of grid.ks) {
      const sigma = opts.sigmaFor(gain, k, params);
      if (sigma === null) continue;
      const p = withOverrides(params, { sigma });
      const out = estimatePower({ params: p, N: grid.Ns, k, endpoint: 'vs_acaps', tier: 'fast', cards: 'risk', scenario: `g${gain}` }, { R: opts.R, seed: opts.seed, makeStream: opts.makeStream });
      for (const r of out) {
        rows.push({ gain_target: gain, k, N: r.N, sigma, power: r.power, lo: r.lo, hi: r.hi, worse: r.worse, mean_gain: r.meanGain, sd_diff: r.sdDiff, R: r.R });
      }
    }
  }
  return rows;
}
