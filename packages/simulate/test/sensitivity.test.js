import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveParams } from '../src/params.js';
import { estimatePower } from '../src/power.js';
import { quickReps } from '../src/budget.js';
import { BANNER } from '../src/label.js';
import { runSensitivity, settingsOf, paramsFor, makeRiskStream, SWEEP_NS } from '../src/sensitivity.js';

/** Cost stub: the timing probe is skipped so the plan does not depend on the machine. */
const NO_PROBE = { cost: () => 1 };
/** Tiny N grid for the count and label tests (the directions test uses the full grid). */
const SMALL_NS = [28, 104];

/** A fake clock that advances by `stepMs` on every read. */
function steppingClock(stepMs) {
  let t = 0;
  return () => {
    t += stepMs;
    return t;
  };
}

/** N80 as a comparable number: a null (not reached) counts as worse than any finite value. */
const need = (row) => (row.cardsNeeded80 === null ? Infinity : row.cardsNeeded80);

test('every sweep S1–S12 returns the expected number of rows (45 settings in all), and each row is labelled synthetic', () => {
  const expected = { S1: 4, S2: 4, S3: 3, S3b: 3, S4: 5, S4b: 3, S5: 4, S6: 4, S7: 4, S8: 2, S9: 3, S10: 2, S11: 2, S12: 2 };
  const r = runSensitivity({}, { R: 12, Ns: SMALL_NS, ...NO_PROBE });
  const bySweep = {};
  for (const row of r.rows) bySweep[row.sweep] = (bySweep[row.sweep] ?? 0) + 1;
  assert.deepEqual(bySweep, expected);
  assert.equal(r.rows.length, 45);
  assert.deepEqual(r.skipped, []);
  for (const row of r.rows) {
    assert.equal(row.label, BANNER, `row ${row.sweep} ${row.settingLabel} is labelled`);
    assert.equal(row.synthetic, true);
    assert.ok(typeof row.settingLabel === 'string' && row.settingLabel.length > 0);
    assert.ok(row.power >= 0 && row.power <= 1 && row.mcError >= 0, 'power and its error bar are proper');
  }
});

