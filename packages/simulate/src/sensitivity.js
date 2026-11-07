/**
 * Sensitivity sweeps S1–S12 (power-spec Analysis 4). Each sweep changes one judgement call (see assumptions.json) and
 * reports, per setting: the true gain, the cards needed for an 80% chance (N80), the power at a reference N, and the
 * Monte Carlo error. Every row is a simulation under stated assumptions (label.js BANNER).
 *
 * Excluded options (never offered): bandRateUncertainty = true (model.js throws), and poolMethod outlier_weighted
 * (population.js throws; it is also too slow for a sweep of this size on the fast path).
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

export const REF_N = 104;
export const SWEEP_NS = Object.freeze([28, 50, 104, 200, 300, 500]);
export const DEFAULT_R = 1000;
export const DEFAULT_SEED = 20261107;
export const BUDGET_SEC = 540;
const PROBE_R = 10;

/**
 * @typedef {object} Setting
 * @property {string} sweep  e.g. 'S1'
 * @property {string} label  plain words
 * @property {unknown} value
 * @property {Record<string, unknown>} overrides parameter overrides (resolveParams keys)
 * @property {object} run    estimatePower spec pieces: k, endpoint, tier, cards, benchmark, constant
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
  for (const fracUninformed of [0, 0.2, 0.4]) add('S3b', `${Math.round(fracUninformed * 100)}% uninformed experts`, fracUninformed, { fracUninformed }, fixedK8);
  for (const omega of [0.5, 0.75, 1, 1.5, 2]) add('S4', `confidence x${omega}`, omega, { omega }, fixedK8);
  for (const panelBias of [-0.5, 0, 0.5]) add('S4b', `panel lean ${panelBias}`, panelBias, { panelBias }, fixedK8);
  for (const base of [0.3, 0.45, 0.59, 0.7]) add('S5', `trigger base rate ${base}`, base, { triggerBase: base }, trig);
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
  return resolveParams({ ...base, ...s.overrides });
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
 * @param {Setting} s @param {Record<string, unknown>} base @param {number} seed
 */
function probeCost(s, base, seed) {
  const t0 = performance.now();
  runSetting(s, base, { R: PROBE_R, seed });
  return (performance.now() - t0) / PROBE_R;
}

/**
 * Runs S1–S12 under the budget guard.
 * @param {{ baseOverrides?: Record<string, unknown>, sweeps?: string[] }} [spec]
 * @param {{ R?: number, seed?: number, quick?: boolean, budgetSec?: number, clock?: () => number, cost?: (s: Setting) => number, sweeps?: string[], Ns?: number[] }} [opts]  Ns overrides the N grid (tests only; a full run uses SWEEP_NS)
 */
export function runSensitivity(spec = {}, opts = {}) {
  const base = spec.baseOverrides ?? {};
  const seed = opts.seed ?? DEFAULT_SEED;
  const budgetSec = opts.budgetSec ?? BUDGET_SEC;
  const requestedR = opts.R ?? DEFAULT_R;
  const R0 = opts.quick ? quickReps(requestedR) : requestedR;
  const wanted = opts.sweeps ?? spec.sweeps ?? null;
  const settings = settingsOf().filter((s) => wanted === null || wanted.includes(s.sweep));
  const sections = settings.map((s) => ({
    id: `${s.sweep}:${String(s.value)}`,
    costMsPerRep: opts.cost ? opts.cost(s) : probeCost(s, base, seed),
    R: R0,
  }));
  const plan = planReps(sections, budgetSec);
  const guard = makeGuard({ budgetSec, clock: opts.clock });
  /** @type {object[]} */
  const rows = [];
  /** @type {string[]} */
  const skipped = [];
  for (const [i, s] of settings.entries()) {
    const id = sections[i].id;
    if (guard.shouldStop(id)) {
      skipped.push(id);
      continue;
    }
    const R = plan.R[id];
    const out = runSetting(s, base, { R, seed, Ns: opts.Ns });
    const profile = s.run.k === null ? dropoutProfile(paramsFor(s, base), seed, id) : null;
    rows.push(rowOf(s, out, R, profile));
  }
  return {
    rows,
    plan: { scale: plan.scale, projectedSec: plan.projectedSec, fits: plan.fits, R: plan.R, requestedR: R0 },
    guard: guard.report(),
    skipped,
    label: BANNER,
  };
}
