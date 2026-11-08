/**
 * Sensitivity sweeps S1–S12 (power-spec Analysis 4). Each sweep changes one judgement call (see assumptions.json) and
 * reports, per setting: the true gain, the cards needed for an 80% chance (N80), the power at a reference N, and the
 * Monte Carlo error. Every row is a simulation under stated assumptions (label.js BANNER).
 *
 * Excluded options (never offered): bandRateUncertainty = true (model.js throws), and poolMethod outlier_weighted
 * (population.js throws; it is also too slow for a sweep of this size on the fast path).
 *
 * Not swept here: herding (the spec puts it in Analysis 5, the second look, not in S1–S12) and log-odds pooling (listed
 * as an option in J21 but not in S1–S12; each card goes through aggregate()'s bootstrap, about 8× the median's cost at
 * N = 104, so a sweep would not fit the budget next to the others).
 *
 * Runtime: the run is planned with budget.js (planReps, quickReps) and guarded by makeGuard. Settings that the guard
 * stops before are reported, not silently dropped.
 */
import { estimatePower, n80 } from './power.js';
import { resolveParams } from './params.js';
import { couplingToParams } from './triggers.js';
import { planReps, quickReps, makeGuard } from './budget.js';
import { BANNER, simCardId } from './label.js';
import { makeRng, hashSeed } from './rng.js';
import { MIN_PANEL_SIZE } from '@benchmark/core/aggregate';
import { makeRiskCards, makeRoster, drawPanel } from './model.js';
import { scoredRecords } from './endpoint.js';
import { bandOffsets } from './data.js';

export const REF_N = 104;
export const SWEEP_NS = Object.freeze([28, 50, 104, 200, 300, 500]);
export const DEFAULT_R = 1000;
export const DEFAULT_SEED = 20261107;
export const BUDGET_SEC = 540;
/** Replicates per setting for the timing probe (a full run; --quick uses PROBE_R_QUICK, the probes are most of its time). */
const PROBE_R = 10;
const PROBE_R_QUICK = 2;
/**
 * Margin on the probe cost. Measured with a fixed seed under load: a 10-replicate probe read up to about 30% low for the
 * trigger settings (S5, S12) and high for the fast ones, so 1.5 covers the slow ones. The run also re-plans after every
 * setting from the measured cost, so a misreading costs R, not a skipped setting.
 */
export const SAFETY_FACTOR = 1.5;
/** Fewest replicates a setting may get when the budget is tight. Below this the power error bar is too wide to use. */
export const MIN_R = 50;

/**
 * @typedef {object} Setting
 * @property {string} sweep  e.g. 'S1'
 * @property {string} label  plain words
 * @property {unknown} value
 * @property {Record<string, unknown>} overrides parameter overrides (resolveParams keys)
 * @property {object} run    estimatePower spec pieces: k, endpoint, tier, cards, benchmark, constant
 * @property {number} [riskBase] S5 only: the risk base rate to set (see riskBaseParams)
 */

