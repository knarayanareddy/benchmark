import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveParams } from '../src/params.js';
import { normalCdf, zCritical } from '../src/endpoint.js';
import { estimatePower, powerWithError, ciHalfWidth, matchedNeff, n80, runAbsoluteGrid, runVsAcapsGrid } from '../src/power.js';
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

/**
 * Stream of gains in triples that share a component: within-triple correlation rho, marginal N(δ, sd²). The triple is
 * the cluster (a risk with three triggers).
 * @param {number} delta @param {number} sd @param {number} rho
 */
function tripleGainStream(delta, sd, rho) {
  return (rng) => {
    let i = 0;
    let shared = 0;
    return {
      next() {
        if (i % 3 === 0) shared = rng.normal();
        i += 1;
        const g = delta + sd * (Math.sqrt(rho) * shared + Math.sqrt(1 - rho) * rng.normal());
        return recordFromGain(g, i, Math.floor((i - 1) / 3));
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

test('size: with δ = 0 the two-sided rejection rate at N = 104 is in [0.035, 0.07] (fast z-decision, R = 4,000)', () => {
  const [row] = estimatePower(
    { params, N: 104, endpoint: 'vs_acaps', tier: 'fast' },
    { R: 4000, seed: 11, makeStream: iidGainStream(0, 0.18) }
  );
  const rejection = row.power + row.worse;
  assert.ok(rejection >= 0.035 && rejection <= 0.07, `size ${rejection}`);
  // Each tail alone is about 0.025; a one-sided rule would put all of it in one tail.
  assert.ok(row.power > 0.012 && row.power < 0.04, `upper tail ${row.power}`);
  assert.ok(row.worse > 0.012 && row.worse < 0.04, `lower tail ${row.worse}`);
});

test('known answer: power at N = 104, δ = 0.03, σ = 0.18 is Φ(δ√N/σ − z) ≈ 0.40 within 3 Wilson half-widths', () => {
  const [row] = estimatePower(
    { params, N: 104, endpoint: 'vs_acaps', tier: 'fast' },
    { R: 4000, seed: 12, makeStream: iidGainStream(0.03, 0.18) }
  );
  const expected = normalCdf((0.03 * Math.sqrt(104)) / 0.18 - zCritical(0.05));
  assert.ok(Math.abs(expected - 0.397) < 0.002, `reference ${expected}`);
  assert.ok(Math.abs(row.power - expected) < 3 * row.halfWidth, `power ${row.power} vs ${expected} ± ${row.halfWidth}`);
});

test('power is non-decreasing in N and in δ on a small grid (tolerance: two Wilson half-widths)', () => {
  const Ns = [40, 80, 160, 320];
  const byN = estimatePower({ params, N: Ns, endpoint: 'vs_acaps', tier: 'fast' }, { R: 2000, seed: 21, makeStream: iidGainStream(0.03, 0.18) });
  for (let i = 1; i < byN.length; i++) {
    assert.ok(byN[i].power >= byN[i - 1].power - 2 * byN[i].halfWidth, `N ${byN[i - 1].N} → ${byN[i].N}`);
  }
  const deltas = [0, 0.01, 0.03, 0.05];
  const byDelta = deltas.map((d) =>
    estimatePower({ params, N: 104, endpoint: 'vs_acaps', tier: 'fast' }, { R: 2000, seed: 22, makeStream: iidGainStream(d, 0.18) })[0]
  );
  for (let i = 1; i < byDelta.length; i++) {
    assert.ok(byDelta[i].power >= byDelta[i - 1].power - 2 * byDelta[i].halfWidth, `δ ${deltas[i - 1]} → ${deltas[i]}`);
  }
});

test('a nested design has less power than the naive z-test; with independent triples the two agree', () => {
  const nestedNaive = estimatePower({ params, N: 102, endpoint: 'vs_acaps', tier: 'fast' }, { R: 2000, seed: 31, makeStream: tripleGainStream(0.03, 0.18, 0.5) })[0];
  const nestedCluster = estimatePower({ params, N: 102, endpoint: 'vs_acaps', tier: 'cluster' }, { R: 2000, seed: 31, makeStream: tripleGainStream(0.03, 0.18, 0.5) })[0];
  assert.ok(nestedCluster.power < nestedNaive.power - 0.08, `cluster ${nestedCluster.power} vs naive ${nestedNaive.power}`);
  assert.ok(nestedCluster.rhoD > 0.3, `realised ρ_D ${nestedCluster.rhoD}`);

  const iidNaive = estimatePower({ params, N: 102, endpoint: 'vs_acaps', tier: 'fast' }, { R: 2000, seed: 32, makeStream: tripleGainStream(0.03, 0.18, 0) })[0];
  const iidCluster = estimatePower({ params, N: 102, endpoint: 'vs_acaps', tier: 'cluster' }, { R: 2000, seed: 32, makeStream: tripleGainStream(0.03, 0.18, 0) })[0];
  assert.ok(Math.abs(iidCluster.power - iidNaive.power) < 3 * (iidNaive.halfWidth + iidCluster.halfWidth), `iid ${iidCluster.power} vs ${iidNaive.power}`);
});

test('the prefix property: N = 50 alone equals the N = 50 entry of a run at [50, 104] with the same seed, on the real model (to 1e-12)', () => {
  const alone = estimatePower({ params, N: 50, endpoint: 'absolute', tier: 'fast', cards: 'risk' }, { R: 20, seed: 41 })[0];
  const both = estimatePower({ params, N: [50, 104], endpoint: 'absolute', tier: 'fast', cards: 'risk' }, { R: 20, seed: 41 })[0];
  assert.ok(Math.abs(alone.power - both.power) < 1e-12);
  assert.ok(Math.abs(alone.meanGain - both.meanGain) < 1e-12);
  assert.ok(Math.abs(alone.sdDiff - both.sdDiff) < 1e-12);
});

test('the real-model power engine runs for both endpoints and both card kinds, with error bars', () => {
  const risk = estimatePower({ params, N: 40, endpoint: 'vs_acaps', tier: 'fast', cards: 'risk' }, { R: 100, seed: 51 })[0];
  assert.ok(risk.power >= 0 && risk.power <= 1 && risk.lo <= risk.power && risk.power <= risk.hi);
  assert.equal(risk.nAnalysed, 40);
  const trig = estimatePower({ params: resolveParams({ sigma: 2.36 }), N: 40, k: 8, endpoint: 'absolute', tier: 'cluster', cards: 'trigger' }, { R: 60, seed: 52 })[0];
  assert.ok(trig.power >= 0 && trig.power <= 1);
  assert.ok(trig.clusters > 1 && trig.clusters <= 40);
});

test('ciHalfWidth on the real paired() returns the median 95% half-width and the power per N', () => {
  const rows = ciHalfWidth({ params, scenario: 'ci-test' }, [28, 40], { R: 20, seed: 61 });
  assert.equal(rows.length, 2);
  for (const r of rows) {
    assert.ok(r.medianHalfWidth > 0.02 && r.medianHalfWidth < 0.2, `half-width ${r.medianHalfWidth}`);
    assert.ok(r.p25 <= r.medianHalfWidth && r.medianHalfWidth <= r.p75);
  }
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

test('the absolute grid reports the nested columns; the formula N_eff is below N; the vs-ACAPS grid reports its rows', () => {
  // R = 60 is a smoke size: at this count the nested and naive decisions can tie, so the power-level claim is tested
  // above at R = 2,000 rather than here.
  const base = resolveParams({});
  const rows = runAbsoluteGrid(base, { gains: [0.03], ks: [8], Ns: [40, 80], couplings: [0.7] }, {
    R: 60,
    seed: 91,
    sigmaFor: () => 2.36,
  });
  assert.equal(rows.length, 2);
  for (const r of rows) {
    assert.equal(r.coupling, 0.7);
    assert.ok(r.rho_D > 0.1, `ρ_D ${r.rho_D}`);
    assert.ok(r.neff_formula < r.N, `formula N_eff ${r.neff_formula} vs N ${r.N}`);
    assert.ok(r.neff_power_matched === null || typeof r.neff_power_matched === 'number');
    assert.ok(r.lo <= r.power_cluster && r.power_cluster <= r.hi);
  }
  const vs = runVsAcapsGrid(base, { gains: [0.03], ks: [8], Ns: [40] }, { R: 40, seed: 92, sigmaFor: () => 1.53 });
  assert.equal(vs.length, 1);
  assert.equal(vs[0].N, 40);
  assert.ok(vs[0].power >= 0 && vs[0].power <= 1);
});

test('the seed of each replicate is a fixed function of the master seed and the replicate (same seed, same result)', () => {
  const a = estimatePower({ params, N: 30, endpoint: 'vs_acaps', tier: 'fast' }, { R: 50, seed: 77, makeStream: iidGainStream(0.02, 0.18) })[0];
  const b = estimatePower({ params, N: 30, endpoint: 'vs_acaps', tier: 'fast' }, { R: 50, seed: 77, makeStream: iidGainStream(0.02, 0.18) })[0];
  assert.deepEqual(a, b);
  const c = estimatePower({ params, N: 30, endpoint: 'vs_acaps', tier: 'fast' }, { R: 50, seed: 78, makeStream: iidGainStream(0.02, 0.18) })[0];
  assert.notEqual(a.power, c.power, 'a different master seed gives a different stream');
});

test('auc is opt-in: off it is null and changes no other output; on, the grid column is a ranking AUC in (0.5, 1)', () => {
  const spec = { params, N: [40, 80], k: 8, endpoint: 'vs_acaps', tier: 'fast', cards: 'risk' };
  const off = estimatePower(spec, { R: 60, seed: 5 });
  const on = estimatePower(spec, { R: 60, seed: 5, auc: true });
  assert.ok(off.every((r) => r.auc === null));
  for (let i = 0; i < off.length; i++) {
    const { auc: _a, ...rest } = on[i];
    const { auc: _b, ...restOff } = off[i];
    assert.deepEqual(rest, restOff, 'turning auc on must not change power, gain or error bars');
    assert.ok(on[i].auc > 0.5 && on[i].auc < 1, `auc ${on[i].auc}`);
  }
  const rows = runAbsoluteGrid(params, { gains: [0.03], ks: [8], Ns: [60], couplings: [0] }, { R: 40, seed: 3, sigmaFor: () => 2.36 });
  assert.equal(rows.length, 1);
  assert.ok(typeof rows[0].auc === 'number' && rows[0].auc > 0.5 && rows[0].auc < 1, `grid auc ${rows[0].auc}`);
});
