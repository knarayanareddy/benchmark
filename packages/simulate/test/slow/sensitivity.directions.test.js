// Slow: the sensitivity directions and the spec's RAN values, at replicate counts that take minutes under load.
// Not run by `npm test` (the root glob is packages/*/test/*.test.js). Run:
//   node --test packages/simulate/test/slow/sensitivity.directions.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runSensitivity, settingsOf, paramsFor } from '../../src/sensitivity.js';
import { estimatePower } from '../../src/power.js';

/** Cost stub: the timing probe is skipped so the plan does not depend on the machine. */
const NO_PROBE = { cost: () => 1 };
/** Tiny N grid for the direction tests (the full grid is used where a test says so). */
const SMALL_NS = [28, 104];

/** N80 as a comparable number: a null (not reached) counts as worse than any finite value. */
const need = (row) => (row.cardsNeeded80 === null ? Infinity : row.cardsNeeded80);

test('more answers per card needs fewer cards (S1), and more shared error lowers the gain (S2): full grid, fixed seed', () => {
  const r = runSensitivity({}, { R: 80, sweeps: ['S1', 'S2'], seed: 20261107, ...NO_PROBE });
  const s1 = r.rows.filter((x) => x.sweep === 'S1');
  const s2 = r.rows.filter((x) => x.sweep === 'S2');
  const k = (v) => s1.find((x) => x.value === v);
  const icc = (v) => s2.find((x) => x.value === v);
  // Fewer experts per card: more cards needed (null, not reached, counts as Infinity).
  assert.ok(need(k(15)) < need(k(3)), `k=15 needs ${need(k(15))}, k=3 needs ${need(k(3))}`);
  assert.ok(need(k(8)) <= need(k(5)) + 1, 'k=8 needs no more than k=5');
  // More shared error: the gain falls. Tolerance 0.004 (about two Monte Carlo standard errors at this R).
  assert.ok(icc(0).gain > icc(0.6).gain + 0.004, `gain at shared error 0 ${icc(0).gain} vs 0.6 ${icc(0.6).gain}`);
  assert.ok(need(icc(0)) < need(icc(0.6)), 'more shared error needs more cards');
});

test('coupling 0.7 has a higher realised intra-risk correlation than 0.3 (S12)', () => {
  const r = runSensitivity({}, { R: 60, Ns: SMALL_NS, sweeps: ['S12'], ...NO_PROBE });
  const c = (v) => r.rows.find((x) => x.sweep === 'S12' && x.value === v);
  assert.ok(c(0.7).rhoD > c(0.3).rhoD, `ρ_D at 0.7 (${c(0.7).rhoD}) above ρ_D at 0.3 (${c(0.3).rhoD})`);
});

test('S5 (risk base rate): the panel wins by more away from the centre, and the gains match the spec RAN values (0.0886 / 0.0413 / 0.0306 / 0.0439) within 0.006', () => {
  const spec = { 0.3: 0.0886, 0.45: 0.0413, 0.59: 0.0306, 0.7: 0.0439 };
  const gains = {};
  for (const s of settingsOf().filter((x) => x.sweep === 'S5')) {
    const [o] = estimatePower({ params: paramsFor(s, {}), N: [104], k: 8, endpoint: 'vs_acaps', tier: 'fast', cards: 'risk', scenario: `S5:${s.value}` }, { R: 400, seed: 20261107 });
    gains[s.value] = o.meanGain;
    assert.ok(Math.abs(o.meanGain - spec[s.value]) < 0.006, `base ${s.value}: gain ${o.meanGain} vs spec ${spec[s.value]}`);
  }
  assert.ok(gains[0.3] > gains[0.59] && gains[0.7] > gains[0.59], `off-centre gains ${gains[0.3]}, ${gains[0.7]} above the centre ${gains[0.59]}`);
});

test('S3b (uninformed experts): the gain falls with the uninformed share, 0 > 0.2 > 0.4 at R = 1000 (the spec prototype value −0.008 is one roster, not the mean)', () => {
  const gain = (f) => {
    const s = settingsOf().find((x) => x.sweep === 'S3b' && x.value === f);
    const [o] = estimatePower({ params: paramsFor(s, {}), N: [104], k: 8, endpoint: 'vs_acaps', tier: 'fast', cards: 'risk', scenario: `S3b:${f}` }, { R: 1000, seed: 20261107 });
    return o.meanGain;
  };
  const g0 = gain(0);
  const g2 = gain(0.2);
  const g4 = gain(0.4);
  assert.ok(g0 > g2 && g2 > g4, `gains ${g0} > ${g2} > ${g4}`);
  // The mean over 1000 rosters is about +0.014 at 40% (measured); the single-roster spec value is noise of about ±0.018.
  assert.ok(g4 > 0 && g4 < 0.025, `gain at 40% uninformed ${g4}`);
});
