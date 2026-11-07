import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveParams } from '../src/params.js';
import { makeRng, expit } from '../src/rng.js';
import { loadHistorical } from '../src/data.js';
import { modelConstants, makeRiskCards, makeRoster, drawPanel, expertReport, cardSharedError } from '../src/model.js';
import { assertNotSynthetic } from '../src/label.js';
import { ACAPS_BANDS, BAND_MIDPOINT } from '@benchmark/core/aggregate';

/**
 * Some settings in the spec sit outside the registered ranges (tau 0.5, sigma 0, k 1). They are built as a plain copy
 * of the resolved defaults, which the model reads without the range check. Each use is named where it happens.
 */
const withOverrides = (over) => ({ ...resolveParams(), ...over });

const logit = (p) => Math.log(p / (1 - p));
const mean = (xs) => xs.reduce((s, x) => s + x, 0) / xs.length;
const variance = (xs) => {
  const m = mean(xs);
  return xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1);
};
const correlation = (xs, ys) => {
  const mx = mean(xs);
  const my = mean(ys);
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < xs.length; i++) {
    sxy += (xs[i] - mx) * (ys[i] - my);
    sxx += (xs[i] - mx) ** 2;
    syy += (ys[i] - my) ** 2;
  }
  return sxy / Math.sqrt(sxx * syy);
};

/**
 * The shared-plus-idiosyncratic error S − L recovered from a reported forecast, by inverting §A.3 with the model's β.
 * Valid for an expert with bias set and skill 0 (so σ_i = σ), as used in these tests.
 */
function errorFromReport(p, expert, card, params) {
  const { mean: m, variance: v } = modelConstants(params);
  const sigmaI = (params.sigma ?? params.sigmaRef) * Math.exp(params.skillSpread * expert.skill);
  const beta = (params.omega * v) / (v + sigmaI * sigmaI);
  const S = m + (logit(p) - m - expert.bias - params.panelBias) / beta;
  return S - card.L;
}

/** ANOVA intraclass correlation for balanced clusters: the estimator of the realised icc. */
function anovaIccBalanced(values, clusterOf, k) {
  const groups = new Map();
  values.forEach((v, i) => {
    const g = clusterOf[i];
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(v);
  });
  const G = groups.size;
  const grand = mean(values);
  let ssb = 0;
  let ssw = 0;
  for (const arr of groups.values()) {
    const m = mean(arr);
    ssb += arr.length * (m - grand) ** 2;
    for (const x of arr) ssw += (x - m) ** 2;
  }
  const msb = ssb / (G - 1);
  const msw = ssw / (G * (k - 1));
  return (msb - msw) / (msb + (k - 1) * msw);
}

/** log Γ(x) by Lanczos (g = 7). Used only for the beta-binomial reference pmf. */
function logGamma(x) {
  const c = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61503916999385,
    12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
  if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - logGamma(1 - x);
  const y = x - 1;
  let a = c[0];
  const t = y + 7.5;
  for (let i = 1; i < 9; i++) a += c[i] / (y + i);
  return 0.5 * Math.log(2 * Math.PI) + (y + 0.5) * Math.log(t) - t + Math.log(a);
}

/** Beta-binomial pmf P(k | n, a, b). */
function betaBinomialPmf(k, n, a, b) {
  const logChoose = logGamma(n + 1) - logGamma(k + 1) - logGamma(n - k + 1);
  const logBeta = (x, y) => logGamma(x) + logGamma(y) - logGamma(x + y);
  return Math.exp(logChoose + logBeta(k + a, n - k + b) - logBeta(a, b));
}

test('seeded: the same seed gives identical cards, roster and panels; a different seed gives different cards', () => {
  const P = resolveParams();
  const cards = () => makeRiskCards(P, makeRng(20261107).fork('cards'), 500);
  assert.deepEqual(cards(), cards());
  assert.notDeepEqual(cards(), makeRiskCards(P, makeRng(20261108).fork('cards'), 500));

  const roster = () => makeRoster(P, makeRng(20261107).fork('roster'));
  assert.deepEqual(roster(), roster());

  const panel = () => {
    const rng = makeRng(7);
    const r = roster();
    return drawPanel(cards()[3], r, P, rng, { kFixed: 8 });
  };
  assert.deepEqual(panel(), panel());
});

