import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summariseArms, ARMS } from '@benchmark/core/secondlook';
import { resolveParams } from '../src/params.js';
import { makeRng, logit } from '../src/rng.js';
import { towardAcaps, revisedLogit, revisedAnswer, simulateRound2, armContrast, armContrastCI, powerRound2 } from '../src/round2.js';

const near = (a, b, tol = 1e-12) => assert.ok(Math.abs(a - b) <= tol, `${a} != ${b}`);

/** Risk cards with ACAPS readings drawn from the band midpoints, and panels of k responders with random Round-1 answers. */
function riskPanels(nCards, k, seed, herd = 0) {
  const rng = makeRng(seed);
  const mids = [0.1, 0.3, 0.5, 0.7, 0.9];
  const roster = Array.from({ length: 40 }, (_, id) => ({ id, bias: 0, skill: 0, uninformed: false, herd }));
  const panels = Array.from({ length: nCards }, (_, c) => {
    const card = {
      id: `SIM-${String(c + 1).padStart(6, '0')}`,
      risk: c + 1,
      band: c % 5,
      a: mids[c % 5],
      L: 0,
      pi: mids[c % 5],
      y: null,
      kind: 'risk',
    };
    const experts = Array.from({ length: k }, (_, i) => (c + 3 * i) % roster.length);
    const ps = experts.map(() => Math.round(100 * (0.1 + 0.8 * rng.next())) / 100);
    return { card, ps, experts };
  });
  return { panels, roster };
}

/**
 * Hand-built pairs: on each card, arm A moves toward ACAPS by s_c (a card-specific amount, spread over ±0.10) with
 * experts nearly identical (±0.001); arm B does not move. Cards differ; experts within a card do not.
 */
function clusteredCardPairs(nCards) {
  const pairs = [];
  for (let c = 0; c < nCards; c++) {
    const cardId = `SIM-${String(c + 1).padStart(6, '0')}`;
    const s = 0.05 + ((c * 37) % 21 - 10) / 200;
    for (let j = 0; j < 5; j++) {
      const jitter = j % 2 ? 0.001 : -0.001;
      pairs.push({ cardId, expertId: j, arm: 'acaps_view', p1: 0.3, p2: 0.3 + s + jitter, acapsP: 0.5, saw: true });
      pairs.push({ cardId, expertId: j, arm: 'control', p1: 0.3, p2: 0.3, acapsP: 0.5, saw: false });
    }
  }
  return pairs;
}

test('towardAcaps is positive when the answer moves closer to ACAPS, negative when it moves away', () => {
  assert.ok(towardAcaps({ p1: 0.2, p2: 0.3, acapsP: 0.705 }) > 0);
  assert.ok(towardAcaps({ p1: 0.6, p2: 0.2, acapsP: 0.705 }) < 0);
  near(towardAcaps({ p1: 0.2, p2: 0.3, acapsP: 0.705 }), 0.1, 1e-12);
  near(towardAcaps({ p1: 0.6, p2: 0.2, acapsP: 0.705 }), -0.4, 1e-12);
});

test('the arm contrast has the expected sign both ways: acaps_view moving toward ACAPS is positive, swapping arms flips it', () => {
  const pairs = clusteredCardPairs(40);
  const forward = armContrast(pairs, 'acaps_view', 'control');
  const reversed = armContrast(pairs, 'control', 'acaps_view');
  assert.ok(forward.est > 0.01, `forward ${forward.est}`);
  near(reversed.est, -forward.est, 1e-12);
  const ci = armContrastCI(pairs, 'acaps_view', 'control', { B: 200 });
  const ciRev = armContrastCI(pairs, 'control', 'acaps_view', { B: 200 });
  assert.equal(ci.significant, true);
  assert.ok(ci.lo > 0, `lo ${ci.lo}`);
  assert.ok(ciRev.hi < 0, `hi ${ciRev.hi}`);
});

test('summariseArms means equal the means of towardAcaps over the same pairs (the definition matches the repo)', () => {
  const { panels, roster } = riskPanels(30, 8, 'means');
  const pairs = simulateRound2(panels, roster, resolveParams(), makeRng('means-r2'));
  const s = summariseArms(pairs);
  for (const arm of ARMS) {
    const mine = pairs.filter((p) => p.arm === arm);
    if (s[arm].suppressed) continue;
    const direct = mine.reduce((acc, p) => acc + towardAcaps(p), 0) / mine.length;
    near(s[arm].meanTowardAcaps, direct, 1e-12);
  }
});

