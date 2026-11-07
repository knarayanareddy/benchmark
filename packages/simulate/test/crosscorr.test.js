import { test } from 'node:test';
import assert from 'node:assert/strict';
import { wilson } from '@benchmark/core/stats';
import { makeRng } from '../src/rng.js';
import {
  aucRank,
  fisherN,
  fisherPower,
  impliedComparisons,
  logisticSlope,
  normalQuantile,
  simulateCorrPower,
  tCritical,
} from '../src/crosscorr.js';
import { bonferroniAlpha } from '../src/strata.js';

const NOISE = { sigma: 1.5, icc: 0.3, k: 8 };

/** Brute-force AUC: every positive-negative pair, ties count half. Independent of the rank code under test. */
function aucBrute(p, y) {
  let wins = 0;
  let pairs = 0;
  for (let i = 0; i < p.length; i++) {
    if (y[i] !== 1) continue;
    for (let j = 0; j < p.length; j++) {
      if (y[j] !== 0) continue;
      pairs++;
      if (p[i] > p[j]) wins += 1;
      else if (p[i] === p[j]) wins += 0.5;
    }
  }
  return pairs === 0 ? null : wins / pairs;
}

test('fisherN reproduces the docs/05 figures: 29 per stratum, 50 with the 1/15 correction', () => {
  assert.equal(fisherN(0.5, 0.05, 0.8), 29);
  assert.equal(fisherN(0.5, 0.05 / 15, 0.8), 50);
});

test('impliedComparisons: n = 50 at rho 0.5 and 80% power can afford about 14 comparisons, inside [13, 17]', () => {
  const m = impliedComparisons(50, 0.5, 0.05, 0.8);
  assert.ok(m >= 13 && m <= 17, `got ${m}`);
});

test('fisherPower matches an independent Monte Carlo of the Fisher z test on a grid', () => {
  const rng = makeRng(11);
  const R = 4000;
  const zc = normalQuantile(0.975);
  for (const n of [10, 20, 40]) {
    for (const rho of [0.2, 0.5]) {
      let hits = 0;
      for (let r = 0; r < R; r++) {
        const xs = [];
        const ys = [];
        for (let i = 0; i < n; i++) {
          const z1 = rng.normal();
          const z2 = rng.normal();
          xs.push(z1);
          ys.push(rho * z1 + Math.sqrt(1 - rho * rho) * z2);
        }
        const mx = xs.reduce((s, v) => s + v, 0) / n;
        const my = ys.reduce((s, v) => s + v, 0) / n;
        let sxy = 0;
        let sxx = 0;
        let syy = 0;
        for (let i = 0; i < n; i++) {
          sxy += (xs[i] - mx) * (ys[i] - my);
          sxx += (xs[i] - mx) ** 2;
          syy += (ys[i] - my) ** 2;
        }
        const sample = sxy / Math.sqrt(sxx * syy);
        if (Math.abs(Math.atanh(sample) * Math.sqrt(n - 3)) > zc) hits++;
      }
      const ci = wilson(hits, R);
      const halfWidth = (ci.hi - ci.lo) / 2;
      const closed = fisherPower(n, rho, 0.05);
      assert.ok(
        Math.abs(hits / R - closed) <= 3 * halfWidth,
        `n=${n} rho=${rho}: Monte Carlo ${hits / R} vs closed form ${closed}`,
      );
    }
  }
});

test('simulated exact-t power at n = 29, rho 0.5, no noise is within [0.77, 0.86]', () => {
  const { power } = simulateCorrPower({ n: 29, rho: 0.5, alpha: 0.05 }, { R: 4000, seed: 1 });
  assert.ok(power >= 0.77 && power <= 0.86, `got ${power}`);
});

test('type-I error at rho = 0 is within [0.035, 0.065]', () => {
  const { power } = simulateCorrPower({ n: 29, rho: 0, alpha: 0.05 }, { R: 4000, seed: 2 });
  assert.ok(power >= 0.035 && power <= 0.065, `got ${power}`);
});

test('the 1/15 multiple-comparison correction lowers power, and the division is what does it', () => {
  const at05 = simulateCorrPower({ n: 50, rho: 0.5, alpha: 0.05 }, { R: 3000, seed: 3 }).power;
  const at15 = simulateCorrPower({ n: 50, rho: 0.5, alpha: bonferroniAlpha(0.05, 15) }, { R: 3000, seed: 3 }).power;
  assert.ok(at15 < at05 - 0.05, `power at alpha/15 ${at15} should fall well below power at alpha ${at05}`);
  assert.equal(bonferroniAlpha(0.05, 15), 0.05 / 15);
});

