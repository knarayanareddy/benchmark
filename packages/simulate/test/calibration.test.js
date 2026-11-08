import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeRng } from '../src/rng.js';
import { aggregate } from '@benchmark/core/aggregate';
import { calibrationCore, calibrationPrecision, crossingN, median, reliabilityBins, withOverrides } from '../src/calibration.js';
import { resolveParams } from '../src/params.js';
import { simCardId } from '../src/label.js';

test('reliability bins withhold any bin below the 5-card floor and show nothing for it', () => {
  // Bin 0 (0-0.2): 4 cards, withheld. Bin 4 (0.8-1): 5 cards, shown.
  const p = [0.1, 0.1, 0.15, 0.05, 0.1, 0.9, 0.85, 0.95, 0.99, 0.8];
  const y = [0, 1, 0, 0, 1, 1, 1, 0, 1, 1];
  const { bins } = reliabilityBins(p, y);
  assert.equal(bins[0].n, 5);
  assert.equal(bins[0].withheld, false);
  const sparse = reliabilityBins([0.1, 0.1, 0.1, 0.1, 0.9, 0.9, 0.9, 0.9, 0.9], [0, 1, 0, 1, 1, 1, 1, 0, 1]);
  assert.equal(sparse.bins[0].n, 4);
  assert.equal(sparse.bins[0].withheld, true);
  assert.equal(sparse.bins[0].observed, null, 'a withheld bin must not show its observed rate');
  assert.equal(sparse.bins[0].meanP, null);
  assert.equal(sparse.bins[0].halfWidth, null);
  assert.equal(sparse.bins[4].withheld, false);
  assert.ok(Math.abs(sparse.bins[4].observed - 4 / 5) < 1e-12);
});

test('reliability bins: the counts add up to N and every shown bin has a Wilson half-width', () => {
  const rng = makeRng(41);
  const p = [];
  const y = [];
  for (let i = 0; i < 300; i++) {
    const pi = rng.next();
    p.push(pi);
    y.push(rng.next() < pi ? 1 : 0);
  }
  const out = reliabilityBins(p, y);
  assert.equal(out.bins.reduce((s, b) => s + b.n, 0), 300);
  for (const b of out.bins) {
    if (b.withheld) continue;
    assert.ok(b.halfWidth > 0 && b.halfWidth < 0.5, `half-width ${b.halfWidth}`);
  }
});

test('the 5-bin resolution is zero when every bin has the base rate, and positive when outcomes track forecasts', () => {
  const p = [0.1, 0.1, 0.1, 0.1, 0.1, 0.9, 0.9, 0.9, 0.9, 0.9];
  // Both bins observe 2 of 5 (0.4): the base rate is 0.4 everywhere, so no resolution.
  const flat = reliabilityBins(p, [1, 1, 0, 0, 0, 1, 1, 0, 0, 0]);
  assert.ok(Math.abs(flat.resolution) < 1e-12);
  const sharp = reliabilityBins(p, [0, 0, 0, 0, 0, 1, 1, 1, 1, 1]);
  assert.ok(Math.abs(sharp.resolution - 0.25) < 1e-12, `got ${sharp.resolution}`);
});

test('reliability bins reject outcomes that are not 0 or 1 and forecasts outside [0, 1]', () => {
  assert.throws(() => reliabilityBins([0.5], [0.5]), RangeError);
  assert.throws(() => reliabilityBins([1.5], [1]), RangeError);
});

test('crossingN interpolates in log N and reports censoring at either end', () => {
  const curve = [
    { N: 100, power: 0.5 },
    { N: 400, power: 0.9 },
  ];
  const { n80, censored } = crossingN(curve, 0.7);
  assert.equal(censored, null);
  // Linear in log N between (100, 0.5) and (400, 0.9): fraction 0.5 gives sqrt(100 * 400) = 200.
  assert.ok(Math.abs(n80 - 200) < 1e-9, `got ${n80}`);
  assert.deepEqual(crossingN(curve, 0.95), { n80: null, censored: 'above' });
  assert.deepEqual(crossingN(curve, 0.4), { n80: null, censored: 'below' });
});

test('median equals aggregate()\'s median (equal weights) on 200 random panels of 3 to 15 answers', () => {
  const rng = makeRng(51);
  for (let d = 0; d < 200; d++) {
    const k = 3 + rng.int(13);
    const answers = [];
    for (let i = 0; i < k; i++) answers.push(Math.round(rng.uniform(0.01, 0.99) * 100) / 100);
    const real = aggregate(answers.map((p, i) => ({ p, expertId: i + 1 })), { reps: 100 }).estimate;
    assert.ok(Math.abs(median(answers) - real) < 1e-12, `panel ${d}: ${median(answers)} vs aggregate ${real}`);
  }
});

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

test('calibrationCore refuses unresolved cards and bad sizes', () => {
  const gen = fixtureGen(1);
  const unresolved = { ...gen, makeRiskCards: (p, r, n) => gen.makeRiskCards(p, r, n).map((c) => ({ ...c, y: null })) };
  assert.throws(() => calibrationCore(unresolved, { params: {}, N: 10, k: 5 }, { R: 1, seed: 1 }), RangeError);
  assert.throws(() => calibrationCore(gen, { params: {}, N: 2, k: 5 }, { R: 1, seed: 1 }), RangeError);
  assert.throws(() => calibrationCore(gen, { params: {}, N: 10, k: 0 }, { R: 1, seed: 1 }), RangeError);
});

test('coupling 0 and 0.9 map rhoLatent to 0 and 0.81, both inside the registered range of 0 to 0.9, so both run', () => {
  const over = withOverrides(resolveParams(), { sigma: 1.5, icc: 0.3, omega: 1.6 });
  for (const coupling of [0, 0.9]) {
    assert.doesNotThrow(() => calibrationPrecision({ params: over, N: 20, k: 5, cards: 'trigger', coupling }, { R: 1, seed: 1 }));
  }
});

