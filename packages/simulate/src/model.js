/**
 * Risk-card generative model and the expert panel (power-spec §A.2–A.4). Logit scale throughout.
 *
 * Stream discipline: every function consumes a FIXED number of draws whatever the parameter values (two normals per
 * report, one per shared error, one per invitee). Callers give each card or component its own fork. So changing σ or
 * the dropout outcome never shifts another card's draws, which is what makes common random numbers valid for solveSigma.
 *
 * Every default comes from params (assumptions.json). Nothing here is a literal parameter value.
 */
import { BAND_MIDPOINT, ACAPS_BANDS, clampForecast } from '@benchmark/core/aggregate';
import { expit } from './rng.js';
import { bandOffsets, latentMoments, muForBase } from './data.js';
import { simCardId, markSynthetic } from './label.js';

/** @typedef {import('./types.js').Card} Card */
/** @typedef {import('./types.js').Expert} Expert */
/** @typedef {import('./types.js').Panel} Panel */

/** Band-model cache. Keyed by the parameters that shape it, so a sweep of σ does not re-solve the offsets. */
const bandCache = new Map();
const triggerCache = new Map();
/** Per-parameter-object caches: a resolved params object (or a σ copy of one) is read through a Proxy, so read it once. */
const bandByParams = new WeakMap();
const viewByParams = new WeakMap();

/**
 * Risk latent: band weights, band hit rates, offsets and the latent moments. Shared by the card draws and the moments.
 * @param {import('./types.js').Params} params
 */
function bandModel(params) {
  const seen = bandByParams.get(params);
  if (seen) return seen;
  if (params.bandRateUncertainty) {
    throw new RangeError('bandRateUncertainty = true is not implemented (power-spec J20 option 3); use false');
  }
  const counts = /** @type {number[]} */ (params.bandCounts);
  const hits = /** @type {number[]} */ (params.bandHits);
  const active = /** @type {number[]} */ (params.activeMix);
  const shrinkM = /** @type {number} */ (params.shrinkM);
  const tau = /** @type {number} */ (params.tau);
  const mix = /** @type {string} */ (params.bandMix);
  const key = JSON.stringify([counts, hits, active, shrinkM, tau, mix]);
  const cached = bandCache.get(key);
  if (cached) return cached;

  const weightSource = mix === 'active' ? active : counts;
  const weightTotal = weightSource.reduce((s, x) => s + x, 0);
  const w = weightSource.map((x) => x / weightTotal);

  // J20: shrinkM blends each band's measured hit rate toward the overall rated rate; 0 uses the measured rates.
  const overall = hits.reduce((s, x) => s + x, 0) / counts.reduce((s, x) => s + x, 0);
  const rates = counts.map((c, b) => (hits[b] + shrinkM * overall) / (c + shrinkM));
  const offsets = bandOffsets(rates, tau);
  const moments = latentMoments(w, offsets, tau);
  const model = { w, rates, offsets, ...moments, tau };
  bandCache.set(key, model);
  bandByParams.set(params, model);
  return model;
}

/**
 * Trigger-scale latent moments: L_gj has mean μ_t and standard deviation s_t marginally (§A.6).
 * @param {import('./types.js').Params} params
 * @returns {{ mean:number, variance:number }}
 */
function triggerMoments(params) {
  const base = /** @type {number} */ (params.triggerBase);
  const spread = /** @type {number} */ (params.triggerSpread);
  const key = `${base}|${spread}`;
  let m = triggerCache.get(key);
  if (!m) {
    m = { mean: muForBase(base, spread), variance: spread * spread };
    triggerCache.set(key, m);
  }
  return m;
}

/**
 * Latent mean and variance m̄, V of the risk latent L (§A.3), for the band mix and offsets in params.
 * @param {import('./types.js').Params} params
 * @returns {{ offsets:number[], mean:number, variance:number }}
 */
export function modelConstants(params) {
  const { offsets, mean, variance } = bandModel(params);
  return { offsets, mean, variance };
}

/**
 * The parameters the expert model reads, as plain numbers, for one params object. Built once per object.
 * A null sigma (solved, §B.3) falls back to the fixed-skill reference for the card kind.
 * @param {import('./types.js').Params} params
 */
