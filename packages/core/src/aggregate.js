/**
 * Aggregation — turning n individual risk estimates into one panel forecast,
 * always with its uncertainty interval, small-panel privacy guard, and ACAPS
 * Risk Level mapping.
 *
 * Scope discipline (see design/04-adoption-review.md and docs/02-scoring-rules.md):
 *
 *   FULL:
 *     - Pooling on single-probability cards: median (default), linear mean,
 *       log-odds mean (aggreCAT LOArMean), and outlier-downweighted linear
 *       pool (aggreCAT OutWAgg).
 *     - Mandatory uncertainty: every non-suppressed call returns both a
 *       bootstrap confidence interval [lo, hi] and panel dispersion
 *       (q25, q75, iqr, min, max, spread). No naked point estimates.
 *     - Small-panel differencing guard: suppresses output below n=3 on panel
 *       views (or below PUBLIC.minCount=10 on public views) so no participant
 *       can solve for an anonymous peer's estimate by subtraction.
 *     - ACAPS 5x5 bridge: maps pooled probability + Impact (1-5) through
 *       ACAPS' published Probability x Impact matrix, including interval
 *       bounds, so Impact actually moves Risk Level.
 *
 *   LIMITED (with hard guardrails):
 *     - Track-record weighting: binary Brier skill weights over shared
 *       resolved seed items ONLY when sharedSeeds >= 10 (Eggstaff et al. 2014;
 *       Clemen 2008). Below 10, automatically falls back to equal weights.
 *       Never uses self-declared expertise (Rule R8) or Cooke continuous CDFs.
 *     - Extremisation: log-odds extremisation (Baron et al. 2014; Satopaa
 *       et al. 2014) is opt-in with d=1.0 (identity / off) by default until
 *       historical panel data exists to fit d out-of-sample, and is suppressed
 *       on contested panels unless explicitly forced.
 *     - Round-2 deduplication: enforces Rule R6 (max 2 rounds) and keeps each
 *       expert's latest round without introducing UI or workflow state.
 *
 * Pure: no storage, no network, no clock.
 */

import { mulberry32, observed, brierItem } from './scoring.js';
import { LEVELS, PUBLIC, resolveLevel } from './anonymity.js';
import { TYPES } from './dispatch.js';

export const METHODS = Object.freeze({
  MEDIAN: 'median',
  MEAN: 'mean',
  LOG_ODDS: 'log_odds',
  OUTLIER_WEIGHTED: 'outlier_weighted',
});

export const DEFAULT_METHOD = METHODS.MEDIAN;
export const MIN_PANEL_SIZE = 3;
export const MIN_RELEASE_PANEL_SIZE = 5;
export const MIN_COHORT_STEP = 3;
export const MIN_SEEDS_FOR_WEIGHTING = 10;
export const MAX_ROUNDS = 2;

export const RELEASE_POLICIES = Object.freeze({
  ON_CLOSE: 'on_close',
  BATCH: 'batch',
});

/**
 * Uninformative coin-flip Brier benchmark on binary outcomes:
 * (0.5 - y)^2 === 0.25 identically for both y = 0 and y = 1.
 */
export const SKILL_CUTOFF_BRIER = 0.25;

export const DISPATCH_THRESHOLDS = Object.freeze({
  contestedIqr: 0.25,
  outlierGap: 0.25,
});

const LOGIT_EPS = 1e-6;

/**
 * ACAPS published percentage bands (organiser/acaps/risk-methodology.md and
 * scripts/measure-baseline.mjs):
 *   Very Low 0-20 · Low 21-40 · Medium 41-60 · High 61-80 · Very High 81-100
 */
export const ACAPS_BANDS = Object.freeze([
  Object.freeze({ ordinal: 1, label: 'Very Low', min: 0.0, max: 0.2 }),
  Object.freeze({ ordinal: 2, label: 'Low', min: 0.2, max: 0.4 }),
  Object.freeze({ ordinal: 3, label: 'Medium', min: 0.4, max: 0.6 }),
  Object.freeze({ ordinal: 4, label: 'High', min: 0.6, max: 0.8 }),
  Object.freeze({ ordinal: 5, label: 'Very High', min: 0.8, max: 1.0 }),
]);

/**
 * Verbatim 5x5 Probability (ordinal 1..5) x Impact (1..5) matrix from
 * organiser/acaps/risk-methodology.md.
 */
export const ACAPS_MATRIX = Object.freeze({
  5: Object.freeze({ 1: 'Medium', 2: 'Medium', 3: 'High', 4: 'High', 5: 'High' }),
  4: Object.freeze({ 1: 'Low', 2: 'Medium', 3: 'Medium', 4: 'High', 5: 'High' }),
  3: Object.freeze({ 1: 'Low', 2: 'Medium', 3: 'Medium', 4: 'Medium', 5: 'High' }),
  2: Object.freeze({ 1: 'Low', 2: 'Low', 3: 'Medium', 4: 'Medium', 5: 'Medium' }),
  1: Object.freeze({ 1: 'Low', 2: 'Low', 3: 'Low', 4: 'Low', 5: 'Medium' }),
});