/** @returns {Setting[]} every setting of S1–S12 (fixed-skill view: σ left at sigmaRef / sigmaRefTrigger) */
export function settingsOf() {
  /** @type {Setting[]} */
  const out = [];
  const risk = { endpoint: 'vs_acaps', tier: 'fast', cards: 'risk' };
  const fixedK8 = { ...risk, k: 8 };
  const dropout = { ...risk, k: null };
  const trig = { endpoint: 'absolute', tier: 'cluster', cards: 'trigger', benchmark: 'in_sample_base_rate', k: 8 };
  const add = (sweep, label, value, overrides, run) => out.push({ sweep, label, value, overrides, run });

  for (const k of [3, 5, 8, 15]) add('S1', `${k} answers per card`, k, {}, { ...risk, k });
  for (const icc of [0, 0.2, 0.4, 0.6]) add('S2', `shared expert error ${icc}`, icc, { icc }, fixedK8);
  for (const skillSpread of [0, 0.25, 0.5]) add('S3', `skill spread ${skillSpread}`, skillSpread, { skillSpread }, fixedK8);
  // S3b: at 40% the panel can read worse than ACAPS. The spec's prototype reported −0.008 from ONE roster drawn for the
  // whole population; the roster alone moves the gain by about 0.018 (sd over rosters), so that single draw is noise.
  // This engine draws a new roster per replicate, and the mean over R replicates is the answer (see the S3b test).
  for (const fracUninformed of [0, 0.2, 0.4]) add('S3b', `${Math.round(fracUninformed * 100)}% uninformed experts`, fracUninformed, { fracUninformed }, fixedK8);
  for (const omega of [0.5, 0.75, 1, 1.5, 2]) add('S4', `confidence x${omega}`, omega, { omega }, fixedK8);
  for (const panelBias of [-0.5, 0, 0.5]) add('S4b', `panel lean ${panelBias}`, panelBias, { panelBias }, fixedK8);
  // S5: the risk base rate (experts know it: their latent mean moves with it; ACAPS's midpoints do not). 0.59 is the
  // measured base rate of the 104 resolved risks (61 / 104 = 0.587); the model's own rated-risk rate at the default is
  // 0.606 (60 / 99), so the 0.59 row is solved to 0.59 exactly, not left at the default.
  for (const base of [0.3, 0.45, 0.59, 0.7]) {
    out.push({ sweep: 'S5', label: `risk base rate ${Math.round(base * 100)}% (ACAPS midpoints fixed)`, value: base, overrides: {}, run: fixedK8, riskBase: base });
  }
  for (const tau of [0.75, 1, 1.25, 1.5]) add('S6', `latent spread tau ${tau}`, tau, { tau }, fixedK8);
  for (const d of [0.3, 0.51, 0.7, 0.83]) add('S7', `${Math.round((1 - d) * 100)}% response (dropout ${d})`, d, { dropout: d }, dropout);
  for (const poolMethod of ['median', 'mean']) add('S8', `pool by ${poolMethod}`, poolMethod, { poolMethod }, fixedK8);
  // S9 ACAPS calibration: 'measured' is the default; the perfect and uninformative readings need a per-card comparator
  // (see acapsComparator). The Beta-uncertain reading needs bandRateUncertainty = true, which is never offered.
  add('S9', 'ACAPS reading as measured', 'measured', {}, fixedK8);
  add('S9', 'ACAPS reading perfectly calibrated', 'perfect', {}, { ...fixedK8, acaps: 'perfect' });
  add('S9', 'ACAPS reading uninformative (constant at the base rate)', 'uninformative', {}, {
    endpoint: 'absolute', tier: 'fast', cards: 'risk', benchmark: 'in_sample_base_rate', k: 8,
  });
  for (const comparator of ['midpoint', 'ordinal']) add('S10', `ACAPS reading as ${comparator}`, comparator, { comparator }, fixedK8);
  for (const floor of [3, 5]) add('S11', `minimum ${floor} answers`, floor, { floor }, dropout);
  for (const c of [0.3, 0.7]) add('S12', `trigger alikeness dial ${c}`, c, couplingToParams(c), trig);
  return out;
}

/**
 * Build a settings' resolved parameters on top of the base overrides.
 * @param {Setting} s @param {Record<string, unknown>} base
 */
export function paramsFor(s, base = {}) {
  const p = resolveParams({ ...base, ...s.overrides });
  return s.riskBase === undefined ? p : riskBaseParams(p, s.riskBase);
}

/** Band offsets by (rates, τ): every S5 setting shares the measured rates, so the solve is done once. */
const offsetsByRates = new Map();

/** E[σ(o + τZ)] for Z ~ N(0,1), by a trapezoid rule on [−8, 8] (the integrand is smooth and Gaussian-weighted). */
function expectedRate(o, tau) {
  const h = 0.02;
  let sum = 0;
  for (let z = -8; z <= 8 + 1e-9; z += h) {
    sum += Math.exp(-0.5 * z * z) * (1 / (1 + Math.exp(-(o + tau * z))));
  }
  return (sum * h) / Math.sqrt(2 * Math.PI);
}

/**
 * The parameters with the risk base rate set to `target` (S5). Every band's latent offset moves by one shift s, chosen
 * so the band-weighted mean hit rate (the model's own weights) equals target. ACAPS's midpoints do not move.
 *
 * Why bandHits: the band offsets are solved from the measured hit rates (bandModel reads bandHits and bandCounts as
 * numbers), and resolveParams locks bandHits to its measured value. So the rescaled rates are passed on a plain copy of
 * the resolved object: each band's new rate is E[σ(o_b + s + τZ)], and bandOffsets recovers o_b + s exactly.
 * Requires shrinkM = 0 (the measured rates); the default. A test checks that a target equal to the default base rate
 * leaves bandHits unchanged, so the default run is not affected.
 * @param {import('./types.js').Params} params
 * @param {number} target strictly inside (0, 1)
 */
