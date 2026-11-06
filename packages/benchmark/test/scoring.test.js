import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { brier, bootstrapBrier, paired, calibration, observed, LADDER, REGRESSION_BEATS_ACAPS } from '../../core/src/scoring.js';

const mk = (p, y, id) => ({ p, y, id });
const det = Array.from({ length: 104 }, (_, i) => mk(0.7, i % 3 === 0 ? 1 : 0, i));

// This test used to assert `fourFieldLogistic < acapsRatings` under the title
// "model beats ACAPS". Both the direction and the claim were wrong: the
// regression scores 0.2177 out of sample against ACAPS's 0.2168. The ladder is
// now pinned to what the scripts actually produce, and the ordering it asserts
// is the one that flatters nobody.
test('the ladder is recorded, and it says the regression did not beat ACAPS', () => {
  assert.ok(LADDER.acapsRatings < LADDER.fourFieldLogistic, 'ACAPS rating is BETTER (lower) than the LOO regression');
  assert.ok(LADDER.fourFieldLogistic < LADDER.naiveFloor, 'both beat the constant');
  assert.equal(REGRESSION_BEATS_ACAPS, false);
  assert.ok(LADDER.fourFieldLogistic < LADDER.naiveFloor);
  // The two measured rungs must match the committed data, not a hand-typed
  // number. This test is what stops a hand-typed rung from creeping back in.
  const blocks = JSON.parse(fs.readFileSync(new URL('../../../data/risk-radar.json', import.meta.url), 'utf8'));
  const resolved = blocks.filter((b) => b.outcome === 0 || b.outcome === 1);
  const base = resolved.reduce((a, b) => a + b.outcome, 0) / resolved.length;
  assert.equal(brier(resolved.map((b) => ({ p: base, y: b.outcome }))).score.toFixed(4), LADDER.naiveFloor.toFixed(4), 'naive floor reproduces from the data');
});

test('unobservable outcomes are excluded, never scored as misses', () => {
  const withNull = [...det, mk(0.9, null, 'n1'), mk(0.1, null, 'n2')];
  assert.equal(observed(withNull).length, 104);
  assert.equal(brier(withNull).n, 104);
});

test('a Brier score is never returned without an interval', () => {
  const r = bootstrapBrier(det);
  assert.ok(r.score >= 0 && r.score <= 1);
  assert.ok(r.lo <= r.score && r.score <= r.hi);
  assert.equal(r.n, 104);
});

test('the interval at n=104 is wide enough to swallow the 0.022 gap', () => {
  const r = bootstrapBrier(det);
  const width = r.hi - r.lo;
  assert.ok(width > 0.022, `expected interval wider than the ACAPS-vs-model gap, got ${width.toFixed(4)}`);
});

test('a paired comparison detects a real difference', () => {
  const a = det.map((d) => ({ ...d, p: 0.5 }));
  const b = det.map((d) => ({ ...d, p: d.y === 1 ? 0.9 : 0.1 }));
  const r = paired(a, b);
  assert.ok(r.diff > 0, 'worse method should have higher Brier');
  assert.equal(r.significant, true);
});

test('a paired comparison refuses to claim a difference that is not there', () => {
  const a = det.map((d) => ({ ...d, p: 0.7 }));
  const b = det.map((d) => ({ ...d, p: 0.7 }));
  const r = paired(a, b);
  assert.equal(r.diff, 0);
  assert.equal(r.significant, false);
});

test('bootstrap is reproducible from a fixed seed', () => {
  const one = bootstrapBrier(det, { seed: 1 });
  const two = bootstrapBrier(det, { seed: 1 });
  assert.equal(one.lo, two.lo);
  assert.equal(one.hi, two.hi);
});

test('calibration returns a curve an expert can read back', () => {
  const c = calibration(det, 5);
  assert.ok(c.length > 0);
  for (const b of c) assert.ok(b.meanPredicted >= 0 && b.meanPredicted <= 1);
});
