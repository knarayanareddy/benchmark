// Slow Monte Carlo cases moved out of the fast test folder so `npm test` stays quick. Run them with `npm run test:slow`. Assertions are unchanged.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveParams } from '../../src/params.js';
import { makeRng } from '../../src/rng.js';
import { simulateRound2, armContrastCI, powerRound2 } from '../../src/round2.js';
import { makeRoster, makeRiskCards, drawPanel } from '../../src/model.js';

/** Share of replicates whose interval excludes zero in either direction, for one bootstrap method, with no arm effect. */
function nullRejectionRate(method, R, N, k, seed) {
  const params = { ...resolveParams(), lambdaAcaps: 0 };
  const root = makeRng(seed);
  let rejected = 0;
  for (let r = 0; r < R; r++) {
    const rr = root.fork(`rep:${r}`);
    const roster = makeRoster(params, rr.fork('roster'));
    const cards = makeRiskCards(params, rr.fork('cards'), N);
    const panels = [];
    cards.forEach((card, i) => {
      const panel = drawPanel(card, roster, params, rr.fork(`panel:${i}`), { kFixed: k });
      if (panel) panels.push(panel);
    });
    const pairs = simulateRound2(panels, roster, params, rr.fork('r2'));
    const ci = armContrastCI(pairs, 'acaps_view', 'control', { B: 200, seed: rr.fork('boot').int(4294967296), method });
    if (!ci.withheld && ci.significant) rejected += 1;
  }
  return rejected / R;
}

test('null: with no arm effect but expert random effects (herding spread, skill, bias), intervals exclude zero about 5% of the time', () => {
  const r = powerRound2(
    { params: { ...resolveParams(), lambdaAcaps: 0 }, N: 40, k: 8, armA: 'acaps_view', armB: 'control' },
    { R: 300, B: 200, seed: 11 },
  );
  assert.ok(r.anySignificant >= 0.03 && r.anySignificant <= 0.075, `two-sided size ${r.anySignificant}`);
});

test('herd = 0 and no arm effect: the arm difference is about zero and the size is near alpha', () => {
  const params = { ...resolveParams({ herd: 0 }), lambdaAcaps: 0 };
  const r = powerRound2({ params, N: 40, k: 8, armA: 'acaps_view', armB: 'control' }, { R: 300, B: 200, seed: 11 });
  assert.ok(Math.abs(r.meanContrast) < 0.003, `mean contrast ${r.meanContrast}`);
  assert.ok(r.anySignificant >= 0.03 && r.anySignificant <= 0.075, `two-sided size ${r.anySignificant}`);
});

test('the pigeonhole (expert-level) interval fails the null, which is why the card bootstrap is used', () => {
  const card = nullRejectionRate('card', 300, 40, 8, 11);
  const experts = nullRejectionRate('pigeonhole', 300, 40, 8, 11);
  assert.ok(card >= 0.03 && card <= 0.075, `card size ${card}`);
  assert.ok(experts > 0.15, `pigeonhole size ${experts} should be far above alpha`);
});

test('with a planted acaps_view pull the power rises with N and is high at large N', () => {
  const base = resolveParams();
  const powers = [20, 40, 80, 160].map((N) => powerRound2(
    { params: base, N, k: 8, armA: 'acaps_view', armB: 'control' },
    { R: 200, B: 200, seed: 7 },
  ).power);
  for (let i = 1; i < powers.length; i++) {
    assert.ok(powers[i] >= powers[i - 1] - 0.08, `power fell from ${powers[i - 1]} to ${powers[i]}`);
  }
  assert.ok(powers[3] >= 0.9, `power at N = 160 is ${powers[3]}`);
});

test('herding: with no herding the 0.3 pull at 40 cards is detected at least 90% of the time; with herding 0.6 at most 50%', () => {
  const run = (herd) => powerRound2(
    { params: resolveParams({ herd }), N: 40, k: 8, armA: 'acaps_view', armB: 'control' },
    { R: 200, B: 200, seed: 7 },
  ).power;
  assert.ok(run(0) >= 0.9, 'herd 0');
  assert.ok(run(0.6) <= 0.5, 'herd 0.6');
});

test('powerRound2 reports pairs per arm near N × k × c2 / 3, and the pooled arm size matches it', () => {
  const r = powerRound2(
    { params: resolveParams(), N: 40, k: 8, armA: 'acaps_view', armB: 'control' },
    { R: 100, B: 100, seed: 7 },
  );
  const expected = (40 * 8 * 0.7) / 3;
  assert.ok(Math.abs(r.pairsPerArmMean - expected) < 0.03 * expected, `pairs per arm ${r.pairsPerArmMean} vs ${expected}`);
  assert.ok(r.pairsPerArmP05 <= r.pairsPerArmMean);
  assert.equal(r.fracWithheld, 0);
});

