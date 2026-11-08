import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveParams } from '../src/params.js';
import { estimatePower } from '../src/power.js';
import { quickReps } from '../src/budget.js';
import { BANNER } from '../src/label.js';
import { makeRiskCards } from '../src/model.js';
import { makeRng } from '../src/rng.js';
import {
  runSensitivity, settingsOf, paramsFor, makeRiskStream, riskBaseParams, planSweep, SWEEP_NS, MIN_R, SAFETY_FACTOR,
} from '../src/sensitivity.js';

/** Cost stub: the timing probe is skipped so the plan does not depend on the machine. */
const NO_PROBE = { cost: () => 1 };
/** Tiny N grid for the count and label tests (the directions are checked in test/slow/). */
const SMALL_NS = [28, 50];

/** A fake clock that advances by `stepMs` on every read. */
function steppingClock(stepMs) {
  let t = 0;
  return () => {
    t += stepMs;
    return t;
  };
}

/** The default risk base rate in the model: count-weighted over the 99 rated risks (60 hits / 99). */
const DEFAULT_RATED_BASE = 60 / 99;

test('every sweep S1–S12 returns the expected number of rows (45 settings in all), and each row is labelled synthetic', () => {
  const expected = { S1: 4, S2: 4, S3: 3, S3b: 3, S4: 5, S4b: 3, S5: 4, S6: 4, S7: 4, S8: 2, S9: 3, S10: 2, S11: 2, S12: 2 };
  const r = runSensitivity({}, { R: 1, Ns: [28], ...NO_PROBE });
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

test('the budget guard stops the run past its limit and reports where it stopped; the rows before the stop are kept', () => {
  const r = runSensitivity({}, { R: 2, Ns: SMALL_NS, sweeps: ['S1', 'S2', 'S3'], budgetSec: 1, clock: steppingClock(400), ...NO_PROBE });
  assert.equal(r.guard.stopped, true);
  assert.ok(r.guard.stoppedAt, 'stoppedAt names the unit of work');
  assert.ok(r.skipped.length > 0, 'the settings after the stop are listed as skipped');
  assert.equal(r.skipped[0], r.guard.stoppedAt, 'the first skipped setting is where the guard stopped');
  assert.ok(r.rows.length >= 1 && r.rows.length + r.skipped.length === 11, 'every setting is either run or reported skipped');
});

test('the guard does not stop a run that fits its budget', () => {
  const r = runSensitivity({}, { R: 2, Ns: SMALL_NS, sweeps: ['S4'], budgetSec: 540, clock: steppingClock(1), ...NO_PROBE });
  assert.equal(r.guard.stopped, false);
  assert.equal(r.rows.length, 5);
});

test('planSweep: at the normal cost every setting gets the requested R, and the plan fits', () => {
  const ids = settingsOf().map((s) => `${s.sweep}:${s.value}`);
  const plan = planSweep(ids, ids.map(() => 1), { R0: 1000, budgetSec: 540 });
  assert.ok(ids.every((id) => plan.R[id] === 1000), 'all 45 settings at R = 1000');
  assert.equal(plan.scale, 1);
  assert.equal(plan.fits, true);
});

test('planSweep: the safety factor is applied to the probe cost (teeth: with no factor the same budget gives R = 750)', () => {
  // 45 settings at 16 ms per replicate: 45 × 1000 × 0.016 s = 720 s, times 1.5 = 1080 s, so a 540 s budget gives R = 500.
  const ids = settingsOf().map((s) => `${s.sweep}:${s.value}`);
  const costs = ids.map(() => 16);
  assert.equal(SAFETY_FACTOR, 1.5, 'the factor the test assumes');
  const planned = planSweep(ids, costs, { R0: 1000, budgetSec: 540 });
  assert.ok(ids.every((id) => planned.R[id] === 500), `R with the factor: ${planned.R[ids[0]]}`);
  assert.ok(planned.projectedSec <= 540 + 1e-9, 'the safety-scaled projection fits the budget');
  const unsafe = planSweep(ids, costs, { R0: 1000, budgetSec: 540, safety: 1 });
  assert.equal(unsafe.R[ids[0]], 750, 'without the factor the same budget would give 750, which the real run overshoots');
});

test('planSweep: when even MIN_R does not fit, every setting is held at MIN_R and the plan says it does not fit', () => {
  const ids = settingsOf().map((s) => `${s.sweep}:${s.value}`);
  const plan = planSweep(ids, ids.map(() => 1000), { R0: 1000, budgetSec: 1 });
  assert.ok(ids.every((id) => plan.R[id] === MIN_R), 'held at the floor');
  assert.equal(plan.fits, false);
});

test('planSweep: a measured slowdown (correction 2) lowers every R by the same factor', () => {
  // 45 settings at 8 ms: 45 × 1000 × 0.008 × 1.5 = 540 s, exactly the budget, so a correction of 2 halves R.
  const ids = settingsOf().map((s) => `${s.sweep}:${s.value}`);
  const costs = ids.map(() => 8);
  const base = planSweep(ids, costs, { R0: 1000, budgetSec: 540 });
  const slower = planSweep(ids, costs, { R0: 1000, budgetSec: 540, correction: 2 });
  assert.equal(base.R[ids[0]], 1000);
  assert.equal(slower.R[ids[0]], 500, 'the re-plan halves R');
  assert.ok(ids.every((id) => slower.R[id] === slower.R[ids[0]]), 'the same R for every setting');
});

test('a budget too small for the requested R scales every setting down by the same R and reports it on the plan', () => {
  // 5 settings at 1 ms per replicate, R0 = 200: planned 5 × 200 × 1.5 ms = 1.5 s. A 0.75 s budget gives scale 0.5, so R = 100.
  const r = runSensitivity({}, { R: 200, Ns: [28], sweeps: ['S4'], budgetSec: 0.75, clock: steppingClock(1), ...NO_PROBE });
  assert.equal(r.skipped.length, 0, 'nothing is skipped');
  assert.equal(r.rows.length, 5);
  // The clock ticks while the plan is made, so the budget left is a little under 0.75 s: R is 100, or 99 after the ticks.
  assert.ok(r.rows.every((x) => x.R === r.rows[0].R), 'every row at the same R');
  assert.ok(r.rows[0].R >= 97 && r.rows[0].R <= 100, `R ${r.rows[0].R}`);
  assert.equal(r.plan.R['S4:1'], r.rows[0].R);
  assert.ok(r.plan.scale < 1 && Math.abs(r.plan.scale - 0.5) < 0.02, `scale ${r.plan.scale}`);
  assert.deepEqual(r.plan.changes, [], 'the first plan was not revised: the machine kept to its probe');
});

test('coupling 0.3 and 0.7 are both run for S12, reported side by side (the directions are in the slow test)', () => {
  const r = runSensitivity({}, { R: 2, Ns: [28], sweeps: ['S12'], ...NO_PROBE });
  const c = (v) => r.rows.find((x) => x.sweep === 'S12' && x.value === v);
  assert.ok(c(0.3) && c(0.7), 'both coupling rows exist');
  assert.notEqual(c(0.3).settingLabel, c(0.7).settingLabel);
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
  const r = runSensitivity({}, { R: 40, Ns: [28], sweeps: ['S9'], ...NO_PROBE });
  const perfect = r.rows.find((x) => x.value === 'perfect');
  assert.ok(perfect.gain < 0, `gain against the truth ${perfect.gain}`);
  assert.equal(perfect.cardsNeeded80, null);
  assert.match(perfect.cardsNeeded80Reason, /not above zero/);
});

test('the reproducibility: the same seed gives identical rows; a different seed changes them', () => {
  const run = (seed) => runSensitivity({}, { R: 4, Ns: [28], sweeps: ['S3', 'S8'], seed, ...NO_PROBE }).rows;
  assert.deepEqual(run(20261107), run(20261107));
  assert.notDeepEqual(run(20261107).map((x) => x.gain), run(7).map((x) => x.gain));
});

test('--quick runs about one fifth of the replicates (quickReps), and the plan reports the requested count', () => {
  const r = runSensitivity({}, { R: 1000, quick: true, Ns: [28], sweeps: ['S8'], ...NO_PROBE });
  assert.equal(r.plan.requestedR, quickReps(1000));
  assert.equal(r.plan.requestedR, 200);
  assert.ok(r.rows.every((x) => x.R === 200));
});

test('the custom risk stream reproduces the engine default when nothing is changed (the S9 stream cannot drift)', () => {
  const params = resolveParams({});
  const spec = { params, N: [40, 80], k: 8, endpoint: 'vs_acaps', tier: 'fast', cards: 'risk' };
  const dflt = estimatePower(spec, { R: 10, seed: 11 });
  const mine = estimatePower(spec, { R: 10, seed: 11, makeStream: makeRiskStream(params, { k: 8 }) });
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
  const r = runSensitivity({}, { R: 2, Ns: [28], sweeps: ['S7'], ...NO_PROBE });
  const share = (v) => r.rows.find((x) => x.value === v).analysableShare;
  assert.ok(share(0.3) > share(0.51) && share(0.51) > share(0.7) && share(0.7) > share(0.83), 'share falls as dropout rises');
  assert.ok(share(0.51) > 0.7 && share(0.51) < 0.9, `share at dropout 0.51 is ${share(0.51)}`);
  assert.ok(r.rows.every((x) => typeof x.meanAnswers === 'number' && x.meanAnswers >= 5), 'answers per analysable card are at least the floor');
});

test('S5 is a risk base-rate sweep: four settings at 30, 45, 59 and 70%, on risk cards against ACAPS, with ACAPS midpoints fixed', () => {
  const s5 = settingsOf().filter((x) => x.sweep === 'S5');
  assert.deepEqual(s5.map((x) => x.value), [0.3, 0.45, 0.59, 0.7]);
  for (const s of s5) {
    assert.equal(s.run.endpoint, 'vs_acaps', 'compared with ACAPS, as the other risk-level sweeps');
    assert.equal(s.run.cards, 'risk', 'risk cards, not triggers');
    assert.equal(s.run.k, 8);
    assert.match(s.label, /ACAPS midpoints fixed/, 'the label says the midpoints do not move');
  }
});

test('riskBaseParams: a target equal to the default rated base rate leaves the band hits unchanged (the default run is not touched)', () => {
  const p = resolveParams({});
  const q = riskBaseParams(p, DEFAULT_RATED_BASE);
  assert.equal(q.bandHits.length, p.bandHits.length);
  q.bandHits.forEach((h, b) => assert.ok(Math.abs(h - p.bandHits[b]) < 1e-6, `band ${b}: ${h} vs ${p.bandHits[b]}`));
  // The default S5-free settings are not wrapped: paramsFor returns the resolved object itself.
  const plain = settingsOf().find((x) => x.sweep === 'S4');
  assert.equal(paramsFor(plain, {}).bandHits.length, 5);
  assert.deepEqual([...paramsFor(plain, {}).bandHits], [...p.bandHits]);
});

test('riskBaseParams: the simulated risks have the target base rate (mean latent probability, within 0.01)', () => {
  const p = resolveParams({});
  for (const target of [0.3, 0.7]) {
    const cards = makeRiskCards(riskBaseParams(p, target), makeRng(5), 20000);
    const meanPi = cards.reduce((s, c) => s + c.pi, 0) / cards.length;
    assert.ok(Math.abs(meanPi - target) < 0.01, `target ${target}: mean probability ${meanPi}`);
  }
});

test('riskBaseParams: a default-base run and the same run through riskBaseParams at the default base give the same power curve', () => {
  const p = resolveParams({});
  const spec = { N: [40, 80], k: 8, endpoint: 'vs_acaps', tier: 'fast', cards: 'risk' };
  const a = estimatePower({ ...spec, params: p }, { R: 20, seed: 3 });
  const b = estimatePower({ ...spec, params: riskBaseParams(p, DEFAULT_RATED_BASE) }, { R: 20, seed: 3 });
  assert.deepEqual(a.map((x) => x.power), b.map((x) => x.power));
  a.forEach((x, i) => assert.ok(Math.abs(x.meanGain - b[i].meanGain) < 1e-9, 'the gains agree to 1e-9'));
});

test('riskBaseParams refuses a target outside (0, 1), and refuses the shrinkage option (its rates would not be the measured ones)', () => {
  const p = resolveParams({});
  assert.throws(() => riskBaseParams(p, 1), RangeError);
  assert.throws(() => riskBaseParams(p, 0), RangeError);
  assert.throws(() => riskBaseParams(resolveParams({ shrinkM: 1 }), 0.5), RangeError);
});

test('the S5 settings resolve to a risk base rate: the band hits differ from the default at 30% and 70%', () => {
  const s5 = settingsOf().filter((x) => x.sweep === 'S5');
  const at = (v) => paramsFor(s5.find((x) => x.value === v), {}).bandHits;
  const def = resolveParams({}).bandHits;
  assert.ok(at(0.3).every((h, b) => h < def[b]), 'every band lower at 30%');
  assert.ok(at(0.7).every((h, b) => h > def[b]), 'every band higher at 70%');
});
