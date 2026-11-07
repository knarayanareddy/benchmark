// SYNTHETIC second-stage analysis under stated assumptions. Nothing here is a result about any real risk or panel.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { combineRule, aucDifferenceCI, secondStagePower, populationAucs, simulateSecondStage } from '../src/secondstage.js';
import { makeRng } from '../src/rng.js';
import { resolveParams } from '../src/params.js';

const RULES = ['max', 'noisy_or', 'mean'];

/** A logistic transform. */
const expit = (x) => 1 / (1 + Math.exp(-x));

/**
 * Rows for the paired test with a controlled relation between scores and outcomes.
 * `pa`/`pr` are the signal weights of the ACAPS-like score and the rule score on a shared latent s.
 * @param {ReturnType<typeof makeRng>} rng
 * @param {number} n
 * @param {number} pa
 * @param {number} pr
 */
function latentRows(rng, n, pa, pr) {
  const rows = [];
  for (let i = 0; i < n; i++) {
    const s = rng.normal();
    const y = rng.bernoulli(expit(1.2 * s));
    rows.push({ y, a: expit(pa * s + rng.normal()), mean: expit(pr * s + rng.normal()) });
  }
  return rows;
}

test('known inputs: a single trigger forecast passes through every rule unchanged', () => {
  for (const rule of RULES) assert.ok(Math.abs(combineRule([0.3], rule) - 0.3) < 1e-12, rule);
});

test('known inputs: noisy-OR, max and mean', () => {
  assert.ok(Math.abs(combineRule([0.5, 0.5], 'noisy_or') - 0.75) < 1e-12);
  assert.ok(Math.abs(combineRule([0.2, 0.3], 'noisy_or') - 0.44) < 1e-12);
  assert.equal(combineRule([0.2, 0.9, 0.4], 'max'), 0.9);
  assert.ok(Math.abs(combineRule([0.2, 0.9, 0.4], 'mean') - 0.5) < 1e-12);
});

test('max is at least every input, and noisy-OR is at least max', () => {
  const rng = makeRng('max-bound');
  for (let t = 0; t < 500; t++) {
    const ps = Array.from({ length: 1 + rng.int(5) }, () => rng.next());
    const mx = combineRule(ps, 'max');
    for (const p of ps) assert.ok(mx >= p);
    assert.ok(combineRule(ps, 'noisy_or') >= mx - 1e-12);
  }
});

test('each rule is non-decreasing in every trigger probability', () => {
  const rng = makeRng('monotone');
  for (let t = 0; t < 300; t++) {
    const ps = Array.from({ length: 1 + rng.int(4) }, () => rng.uniform(0.01, 0.9));
    const j = rng.int(ps.length);
    const bumped = ps.map((p, i) => (i === j ? p + 0.05 : p));
    for (const rule of RULES) {
      assert.ok(combineRule(bumped, rule) >= combineRule(ps, rule) - 1e-12, `${rule} at trial ${t}`);
    }
  }
});

test('invalid inputs throw: empty list, probability outside [0, 1], unknown rule', () => {
  assert.throws(() => combineRule([], 'mean'), /at least one/);
  assert.throws(() => combineRule([1.2], 'mean'), /outside \[0, 1\]/);
  assert.throws(() => combineRule([0.5], 'median'), /unknown rule/);
});

test('identical score vectors: dAuc 0 and interval exactly [0, 0], never significant', () => {
  const rng = makeRng('identical');
  const rows = latentRows(rng, 120, 1, 1).map((r) => ({ ...r, mean: r.a }));
  const ci = aucDifferenceCI(rows, 'mean', { B: 300, seed: 11 });
  assert.equal(ci.dAuc, 0);
  assert.equal(ci.lo, 0);
  assert.equal(ci.hi, 0);
  assert.equal(ci.significantBetter, false);
});

test('a rule that ranks perfectly against a flat ACAPS score: dAuc equals the hand value 0.5', () => {
  // y = [1,1,0,0]; ACAPS flat (AUC 0.5); rule separates the classes (AUC 1). dAuc = 0.5 exactly.
  const rows = [
    { y: 1, a: 0.5, mean: 0.9 },
    { y: 1, a: 0.5, mean: 0.8 },
    { y: 0, a: 0.5, mean: 0.2 },
    { y: 0, a: 0.5, mean: 0.1 },
  ];
  const ci = aucDifferenceCI(rows, 'mean', { B: 200, seed: 3 });
  assert.ok(Math.abs(ci.dAuc - 0.5) < 1e-12);
  assert.ok(ci.lo <= ci.dAuc && ci.dAuc <= ci.hi);
});

test('a single-class dataset cannot be compared and throws', () => {
  const rows = [
    { y: 1, a: 0.2, mean: 0.3 },
    { y: 1, a: 0.6, mean: 0.7 },
  ];
  assert.throws(() => aucDifferenceCI(rows, 'mean', { B: 10, seed: 1 }), /both classes/);
});

test('size near alpha under an exchangeable null (rule and ACAPS score equally informative)', () => {
  // Both scores are noisy copies of one latent with the same distribution, so the true dAuc is 0. The lower 2.5% bound
  // of the paired interval is then the one-sided rejection rate, nominally 0.025.
  const rng = makeRng('size');
  const R = 150;
  let hits = 0;
  for (let r = 0; r < R; r++) {
    const rows = latentRows(rng.fork(`rep${r}`), 150, 1, 1);
    if (aucDifferenceCI(rows, 'mean', { B: 200, seed: 100 + r }).significantBetter) hits += 1;
  }
  const size = hits / R;
  console.log(`exchangeable null, one-sided rejection: ${size} over ${R} datasets (nominal 0.025)`);
  assert.ok(size >= 0.005 && size <= 0.07, `size ${size} with ${hits} of ${R}`);
});

