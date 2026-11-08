import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveParams } from '../src/params.js';
import { makeRng, expit } from '../src/rng.js';
import { makeRiskCards, makeRoster, drawPanel, expertReport, cardSharedError } from '../src/model.js';
import { assertNotSynthetic } from '../src/label.js';
import { ACAPS_BANDS, BAND_MIDPOINT } from '@benchmark/core/aggregate';

/**
 * Some settings in the spec sit outside the registered ranges (tau 0.5, sigma 0, k 1). They are built as a plain copy
 * of the resolved defaults, which the model reads without the range check. Each use is named where it happens.
 */
const withOverrides = (over) => ({ ...resolveParams(), ...over });

const mean = (xs) => xs.reduce((s, x) => s + x, 0) / xs.length;

const variance = (xs) => {
  const m = mean(xs);
  return xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1);
};

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