test('more answers per card needs fewer cards (S1), and more shared error lowers the gain (S2): coarse grid, fixed seed', () => {
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

test('the budget guard stops the run past its limit and reports where it stopped; the rows before the stop are kept', () => {
  const r = runSensitivity({}, { R: 10, Ns: SMALL_NS, sweeps: ['S1', 'S2', 'S3'], budgetSec: 1, clock: steppingClock(400), ...NO_PROBE });
  assert.equal(r.guard.stopped, true);
  assert.ok(r.guard.stoppedAt, 'stoppedAt names the unit of work');
  assert.ok(r.skipped.length > 0, 'the settings after the stop are listed as skipped');
  assert.equal(r.skipped[0], r.guard.stoppedAt, 'the first skipped setting is where the guard stopped');
  assert.ok(r.rows.length >= 1 && r.rows.length + r.skipped.length === 11, 'every setting is either run or reported skipped');
});

test('the guard does not stop a run that fits its budget', () => {
  const r = runSensitivity({}, { R: 10, Ns: SMALL_NS, sweeps: ['S4'], budgetSec: 540, clock: steppingClock(1), ...NO_PROBE });
  assert.equal(r.guard.stopped, false);
  assert.equal(r.rows.length, 5);
});

test('coupling 0.3 and 0.7 are both run for S12, reported side by side, and they differ in the realised correlation', () => {
  const r = runSensitivity({}, { R: 60, Ns: SMALL_NS, sweeps: ['S12'], ...NO_PROBE });
  const c = (v) => r.rows.find((x) => x.sweep === 'S12' && x.value === v);
  assert.ok(c(0.3) && c(0.7), 'both coupling rows exist');
  assert.notEqual(c(0.3).settingLabel, c(0.7).settingLabel);
  assert.ok(c(0.7).rhoD > c(0.3).rhoD, `ρ_D at 0.7 (${c(0.7).rhoD}) above ρ_D at 0.3 (${c(0.3).rhoD})`);
  assert.ok(c(0.3).rhoD !== c(0.7).rhoD);
});

test('the stored coupling and sharedErrRisk are not used: S12 settings read the couplingToParams mapping', () => {
  const s = settingsOf().find((x) => x.sweep === 'S12' && x.value === 0.7);
  const p = paramsFor(s, {});
  assert.equal(p.rhoLatent, 0.9 * 0.7);
  assert.equal(p.copyShare, 0.7);
  assert.equal(p.sharedErrRisk, 0.7);
});

test('no setting uses an option that throws: bandRateUncertainty is never true and poolMethod is never outlier_weighted', () => {
  for (const s of settingsOf()) {
    assert.notEqual(s.overrides.bandRateUncertainty, true, `${s.sweep} ${s.label}`);
    assert.notEqual(s.overrides.poolMethod, 'outlier_weighted', `${s.sweep} ${s.label}`);
    // Every setting must resolve to a valid parameter object (a throw here would mean an unoffered option is needed).
    assert.doesNotThrow(() => paramsFor(s, {}), `${s.sweep} ${s.label}`);
  }
});

test('S9: the ACAPS reading as the perfect forecast cannot beat the truth, so its N80 is null with a plain reason', () => {
  const r = runSensitivity({}, { R: 40, Ns: SMALL_NS, sweeps: ['S9'], ...NO_PROBE });
  const perfect = r.rows.find((x) => x.value === 'perfect');
  assert.ok(perfect.gain < 0, `gain against the truth ${perfect.gain}`);
  assert.equal(perfect.cardsNeeded80, null);
  assert.match(perfect.cardsNeeded80Reason, /not above zero/);
});

test('the reproducibility: the same seed gives identical rows; a different seed changes them', () => {
  const run = (seed) => runSensitivity({}, { R: 12, Ns: SMALL_NS, sweeps: ['S3', 'S8'], seed, ...NO_PROBE }).rows;
  assert.deepEqual(run(20261107), run(20261107));
  assert.notDeepEqual(run(20261107).map((x) => x.gain), run(7).map((x) => x.gain));
});

test('--quick runs about one fifth of the replicates (quickReps), and the plan reports the requested count', () => {
  const r = runSensitivity({}, { R: 1000, quick: true, Ns: SMALL_NS, sweeps: ['S8'], ...NO_PROBE });
  assert.equal(r.plan.requestedR, quickReps(1000));
  assert.equal(r.plan.requestedR, 200);
  assert.ok(r.rows.every((x) => x.R === 200));
});

test('the custom risk stream reproduces the engine default when nothing is changed (the S9 stream cannot drift)', () => {
  const params = resolveParams({});
  const spec = { params, N: [40, 80], k: 8, endpoint: 'vs_acaps', tier: 'fast', cards: 'risk' };
  const dflt = estimatePower(spec, { R: 30, seed: 11 });
  const mine = estimatePower(spec, { R: 30, seed: 11, makeStream: makeRiskStream(params, { k: 8 }) });
  assert.deepEqual(mine.map((x) => [x.power, x.meanGain, x.sdDiff]), dflt.map((x) => [x.power, x.meanGain, x.sdDiff]));
});

test('the sweeps use the stored dropout concentration (dropoutKappa 10) for S7 and the floor for S11', () => {
  const s7 = settingsOf().filter((x) => x.sweep === 'S7');
  assert.equal(s7.length, 4);
  assert.ok(s7.every((x) => x.run.k === null), 'S7 is the dropout model, not a fixed k');
  assert.equal(paramsFor(s7[0], {}).dropoutKappa, 10);
  assert.deepEqual(SWEEP_NS, [28, 50, 104, 200, 300, 500]);
});

test('S7 reports the analysable share and the answers per card: more dropout, fewer cards reach the floor; at 49% response with κ = 10 about 82% reach 5', () => {
  const r = runSensitivity({}, { R: 12, Ns: SMALL_NS, sweeps: ['S7'], ...NO_PROBE });
  const share = (v) => r.rows.find((x) => x.value === v).analysableShare;
  assert.ok(share(0.3) > share(0.51) && share(0.51) > share(0.7) && share(0.7) > share(0.83), 'share falls as dropout rises');
  assert.ok(share(0.51) > 0.7 && share(0.51) < 0.9, `share at dropout 0.51 is ${share(0.51)}`);
  assert.ok(r.rows.every((x) => typeof x.meanAnswers === 'number' && x.meanAnswers >= 5), 'answers per analysable card are at least the floor');
});