export function riskBaseParams(params, target) {
  if (!(target > 0 && target < 1)) throw new RangeError(`risk base rate must be strictly inside (0, 1), got ${target}`);
  if (params.shrinkM !== 0) throw new RangeError('riskBaseParams needs shrinkM = 0 (the measured band rates)');
  const counts = /** @type {number[]} */ (params.bandCounts);
  const hits = /** @type {number[]} */ (params.bandHits);
  const tau = /** @type {number} */ (params.tau);
  const weightSource = params.bandMix === 'active' ? /** @type {number[]} */ (params.activeMix) : counts;
  const weightTotal = weightSource.reduce((s, x) => s + x, 0);
  const w = weightSource.map((x) => x / weightTotal);
  const rates = counts.map((c, b) => hits[b] / c);
  const key = JSON.stringify([rates, tau]);
  let offsets = offsetsByRates.get(key);
  if (!offsets) {
    offsets = bandOffsets(rates, tau);
    offsetsByRates.set(key, offsets);
  }
  const marginal = (/** @type {number} */ s) => offsets.reduce((t, o, b) => t + w[b] * expectedRate(o + s, tau), 0);
  let lo = -12;
  let hi = 12;
  for (let it = 0; it < 80; it++) {
    const mid = (lo + hi) / 2;
    if (marginal(mid) < target) lo = mid;
    else hi = mid;
  }
  const s = (lo + hi) / 2;
  const bandHits = counts.map((c, b) => c * expectedRate(offsets[b] + s, tau));
  return { ...params, bandHits };
}

/**
 * A risk-card stream as power.js's default, with one change for S9: `acaps: 'perfect'` replaces each card's ACAPS
 * comparator with its true probability π. Draw order matches defaultMakeStream (roster, card fork, panel, yield), so
 * with no change the stream is the engine's own (a test checks this).
 * @param {import('./types.js').Params} params
 * @param {{ k?: number|null, acaps?: 'measured'|'perfect' }} [opts]
 */
export function makeRiskStream(params, opts = {}) {
  const kFixed = opts.k ?? params.kFixed ?? undefined;
  const floor = kFixed !== undefined ? MIN_PANEL_SIZE : /** @type {number} */ (params.floor);
  const perfect = opts.acaps === 'perfect';
  return (/** @type {import('./types.js').Rng} */ rng, /** @type {string} */ tier) => {
    const roster = makeRoster(params, rng);
    const poolOpts = {
      floor,
      method: /** @type {string} */ (params.poolMethod),
      extremiseD: /** @type {number} */ (params.extremiseD),
      comparator: /** @type {string} */ (params.comparator),
      viaAggregate: tier === 'real',
    };
    /** @type {import('./endpoint.js').Scored[]} */
    const queue = [];
    let cardNo = 0;
    const refill = () => {
      cardNo += 1;
      const [base] = makeRiskCards(params, rng.fork(`card:${cardNo}`), 1);
      const card = { ...base, id: simCardId(cardNo, 'risk'), risk: cardNo };
      const panel = drawPanel(card, roster, params, rng, { kFixed });
      const observed = rng.bernoulli(/** @type {number} */ (params.yieldRisk)) === 1;
      if (!observed || panel === null) return;
      for (const rec of scoredRecords([panel], poolOpts)) queue.push(rec);
    };
    return {
      next() {
        while (queue.length === 0) refill();
        const rec = /** @type {import('./endpoint.js').Scored} */ (queue.shift());
        if (perfect) rec.a = /** @type {number} */ (rec.panel?.card.pi);
        return rec;
      },
    };
  };
}

/**
 * Runs one setting's power curve.
 * @param {Setting} s @param {Record<string, unknown>} base @param {{ R: number, seed: number }} o
 */
function runSetting(s, base, o) {
  const params = paramsFor(s, base);
  const Ns = o.Ns ?? SWEEP_NS;
  const { acaps, ...run } = /** @type {any} */ (s.run);
  const makeStream = acaps === 'perfect' ? makeRiskStream(params, { k: run.k, acaps }) : undefined;
  return estimatePower(
    { params, N: Ns, scenario: `${s.sweep}:${String(s.value)}`, ...run },
    { R: o.R, seed: o.seed, makeStream },
  );
}

