import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveParams } from '../src/params.js';
import { makeRng } from '../src/rng.js';
import { muForBase } from '../src/data.js';
import { cardSharedError } from '../src/model.js';
import { couplingToParams, riskOfTriggers, makeTriggerCards } from '../src/triggers.js';
import { assertNotSynthetic } from '../src/label.js';

/** Settings outside the registered ranges (rho_lat 0 and 0.81 at the coupling dial) are built on a plain copy. */
const withOverrides = (over) => ({ ...resolveParams(), ...over });

const mean = (xs) => xs.reduce((s, x) => s + x, 0) / xs.length;

const variance = (xs) => {
  const m = mean(xs);
  return xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1);
};

const correlation = (xs, ys) => {
  const mx = mean(xs);
  const my = mean(ys);
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < xs.length; i++) {
    sxy += (xs[i] - mx) * (ys[i] - my);
    sxx += (xs[i] - mx) ** 2;
    syy += (ys[i] - my) ** 2;
  }
  return sxy / Math.sqrt(sxx * syy);
};

test('couplingToParams: the §A.6 mapping, rho_lat = 0.9c, copyShare = c, sharedErrRisk = max(0.3, c); outside [0, 1] throws', () => {
  assert.deepEqual(couplingToParams(0), { rhoLatent: 0, copyShare: 0, sharedErrRisk: 0.3 });
  const c7 = couplingToParams(0.7);
  assert.ok(Math.abs(c7.rhoLatent - 0.63) < 1e-12);
  assert.equal(c7.copyShare, 0.7);
  assert.equal(c7.sharedErrRisk, 0.7);
  assert.ok(Math.abs(couplingToParams(1).rhoLatent - 0.9) < 1e-12);
  assert.throws(() => couplingToParams(1.2));
  assert.throws(() => couplingToParams(-0.1));
});

test('trigger latent: marginal mean is mu_t and standard deviation is triggerSpread, with mu_t reproducing triggerBase', () => {
  const P = resolveParams();
  const triggers = makeTriggerCards(P, makeRng(311).fork('triggers'), 20000);
  const Ls = triggers.map((t) => t.L);
  assert.ok(Math.abs(mean(Ls) - muForBase(P.triggerBase, P.triggerSpread)) < 0.02, 'mean');
  assert.ok(Math.abs(variance(Ls) / P.triggerSpread ** 2 - 1) < 0.02, 'variance');
});

test('within a risk, trigger latents correlate at rho_lat (0.3 by default), within 0.02', () => {
  const P = resolveParams();
  const groups = riskOfTriggers(P, makeRng(321), 20000);
  const a = [];
  const b = [];
  for (const g of groups) {
    if (g.triggers.length >= 2) {
      a.push(g.triggers[0].L);
      b.push(g.triggers[1].L);
    }
  }
  assert.ok(a.length > 5000, 'enough pairs');
  assert.ok(Math.abs(correlation(a, b) - P.rhoLatent) < 0.02, `within-risk correlation ${correlation(a, b)}`);
});

test('with rho_lat = 0 a trigger latent is uncorrelated with its risk latent (within 0.02)', () => {
  // rho_lat 0 is outside the registered range (0.1 to 0.8); it is set on a plain copy.
  const P = withOverrides({ rhoLatent: 0 });
  const groups = riskOfTriggers(P, makeRng(331), 20000);
  const Lt = [];
  const Lr = [];
  for (const g of groups) {
    for (const t of g.triggers) {
      Lt.push(t.L);
      Lr.push(g.risk.L);
    }
  }
  assert.ok(Math.abs(correlation(Lt, Lr)) < 0.02, `correlation ${correlation(Lt, Lr)}`);
});

test('copyShare decides only the outcomes: trigger latents and ids are identical at copyShare 0 and 0.5 with the same seed', () => {
  const at = (copyShare) => makeTriggerCards(withOverrides({ copyShare }), makeRng(341).fork('triggers'), 2000);
  const plain = at(0);
  const copied = at(0.5);
  assert.equal(plain.length, copied.length);
  assert.deepEqual(copied.map((t) => t.L), plain.map((t) => t.L));
  assert.deepEqual(copied.map((t) => t.id), plain.map((t) => t.id));
  assert.ok(copied.some((t, i) => t.y !== plain[i].y), 'some outcomes should change');
});

test('copyShare 1: every trigger of a risk takes the risk\'s trigger-scale outcome, so they all agree', () => {
  const groups = riskOfTriggers(withOverrides({ copyShare: 1 }), makeRng(351), 3000);
  const multi = groups.filter((g) => g.triggers.length >= 2);
  assert.ok(multi.length > 1000);
  for (const g of multi) {
    const ys = new Set(g.triggers.map((t) => t.y));
    assert.equal(ys.size, 1, `risk ${g.risk.id} triggers disagree`);
  }
});

test('shared panel error: triggers of one risk share sharedErrRisk of their error correlation, and total variance is icc x sigma^2', () => {
  // sigma 1.53 and icc 0.4 are in range; sharedErrRisk 0.5 is too (it is a share, 0 to 1).
  const P = withOverrides({ sharedErrRisk: 0.5, icc: 0.4, sigma: 1.53 });
  const rng = makeRng(361);
  const N = 30000;
  const u1 = [];
  const u2 = [];
  for (let g = 0; g < N; g++) {
    const riskShared = rng.normal();
    u1.push(cardSharedError(P, rng, riskShared));
    u2.push(cardSharedError(P, rng, riskShared));
  }
  assert.ok(Math.abs(correlation(u1, u2) - 0.5) < 0.02, `correlation ${correlation(u1, u2)}`);
  const total = variance(u1.concat(u2));
  assert.ok(Math.abs(total / (P.icc * 1.53 ** 2) - 1) < 0.02, `total variance ${total}`);
});

test('trigger cards carry SIM-T ids, their parent risk id, no ACAPS reading, and are flagged synthetic', () => {
  const groups = riskOfTriggers(resolveParams(), makeRng(371), 50);
  const first = groups[0];
  assert.equal(first.risk.id, 'SIM-000001');
  assert.equal(first.risk.kind, 'risk');
  for (const t of groups.flatMap((g) => g.triggers)) {
    assert.match(t.id, /^SIM-T\d{6}$/);
    assert.equal(t.kind, 'trigger');
    assert.equal(t.synthetic, true);
    assert.ok(Number.isNaN(t.a), 'triggers have no ACAPS reading');
  }
  assert.throws(() => assertNotSynthetic(first.triggers[0]));
});

