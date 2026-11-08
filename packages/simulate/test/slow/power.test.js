// Slow Monte Carlo cases moved out of the fast test folder so `npm test` stays quick. Run them with `npm run test:slow`. Assertions are unchanged.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveParams } from '../../src/params.js';
import { normalCdf, zCritical } from '../../src/endpoint.js';
import { estimatePower, ciHalfWidth, runAbsoluteGrid, runVsAcapsGrid } from '../../src/power.js';

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

