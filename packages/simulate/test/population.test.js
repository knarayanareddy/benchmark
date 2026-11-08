import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveParams } from '../src/params.js';
import { populationGain, headroomTable } from '../src/population.js';

test('populationGain input checks: acaps against triggers, unknown benchmarks and a missing k are refused', () => {
  const P = resolveParams();
  assert.throws(() => populationGain(P, { benchmark: 'acaps', M: 100, k: 8, cards: 'trigger' }), /no ACAPS comparator/);
  assert.throws(() => populationGain(P, { benchmark: 'fixed', M: 100, k: 8 }), /unknown benchmark/);
  assert.throws(() => populationGain(P, { benchmark: 'base_rate', M: 100 }), /needs k/);
});

test('headroom: at tau 1.25 the headroom over ACAPS is 0.0538 (within 0.003); ACAPS Brier does not move with tau', () => {
  const P = resolveParams();
  const [t075, t125, t150] = headroomTable(P, [0.75, 1.25, 1.5]);
  assert.ok(Math.abs(t125.headroom - 0.0538) < 0.003, `headroom ${t125.headroom}`);
  assert.ok(Math.abs(t125.perfectBrier - 0.1591) < 0.003, `perfect ${t125.perfectBrier}`);
  // ACAPS's band hit rates are reproduced exactly for every tau, so its population Brier is the same at every tau.
  assert.ok(Math.abs(t075.acapsBrier - t125.acapsBrier) < 1e-9, 'acaps Brier is tau-invariant');
  assert.ok(Math.abs(t150.acapsBrier - t125.acapsBrier) < 1e-9, 'acaps Brier is tau-invariant');
  assert.ok(Math.abs(t125.acapsBrier - 0.2124) < 0.0005, `acaps Brier ${t125.acapsBrier}`);
});

test('headroom is non-decreasing in tau: a wider latent leaves more room for an ideal forecaster', () => {
  const rows = headroomTable(resolveParams(), [0.75, 1, 1.25, 1.5]);
  for (let i = 1; i < rows.length; i++) assert.ok(rows[i].headroom > rows[i - 1].headroom);
});

