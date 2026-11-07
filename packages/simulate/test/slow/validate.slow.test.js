// SLOW: the validation checks that run the population solver or the replicate grids (power-spec §C). Every check must
// pass on the real model in quick form. Run with: node --test packages/simulate/test/slow/validate.slow.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveParams } from '../../src/params.js';
import { checkSize, checkPlantedSkill, checkMonotone, checkRoundTwoNull, checkDeterminism, checkSecondStage, runValidation } from '../../src/validate.js';

const P = resolveParams({});

test('C.1 size: the two-sided rejection at zero gain is inside [0.03, 0.07] (fast tier, quick)', () => {
  const r = checkSize({ params: P, R: 300, seed: 7, tier: 'fast' });
  assert.equal(r.pass, true, r.detail);
});

test('C.2 planted skill: the solved gain is within 3 SE of 0.03', () => {
  assert.equal(checkPlantedSkill({ params: P, targets: [0.03], M: 8000 }).pass, true);
});

test('C.4 monotone: power does not fall with N, and gain does not rise with sigma', () => {
  assert.equal(checkMonotone({ params: P, R: 300 }).pass, true);
});

test('C.8 determinism: the same seed gives the identical table', () => {
  assert.equal(checkDeterminism({ params: P, R: 100 }).pass, true);
});

test('C.9 Round-2 null: equal arms reject in the acceptable range', () => {
  assert.equal(checkRoundTwoNull({ params: P, R: 500, B: 200 }).pass, true);
});

test('C.11 second stage: the mean rule AUC is near 0.5 at zero link (G = 10,000)', () => {
  assert.equal(checkSecondStage({ G: 10000 }).pass, true);
});

test('every validation check passes on the real model in quick form', () => {
  const checks = runValidation({ quick: true });
  const failed = checks.filter((c) => !c.pass).map((c) => `${c.id}: ${c.detail}`);
  assert.deepEqual(failed, []);
  assert.equal(checks.length, 13);
});