/**
 * Response profile of the dropout model (S7, S11): the share of cards whose panel reaches the floor, before yield, and
 * the mean number of answers among those. Draws only panels, so it is cheap; the same seed gives the same profile.
 * @param {import('./types.js').Params} params @param {number} seed @param {string} tag
 * @returns {{ analysableShare: number, meanAnswers: number }}
 */
export function dropoutProfile(params, seed, tag, n = 2000) {
  const rng = makeRng(hashSeed(seed, 'profile', tag));
  const roster = makeRoster(params, rng.fork('roster'));
  let reached = 0;
  let answers = 0;
  for (let i = 1; i <= n; i++) {
    const [card] = makeRiskCards(params, rng.fork(`card:${i}`), 1);
    const panel = drawPanel(card, roster, params, rng, { kFixed: null });
    if (panel !== null) {
      reached += 1;
      answers += panel.ps.length;
    }
  }
  return { analysableShare: reached / n, meanAnswers: reached === 0 ? null : answers / reached };
}

/**
 * Turns one setting's power curve into a row.
 * @param {Setting} s @param {ReturnType<typeof estimatePower>} out @param {number} R
 */
function rowOf(s, out, R, profile = null) {
  const ref = out.find((r) => r.N === REF_N) ?? out[0];
  const curve = out.map((r) => ({ N: r.N, power: r.power, lo: r.lo, hi: r.hi }));
  const cross = n80(curve);
  let cardsNeeded80 = cross.n80 === null ? null : Math.ceil(cross.n80);
  let reason = null;
  if (cards80Undefined(out)) reason = `already at 0.8 at the smallest N (${out[0].N})`;
  else if (ref.meanGain !== null && ref.meanGain <= 0) reason = 'true gain is not above zero; 0.8 is never reached';
  else if (cross.n80 === null) reason = `not reached by N = ${out[out.length - 1].N} analysable cards; not extrapolated`;
  if (reason !== null) cardsNeeded80 = null;
  return {
    sweep: s.sweep,
    settingLabel: s.label,
    value: s.value,
    gain: ref.meanGain,
    cardsNeeded80,
    cardsNeeded80Reason: reason,
    n80Lo: cross.lo === null ? null : Math.ceil(cross.lo),
    n80Hi: cross.hi === null ? null : Math.ceil(cross.hi),
    refN: ref.N,
    power: ref.power,
    powerLo: ref.lo,
    powerHi: ref.hi,
    mcError: ref.halfWidth,
    rhoD: ref.rhoD,
    analysableShare: profile ? profile.analysableShare : null,
    meanAnswers: profile ? profile.meanAnswers : null,
    R,
    label: BANNER,
    synthetic: true,
  };
}

/** The power curve is already at 0.8 at its smallest N: the N80 is at or below the grid. */
function cards80Undefined(out) {
  return out.length > 0 && out[0].power >= 0.8;
}

/**
 * Timing probe: ms per replicate for one setting, from a short run.
 * @param {Setting} s @param {Record<string, unknown>} base @param {number} seed @param {number} R
 */
function probeCost(s, base, seed, R) {
  const t0 = performance.now();
  runSetting(s, base, { R, seed });
  return (performance.now() - t0) / R;
}

/**
 * The replicate plan for a list of settings: every setting gets the same R, the largest that fits `budgetSec` once each
 * measured cost is multiplied by `safety`, never above `R0`, and never below min(minR, R0) (planReps's floor: a request
 * already under minR, such as a quick run, is not reduced further). `correction` (at least 1) scales all costs, for a
 * re-plan after the machine has been slower than its probe said.
 * @param {string[]} ids setting ids, one per cost
 * @param {number[]} costsMsPerRep measured ms per replicate
 * @param {{ R0: number, budgetSec: number, safety?: number, minR?: number, correction?: number }} o
 * @returns {{ R: Record<string, number>, scale: number, projectedSec: number, fits: boolean }}
 */
export function planSweep(ids, costsMsPerRep, o) {
  if (ids.length === 0) return { R: {}, scale: 1, projectedSec: 0, fits: true };
  const safety = o.safety ?? SAFETY_FACTOR;
  const correction = o.correction ?? 1;
  const plan = planReps(
    ids.map((id, i) => ({ id, costMsPerRep: costsMsPerRep[i] * safety * correction, R: o.R0 })),
    o.budgetSec,
    o.minR ?? MIN_R,
  );
  return { R: plan.R, scale: plan.scale, projectedSec: plan.projectedSec, fits: plan.fits };
}