test('power at large N: a rule with a planted advantage is detected in most datasets', () => {
  const rng = makeRng('power');
  const R = 40;
  let hits = 0;
  for (let r = 0; r < R; r++) {
    // ACAPS-like score carries 0.3 of the latent signal, the rule carries 1.5: a planted AUC gap of about 0.2.
    const rows = latentRows(rng.fork(`rep${r}`), 400, 0.3, 1.5);
    const ci = aucDifferenceCI(rows, 'mean', { B: 200, seed: 200 + r });
    assert.ok(ci.dAuc > 0, `planted advantage should be positive, got ${ci.dAuc}`);
    if (ci.significantBetter) hits += 1;
  }
  console.log(`planted advantage at N 400: power ${hits / R} over ${R} datasets`);
  assert.ok(hits / R >= 0.8, `power ${hits / R}`);
});

// --- Pipeline: needs the trigger generator (WP2) and the panel model. ---

/** A parameter object with rhoLatent overridden. The register range is 0.1–0.8; 0 and 1 are used on purpose here to
 *  isolate the mechanism, so this bypasses resolveParams' range check and is for these tests only. */
function withRhoLatent(rho, overrides = {}) {
  return { ...resolveParams({ sigma: 1.53, ...overrides }), rhoLatent: rho };
}

test('pipeline: with rhoLatent = 0 the mean rule has AUC in [0.47, 0.53] at 20,000 risks', () => {
  const pop = populationAucs(withRhoLatent(0), { G: 20000, seed: 21, kFixed: 8 });
  assert.ok(pop.mean >= 0.47 && pop.mean <= 0.53, `mean AUC ${pop.mean}`);
});

test('pipeline: with sigma ≈ 0, rhoLatent = 1 and no shared error, the mean rule beats ACAPS', () => {
  const pop = populationAucs(
    withRhoLatent(1, { sigma: 0.05, icc: 0 }),
    { G: 4000, seed: 22, kFixed: 8 },
  );
  assert.ok(pop.mean > pop.acaps, `mean ${pop.mean} vs acaps ${pop.acaps}`);
});

test('pipeline: population AUCs at rhoLatent 0.3 match the spec table (0.701 / 0.798 / 0.679 / 0.672 / 0.707) within 0.015', () => {
  const pop = populationAucs(resolveParams({ sigma: 1.53 }), { G: 30000, seed: 20261107, kFixed: 8 });
  console.log(
    `population (rho 0.3, n=${pop.n}): AUC acaps ${pop.acaps.toFixed(3)} direct ${pop.direct.toFixed(3)} ` +
      `max ${pop.max.toFixed(3)} noisy_or ${pop.noisy_or.toFixed(3)} mean ${pop.mean.toFixed(3)}; ` +
      `Brier acaps ${pop.brier.acaps.toFixed(3)} direct ${pop.brier.direct.toFixed(3)}`,
  );
  const spec = { acaps: 0.701, direct: 0.798, max: 0.679, noisy_or: 0.672, mean: 0.707 };
  for (const key of Object.keys(spec)) {
    assert.ok(Math.abs(pop[key] - spec[key]) <= 0.015, `${key}: ${pop[key]} vs spec ${spec[key]}`);
  }
});

test('pipeline: simulateSecondStage rows carry y, a, direct, m and every requested rule', () => {
  const rows = simulateSecondStage(resolveParams({ sigma: 1.53 }), { G: 50, seed: 4, kFixed: 8 });
  assert.ok(rows.length > 0);
  for (const r of rows) {
    assert.ok(r.y === 0 || r.y === 1);
    assert.ok(r.m >= 1);
    for (const rule of RULES) assert.ok(r[rule] >= 0 && r[rule] <= 1, rule);
  }
  const onlyMean = simulateSecondStage(resolveParams({ sigma: 1.53 }), { G: 50, seed: 4, kFixed: 8, rules: ['mean'] });
  assert.ok('mean' in onlyMean[0]);
  assert.ok(!('max' in onlyMean[0]));
});

test('pipeline: power at G = 300 detects a planted advantage (rhoLatent 0.8, mean rule) in most datasets', () => {
  const res = secondStagePower(
    { params: withRhoLatent(0.8), G: 300, rule: 'mean', kFixed: 8 },
    { R: 40, B: 200, seed: 31 },
  );
  console.log(
    `second stage, rho 0.8, G 300, mean rule: power ${res.power.toFixed(2)} [${res.lo.toFixed(2)}, ${res.hi.toFixed(2)}], ` +
      `mean dAuc ${res.meanDAuc.toFixed(3)}, mean half-width ${res.halfWidth.toFixed(3)}`,
  );
  assert.ok(res.power >= 0.6, `power ${res.power}`);
  assert.ok(res.meanDAuc > 0);
});

test('pipeline: at rhoLatent 0 the mean rule is never significantly better than ACAPS', () => {
  const res = secondStagePower({ params: withRhoLatent(0), G: 150, rule: 'mean', kFixed: 8 }, { R: 20, B: 150, seed: 32 });
  assert.equal(res.power, 0);
});
