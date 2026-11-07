import test from 'node:test';
import assert from 'node:assert/strict';
import { wilson, cohenKappa } from '@benchmark/core/stats';
import { evaluateObservable } from '@benchmark/core/gate';
import fs from 'node:fs';

const close = (a, b, eps = 1e-3) => assert.ok(Math.abs(a - b) < eps, `${a} vs ${b}`);

test('wilson interval matches published values and never leaves [0, 1]', () => {
  // Reference values for the Wilson score interval (95%).
  const a = wilson(25, 29);
  close(a.lo, 0.6944); close(a.hi, 0.9450);
  const b = wilson(0, 10);
  assert.equal(b.lo, 0);
  close(b.hi, 0.2775);
  const c = wilson(10, 10);
  close(c.hi, 1, 1e-9);
  close(c.lo, 0.7225);
  assert.equal(wilson(0, 0), null);
  assert.throws(() => wilson(5, 3), RangeError);
  assert.throws(() => wilson(-1, 3), RangeError);
});

test('wilson narrows as n grows, which is why n=50 cannot carry a headline', () => {
  const w50 = wilson(43, 50); const w500 = wilson(430, 500);
  assert.ok(w500.hi - w500.lo < (w50.hi - w50.lo) / 2);
});

test('cohen kappa: perfect, chance-level and in-between agreement', () => {
  const x = ['y', 'y', 'n', 'n', 'y', 'n'];
  assert.equal(cohenKappa(x, x).kappa, 1);
  close(cohenKappa(['y', 'y', 'n', 'n'], ['y', 'n', 'y', 'n']).kappa, 0);
  const mid = cohenKappa(['y', 'y', 'y', 'n', 'n', 'n', 'y', 'n'], ['y', 'y', 'n', 'n', 'n', 'n', 'y', 'y']);
  assert.ok(mid.kappa > 0 && mid.kappa < 1);
  assert.equal(cohenKappa(['y', 'y'], ['y', 'y']), null, 'kappa is undefined when there is no variation');
  assert.throws(() => cohenKappa(['a'], ['a', 'b']), TypeError);
});

test('the observable check is reported with intervals, not a bare 86%', () => {
  const labelled = JSON.parse(fs.readFileSync(new URL('./fixtures/observable-labelled-50.json', import.meta.url), 'utf8'));
  const r = evaluateObservable(labelled);
  assert.equal(r.n, 50);
  close(r.warnPrecision, 25 / 29);
  assert.ok(r.warnPrecisionCI.lo < r.warnPrecision && r.warnPrecision < r.warnPrecisionCI.hi);
  assert.ok(r.warnPrecisionCI.hi - r.warnPrecisionCI.lo > 0.2, 'at n=50 the interval is wide');
  assert.ok(r.falseWarnRateCI.hi > 0.4, 'the false-warn rate could plausibly be near half');
});