function viewOf(params) {
  const seen = viewByParams.get(params);
  if (seen) return seen;
  const view = {
    icc: /** @type {number} */ (params.icc),
    omega: /** @type {number} */ (params.omega),
    panelBias: /** @type {number} */ (params.panelBias),
    uninformedSd: /** @type {number} */ (params.uninformedSd),
    skillSpread: /** @type {number} */ (params.skillSpread),
    sigmaRisk: /** @type {number} */ (params.sigma ?? params.sigmaRef),
    sigmaTrigger: /** @type {number} */ (params.sigma ?? params.sigmaRefTrigger),
    sharedErrRisk: /** @type {number} */ (params.sharedErrRisk),
    risk: bandModel(params),
    trigger: triggerMoments(params),
  };
  viewByParams.set(params, view);
  return view;
}

/** σ for a card kind. @param {ReturnType<typeof viewOf>} view @param {'risk'|'trigger'} kind */
const sigmaOf = (view, kind) => (kind === 'trigger' ? view.sigmaTrigger : view.sigmaRisk);

/** m̄ and V of the latent the experts estimate: the risk latent for risk cards, the trigger latent for triggers. */
function momentsFor(card, view) {
  return card.kind === 'trigger' ? view.trigger : view.risk;
}

/**
 * Turns a logit into a reported forecast: whole percents, then the protocol clamp (R9).
 * @param {number} ell
 * @returns {number}
 */
function reportFromLogit(ell) {
  return clampForecast(Math.round(100 * expit(ell)) / 100);
}

/** Shared error draw with a given σ. Always consumes one normal. */
function sharedDraw(sigma, view, rng, riskShared) {
  const z = rng.normal();
  const rho = view.icc;
  if (riskShared === undefined) return sigma * Math.sqrt(rho) * z;
  const phi = view.sharedErrRisk;
  return sigma * Math.sqrt(rho) * (Math.sqrt(phi) * riskShared + Math.sqrt(1 - phi) * z);
}

/**
 * Per-card shared panel error u_c (§A.3): u ~ N(0, σ²ρ_e) for a risk card. A trigger card passes its risk's shared
 * standard normal, and then u = σ√ρ_e(√φ_u·u_g + √(1−φ_u)·u′) (§A.6), so the triggers of one risk share part of it.
 * @param {import('./types.js').Params} params
 * @param {import('./rng.js').Rng} rng
 * @param {number} [riskShared] standard normal shared by the triggers of one risk
 * @returns {number}
 */
export function cardSharedError(params, rng, riskShared) {
  const view = viewOf(params);
  return sharedDraw(view.sigmaRisk, view, rng, riskShared);
}

/**
 * Reported probability of one responder on one card (§A.3 and §A.4). Always consumes exactly two normals.
 * @param {Expert} expert
 * @param {Card} card
 * @param {number} sharedU the card's shared error (from cardSharedError)
 * @param {import('./types.js').Params} params
 * @param {import('./rng.js').Rng} rng
 * @returns {number} a whole percent in [0.01, 0.99]
 */
export function expertReport(expert, card, sharedU, params, rng) {
  const view = viewOf(params);
  const { mean, variance } = momentsFor(card, view);
  const skillNoise = rng.normal();
  const uninformedNoise = rng.normal();

  if (expert.uninformed) {
    const ell = mean + expert.bias + view.uninformedSd * uninformedNoise + view.panelBias;
    return reportFromLogit(ell);
  }
  const sigmaI = sigmaOf(view, card.kind) * Math.exp(view.skillSpread * expert.skill);
  const shared = card.L + sharedU + sigmaI * Math.sqrt(1 - view.icc) * skillNoise;
  const beta = (view.omega * variance) / (variance + sigmaI * sigmaI);
  return reportFromLogit(mean + beta * (shared - mean) + expert.bias + view.panelBias);
}

/**
 * Risk cards (§A.2): band from the measured mix, latent L = o_b + τz, outcome Bernoulli(σ(L)). `a` is the band midpoint.
 * @param {import('./types.js').Params} params
 * @param {import('./rng.js').Rng} rng
 * @param {number} n
 * @returns {Card[]}
 */
