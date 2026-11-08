// Slow Monte Carlo cases moved out of the fast test folder so `npm test` stays quick. Run them with `npm run test:slow`. Assertions are unchanged.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveParams } from '../../src/params.js';
import { makeRng, expit } from '../../src/rng.js';
import { loadHistorical, bandOffsets, muForBase } from '../../src/data.js';
import { makeRiskCards } from '../../src/model.js';
import { populationGain, solveSigma } from '../../src/population.js';
import { paired } from '@benchmark/core/scoring';

/** Settings outside the registered ranges (sigma 0, k 1, the oracle expert) are built on a plain copy. */
const withOverrides = (over) => ({ ...resolveParams(), ...over });

/** Standard-normal expectation of f(z) by a fine trapezoid on [-10, 10]: an independent check on the model. */
function gaussianExpect(f) {
  const h = 0.002;
  let s = 0;
  for (let z = -10; z <= 10; z += h) s += h * Math.exp(-z * z / 2) / Math.sqrt(2 * Math.PI) * f(z);
  return s;
}

/** E[pi (1 - pi)] over the risk latent, with bands from the data and offsets from the data loader (not the model). */
function riskPerfectBrier(P) {
  const h = loadHistorical();
  const offsets = bandOffsets(h.bandRates, P.tau);
  let total = 0;
  for (let b = 0; b < 5; b++) {
    const w = h.bandCounts[b] / h.rated;
    total += w * gaussianExpect((z) => {
      const q = expit(offsets[b] + P.tau * z);
      return q * (1 - q);
    });
  }
  return total;
}

test('oracle expert: a single report with sigma 0 and omega 1 is the latent, so the panel Brier equals E[pi(1 - pi)]', () => {
  const P = withOverrides({ sigma: 0, omega: 1, icc: 0, panelBias: 0, sigmaBias: 0, fracUninformed: 0 });
  const r = populationGain(P, { benchmark: 'base_rate', k: 1 });
  // Independent quadrature of the perfect Brier (the mean over sampled cards has its own small error).
  assert.ok(Math.abs(r.perfectBrier - riskPerfectBrier(P)) < 0.002,
    `perfect ${r.perfectBrier} vs quadrature ${riskPerfectBrier(P)}`);
  assert.ok(Math.abs(r.panelBrier - r.perfectBrier) < 3 * r.se,
    `panel Brier ${r.panelBrier} vs perfect ${r.perfectBrier}, SE ${r.se}`);
});

test('the sample comparator is the mean-outcome Brier: the base-rate comparator on risk cards is about 0.2388 (the 99 rated risks)', () => {
  const P = resolveParams();
  const r = populationGain(P, { benchmark: 'base_rate', M: 20000, k: 8 });
  // E[y] = sum_b w_b h_b = 60/99 on the rated risks, so the Brier of the constant base rate is p(1 - p) = 0.2388.
  const base = 60 / 99;
  assert.ok(Math.abs(r.comparatorBrier - base * (1 - base)) < 0.004, `comparator ${r.comparatorBrier}`);
});

test('ACAPS-clone arithmetic: a panel that reports exactly the comparator scores a paired difference of exactly 0', () => {
  // Arithmetic check of the comparison machinery, not of the simulator: a clone of the comparator has zero difference.
  const P = resolveParams();
  const cards = makeRiskCards(P, makeRng(501).fork('cards'), 10000);
  const acaps = cards.map((c) => ({ id: c.id, p: c.a, y: c.y }));
  const clone = cards.map((c) => ({ id: c.id, p: c.a, y: c.y }));
  const res = paired(clone, acaps, { reps: 2000, seed: 7 });
  assert.equal(res.diff, 0);
  assert.equal(res.lo, 0);
  assert.equal(res.hi, 0);
});

test('seeded: populationGain repeats exactly with the same seed, and changes with another seed', () => {
  const P = resolveParams();
  const a = populationGain(P, { benchmark: 'acaps', M: 5000, k: 8 });
  assert.deepEqual(populationGain(P, { benchmark: 'acaps', M: 5000, k: 8 }), a);
  const b = populationGain(P, { benchmark: 'acaps', M: 5000, k: 8, seed: 99 });
  assert.notEqual(b.gain, a.gain);
});

test('risk cards report no ICC; trigger cards report rhoD and deff, and the ceiling gain over the base rate is 0.0676 within 0.004', () => {
  const P = resolveParams();
  const risk = populationGain(P, { benchmark: 'acaps', M: 3000, k: 8 });
  assert.equal(risk.rhoD, undefined);
  const trig = populationGain(P, { benchmark: 'base_rate', M: 60000, k: 8, cards: 'trigger' });
  assert.ok(typeof trig.rhoD === 'number' && typeof trig.deff === 'number');
  // Ceiling: base Brier minus the perfect Brier, for the trigger model (b = 0.4, spread 1.47).
  const mu = muForBase(P.triggerBase, P.triggerSpread);
  const perfect = gaussianExpect((z) => {
    const q = expit(mu + P.triggerSpread * z);
    return q * (1 - q);
  });
  assert.ok(Math.abs(trig.perfectBrier - perfect) < 0.002, `perfect ${trig.perfectBrier} vs ${perfect}`);
  const ceiling = trig.comparatorBrier - trig.perfectBrier;
  assert.ok(Math.abs(ceiling - 0.0676) < 0.004, `ceiling ${ceiling}`);
});

test('solveSigma: the solved panel gives the target gain over ACAPS within 3 SE (target 0.03, k 8)', () => {
  const P = resolveParams();
  const s = solveSigma(0.03, P, { benchmark: 'acaps', M: 10000, k: 8 });
  assert.equal(s.attainable, true);
  assert.ok(Math.abs(s.achieved - 0.03) < 3 * s.se, `achieved ${s.achieved} (SE ${s.se})`);
  assert.ok(s.sigma > 1 && s.sigma < 2.5, `sigma ${s.sigma} (the spec's fixed-skill anchor is 1.53)`);
});

test('delta-free: solving for zero gain over ACAPS gives a panel whose Brier difference is 0 within 3 SE', () => {
  const P = resolveParams();
  const s = solveSigma(0, P, { benchmark: 'acaps', M: 10000, k: 8 });
  assert.equal(s.attainable, true);
  assert.ok(Math.abs(s.achieved) < 3 * s.se, `achieved ${s.achieved} (SE ${s.se})`);
});

test('solveSigma: a target above the ceiling is unattainable, and the gain never rises with sigma', () => {
  const P = resolveParams();
  const none = solveSigma(0.2, P, { benchmark: 'acaps', M: 10000, k: 8 });
  assert.equal(none.attainable, false);
  assert.equal(none.sigma, null);

  const gains = [0.5, 1, 1.5, 2, 2.5, 3].map(
    (sigma) => populationGain({ ...P, sigma }, { benchmark: 'acaps', M: 10000, k: 8 }).gain
  );
  for (let i = 1; i < gains.length; i++) {
    assert.ok(gains[i] <= gains[i - 1] + 1e-9, `gain rose from ${gains[i - 1]} to ${gains[i]} at sigma step ${i}`);
  }
});

