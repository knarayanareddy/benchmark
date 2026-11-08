import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveParams } from '../src/params.js';
import { normalCdf } from '../src/endpoint.js';
import { estimatePower, powerWithError, matchedNeff, n80 } from '../src/power.js';
import { planReps, quickReps, makeGuard } from '../src/budget.js';

const params = resolveParams({});

/**
 * A scored record whose vs-ACAPS gain is exactly g: comparator a = 0 and y chosen by the sign of g.
 * gain = (a − y)² − (p − y)² = g.
 */
function recordFromGain(g, id, cluster) {
  const y = g >= 0 ? 1 : 0;
  const p = y === 1 ? 1 - Math.sqrt(1 - g) : Math.sqrt(-g);
  return { id: `T${id}`, cluster, p, y, a: 0 };
}

/**
 * Stream of i.i.d. gains N(δ, sd²): the known-answer injection. Each card is its own cluster.
 * @param {number} delta @param {number} sd
 */
function iidGainStream(delta, sd) {
  return (rng) => {
    let i = 0;
    return {
      next() {
        i += 1;
        return recordFromGain(delta + sd * rng.normal(), i, i);
      },
    };
  };
}

test('the Monte Carlo error bar is the Wilson half-width: ≈ 1.96·√(p(1−p)/R), and it shrinks like 1/√R', () => {
  for (const [k, R] of [[2000, 4000], [800, 4000]]) {
    const { power, halfWidth } = powerWithError(k, R);
    const wald = 1.96 * Math.sqrt((power * (1 - power)) / R);
    assert.ok(Math.abs(halfWidth / wald - 1) < 0.05, `halfWidth ${halfWidth} vs Wald ${wald}`);
  }
  const small = powerWithError(250, 500).halfWidth;
  const large = powerWithError(1000, 2000).halfWidth;
  assert.ok(Math.abs(small / large - 2) < 0.1, `ratio ${small / large} should be 2`);
});

test('the prefix property: N = 50 alone equals the N = 50 entry of a run at [50, 104] with the same seed, on the real model (to 1e-12)', () => {
  const alone = estimatePower({ params, N: 50, endpoint: 'absolute', tier: 'fast', cards: 'risk' }, { R: 20, seed: 41 })[0];
  const both = estimatePower({ params, N: [50, 104], endpoint: 'absolute', tier: 'fast', cards: 'risk' }, { R: 20, seed: 41 })[0];
  assert.ok(Math.abs(alone.power - both.power) < 1e-12);
  assert.ok(Math.abs(alone.meanGain - both.meanGain) < 1e-12);
  assert.ok(Math.abs(alone.sdDiff - both.sdDiff) < 1e-12);
});

test('n80 interpolates the 0.8 crossing and is censored outside the grid', () => {
  const r = n80([{ N: 100, power: 0.6 }, { N: 200, power: 0.9 }]);
  assert.ok(Math.abs(r.n80 - (100 + (0.2 / 0.3) * 100)) < 1e-9);
  assert.equal(r.censored, false);
  const never = n80([{ N: 100, power: 0.3 }, { N: 200, power: 0.7 }]);
  assert.equal(never.n80, null);
  assert.equal(never.censored, true);
  const withBounds = n80([{ N: 100, power: 0.6, lo: 0.5, hi: 0.7 }, { N: 200, power: 0.9, lo: 0.8, hi: 0.95 }]);
  assert.ok(withBounds.lo < withBounds.n80 && withBounds.n80 < withBounds.hi);
});

test('matchedNeff recovers a planted ratio: nested power at N = 150 equals iid power at 100, so N_eff = 100 and the ratio is 1.5', () => {
  const iid = [];
  for (let N = 1; N <= 400; N++) iid.push({ N, power: normalCdf((0.03 * Math.sqrt(N)) / 0.18 - 1.96) });
  const nestedPower = normalCdf((0.03 * Math.sqrt(100)) / 0.18 - 1.96);
  const neff = matchedNeff(iid, nestedPower);
  assert.ok(Math.abs(neff - 100) < 0.5, `N_eff ${neff}`);
  assert.ok(Math.abs(150 / neff - 1.5) < 0.01);
});

test('planReps: never below the floor, never above the request, monotone in the budget, and reports when it cannot fit', () => {
  const sections = [
    { id: 'grid', costMsPerRep: 3, R: 2000 },
    { id: 'sens', costMsPerRep: 10, R: 1000 },
  ];
  const big = planReps(sections, 10000);
  assert.equal(big.scale, 1);
  assert.deepEqual(big.R, { grid: 2000, sens: 1000 });
  let last = null;
  for (const budget of [60, 120, 240, 480]) {
    const plan = planReps(sections, budget);
    assert.ok(plan.R.grid >= 300 && plan.R.sens >= 300, JSON.stringify(plan.R));
    assert.ok(plan.R.grid <= 2000 && plan.R.sens <= 1000);
    if (last) {
      assert.ok(plan.R.grid >= last.R.grid && plan.R.sens >= last.R.sens, 'monotone in budget');
    }
    last = plan;
  }
  const tight = planReps(sections, 1);
  assert.equal(tight.fits, false);
  assert.equal(tight.R.grid, 300);
  assert.equal(quickReps(2000), 400);
  assert.equal(quickReps(1), 1);
});

test('the budget guard stops a run past its limit and reports where it stopped', () => {
  let nowMs = 0;
  const guard = makeGuard({ budgetSec: 10, clock: () => nowMs });
  nowMs = 9000;
  assert.equal(guard.shouldStop('section A'), false);
  nowMs = 10500;
  assert.equal(guard.shouldStop('section B'), true);
  assert.equal(guard.shouldStop('section C'), true, 'stays stopped');
  const report = guard.report();
  assert.equal(report.stopped, true);
  assert.equal(report.stoppedAt, 'section B');
  assert.ok(Math.abs(report.elapsedSec - 10.5) < 1e-9);
  assert.equal(report.budgetSec, 10);
});

test('the seed of each replicate is a fixed function of the master seed and the replicate (same seed, same result)', () => {
  const a = estimatePower({ params, N: 30, endpoint: 'vs_acaps', tier: 'fast' }, { R: 50, seed: 77, makeStream: iidGainStream(0.02, 0.18) })[0];
  const b = estimatePower({ params, N: 30, endpoint: 'vs_acaps', tier: 'fast' }, { R: 50, seed: 77, makeStream: iidGainStream(0.02, 0.18) })[0];
  assert.deepEqual(a, b);
  const c = estimatePower({ params, N: 30, endpoint: 'vs_acaps', tier: 'fast' }, { R: 50, seed: 78, makeStream: iidGainStream(0.02, 0.18) })[0];
  assert.notEqual(a.power, c.power, 'a different master seed gives a different stream');
});

