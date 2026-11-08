// Slow Monte Carlo cases moved out of the fast test folder so `npm test` stays quick. Run them with `npm run test:slow`. Assertions are unchanged.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calibrationCore, calibrationPrecision, withOverrides } from '../../src/calibration.js';
import { resolveParams } from '../../src/params.js';
import { simCardId } from '../../src/label.js';

/**
 * Hand-built generators: the truth is y ~ Bernoulli(expit(L)); every expert answers expit(omega · L), so the pooled
 * forecast has logit omega · L and the calibration slope should be 1 / omega (1.6 gives 0.625).
 */
function fixtureGen(omega) {
  const cardsFrom = (rng, n, kind) => {
    const out = [];
    for (let i = 0; i < n; i++) {
      const L = 1.5 * rng.normal();
      const pi = 1 / (1 + Math.exp(-L));
      out.push({ id: simCardId(i + 1, kind), risk: i + 1, band: 2, a: 0.5, L, pi, y: rng.next() < pi ? 1 : 0, kind });
    }
    return out;
  };
  return {
    makeRoster: () => [],
    makeRiskCards: (_params, rng, n) => cardsFrom(rng, n, 'risk'),
    makeTriggerCards: (_params, rng, n) => cardsFrom(rng, n, 'trigger'),
    drawPanel: (card, _roster, _params, _rng, { kFixed }) => ({
      card,
      ps: new Array(kFixed).fill(1 / (1 + Math.exp(-omega * card.L))),
      experts: [],
    }),
  };
}

test('calibrationCore recovers a planted overconfidence slope of 1/1.6 = 0.625 and detects it', () => {
  const out = calibrationCore(fixtureGen(1.6), { params: {}, N: 3000, k: 5 }, { R: 20, seed: 61 });
  assert.ok(Math.abs(out.slopeMean - 0.625) < 0.05, `slope ${out.slopeMean}`);
  assert.ok(Math.abs(out.interceptMean) < 0.1, `intercept ${out.interceptMean}`);
  assert.ok(out.slopePower >= 0.9, `power to see slope 0.625 against 1 is ${out.slopePower}`);
  assert.equal(out.slopeConvergedShare, 1);
});

test('calibrationCore on a calibrated pooled forecast: slope near 1 and few false alarms', () => {
  const out = calibrationCore(fixtureGen(1), { params: {}, N: 3000, k: 5 }, { R: 20, seed: 62 });
  assert.ok(Math.abs(out.slopeMean - 1) < 0.05, `slope ${out.slopeMean}`);
  assert.ok(out.slopePower <= 0.2, `false-alarm share ${out.slopePower}`);
});

test('the 5-bin resolution is biased upward by about (B-1) * base * (1 - base) / N when outcomes are unrelated', () => {
  const N = 3000;
  const out = calibrationCore(fixtureGen(1), { params: {}, N, k: 5 }, { R: 40, seed: 63 });
  const expected = (4 * 0.5 * 0.5) / N;
  assert.ok(out.resolutionNullBias > expected / 1.5 && out.resolutionNullBias < expected * 1.5,
    `null bias ${out.resolutionNullBias} vs ${expected}`);
  assert.ok(out.resolutionEstimate > 0);
});

test('end to end with the real model: overconfident experts show a calibration slope below 1, and the dial reaches the trigger path', () => {
  const base = resolveParams();
  const over = withOverrides(base, { sigma: 1.5, icc: 0.3, omega: 1.6 });
  const risk = calibrationPrecision({ params: over, N: 300, k: 8 }, { R: 40, seed: 71 });
  assert.ok(risk.slopeMean > 0.6 && risk.slopeMean < 0.9, `slope ${risk.slopeMean}`);
  assert.equal(risk.cards, 'risk');
  const nested = calibrationPrecision({ params: over, N: 120, k: 5, cards: 'trigger', coupling: 0.5 }, { R: 10, seed: 72 });
  assert.equal(nested.cards, 'trigger');
  assert.ok(Number.isFinite(nested.slopeMean) && nested.resolutionEstimate >= 0);
});