test('streams are independent: draws on a sibling fork or on the parent do not shift the risk cards', () => {
  const P = resolveParams();
  const root = makeRng(20261107);
  const before = makeRiskCards(P, root.fork('cards'), 500);
  makeRoster(P, root.fork('roster'));
  for (let i = 0; i < 5000; i++) root.next();
  assert.deepEqual(makeRiskCards(P, root.fork('cards'), 500), before);
});

test('every output is flagged synthetic and carries a SIM- id; assertNotSynthetic refuses it', () => {
  const P = resolveParams();
  const cards = makeRiskCards(P, makeRng(1).fork('cards'), 50);
  for (const [i, c] of cards.entries()) {
    assert.equal(c.synthetic, true);
    assert.equal(c.id, `SIM-${String(i + 1).padStart(6, '0')}`);
    assert.equal(c.kind, 'risk');
  }
  assert.throws(() => assertNotSynthetic(cards[0]));
  assert.throws(() => assertNotSynthetic(cards));

  const roster = makeRoster(P, makeRng(2).fork('roster'));
  assert.ok(roster.every((e) => e.synthetic === true));
  const panel = drawPanel(cards[0], roster, P, makeRng(3), { kFixed: 5 });
  assert.equal(panel.synthetic, true);
  assert.throws(() => assertNotSynthetic(panel.card));
});

test('risk latent is grounded in the measured bands: band mix and hit rates match the data (200,000 cards, tau 0.5 and 1.25)', () => {
  const h = loadHistorical();
  for (const tau of [0.5, 1.25]) {
    // tau 0.5 is outside the registered range (0.75 to 1.5); it is used here to test the offset solver at another spread.
    const P = withOverrides({ tau });
    const cards = makeRiskCards(P, makeRng(101).fork('cards'), 200000);
    for (let b = 0; b < 5; b++) {
      const inBand = cards.filter((c) => c.band === b);
      const n = inBand.length;
      const wExpected = h.bandCounts[b] / h.rated;
      const wSe = Math.sqrt((wExpected * (1 - wExpected)) / 200000);
      assert.ok(Math.abs(n / 200000 - wExpected) < 3 * wSe, `tau ${tau} band ${b}: weight`);

      const target = h.bandHits[b] / h.bandCounts[b];
      const hits = inBand.reduce((s, c) => s + c.y, 0);
      const se = Math.sqrt((target * (1 - target)) / n);
      assert.ok(Math.abs(hits / n - target) < 3 * se, `tau ${tau} band ${b}: hit rate ${hits / n} vs ${target}`);
      assert.ok(inBand.every((c) => c.a === BAND_MIDPOINT[ACAPS_BANDS[b].label]), 'a is the band midpoint');
    }
  }
});

test('modelConstants: the latent mean and variance match a Monte Carlo of the risk latent', () => {
  const P = resolveParams();
  const { mean: m, variance: v } = modelConstants(P);
  const cards = makeRiskCards(P, makeRng(55).fork('cards'), 200000);
  const Ls = cards.map((c) => c.L);
  assert.ok(Math.abs(mean(Ls) - m) < 0.01, `mean ${mean(Ls)} vs ${m}`);
  assert.ok(Math.abs(variance(Ls) / v - 1) < 0.01, `variance ${variance(Ls)} vs ${v}`);
});

test('shared card-level error: two experts on one card share icc of their error, and total error variance is invariant in icc', () => {
  const e1 = { id: 1, bias: 0, skill: 0, uninformed: false, herd: 0 };
  const e2 = { id: 2, bias: 0, skill: 0, uninformed: false, herd: 0 };
  const N = 50000;
  const stats = {};
  for (const icc of [0, 0.4]) {
    const P = withOverrides({ icc, sigma: 1.53 });
    const cards = makeRiskCards(P, makeRng(9).fork('cards'), N);
    const rng = makeRng(10).fork(`icc${icc}`);
    const x1 = [];
    const x2 = [];
    for (const card of cards) {
      const u = cardSharedError(P, rng);
      x1.push(errorFromReport(expertReport(e1, card, u, P, rng), e1, card, P));
      x2.push(errorFromReport(expertReport(e2, card, u, P, rng), e2, card, P));
    }
    stats[icc] = { corr: correlation(x1, x2), total: variance(x1.concat(x2)) };
  }
  assert.ok(Math.abs(stats[0].corr) < 0.02, `icc 0 correlation ${stats[0].corr}`);
  assert.ok(Math.abs(stats[0.4].corr - 0.4) < 0.02, `icc 0.4 correlation ${stats[0.4].corr}`);
  assert.ok(Math.abs(stats[0.4].total / stats[0].total - 1) < 0.02,
    `total error variance ${stats[0.4].total} vs ${stats[0].total}`);
  // The parameter itself: S − L has variance sigma^2 (here 1.53^2), whatever the shared share.
  for (const icc of [0, 0.4]) {
    assert.ok(Math.abs(stats[icc].total / 1.53 ** 2 - 1) < 0.02, `icc ${icc}: variance ${stats[icc].total} vs sigma^2`);
  }
});