function assertProbability(p, label = 'probability') {
  if (typeof p !== 'number' || !Number.isFinite(p) || p < 0 || p > 1) {
    throw new RangeError(`${label} must be a finite number in [0, 1], got ${JSON.stringify(p)}`);
  }
}

function quantileSorted(sorted, q) {
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

function sigmoid(z) {
  if (z >= 0) {
    const ez = Math.exp(-z);
    return 1 / (1 + ez);
  }
  const ez = Math.exp(z);
  return ez / (1 + ez);
}

function clampedLogit(p) {
  const c = Math.min(1 - LOGIT_EPS, Math.max(LOGIT_EPS, p));
  return Math.log(c) - Math.log1p(-c);
}

/**
 * Exact weighted median (minimiser of sum_i w_i |p_i - m|).
 * Groups identical values first so tie ordering never alters the output, and
 * reduces algebraically to the standard median when weights are equal.
 */
function weightedMedian(values, weights) {
  const massByValue = new Map();
  let total = 0;
  for (let i = 0; i < values.length; i++) {
    const w = weights[i];
    if (w <= 0) continue;
    const v = values[i];
    massByValue.set(v, (massByValue.get(v) || 0) + w);
    total += w;
  }
  if (total <= 0) {
    const sorted = [...values].sort((a, b) => a - b);
    return quantileSorted(sorted, 0.5);
  }
  const pairs = [...massByValue.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([v, w]) => [v, w / total]);

  let cum = 0;
  const half = 0.5;
  const tol = 1e-12;
  for (let i = 0; i < pairs.length; i++) {
    cum += pairs[i][1];
    if (Math.abs(cum - half) <= tol && i + 1 < pairs.length) {
      return (pairs[i][0] + pairs[i + 1][0]) / 2;
    }
    if (cum > half) return pairs[i][0];
  }
  return pairs[pairs.length - 1][0];
}

function poolOnce(values, baseWeights, method) {
  const wSum = baseWeights.reduce((a, b) => a + b, 0);
  const w = wSum > 0 ? baseWeights.map((x) => x / wSum) : values.map(() => 1 / values.length);

  if (method === METHODS.MEDIAN) {
    return weightedMedian(values, w);
  }
  if (method === METHODS.MEAN) {
    let acc = 0;
    for (let i = 0; i < values.length; i++) acc += w[i] * values[i];
    return acc;
  }
  if (method === METHODS.LOG_ODDS) {
    let acc = 0;
    for (let i = 0; i < values.length; i++) acc += w[i] * clampedLogit(values[i]);
    return sigmoid(acc);
  }
  if (method === METHODS.OUTLIER_WEIGHTED) {
    // Adapted from aggreCAT OutWAgg (R/weight_outlier.R):
    //   r_i = 1 - (p_i - median)^2 / max_j (p_j - median)^2
    const sorted = [...values].sort((a, b) => a - b);
    const med = quantileSorted(sorted, 0.5);
    const sqDevs = values.map((v) => (v - med) * (v - med));
    const maxDev = Math.max(...sqDevs);
    if (maxDev === 0) return med;

    const combined = values.map((_, i) => {
      const factor = 1 - sqDevs[i] / maxDev;
      return factor <= 1e-12 ? 0 : w[i] * factor;
    });
    const cSum = combined.reduce((a, b) => a + b, 0);
    // Symmetric bimodal panels (e.g. [0.2, 0.2, 0.2, 0.8, 0.8, 0.8]) put every
    // point at maxDev (up to 1-ULP IEEE-754 float asymmetry between 0.2-0.5 and
    // 0.8-0.5), making cSum === 0 once snapped. Fall back to base weights rather
    // than magnifying float dust or dividing 0/0.
    if (cSum <= 1e-12) {
      let fallback = 0;
      for (let i = 0; i < values.length; i++) fallback += w[i] * values[i];
      return fallback;
    }
    let acc = 0;
    for (let i = 0; i < values.length; i++) acc += (combined[i] / cSum) * values[i];
    return acc;
  }
  throw new RangeError(`unknown aggregation method ${JSON.stringify(method)}`);
}

/**
 * Log-odds extremisation (Baron et al. 2014; Satopaa et al. 2014).
 *
 * Defaults to d = 1.0 (exact identity / off) because aggressive extremisation
 * on small correlated panels without out-of-sample calibration inflates Brier
 * loss when leanings fail to materialise.
 */
export function extremise(p, { d = 1.0 } = {}) {
  assertProbability(p, 'p');
  if (typeof d !== 'number' || !Number.isFinite(d) || d <= 0) {
    throw new RangeError(`extremise factor d must be a finite number > 0, got ${JSON.stringify(d)}`);
  }
  if (d === 1) return p;
  if (p === 0 || p === 1 || p === 0.5) return p;
  const z = d * (Math.log(p) - Math.log1p(-p));
  return sigmoid(z);
}

/**
 * Validate and deduplicate Round-1 / Round-2 estimates per Rule R6.
 *
 * Keeps each expert's latest round (up to MAX_ROUNDS = 2) and rejects
 * duplicate submissions by the same expert within the same round. Supports
 * card-scoped unlinkable `ballotToken` keys for ANONYMOUS submissions so
 * transport layers can deduplicate or update Round-2 anonymous ballots without
 * retaining `expertId`. Unrecognised anonymity levels fail closed to ANONYMOUS.
 */
export function deduplicateRounds(estimates, opts = {}) {
  if (!Array.isArray(estimates)) {
    throw new TypeError('estimates must be an array');
  }
  const requireBallotKey = Boolean(opts.requireBallotKey);
  const byKey = new Map();
  const unkeyed = [];
  let maxRound = 1;

  for (let i = 0; i < estimates.length; i++) {
    const raw = estimates[i];
    if (!raw || typeof raw !== 'object') {
      throw new TypeError(`estimates[${i}] must be an object with { p, ... }`);
    }
    assertProbability(raw.p, `estimates[${i}].p`);

    const round = raw.round === undefined ? 1 : raw.round;
    if (!Number.isInteger(round) || round < 1 || round > MAX_ROUNDS) {
      throw new RangeError(
        `estimates[${i}].round must be an integer between 1 and ${MAX_ROUNDS} (Rule R6), got ${JSON.stringify(round)}`
      );
    }
    if (round > maxRound) maxRound = round;

    let level = LEVELS.PSEUDONYMOUS;
    if (raw.level !== undefined) {
      const resolved = resolveLevel(raw.level);
      level = resolved.honoured ? resolved.level : LEVELS.ANONYMOUS;
    }

    const rawId = raw.expertId ?? raw.expert;
    const expertId = rawId !== undefined && rawId !== null && String(rawId).trim() !== ''
      ? String(rawId).trim()
      : null;

    const rawToken = raw.ballotToken;
    const ballotToken =
      rawToken !== undefined && rawToken !== null && String(rawToken).trim() !== ''
        ? String(rawToken).trim()
        : null;

    const dedupeKey =
      expertId !== null ? `id:${expertId}` : ballotToken !== null ? `ballot:${ballotToken}` : null;

    if (dedupeKey === null) {
      if (requireBallotKey) {
        throw new Error(
          `estimates[${i}] lacks both expertId and ballotToken (required when requireBallotKey=true)`
        );
      }
      if (round > 1) {
        throw new Error(`estimates[${i}] is round ${round} without an expertId or ballotToken to replace round 1`);
      }
      unkeyed.push({ expertId: null, p: raw.p, round, level });
      continue;
    }

    const entry = byKey.get(dedupeKey) || {};
    if (entry[round] !== undefined) {
      const label = expertId !== null ? `expert "${expertId}"` : `ballot "${ballotToken}"`;
      throw new Error(`duplicate estimate from ${label} in round ${round}`);
    }
    entry[round] = { expertId, p: raw.p, round, level };
    byKey.set(dedupeKey, entry);
  }

  const active = [];
  let revisedCount = 0;
  let round2Count = 0;
  for (const rounds of byKey.values()) {
    if (rounds[2] !== undefined) {
      round2Count++;
      if (rounds[1] !== undefined && rounds[2].p !== rounds[1].p) revisedCount++;
      active.push(rounds[2]);
    } else {
      active.push(rounds[1]);
    }
  }
  for (const item of unkeyed) active.push(item);

  return {
    active,
    roundsUsed: active.length ? maxRound : 0,
    round2Count,
    revisedCount,
  };
}

/**
 * Compute track-record weights from resolved binary seed items, gated at >= 10
 * shared resolved seeds (Eggstaff et al. 2014; Clemen 2008; design/04-adoption-review.md).
 *
 * Uses Murphy (1973) proper Brier skill over the uninformative p=0.5 benchmark
 * (Brier = 0.25) on the IDENTICAL shared seed items across all participating
 * experts. Unobservable outcomes (y = null) are excluded per Rule R4;
 * self-declared expertise is ignored per Rule R8.
 */
export function seedWeights(historyByExpert, expertIds = [], opts = {}) {
  if (!Array.isArray(expertIds) || expertIds.length === 0) {
    return { weights: {}, mode: 'equal', sharedSeeds: 0, minSeeds: MIN_SEEDS_FOR_WEIGHTING };
  }
  const minSeeds = opts.minSeeds === undefined ? MIN_SEEDS_FOR_WEIGHTING : opts.minSeeds;
  if (!Number.isInteger(minSeeds) || minSeeds < MIN_SEEDS_FOR_WEIGHTING) {
    throw new RangeError(
      `minSeeds must be an integer >= ${MIN_SEEDS_FOR_WEIGHTING}; performance weighting on fewer seeds overfits out of sample`
    );
  }
  const cutoffBrier = opts.cutoffBrier === undefined ? SKILL_CUTOFF_BRIER : opts.cutoffBrier;
  if (typeof cutoffBrier !== 'number' || !Number.isFinite(cutoffBrier) || cutoffBrier <= 0 || cutoffBrier > 1) {
    throw new RangeError(`cutoffBrier must be in (0, 1], got ${JSON.stringify(cutoffBrier)}`);
  }

  if (expertIds.some((id) => !id || String(id).trim() === '')) {
    return {
      weights: null,
      mode: 'equal_fallback',
      sharedSeeds: 0,
      minSeeds,
      reason: 'anonymous/unkeyed respondent has no linkable seed history; using equal weights',
    };
  }
  if (new Set(expertIds).size !== expertIds.length) {
    throw new Error('seedWeights() received duplicate expertIds — deduplicate rounds first');
  }

  const equal = Object.fromEntries(expertIds.map((id) => [id, 1 / expertIds.length]));
  if (!historyByExpert || typeof historyByExpert !== 'object') {
    return { weights: equal, mode: 'equal', sharedSeeds: 0, minSeeds };
  }

  const getHistory = (id) =>
    historyByExpert instanceof Map ? historyByExpert.get(id) : historyByExpert[id];

  // Validate and index observed seed items per expert, enforcing paired outcomes.
  const perExpert = new Map();
  const canonicalOutcome = new Map();

  for (const expertId of expertIds) {
    const rawItems = getHistory(expertId) || [];
    if (!Array.isArray(rawItems)) {
      throw new TypeError(`seedHistory for "${expertId}" must be an array`);
    }
    const obs = observed(rawItems);
    const byId = new Map();
    for (const item of obs) {
      if (item.id === undefined || item.id === null || String(item.id).trim() === '') {
        throw new Error(`seedWeights() requires an id on every seed item (expert "${expertId}")`);
      }
      assertProbability(item.p, `seedHistory[${expertId}][${item.id}].p`);
      const sid = String(item.id);
      if (byId.has(sid)) {
        throw new Error(`duplicate seed id "${sid}" for expert "${expertId}"`);
      }
      if (canonicalOutcome.has(sid) && canonicalOutcome.get(sid) !== item.y) {
        throw new Error(`seedWeights() matched seed "${sid}" across different outcomes`);
      }
      canonicalOutcome.set(sid, item.y);
      byId.set(sid, item);
    }
    perExpert.set(expertId, byId);
  }

  const firstMap = perExpert.get(expertIds[0]);
  const sharedIds = [...firstMap.keys()].filter((sid) =>
    expertIds.every((id) => perExpert.get(id).has(sid))
  );

  if (sharedIds.length < minSeeds) {
    return {
      weights: equal,
      mode: 'equal_fallback',
      sharedSeeds: sharedIds.length,
      minSeeds,
      reason: `shared resolved seeds (${sharedIds.length}) below threshold (${minSeeds}); using equal weights`,
    };
  }

  const rawSkills = expertIds.map((id) => {
    const m = perExpert.get(id);
    let errSum = 0;
    for (const sid of sharedIds) errSum += brierItem(m.get(sid));
    const meanBrier = errSum / sharedIds.length;
    return Math.max(0, cutoffBrier - meanBrier);
  });

  const skillSum = rawSkills.reduce((a, b) => a + b, 0);
  if (skillSum <= 0) {
    return {
      weights: equal,
      mode: 'equal_no_positive_skill',
      sharedSeeds: sharedIds.length,
      minSeeds,
      reason: `no expert beat the ${cutoffBrier} uninformative Brier cutoff on shared seeds; using equal weights`,
    };
  }

  const weights = {};
  for (let i = 0; i < expertIds.length; i++) {
    weights[expertIds[i]] = rawSkills[i] / skillSum;
  }
  return {
    weights,
    mode: 'brier_skill',
    sharedSeeds: sharedIds.length,
    minSeeds,
  };
}

/**
 * Map a probability in [0, 1] to ACAPS' published five-point probability band.
 */
export function probabilityBand(p) {
  assertProbability(p, 'p');
  for (const band of ACAPS_BANDS) {
    if (p <= band.max) {
      return { label: band.label, ordinal: band.ordinal, range: [band.min, band.max] };
    }
  }
  const last = ACAPS_BANDS[ACAPS_BANDS.length - 1];
  return { label: last.label, ordinal: last.ordinal, range: [last.min, last.max] };
}

function parseImpact(impact) {
  if (typeof impact === 'boolean' || impact === null || impact === undefined) {
    throw new RangeError(`impact must be an integer 1..5, got ${JSON.stringify(impact)}`);
  }
  if (typeof impact === 'string' && impact.trim() === '') {
    throw new RangeError('impact must be an integer 1..5, got empty string');
  }
  const n = typeof impact === 'number' ? impact : Number(String(impact).trim());
  if (!Number.isInteger(n) || n < 1 || n > 5) {
    throw new RangeError(`impact must be an integer 1..5, got ${JSON.stringify(impact)}`);
  }
  return n;
}

/**
 * Derive ACAPS Risk Level ('Low' | 'Medium' | 'High') from Probability x Impact
 * using ACAPS' published 5x5 matrix (organiser/acaps/risk-methodology.md).
 *
 * Accepts either a scalar probability p or an aggregate() result object. When
 * given an aggregate() object, propagates [lo, hi] through the matrix so
 * uncertainty is preserved into the categorical rating.
 */
export function acapsRiskLevel(probOrAggregate, impact) {
  const imp = parseImpact(impact);

  if (probOrAggregate && typeof probOrAggregate === 'object') {
    if (probOrAggregate.suppressed) {
      return {
        suppressed: true,
        riskLevel: null,
        loRiskLevel: null,
        hiRiskLevel: null,
        spansRiskLevels: null,
        probabilityBand: null,
        probabilityOrdinal: null,
        impact: imp,
      };
    }
    const est = probOrAggregate.estimate ?? probOrAggregate.p;
    assertProbability(est, 'aggregate.estimate');
    const band = probabilityBand(est);
    const riskLevel = ACAPS_MATRIX[band.ordinal][imp];

    let loRiskLevel = riskLevel;
    let hiRiskLevel = riskLevel;
    if (probOrAggregate.lo !== undefined && probOrAggregate.hi !== undefined) {
      assertProbability(probOrAggregate.lo, 'aggregate.lo');
      assertProbability(probOrAggregate.hi, 'aggregate.hi');
      loRiskLevel = ACAPS_MATRIX[probabilityBand(probOrAggregate.lo).ordinal][imp];
      hiRiskLevel = ACAPS_MATRIX[probabilityBand(probOrAggregate.hi).ordinal][imp];
    }

    return {
      suppressed: false,
      riskLevel,
      loRiskLevel,
      hiRiskLevel,
      spansRiskLevels: loRiskLevel !== hiRiskLevel,
      probabilityBand: band.label,
      probabilityOrdinal: band.ordinal,
      impact: imp,
    };
  }

  assertProbability(probOrAggregate, 'p');
  const band = probabilityBand(probOrAggregate);
  const riskLevel = ACAPS_MATRIX[band.ordinal][imp];
  return {
    suppressed: false,
    riskLevel,
    loRiskLevel: riskLevel,
    hiRiskLevel: riskLevel,
    spansRiskLevels: false,
    probabilityBand: band.label,
    probabilityOrdinal: band.ordinal,
    impact: imp,
  };
}

/**
 * Aggregate a panel's estimates on a single risk statement.
 *
 * Enforces:
 *   1. Round deduplication (Rule R6: max 2 rounds, latest wins per expert).
 *   2. Small-panel differencing guard (n >= 3 for 'panel', n >= 10 for 'public').
 *   3. Mandatory interval ([lo, hi] bootstrap CI + [q25, q75] empirical IQR).
 *   4. Zero internal expert IDs or names in the returned object.
 */
export function aggregate(estimates, opts = {}) {
  const method = opts.method === undefined ? DEFAULT_METHOD : opts.method;
  if (!Object.values(METHODS).includes(method)) {
    throw new RangeError(`unknown aggregation method ${JSON.stringify(method)}`);
  }

  const visibility = opts.visibility === undefined ? 'panel' : opts.visibility;
  if (visibility !== 'panel' && visibility !== 'public') {
    throw new RangeError(`visibility must be "panel" or "public", got ${JSON.stringify(visibility)}`);
  }

  const requestedMin = opts.minPanel === undefined ? MIN_PANEL_SIZE : opts.minPanel;
  if (!Number.isInteger(requestedMin) || requestedMin < 1) {
    throw new RangeError(`minPanel must be a positive integer, got ${JSON.stringify(requestedMin)}`);
  }
  const floor = visibility === 'public' ? PUBLIC.minCount : MIN_PANEL_SIZE;
  const effectiveMin = Math.max(floor, requestedMin);

  const extremiseD = opts.extremiseD === undefined ? 1.0 : opts.extremiseD;
  if (typeof extremiseD !== 'number' || !Number.isFinite(extremiseD) || extremiseD <= 0) {
    throw new RangeError(`extremiseD must be a finite number > 0, got ${JSON.stringify(extremiseD)}`);
  }
  const suppressExtremiseOnContested =
    opts.suppressExtremiseOnContested === undefined ? true : Boolean(opts.suppressExtremiseOnContested);

  const contestedIqr = opts.contestedIqr ?? DISPATCH_THRESHOLDS.contestedIqr;
  const outlierGap = opts.outlierGap ?? DISPATCH_THRESHOLDS.outlierGap;
  const reps = opts.reps ?? 2000;
  const seed = opts.seed ?? 42;
  const alpha = opts.alpha ?? 0.05;

  if (!Number.isInteger(reps) || reps < 100) {
    throw new RangeError(`reps must be an integer >= 100, got ${JSON.stringify(reps)}`);
  }
  if (typeof alpha !== 'number' || !Number.isFinite(alpha) || alpha <= 0 || alpha >= 1) {
    throw new RangeError(`alpha must be in (0, 1), got ${JSON.stringify(alpha)}`);
  }

  const parsedImpact = opts.impact === undefined ? null : parseImpact(opts.impact);
  const { active, roundsUsed, round2Count, revisedCount } = deduplicateRounds(estimates, {
    requireBallotKey: opts.requireBallotKey,
  });
  const n = active.length;

  // Fail closed when panel size is too small to hide individual positions.
  if (n < effectiveMin) {
    const suppressedResult = {
      suppressed: true,
      estimate: null,
      lo: null,
      hi: null,
      q25: null,
      q75: null,
      iqr: null,
      min: null,
      max: null,
      spread: null,
      n,
      needed: effectiveMin,
      visibility,
      method,
      weightsMode: null,
      sharedSeeds: 0,
      extremised: false,
      extremiseD: 1.0,
      roundsUsed: 0,
      round2Count: 0,
      revisedCount: 0,
      contested: null,
      outlierCount: null,
      acaps: null,
      reason: `panel size ${n} is below minimum ${effectiveMin} for ${visibility} visibility`,
    };
    if (parsedImpact !== null) {
      suppressedResult.acaps = acapsRiskLevel(suppressedResult, parsedImpact);
    }
    return suppressedResult;
  }

  // Resolve weights: equal unless seedHistory clears >= 10 shared resolved items.
  let weightsMode = 'equal';
  let sharedSeeds = 0;
  let baseWeights = active.map(() => 1 / n);

  if (opts.seedHistory !== undefined && opts.seedHistory !== null) {
    const ids = active.map((a) => a.expertId);
    const sw = seedWeights(opts.seedHistory, ids, {
      minSeeds: opts.minSeeds,
      cutoffBrier: opts.cutoffBrier,
    });
    weightsMode = sw.mode;
    sharedSeeds = sw.sharedSeeds;
    if (sw.mode === 'brier_skill') {
      baseWeights = active.map((a) => sw.weights[a.expertId]);
    }
  }

  const values = active.map((a) => a.p);
  const sorted = [...values].sort((a, b) => a - b);
  const min = sorted[0];
  const max = sorted[sorted.length - 1];
  const spread = max - min;
  const q25 = quantileSorted(sorted, 0.25);
  const q75 = quantileSorted(sorted, 0.75);
  const iqr = q75 - q25;
  const rawMedian = quantileSorted(sorted, 0.5);

  const contested = iqr >= contestedIqr;
  const outlierCount = values.filter((v) => Math.abs(v - rawMedian) >= outlierGap).length;

  const canExtremise = extremiseD !== 1 && !(contested && suppressExtremiseOnContested);
  const appliedD = canExtremise ? extremiseD : 1.0;

  const rawPooled = poolOnce(values, baseWeights, method);
  const estimate = appliedD === 1.0 ? rawPooled : extremise(rawPooled, { d: appliedD });

  // Deterministic variance-preserving smoothed bootstrap CI (Efron & Tibshirani
  // 1993, §16.5). Pure discrete resampling on small panels (n = 3..5) collapses
  // the 2.5% and 97.5% median quantiles onto exact participant submissions
  // [min, max] (U1); continuous Gaussian kernel smoothing with shrinkage
  // sqrt(1 - 1/n) and bandwidth sd/sqrt(n) preserves exact sample variance
  // while keeping [lo, hi] off individual panellists' raw inputs.
  const meanVal = values.reduce((a, b) => a + b, 0) / n;
  const sampleSd = Math.sqrt(values.reduce((a, v) => a + (v - meanVal) ** 2, 0) / n);
  let lo = estimate;
  let hi = estimate;

  if (sampleSd > 0) {
    const shrink = Math.sqrt(Math.max(0, 1 - 1 / n));
    const bandwidth = sampleSd / Math.sqrt(n);
    const rnd = mulberry32(seed);
    const boot = new Array(reps);
    const sampleVals = new Array(n);
    const sampleWeights = new Array(n);

    for (let r = 0; r < reps; r++) {
      for (let i = 0; i < n; i++) {
        const idx = (rnd() * n) | 0;
        const u1 = Math.max(1e-12, rnd());
        const u2 = rnd();
        const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
        const smoothed = meanVal + shrink * (values[idx] - meanVal) + bandwidth * z;
        sampleVals[i] = Math.min(1, Math.max(0, smoothed));
        sampleWeights[i] = baseWeights[idx];
      }
      const bRaw = poolOnce(sampleVals, sampleWeights, method);
      boot[r] = appliedD === 1.0 ? bRaw : extremise(bRaw, { d: appliedD });
    }
    boot.sort((a, b) => a - b);
    lo = Math.min(estimate, quantileSorted(boot, alpha / 2));
    hi = Math.max(estimate, quantileSorted(boot, 1 - alpha / 2));
  }

  const out = {
    suppressed: false,
    estimate,
    lo,
    hi,
    q25,
    q75,
    iqr,
    min,
    max,
    spread,
    n,
    needed: effectiveMin,
    visibility,
    method,
    weightsMode,
    sharedSeeds,
    extremised: canExtremise,
    extremiseD: appliedD,
    extremiseSuppressedReason:
      extremiseD !== 1 && !canExtremise ? 'contested_panel' : null,
    roundsUsed,
    round2Count,
    revisedCount,
    contested,
    outlierCount,
    acaps: null,
  };

  if (parsedImpact !== null) {
    out.acaps = acapsRiskLevel(out, parsedImpact);
  }
  return out;
}

/**
 * Privacy-enforcing release gate around `aggregate()` for all panellist,
 * analyst, and public views (closes U1 and U4):
 *
 *   1. Raises the release floor to `MIN_RELEASE_PANEL_SIZE = 5` on panel views
 *      (matching `anonymity.js` `leaksBy`'s `< 5` threshold) and `PUBLIC.minCount = 10`
 *      on public views so colluding or `IDENTIFIED` peers cannot isolate an
 *      `ANONYMOUS` peer on a 3- or 4-person panel.
 *   2. Suppresses auxiliary order statistics (`q25`, `q75`, `iqr`, `min`, `max`,
 *      `spread`) whenever `n < PUBLIC.minCount` (`10`) in BOTH `on_close` and
 *      `batch` modes, eliminating order-statistic linear-system solvers
 *      (`2*q25 - median`, `2*q75 - median`). Only `{ estimate, lo, hi }` (with
 *      variance-preserving smoothed bootstrap `[lo, hi]`) is emitted below 10.
 *   3. Prevents sequential temporal differencing (`U4`): `on_close` (default)
 *      withholds all interim statistics until `closed: true`; `batch` pins
 *      `previousSnapshot` until `>= MIN_COHORT_STEP` (`3`) new respondents arrive
 *      and masks `min`/`max`/`spread` while open.
 */
export function releaseAggregate(estimates, opts = {}) {
  const policy = opts.policy === undefined ? RELEASE_POLICIES.ON_CLOSE : opts.policy;
  if (!Object.values(RELEASE_POLICIES).includes(policy)) {
    throw new RangeError(`unknown release policy ${JSON.stringify(policy)}`);
  }

  const closed = Boolean(opts.closed);
  const requestedStep = opts.minStep === undefined ? MIN_COHORT_STEP : opts.minStep;
  if (!Number.isInteger(requestedStep) || requestedStep < 1) {
    throw new RangeError(`minStep must be a positive integer, got ${JSON.stringify(requestedStep)}`);
  }
  const minStep = Math.max(MIN_COHORT_STEP, requestedStep);
  const prev = opts.previousSnapshot && !opts.previousSnapshot.suppressed ? opts.previousSnapshot : null;

  const requestedMin = opts.minPanel === undefined ? MIN_RELEASE_PANEL_SIZE : opts.minPanel;
  if (!Number.isInteger(requestedMin) || requestedMin < 1) {
    throw new RangeError(`minPanel must be a positive integer, got ${JSON.stringify(requestedMin)}`);
  }
  const releaseFloor = opts.visibility === 'public' ? PUBLIC.minCount : MIN_RELEASE_PANEL_SIZE;
  const effectiveReleaseMin = Math.max(releaseFloor, requestedMin);

  const base = aggregate(estimates, { ...opts, minPanel: effectiveReleaseMin });
  if (base.suppressed) {
    return {
      ...base,
      policy,
      closed,
      releaseHeld: true,
      stale: false,
      heldBackCount: 0,
      neededForNextBatch: Math.max(0, base.needed - base.n),
    };
  }

  if (prev !== null && typeof prev.n === 'number') {
    if (base.n < prev.n) {
      throw new RangeError(
        `panel size ${base.n} regressed below previousSnapshot.n (${prev.n})`
      );
    }
    const delta = base.n - prev.n;
    if (delta < minStep) {
      return {
        ...prev,
        policy,
        closed,
        releaseHeld: delta > 0,
        stale: delta > 0,
        heldBackCount: delta,
        neededForNextBatch: delta === 0 ? minStep : minStep - delta,
        reason:
          delta > 0
            ? `holding ${delta} new response(s) until cohort step ${minStep} is reached to prevent sequential differencing`
            : null,
      };
    }
  }

  if (policy === RELEASE_POLICIES.ON_CLOSE && !closed) {
    const withheld = {
      suppressed: true,
      estimate: null,
      lo: null,
      hi: null,
      q25: null,
      q75: null,
      iqr: null,
      min: null,
      max: null,
      spread: null,
      n: base.n,
      needed: base.needed,
      visibility: base.visibility,
      method: base.method,
      weightsMode: null,
      sharedSeeds: 0,
      extremised: false,
      extremiseD: 1.0,
      roundsUsed: 0,
      round2Count: 0,
      revisedCount: 0,
      contested: null,
      outlierCount: null,
      acaps: base.acaps !== null ? acapsRiskLevel({ suppressed: true }, base.acaps.impact) : null,
      policy,
      closed: false,
      releaseHeld: true,
      stale: false,
      heldBackCount: base.n,
      neededForNextBatch: 0,
      reason:
        'round is still open; policy "on_close" withholds interim panel statistics to prevent sequential differencing',
    };
    return withheld;
  }

  // Below PUBLIC.minCount (10), suppress quartiles and extremes in ALL modes so
  // { estimate, q25, q75 } or { min, max } can never invert individual answers
  // (U1). Above 10 in live BATCH mode, keep sample extremes masked as well.
  const maskQuartiles = base.n < PUBLIC.minCount;
  const maskExtremes = maskQuartiles || (policy === RELEASE_POLICIES.BATCH && !closed);
  return {
    ...base,
    q25: maskQuartiles ? null : base.q25,
    q75: maskQuartiles ? null : base.q75,
    iqr: maskQuartiles ? null : base.iqr,
    min: maskExtremes ? null : base.min,
    max: maskExtremes ? null : base.max,
    spread: maskExtremes ? null : base.spread,
    policy,
    closed,
    releaseHeld: false,
    stale: false,
    heldBackCount: 0,
    neededForNextBatch: minStep,
  };
}

/**
 * Internal pre-attribution helper producing candidate notifications for
 * packages/core/src/dispatch.js (`TYPES.outlier` and `TYPES.contested`).
 *
 * Kept separate from `aggregate()` so `aggregate()` never emits an `expertId`
 * in any summary or feed payload. Suppresses all signals if the panel itself
 * is below the privacy floor, or if an expert chose ANONYMOUS (who opted out
 * of follow-up per LEVEL_COPY[LEVELS.ANONYMOUS].warn).
 */
export function dispatchSignals(estimates, opts = {}) {
  const agg = aggregate(estimates, opts);
  if (agg.suppressed) return [];

  const { active } = deduplicateRounds(estimates);
  const sorted = active.map((a) => a.p).sort((a, b) => a - b);
  const med = quantileSorted(sorted, 0.5);
  const outlierGap = opts.outlierGap ?? DISPATCH_THRESHOLDS.outlierGap;
  const card = opts.card ?? null;

  const candidates = [];
  const outlierExperts = new Set();

  for (const item of active) {
    // LEVEL_COPY[ANONYMOUS].warn: "You cannot be contacted to clarify or to credit.
    // Some follow-ups will not reach you." Honour that promise here.
    if (!item.expertId || item.level === LEVELS.ANONYMOUS) continue;

    const dev = Math.abs(item.p - med);
    if (dev >= outlierGap) {
      outlierExperts.add(item.expertId);
      candidates.push({
        type: TYPES.outlier,
        expert: item.expertId,
        card,
        severity: dev,
      });
    }
  }

  if (agg.contested) {
    for (const item of active) {
      if (!item.expertId || item.level === LEVELS.ANONYMOUS) continue;
      if (outlierExperts.has(item.expertId)) continue;
      if (item.round >= MAX_ROUNDS) continue;
      candidates.push({
        type: TYPES.contested,
        expert: item.expertId,
        card,
        severity: agg.iqr,
      });
    }
  }

  return candidates;
}
