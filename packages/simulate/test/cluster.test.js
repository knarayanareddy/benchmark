import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeRng } from '../src/rng.js';
import {
  clusterBootstrapMean,
  clusterRobustSe,
  crCritical,
  iccOfScores,
  designEffect,
  effectiveN,
} from '../src/cluster.js';

/** Cluster sizes 1..4, drawn from the stream, and one id per card. */
function clusterSizes(rng, G) {
  const ids = [];
  for (let g = 0; g < G; g++) {
    const m = 1 + rng.int(4);
    for (let j = 0; j < m; j++) ids.push(g);
  }
  return ids;
}

test('iccOfScores recovers a planted ICC of 0.3 on 5,000 unbalanced clusters within 0.03', () => {
  const rng = makeRng(101);
  const ids = clusterSizes(rng, 5000);
  const groupEffect = new Map();
  const values = ids.map((g) => {
    if (!groupEffect.has(g)) groupEffect.set(g, Math.sqrt(0.3) * rng.normal());
    return groupEffect.get(g) + Math.sqrt(0.7) * rng.normal();
  });
  const icc = iccOfScores(values, ids);
  assert.ok(Math.abs(icc - 0.3) < 0.03, `ICC ${icc} should be 0.3 ± 0.03`);
});

test('iccOfScores is near 0 for independent cards and near 1 when a cluster holds copies', () => {
  const rng = makeRng(202);
  const ids = clusterSizes(rng, 3000);
  const independent = ids.map(() => rng.normal());
  assert.ok(Math.abs(iccOfScores(independent, ids)) < 0.03);
  const copies = new Map();
  const duplicated = ids.map((g) => {
    if (!copies.has(g)) copies.set(g, rng.normal());
    return copies.get(g);
  });
  assert.ok(iccOfScores(duplicated, ids) > 0.99);
});

test('clusterRobustSe equals the naive sd/√n when every card is its own cluster', () => {
  const rng = makeRng(303);
  const values = Array.from({ length: 80 }, () => rng.normal() * 0.2 + 0.03);
  const ids = values.map((_, i) => i);
  const cr = clusterRobustSe(values, ids);
  const n = values.length;
  const m = values.reduce((s, v) => s + v, 0) / n;
  const sd = Math.sqrt(values.reduce((s, v) => s + (v - m) ** 2, 0) / (n - 1));
  assert.ok(Math.abs(cr.se - sd / Math.sqrt(n)) < 1e-12, `${cr.se} vs ${sd / Math.sqrt(n)}`);
});

test('clusterRobustSe exceeds the naive SE when triggers under a risk are correlated (ρ = 0.5)', () => {
  const rng = makeRng(404);
  let naiveSum = 0;
  let crSum = 0;
  for (let rep = 0; rep < 200; rep++) {
    const values = [];
    const ids = [];
    for (let g = 0; g < 60; g++) {
      const shared = rng.normal();
      for (let j = 0; j < 3; j++) {
        values.push(0.5 * shared + Math.sqrt(0.5) * rng.normal());
        ids.push(g);
      }
    }
    const n = values.length;
    const m = values.reduce((s, v) => s + v, 0) / n;
    const sd = Math.sqrt(values.reduce((s, v) => s + (v - m) ** 2, 0) / (n - 1));
    naiveSum += sd / Math.sqrt(n);
    crSum += clusterRobustSe(values, ids).se;
  }
  const ratio = crSum / naiveSum;
  // Theory: sqrt(DEFF) = sqrt(1 + (3 - 1)·ρ) with ρ = 0.5 is about 1.41.
  assert.ok(ratio > 1.25 && ratio < 1.6, `CR/naive ratio ${ratio} should be about 1.41`);
});

test('clusterRobustSe matches the naive SE when clusters carry no shared component', () => {
  const rng = makeRng(505);
  let naiveSum = 0;
  let crSum = 0;
  for (let rep = 0; rep < 200; rep++) {
    const values = [];
    const ids = [];
    for (let g = 0; g < 60; g++) {
      for (let j = 0; j < 3; j++) {
        values.push(rng.normal());
        ids.push(g);
      }
    }
    const n = values.length;
    const m = values.reduce((s, v) => s + v, 0) / n;
    const sd = Math.sqrt(values.reduce((s, v) => s + (v - m) ** 2, 0) / (n - 1));
    naiveSum += sd / Math.sqrt(n);
    crSum += clusterRobustSe(values, ids).se;
  }
  const ratio = crSum / naiveSum;
  assert.ok(Math.abs(ratio - 1) < 0.05, `CR/naive ratio ${ratio} should be 1 when clusters are independent`);
});

test('clusterBootstrapMean with unit clusters gives the plain bootstrap width; with iid values in clusters it stays within 10%', () => {
  const rng = makeRng(606);
  const values = Array.from({ length: 300 }, () => 0.1 + 0.2 * rng.normal());
  const unit = values.map((_, i) => i);
  const plain = clusterBootstrapMean(values, unit, { B: 2000, seed: 9 });
  const ids = [];
  for (let g = 0; ids.length < 300; g++) {
    const m = 1 + rng.int(4);
    for (let j = 0; j < m && ids.length < 300; j++) ids.push(g);
  }
  const clustered = clusterBootstrapMean(values, ids, { B: 2000, seed: 9 });
  const wPlain = plain.hi - plain.lo;
  const wClustered = clustered.hi - clustered.lo;
  assert.ok(Math.abs(wClustered / wPlain - 1) < 0.1, `width ratio ${wClustered / wPlain}`);
});

test('clusterBootstrapMean is wider on strongly clustered data (fails if clusters are ignored)', () => {
  const rng = makeRng(707);
  const values = [];
  const ids = [];
  for (let g = 0; g < 60; g++) {
    const shared = 0.2 * rng.normal();
    for (let j = 0; j < 5; j++) {
      values.push(shared + 0.05 * rng.normal());
      ids.push(g);
    }
  }
  const plain = clusterBootstrapMean(values, values.map((_, i) => i), { B: 2000, seed: 3 });
  const clustered = clusterBootstrapMean(values, ids, { B: 2000, seed: 3 });
  assert.ok(clustered.hi - clustered.lo > 2 * (plain.hi - plain.lo));
});

test('crCritical matches Student-t tables: t(28) = 2.0484 and t(2) = 4.3027, tending to 1.96', () => {
  assert.ok(Math.abs(crCritical(28, 0.05) - 2.0484) < 0.001);
  assert.ok(Math.abs(crCritical(2, 0.05) - 4.3027) < 0.001);
  assert.ok(Math.abs(crCritical(1e6, 0.05) - 1.96) < 0.001);
});

test('effectiveN(149, 76/28, 0.27) is 101 ± 1; designEffect floors a negative ICC at no inflation', () => {
  // The spec's literal mean cluster size 2.7 gives 102.1, so the test uses the real mean 76 triggers / 28 risks.
  assert.ok(Math.abs(effectiveN(149, 76 / 28, 0.27) - 101) <= 1);
  assert.equal(designEffect(2.7, -0.2), 1);
});