test('the icc parameter is recovered by a one-way ANOVA of the expert errors on each card (within 0.02)', () => {
  const P = withOverrides({ skillSpread: 0, sigmaBias: 0.3, sigma: 1.53 });
  const roster = makeRoster(P, makeRng(12).fork('roster'));
  const k = 4;
  const cards = makeRiskCards(P, makeRng(13).fork('cards'), 20000);
  const rng = makeRng(14).fork('reports');
  const values = [];
  const clusterOf = [];
  cards.forEach((card, i) => {
    const u = cardSharedError(P, rng);
    for (let j = 0; j < k; j++) {
      const expert = roster[j];
      values.push(errorFromReport(expertReport(expert, card, u, P, rng), expert, card, P));
      clusterOf.push(i);
    }
  });
  const icc = anovaIccBalanced(values, clusterOf, k);
  assert.ok(Math.abs(icc - P.icc) < 0.02, `ANOVA icc ${icc} vs parameter ${P.icc}`);
});

test('reports are whole percents clamped to [0.01, 0.99], and the clamp is reached when experts are over-confident', () => {
  // Over-confidence (omega 2) at low noise pushes logits past ±4.6, where the clamp binds. High noise shrinks them instead.
  const P = withOverrides({ sigma: 0.5, omega: 2 });
  const roster = makeRoster(P, makeRng(21).fork('roster'));
  const cards = makeRiskCards(P, makeRng(22).fork('cards'), 2000);
  const rng = makeRng(23);
  let atFloor = 0;
  let atCeiling = 0;
  for (const card of cards) {
    const panel = drawPanel(card, roster, P, rng, { kFixed: 8 });
    for (const p of panel.ps) {
      assert.ok(p >= 0.01 && p <= 0.99, `report ${p} out of range`);
      assert.ok(Math.abs(p * 100 - Math.round(p * 100)) < 1e-9, `report ${p} is not a whole percent`);
      if (p === 0.01) atFloor++;
      if (p === 0.99) atCeiling++;
    }
  }
  assert.ok(atFloor > 0 && atCeiling > 0, 'the clamp should bind at sigma 6');
});

test('P(k >= 5) with K = 15 and dropout 0.51 matches the exact value within 3 SE, at kappa 10000 (fixed share) and the default kappa 10', () => {
  const N = 100000;
  for (const [kappa, label] of [[10000, 'kappa 10000'], [10, 'default kappa 10']]) {
    const P = withOverrides({ dropoutKappa: kappa });
    const roster = makeRoster(P, makeRng(31).fork('roster'));
    const card = makeRiskCards(P, makeRng(32).fork('cards'), 1)[0];
    const rng = makeRng(33);
    let atLeastFloor = 0;
    for (let i = 0; i < N; i++) {
      if (drawPanel(card, roster, P, rng) !== null) atLeastFloor++;
    }
    // Exact: the beta-binomial with response share 0.49 and concentration kappa. kappa 10000 is the binomial limit.
    let exact = 0;
    for (let k = 5; k <= 15; k++) exact += betaBinomialPmf(k, 15, 0.49 * kappa, 0.51 * kappa);
    const se = Math.sqrt((exact * (1 - exact)) / N);
    assert.ok(Math.abs(atLeastFloor / N - exact) < 3 * se, `${label}: observed ${atLeastFloor / N} vs exact ${exact}`);
    if (kappa === 10000) assert.ok(Math.abs(exact - 0.931) < 0.001, `binomial limit ${exact} should be the spec's 0.931`);
  }
});