test('an arm with 4 pairs is withheld (no numbers); with 5 it is not', () => {
  const mk = (arm, n) => Array.from({ length: n }, (_, i) => ({
    cardId: `SIM-${String(i + 1).padStart(6, '0')}`, expertId: 0, arm, p1: 0.2, p2: 0.3, acapsP: 0.7, saw: true,
  }));
  const four = [...mk('acaps_view', 4), ...mk('control', 30)];
  const r4 = armContrast(four, 'acaps_view', 'control');
  assert.equal(r4.withheld, true);
  assert.equal(r4.est, null);
  assert.equal(r4.nA, 4);
  const ci4 = armContrastCI(four, 'acaps_view', 'control', { B: 50 });
  assert.equal(ci4.withheld, true);
  assert.equal(ci4.est, null);
  assert.equal(ci4.lo, null);
  assert.equal(ci4.hi, null);
  assert.equal(ci4.significant, false);

  const five = [...mk('acaps_view', 5), ...mk('control', 30)];
  const r5 = armContrast(five, 'acaps_view', 'control');
  assert.equal(r5.withheld, false);
  assert.equal(typeof r5.est, 'number');
  assert.equal(r5.nA, 5);
});

test('the release floor is an argument: a higher floor withholds an arm that a lower one reports', () => {
  const pairs = Array.from({ length: 6 }, (_, i) => ({
    cardId: `SIM-${String(i + 1).padStart(6, '0')}`, expertId: 0, arm: 'balanced', p1: 0.2, p2: 0.3, acapsP: 0.7, saw: true,
  }));
  const more = Array.from({ length: 30 }, (_, i) => ({
    cardId: `SIM-${String(i + 1).padStart(6, '0')}`, expertId: 1, arm: 'control', p1: 0.2, p2: 0.2, acapsP: 0.7, saw: false,
  }));
  assert.equal(armContrast([...pairs, ...more], 'balanced', 'control', { floor: 5 }).withheld, false);
  assert.equal(armContrast([...pairs, ...more], 'balanced', 'control', { floor: 7 }).withheld, true);
});

test('pKeep = 1: every answer is kept, so p2 = p1 and the change toward ACAPS is exactly 0', () => {
  const { panels, roster } = riskPanels(20, 8, 'keep');
  const params = { ...resolveParams(), pKeep: 1 };
  const pairs = simulateRound2(panels, roster, params, makeRng('keep-r2'));
  assert.ok(pairs.length > 50);
  for (const p of pairs) {
    assert.equal(p.p2, p.p1);
    assert.equal(towardAcaps(p), 0);
  }
});

test('herd = 1, pKeep = 0, pull = 0, noise = 0: the revised logit is exactly the mean Round-1 logit', () => {
  const pool = logit(0.37);
  for (const p1 of [0.1, 0.3, 0.62, 0.9]) {
    const l2 = revisedLogit({ p1, pool, a: 0.5, herd: 1, pull: 0, opened: false, noise: 0 });
    near(l2, pool, 1e-12);
  }
});

test('the same extreme settings through simulateRound2: each revised answer is the panel mean on the 0.01 grid', () => {
  const { panels, roster } = riskPanels(25, 8, 'full-herd', 1);
  const params = { ...resolveParams(), pKeep: 0, lambdaAcaps: 0, lambdaBalanced: 0, r2Noise: 0, c2: 1 };
  const pairs = simulateRound2(panels, roster, params, makeRng('full-herd-r2'));
  assert.ok(pairs.length > 100);
  const byCard = new Map(panels.map((p) => [p.card.id, p]));
  for (const pr of pairs) {
    const panel = byCard.get(pr.cardId);
    const pool = panel.ps.reduce((s, p) => s + logit(p), 0) / panel.ps.length;
    // The answer is the mean rounded to a whole percent, so its logit is within rounding of the mean.
    assert.ok(Math.abs(logit(pr.p2) - pool) < 0.03, `${pr.p2} vs pool ${pool}`);
  }
});

test('control never sees the background, and every seen answer comes from a non-control arm', () => {
  const { panels, roster } = riskPanels(80, 10, 'saw');
  const pairs = simulateRound2(panels, roster, resolveParams(), makeRng('saw-r2'));
  const control = pairs.filter((p) => p.arm === 'control');
  assert.ok(control.length > 100);
  assert.ok(control.every((p) => p.saw === false));
  assert.ok(pairs.some((p) => p.saw === true));
  assert.ok(pairs.filter((p) => p.saw).every((p) => p.arm !== 'control'));
});

test('arms are assigned uniformly: each arm holds between 30% and 37% of responders', () => {
  const { panels, roster } = riskPanels(500, 15, 'arms');
  const pairs = simulateRound2(panels, roster, resolveParams(), makeRng('arms-r2'));
  assert.ok(pairs.length > 4000);
  for (const arm of ARMS) {
    const share = pairs.filter((p) => p.arm === arm).length / pairs.length;
    assert.ok(share >= 0.30 && share <= 0.37, `${arm} share ${share}`);
  }
});