export function makeRiskCards(params, rng, n) {
  const { w, offsets, tau } = bandModel(params);
  const cum = [];
  let acc = 0;
  for (const x of w) {
    acc += x;
    cum.push(acc);
  }
  const out = [];
  for (let i = 1; i <= n; i++) {
    const z = rng.normal();
    const u = rng.next();
    let band = cum.findIndex((c) => u < c);
    if (band < 0) band = cum.length - 1;
    const L = offsets[band] + tau * z;
    const pi = expit(L);
    const y = rng.bernoulli(pi);
    out.push(
      markSynthetic({
        id: simCardId(i, 'risk'),
        risk: i,
        band: /** @type {0|1|2|3|4} */ (band),
        a: BAND_MIDPOINT[ACAPS_BANDS[band].label],
        L,
        pi,
        y: /** @type {0|1} */ (y),
        kind: /** @type {'risk'} */ ('risk'),
      })
    );
  }
  return out;
}

/**
 * The roster of E experts (§A.3 and §A.5). `skill` is the standard-normal skill draw g; the expert's noise is
 * σ·exp(η·skill). `herd` is the Round-2 herding draw, clamped to [0, 1].
 * @param {import('./types.js').Params} params
 * @param {import('./rng.js').Rng} rng
 * @returns {Expert[]}
 */
export function makeRoster(params, rng) {
  const size = /** @type {number} */ (params.rosterSize);
  const sigmaBias = /** @type {number} */ (params.sigmaBias);
  const fracUninformed = /** @type {number} */ (params.fracUninformed);
  const herd = /** @type {number} */ (params.herd);
  const herdSd = /** @type {number} */ (params.herdSd);
  const out = [];
  for (let i = 1; i <= size; i++) {
    const bias = sigmaBias * rng.normal();
    const skill = rng.normal();
    const uninformed = rng.next() < fracUninformed;
    const h = Math.min(1, Math.max(0, herd + herdSd * rng.normal()));
    out.push(markSynthetic({ id: i, bias, skill, uninformed, herd: h }));
  }
  return out;
}

/**
 * Partial Fisher–Yates: k distinct indices from 0..n-1, in draw order. Consumes exactly k integers.
 * @param {number} n @param {number} k @param {import('./rng.js').Rng} rng
 * @returns {number[]}
 */
function sampleWithoutReplacement(n, k, rng) {
  const idx = Array.from({ length: n }, (_, i) => i);
  for (let i = 0; i < k; i++) {
    const j = i + rng.int(n - i);
    const t = idx[i];
    idx[i] = idx[j];
    idx[j] = t;
  }
  return idx.slice(0, k);
}

/**
 * One card's panel (§A.4). Without kFixed: K invited, a response share r ~ Beta(1−d, κ) (concentration κ), each invitee
 * answers with probability r, and a card with fewer than `floor` answers returns null. With kFixed (an argument or
 * params.kFixed) exactly that many answer; dropout and the floor are bypassed.
 * @param {Card} card
 * @param {Expert[]} roster
 * @param {import('./types.js').Params} params
 * @param {import('./rng.js').Rng} rng
 * @param {{ kFixed?: number }} [opts]
 * @returns {Panel | null}
 */
export function drawPanel(card, roster, params, rng, opts = {}) {
  const kFixed = opts.kFixed ?? params.kFixed;
  /** @type {number[]} */
  let picks;
  if (kFixed !== null && kFixed !== undefined) {
    if (kFixed > roster.length) throw new RangeError(`kFixed ${kFixed} exceeds the roster of ${roster.length}`);
    picks = sampleWithoutReplacement(roster.length, kFixed, rng);
  } else {
    const K = /** @type {number} */ (params.K);
    if (K > roster.length) throw new RangeError(`K ${K} exceeds the roster of ${roster.length}`);
    const invited = sampleWithoutReplacement(roster.length, K, rng);
    const m = 1 - /** @type {number} */ (params.dropout);
    const kappa = /** @type {number} */ (params.dropoutKappa);
    const r = rng.beta(m * kappa, (1 - m) * kappa);
    picks = invited.filter(() => rng.next() < r);
    if (picks.length < /** @type {number} */ (params.floor)) return null;
  }
  const view = viewOf(params);
  const sharedU = sharedDraw(sigmaOf(view, card.kind), view, rng, /** @type {any} */ (card).riskShared);
  const ps = picks.map((i) => expertReport(roster[i], card, sharedU, params, rng));
  return markSynthetic({ card, ps, experts: picks.map((i) => roster[i].id) });
}
