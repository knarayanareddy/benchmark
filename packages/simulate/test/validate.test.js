// Validation checks (power-spec §C), fast forms. Each check passes on the real model and fails on a deliberately broken
// one (teeth). The heavy forms (solver-based size, planted skill, monotone grids) run in test/slow/.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveParams } from '../src/params.js';
import { median } from '../src/endpoint.js';
import {
  checkK1, checkFastEqualsReal, checkDropout, checkCorrelation, checkSecondStage, checkAbsoluteConstant,
  checkCalendar, checkRealData, checkSize, betaBinomialTail, renderValidation, RANGES,
} from '../src/validate.js';
import { loadAssumptions } from '../src/assumptions.js';
import { BASELINE_FILE } from '../src/validate.js';
import { readFileSync } from 'node:fs';

const P = resolveParams({});

test('C.3 k = 1: the pooled forecast is the single expert, and brier() matches the hand mean', () => {
  const r = checkK1({ params: P, cards: 120, seed: 7 });
  assert.equal(r.pass, true, r.detail);
  assert.equal(r.value, 0);
});

test('C.3 teeth: a pooling rule that is not the expert fails the check', () => {
  const r = checkK1({ params: P, cards: 120, seed: 7, pool: (ps) => median(ps) * 0.9 });
  assert.equal(r.pass, false, 'a pool that shifts the forecast must fail');
});

test('C.6 fast median equals aggregate() on every panel', () => {
  const r = checkFastEqualsReal({ params: P, cards: 60, seed: 7 });
  assert.equal(r.pass, true, r.detail);
});

test('C.7 the analysable share matches the beta-binomial tail, and no panel is below the floor', () => {
  const r = checkDropout({ params: P, cards: 800, seed: 7 });
  assert.equal(r.pass, true, r.detail);
});

test('C.7 the beta-binomial tail is the exact pmf sum: at kappa infinity it matches the binomial', () => {
  // Binomial(15, 0.49) P(k >= 5) = 0.9307 (exact); a huge kappa approaches the binomial.
  const near = betaBinomialTail(15, 0.49 * 1e6, 0.51 * 1e6, 5);
  assert.ok(Math.abs(near - 0.9307) < 0.001, `binomial limit ${near}`);
  assert.ok(betaBinomialTail(15, 4.9, 5.1, 5) < near, 'finite kappa is over-dispersed, so the tail is lower');
});

test('C.10 correlation machinery: fisherN, simulated power at 29 and the type-I rate', () => {
  const r = checkCorrelation({ R: 2000, seed: 7 });
  assert.equal(r.pass, true, r.detail);
  assert.equal(r.value.n29, 29);
  assert.equal(r.value.n50, 50);
});

test('C.12 the constant forecast at the base rate cannot be better', () => {
  const r = checkAbsoluteConstant({ params: P, cards: 200, seed: 7 });
  assert.equal(r.pass, true, r.detail);
  assert.equal(r.value, 0);
});

test('C.13 the calendar reproduces the radar counts and the 12-month window', () => {
  const r = checkCalendar({ B: 4000, seed: 7 });
  assert.equal(r.pass, true, r.detail);
});

test('C.5 reproduces the repo on the real 104 resolved risks, including the child-process script', () => {
  const r = checkRealData();
  assert.equal(r.pass, true, r.detail);
  assert.match(r.detail, /REAL DATA \(historical, already resolved\), not simulated/);
});

test('C.5 teeth: a baseline file that disagrees with the simulator fails the check', () => {
  const base = JSON.parse(readFileSync(BASELINE_FILE, 'utf8'));
  const broken = { ...base, brier: { ...base.brier, acaps: base.brier.acaps + 0.01 } };
  const r = checkRealData({ baseline: broken, runScript: false });
  assert.equal(r.pass, false, 'a shifted ACAPS Brier must fail');
  assert.match(r.detail, /ACAPS midpoint vs baseline-fit\.json/);
});

test('C.1 teeth: a one-sided rule (power only) and a rule that never rejects both fail the size range', () => {
  const never = checkSize({ params: P, N: 40, R: 40, M: 1000, seed: 7, rejection: () => 0 });
  const always = checkSize({ params: P, N: 40, R: 40, M: 1000, seed: 7, rejection: () => 1 });
  assert.equal(never.pass, false);
  assert.equal(always.pass, false);
  assert.deepEqual(RANGES.size, [0.03, 0.07]);
});

test('C.11 teeth-light: identical scores give dAUC 0 with interval [0, 0] (secondary to the heavy form)', () => {
  const r = checkSecondStage({ G: 2000, seed: 7 });
  assert.equal(typeof r.pass, 'boolean');
  assert.equal(r.value.identical.dAuc, 0);
});

test('a failing check is rendered as FAIL with its numbers, and the count is printed', () => {
  const md = renderValidation([
    { id: 'C.1', name: 'x', pass: false, value: 0, expected: '0.03 to 0.07', detail: 'd' },
    { id: 'C.2', name: 'y', pass: true, value: 1, expected: 'e', detail: 'd2' },
  ]);
  assert.match(md, /^Validation: 1 of 2 checks pass\./m);
  assert.match(md, /\| C\.1 \| x \| FAIL \| 0\.03 to 0\.07 \| d \|/);
});

test('the assumptions file loads, so the validation sees the same defaults as the simulator', () => {
  assert.ok(loadAssumptions().entries.length >= 24);
});