test('the Round-2 answer is on the 0.01 grid in [0.01, 0.99]', () => {
  const { panels, roster } = riskPanels(60, 8, 'grid', 0.6);
  const pairs = simulateRound2(panels, roster, resolveParams({ lambdaAcaps: 0.5 }), makeRng('grid-r2'));
  for (const p of pairs) {
    assert.ok(p.p2 >= 0.01 && p.p2 <= 0.99, `p2 ${p.p2}`);
    near(Math.round(p.p2 * 100) / 100, p.p2, 1e-12);
  }
  assert.equal(revisedAnswer({ p1: 0.5, pool: logit(0.999), a: 0.5, herd: 1, pull: 0, opened: false, noise: 0 }), 0.99);
});

test('herd = 0 with no arm effect: the arm difference is about 0', () => {
  const { panels, roster } = riskPanels(200, 8, 'null-herd', 0);
  const params = { ...resolveParams(), lambdaAcaps: 0 };
  const pairs = simulateRound2(panels, roster, params, makeRng('null-herd-r2'));
  const est = armContrast(pairs, 'acaps_view', 'control').est;
  assert.ok(Math.abs(est) < 0.003, `contrast ${est}`);
});

test('the card bootstrap resamples cards: with consistent experts and different cards, its interval is much wider than the expert-level one', () => {
  const pairs = clusteredCardPairs(30);
  const card = armContrastCI(pairs, 'acaps_view', 'control', { B: 400, seed: 3, method: 'card' });
  const experts = armContrastCI(pairs, 'acaps_view', 'control', { B: 400, seed: 3, method: 'pigeonhole' });
  const wCard = card.hi - card.lo;
  const wExperts = experts.hi - experts.lo;
  assert.ok(wCard > 10 * wExperts, `card width ${wCard} vs expert-level width ${wExperts}`);
  assert.ok(card.lo < card.est && card.est < card.hi);
});

test('an unknown bootstrap method, the same arm twice, or an unknown arm are refused', () => {
  const pairs = clusteredCardPairs(10);
  assert.throws(() => armContrastCI(pairs, 'acaps_view', 'control', { method: 'expert' }), RangeError);
  assert.throws(() => armContrast(pairs, 'control', 'control'), RangeError);
  assert.throws(() => armContrast(pairs, 'anchored', 'control'), RangeError);
});

test('a non-risk card and an expert outside the roster are refused', () => {
  const { panels, roster } = riskPanels(3, 4, 'refuse');
  const trigger = { ...panels[0], card: { ...panels[0].card, kind: 'trigger' } };
  assert.throws(() => simulateRound2([trigger], roster, resolveParams(), makeRng(1)), TypeError);
  const stranger = { ...panels[0], experts: [99, 1, 2, 3] };
  assert.throws(() => simulateRound2([stranger], roster, resolveParams(), makeRng(1)), RangeError);
});

test('seeds reproduce: the same seed gives identical pairs and intervals; a different seed does not', () => {
  const { panels, roster } = riskPanels(40, 8, 'seed');
  const params = resolveParams();
  const a = simulateRound2(panels, roster, params, makeRng(20261107));
  const b = simulateRound2(panels, roster, params, makeRng(20261107));
  const c = simulateRound2(panels, roster, params, makeRng(20261108));
  assert.deepEqual(a, b);
  assert.notDeepEqual(a, c);
  assert.deepEqual(armContrastCI(a, 'acaps_view', 'control', { B: 200 }), armContrastCI(b, 'acaps_view', 'control', { B: 200 }));
});

test('cells under the release floor are withheld in the power run: no numbers, and nothing counts as detected', () => {
  const params = { ...resolveParams(), releaseFloor: 1000 };
  const r = powerRound2({ params, N: 40, k: 8, armA: 'acaps_view', armB: 'control' }, { R: 50, B: 50, seed: 7 });
  assert.equal(r.fracWithheld, 1);
  assert.equal(r.power, 0);
  assert.equal(r.meanContrast, null);
  assert.equal(r.anySignificant, 0);
});

test('powerRound2 reproduces from its seed and differs for another seed', () => {
  const spec = { params: resolveParams(), N: 20, k: 8, armA: 'acaps_view', armB: 'control' };
  const a = powerRound2(spec, { R: 40, B: 100, seed: 5 });
  const b = powerRound2(spec, { R: 40, B: 100, seed: 5 });
  const c = powerRound2(spec, { R: 40, B: 100, seed: 6 });
  assert.deepEqual(a, b);
  assert.notDeepEqual(a, c);
});