test('with panel noise the observed correlation is rho times the reliability, within 0.03', () => {
  const rho = 0.6;
  const noise = { sigma: 1, icc: 0.3, k: 8 };
  const reliability = 1 / (1 + noise.sigma ** 2 * (noise.icc + (1 - noise.icc) / noise.k));
  const { meanObservedR } = simulateCorrPower({ n: 400, rho, alpha: 0.05, noise }, { R: 200, seed: 4 });
  assert.ok(Math.abs(meanObservedR - rho * reliability) < 0.03, `got ${meanObservedR}, expected ${rho * reliability}`);
});

test('a shared narrative error makes a true null look significant at n = 60 (spurious-correlation null)', () => {
  const null0 = simulateCorrPower({ n: 60, rho: 0, alpha: 0.05, noise: NOISE }, { R: 2000, seed: 5 }).power;
  const shared = simulateCorrPower({ n: 60, rho: 0, alpha: 0.05, rhoShared: 0.4, noise: NOISE }, { R: 2000, seed: 5 }).power;
  assert.ok(null0 >= 0.03 && null0 <= 0.07, `control type-I ${null0}`);
  assert.ok(shared > 0.15, `shared-error rejection ${shared}`);
});

test('tCritical(28, 0.05) is 2.0484 and tends to the normal quantile', () => {
  assert.ok(Math.abs(tCritical(28, 0.05) - 2.0484) < 0.001, `got ${tCritical(28, 0.05)}`);
  assert.ok(Math.abs(tCritical(1e5, 0.05) - normalQuantile(0.975)) < 0.001);
});

test('aucRank equals the brute-force pair count on 20 random datasets, with ties', () => {
  const rng = makeRng(21);
  for (let d = 0; d < 20; d++) {
    const n = 5 + rng.int(60);
    const p = [];
    const y = [];
    for (let i = 0; i < n; i++) {
      p.push(Math.round(rng.next() * 10) / 10);
      y.push(rng.bernoulli(0.4));
    }
    const fast = aucRank(p, y);
    const brute = aucBrute(p, y);
    if (brute === null) assert.equal(fast, null);
    else assert.ok(Math.abs(fast - brute) < 1e-12, `dataset ${d}: rank ${fast} vs brute ${brute}`);
  }
});

test('aucRank on all-tied forecasts is exactly one half, and is null with one outcome class', () => {
  assert.equal(aucRank([0.5, 0.5, 0.5, 0.5], [1, 0, 1, 0]), 0.5);
  assert.equal(aucRank([0.2, 0.7], [1, 1]), null);
});

test('logisticSlope recovers a planted slope 0.7 (sign included) within 0.03 at N = 20,000', () => {
  const rng = makeRng(31);
  const p = [];
  const y = [];
  for (let i = 0; i < 20000; i++) {
    const pi = 0.05 + 0.9 * rng.next();
    const eta = Math.log(pi / (1 - pi));
    const prob = 1 / (1 + Math.exp(-(0.7 * eta)));
    p.push(pi);
    y.push(rng.next() < prob ? 1 : 0);
  }
  const fit = logisticSlope(p, y);
  assert.equal(fit.converged, true);
  assert.ok(Math.abs(fit.b - 0.7) < 0.03, `slope ${fit.b}`);
  assert.ok(fit.b > 0, 'a positive planted slope must not come back negative');
});

test('logisticSlope reports non-convergence on perfect separation', () => {
  const p = [0.1, 0.2, 0.3, 0.4, 0.6, 0.7, 0.8, 0.9];
  const y = [0, 0, 0, 0, 1, 1, 1, 1];
  const fit = logisticSlope(p, y);
  assert.equal(fit.converged, false);
  assert.equal(fit.b, null);
});

test('simulateCorrPower rejects impossible specifications', () => {
  assert.throws(() => simulateCorrPower({ n: 3, rho: 0.5, alpha: 0.05 }, { R: 10, seed: 1 }), RangeError);
  assert.throws(() => simulateCorrPower({ n: 10, rho: 1, alpha: 0.05 }, { R: 10, seed: 1 }), RangeError);
  assert.throws(() => simulateCorrPower({ n: 10, rho: 0.5, alpha: 0.05 }, { R: 0, seed: 1 }), RangeError);
});