test('dropout distribution: the number of answers follows the beta-binomial (kappa 10), and the mean is K(1 - dropout)', () => {
  const P = withOverrides({ dropoutKappa: 10, floor: 0 });
  const roster = makeRoster(P, makeRng(41).fork('roster'));
  const card = makeRiskCards(P, makeRng(42).fork('cards'), 1)[0];
  const rng = makeRng(43);
  const N = 100000;
  const counts = new Array(16).fill(0);
  for (let i = 0; i < N; i++) counts[drawPanel(card, roster, P, rng).ps.length] += 1;
  const mk = 1 - P.dropout;
  let worst = 0;
  let meanK = 0;
  for (let k = 0; k <= 15; k++) {
    const expected = betaBinomialPmf(k, 15, mk * 10, (1 - mk) * 10);
    worst = Math.max(worst, Math.abs(counts[k] / N - expected));
    meanK += (k * counts[k]) / N;
  }
  assert.ok(worst < 0.006, `largest pmf deviation ${worst}`);
  assert.ok(Math.abs(meanK / 15 - mk) < 0.005, `mean share ${meanK / 15} vs ${mk}`);
});

test('dropout: a card with fewer answers than the floor is withheld (null); kFixed bypasses dropout and the floor', () => {
  const P = resolveParams();
  const roster = makeRoster(P, makeRng(51).fork('roster'));
  const card = makeRiskCards(P, makeRng(52).fork('cards'), 1)[0];
  const rng = makeRng(53);
  let withheld = 0;
  for (let i = 0; i < 2000; i++) {
    const panel = drawPanel(card, roster, P, rng);
    if (panel === null) withheld++;
    else assert.ok(panel.ps.length >= P.floor);
  }
  assert.ok(withheld > 0, 'with a 49% response some cards should fall below 5');
  const fixed = drawPanel(card, roster, P, rng, { kFixed: 3 });
  assert.equal(fixed.ps.length, 3);
});

test('expert roster: bias spread, skill spread, uninformed share and herding match their parameters', () => {
  const P = withOverrides({ rosterSize: 4000, fracUninformed: 0.2 });
  const roster = makeRoster(P, makeRng(61).fork('roster'));
  assert.ok(Math.abs(variance(roster.map((e) => e.bias)) - P.sigmaBias ** 2) < 0.01, 'bias variance');
  assert.ok(Math.abs(variance(roster.map((e) => e.skill)) - 1) < 0.07, 'skill variance');
  const share = roster.filter((e) => e.uninformed).length / roster.length;
  assert.ok(Math.abs(share - 0.2) < 0.02, `uninformed share ${share}`);
  assert.ok(Math.abs(mean(roster.map((e) => e.herd)) - P.herd) < 0.01, 'herd mean');
  assert.ok(roster.every((e) => e.herd >= 0 && e.herd <= 1), 'herd is in [0, 1]');
});

test('a report with no noise and no shared error sits on the latent (oracle): the expert is the latent expit', () => {
  // sigma 0 and omega 1 are outside the registered ranges; the oracle is built on a plain copy.
  const P = withOverrides({ sigma: 0, omega: 1, icc: 0, panelBias: 0, sigmaBias: 0, fracUninformed: 0 });
  const oracle = { id: 1, bias: 0, skill: 0, uninformed: false, herd: 0 };
  const cards = makeRiskCards(P, makeRng(71).fork('cards'), 2000);
  const rng = makeRng(72);
  for (const card of cards.slice(0, 500)) {
    const p = expertReport(oracle, card, cardSharedError(P, rng), P, rng);
    // The model's rule: whole percent, then the clamp to [0.01, 0.99].
    const expected = Math.min(0.99, Math.max(0.01, Math.round(100 * expit(card.L)) / 100));
    assert.equal(p, expected, `report ${p} vs latent ${expit(card.L)}`);
  }
});

test('ACAPS midpoint is the comparator on every risk card, and lies strictly inside (0, 1)', () => {
  const P = resolveParams();
  const cards = makeRiskCards(P, makeRng(81).fork('cards'), 1000);
  for (const c of cards) {
    assert.equal(c.a, BAND_MIDPOINT[ACAPS_BANDS[c.band].label]);
    assert.ok(c.a > 0 && c.a < 1);
  }
});
