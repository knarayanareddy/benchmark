// SYNTHETIC second-stage analysis under stated assumptions. Nothing here is a result about any real risk or panel.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { combineRule, aucDifferenceCI, simulateSecondStage } from '../src/secondstage.js';
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

