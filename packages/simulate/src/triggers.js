/**
 * Trigger cards nested in risks (power-spec §A.6). Each trigger's latent is tied to its risk's latent through ρ_lat;
 * its outcome is copied from the risk's trigger-scale draw with probability θ (copyShare), otherwise drawn on its own;
 * its panel error shares a risk-level component through φ_u (sharedErrRisk).
 *
 * The nesting knobs are read from params as stored (rhoLatent, copyShare, sharedErrRisk). couplingToParams gives the
 * §A.6 mapping of a single dial c; the stored defaults do not follow that mapping (see the J13 conflict).
 */
import { expit } from './rng.js';
import { loadHistorical, muForBase } from './data.js';
import { simCardId, markSynthetic } from './label.js';
import { makeRiskCards, modelConstants } from './model.js';

/** @typedef {import('./types.js').Card} Card */
/**
 * A trigger card. `riskShared` is the standard normal shared by the triggers of one risk (§A.6 u_g); `a` is NaN because
 * triggers have no ACAPS reading; `band` is the parent risk's band.
 * @typedef {Card & { riskShared: number }} TriggerCard
 */

/**
 * The §A.6 mapping of one coupling dial c ∈ [0, 1]: ρ_lat = 0.9c, θ = c, φ_u = max(0.3, c).
 * Note: the registered defaults (J13, J23) do not follow this mapping. The caller decides which to use.
 * @param {number} c
 * @returns {{ rhoLatent:number, copyShare:number, sharedErrRisk:number }}
 */
export function couplingToParams(c) {
  if (!(c >= 0 && c <= 1)) throw new RangeError(`coupling must be in [0, 1], got ${c}`);
  return { rhoLatent: 0.9 * c, copyShare: c, sharedErrRisk: Math.max(0.3, c) };
}

/**
 * Triggers per risk, drawn from the measured Active list (4, 4, 4, 3×16, 2×7, 1×2; 76 in all).
 * @returns {number[]}
 */
const activeTriggerCounts = (() => {
  /** @type {number[] | null} */
  let counts = null;
  return () => (counts ??= loadHistorical().active.triggersPerRisk);
})();

/**
 * Risks with their trigger cards (for the second stage). Risk g's draws come from rng.fork('risk:g') and
 * rng.fork('triggers:g'), so no risk's draws depend on another's.
 * @param {import('./types.js').Params} params
 * @param {import('./rng.js').Rng} rng
 * @param {number} nRisks
 * @returns {Array<{ risk: Card, triggers: TriggerCard[] }>}
 */
export function riskOfTriggers(params, rng, nRisks) {
  const { mean, variance } = modelConstants(params);
  const sd = Math.sqrt(variance);
  const mu = muForBase(/** @type {number} */ (params.triggerBase), /** @type {number} */ (params.triggerSpread));
  const s = /** @type {number} */ (params.triggerSpread);
  const rho = /** @type {number} */ (params.rhoLatent);
  const theta = /** @type {number} */ (params.copyShare);
  const counts = activeTriggerCounts();
  const out = [];
  let triggerIndex = 0;

  for (let g = 1; g <= nRisks; g++) {
    const base = makeRiskCards(params, rng.fork(`risk:${g}`), 1)[0];
    const risk = markSynthetic({ ...base, id: simCardId(g, 'risk'), risk: g });
    const tr = rng.fork(`triggers:${g}`);
    const zg = (risk.L - mean) / sd;
    // The risk's trigger-scale draw: the outcome that copied triggers take (§A.6).
    const copied = tr.bernoulli(expit(mu + s * zg));
    const riskShared = tr.normal();
    const count = counts[tr.int(counts.length)];
    /** @type {TriggerCard[]} */
    const triggers = [];
    for (let j = 0; j < count; j++) {
      triggerIndex += 1;
      const eps = tr.normal();
      const L = mu + s * (Math.sqrt(rho) * zg + Math.sqrt(1 - rho) * eps);
      const pi = expit(L);
      // Both draws are always consumed, so copyShare changes outcomes but never the latents or later draws.
      const copy = tr.next() < theta;
      const own = tr.bernoulli(pi);
      triggers.push(
        markSynthetic({
          id: simCardId(triggerIndex, 'trigger'),
          risk: g,
          band: risk.band,
          a: NaN,
          L,
          pi,
          y: /** @type {0|1} */ (copy ? copied : own),
          kind: /** @type {'trigger'} */ ('trigger'),
          riskShared,
        })
      );
    }
    out.push({ risk, triggers });
  }
  return out;
}

/**
 * Trigger cards only, flat, with the parent risk id in `risk`.
 * @param {import('./types.js').Params} params
 * @param {import('./rng.js').Rng} rng
 * @param {number} nRisks
 * @returns {TriggerCard[]}
 */
export function makeTriggerCards(params, rng, nRisks) {
  return riskOfTriggers(params, rng, nRisks).flatMap((r) => r.triggers);
}