/**
 * Runs S1–S12 under the budget guard.
 *
 * Planning: every setting is probed for ms per replicate (PROBE_R reps). planSweep gives every setting the same R, the
 * largest that fits the budget left after the probes when each probe is multiplied by SAFETY_FACTOR, never below MIN_R.
 * After each setting the plan is redone from the measured cost (the ratio of measured to predicted time so far, never
 * below 1), so a machine that slows down lowers R for the settings still to run, uniformly. R is never raised after the
 * first plan. The rows carry the R they were run at, and plan.changes lists each reduction. A setting is skipped only if
 * the budget is gone even at MIN_R.
 *
 * @param {{ baseOverrides?: Record<string, unknown>, sweeps?: string[] }} [spec]
 * @param {{ R?: number, seed?: number, quick?: boolean, budgetSec?: number, clock?: () => number, cost?: (s: Setting) => number, sweeps?: string[], Ns?: number[], minR?: number }} [opts]  Ns and minR override the N grid and the floor (tests only; a full run uses SWEEP_NS and MIN_R)
 */
export function runSensitivity(spec = {}, opts = {}) {
  const base = spec.baseOverrides ?? {};
  const seed = opts.seed ?? DEFAULT_SEED;
  const budgetSec = opts.budgetSec ?? BUDGET_SEC;
  const requestedR = opts.R ?? DEFAULT_R;
  const R0 = opts.quick ? quickReps(requestedR) : requestedR;
  const wanted = opts.sweeps ?? spec.sweeps ?? null;
  const settings = settingsOf().filter((s) => wanted === null || wanted.includes(s.sweep));
  const ids = settings.map((s) => `${s.sweep}:${String(s.value)}`);
  // The guard starts before the probes, so the probes count against the budget.
  const guard = makeGuard({ budgetSec, clock: opts.clock });
  const probeR = opts.quick ? PROBE_R_QUICK : PROBE_R;
  const costs = settings.map((s) => Math.max(1e-6, opts.cost ? opts.cost(s) : probeCost(s, base, seed, probeR)));

  const minR = opts.minR ?? MIN_R;
  const first = planSweep(ids, costs, { R0, budgetSec: Math.max(guard.remainingSec(), 1e-6), minR });
  /** @type {Record<string, number>} */
  const R = { ...first.R };
  /** @type {Array<{ before: string, from: number, to: number }>} */
  const changes = [];
  /** @type {number} */
  let correction;
  let predictedMs = 0;
  let actualMs = 0;
  /** @type {object[]} */
  const rows = [];
  /** @type {string[]} */
  const skipped = [];
  for (const [i, s] of settings.entries()) {
    const id = ids[i];
    if (guard.shouldStop(id)) {
      skipped.push(id);
      continue;
    }
    const before = guard.elapsedSec();
    const out = runSetting(s, base, { R: R[id], seed, Ns: opts.Ns });
    const profile = s.run.k === null ? dropoutProfile(paramsFor(s, base), seed, id) : null;
    rows.push(rowOf(s, out, R[id], profile));
    actualMs += (guard.elapsedSec() - before) * 1000;
    predictedMs += costs[i] * R[id];
    correction = Math.max(1, actualMs / predictedMs);
    if (i + 1 < settings.length) {
      const rest = planSweep(ids.slice(i + 1), costs.slice(i + 1), {
        R0,
        budgetSec: Math.max(guard.remainingSec(), 1e-6),
        minR,
        correction,
      });
      // Only ever lower R: a run that finishes early leaves budget over, and raising R would make the rows unequal.
      for (const [oid, planned] of Object.entries(rest.R)) {
        const to = Math.min(planned, R[oid]);
        if (to !== R[oid]) {
          changes.push({ before: oid, from: R[oid], to });
          R[oid] = to;
        }
      }
    }
  }
  return {
    rows,
    plan: {
      scale: first.scale,
      projectedSec: first.projectedSec,
      fits: first.fits,
      R,
      requestedR: R0,
      safety: SAFETY_FACTOR,
      minR,
      probeR,
      changes,
    },
    guard: guard.report(),
    skipped,
    label: BANNER,
  };
}
