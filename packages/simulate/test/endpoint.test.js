import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aggregate } from '@benchmark/core/aggregate';
import { paired as repoPaired } from '@benchmark/core/scoring';
import { makeRng, hashSeed } from '../src/rng.js';
import { resolveParams } from '../src/params.js';
import { makeRiskCards, makeRoster, drawPanel } from '../src/model.js';
import {
  normalQuantile,
  normalCdf,
  median,
  pooledForecast,
  comparatorP,
  analyseVsAcapsFast,
  analyseVsAcapsReal,
  analyseAbsoluteFast,
  analyseAbsoluteReal,
  analyseAbsoluteCluster,
} from '../src/endpoint.js';

const params = resolveParams({});

/** Real-model panels: risk cards with k responders each (kFixed bypasses dropout, so every card is analysable). */
function modelPanels(rng, n, kFixed = 8) {
  const cards = makeRiskCards(params, rng, n);
  const roster = makeRoster(params, rng);
  const out = [];
  for (const card of cards) {
    const panel = drawPanel(card, roster, params, rng, { kFixed });
    if (panel) out.push(panel);
  }
  return out;
}

/** A hand-built panel: `k` identical forecasts p on one card (kept small and explicit for exact checks). */
function handPanel(id, risk, y, p, a, k = 5) {
  const experts = Array.from({ length: k }, (_, j) => j + 1);
  return {
    card: { id, risk, band: 2, a, L: 0, pi: p, y, kind: 'risk' },
    ps: Array(k).fill(p),
    experts,
  };
}

test('normal quantile and CDF agree with the standard table, and invert each other', () => {
  assert.ok(Math.abs(normalQuantile(0.975) - 1.959964) < 1e-6);
  assert.ok(Math.abs(normalQuantile(0.025) + 1.959964) < 1e-6);
  for (const p of [0.01, 0.3, 0.9]) assert.ok(Math.abs(normalCdf(normalQuantile(p)) - p) < 1e-6);
});

test('the fast median equals aggregate().estimate exactly on 500 random panels (k = 3..15, odd and even, with ties)', () => {
  const rng = makeRng(hashSeed('median-check'));
  for (let t = 0; t < 500; t++) {
    const k = 3 + rng.int(13);
    const ps = Array.from({ length: k }, () => Math.round(100 * (0.01 + 0.98 * rng.next())) / 100);
    const estimates = ps.map((p, j) => ({ p, expertId: `e${j}` }));
    const real = aggregate(estimates, { reps: 100, minPanel: 3 }).estimate;
    assert.equal(median(ps), real, `panel ${JSON.stringify(ps)}`);
  }
});

test('pooledForecast takes the in-house path for median and calls aggregate() for log_odds', () => {
  const panel = { card: { id: 'x' }, ps: [0.2, 0.4, 0.9], experts: [1, 2, 3] };
  assert.equal(pooledForecast(panel, { floor: 3 }), 0.4);
  const viaAgg = pooledForecast(panel, { floor: 3, method: 'log_odds' });
  const real = aggregate(panel.ps.map((p, j) => ({ p, expertId: String(j + 1) })), { method: 'log_odds', reps: 100, minPanel: 3 }).estimate;
  assert.equal(viaAgg, real);
});

test('comparatorP reads the band midpoint, or the ordinal rating divided by five', () => {
  const card = { band: 3, a: 0.705 };
  assert.equal(comparatorP(card, 'midpoint'), 0.705);
  assert.equal(comparatorP(card, 'ordinal'), 0.8);
});

test('the sign is right: a sharp correct panel beats ACAPS (negative Δ, better), a sharp wrong panel does not', () => {
  const good = [];
  const bad = [];
  for (let i = 0; i < 60; i++) {
    const y = i % 2;
    good.push(handPanel(`G${i}`, i, y, y === 1 ? 0.99 : 0.01, 0.5));
    bad.push(handPanel(`B${i}`, i, y, y === 1 ? 0.01 : 0.99, 0.5));
  }
  const g = analyseVsAcapsFast(good, { floor: 5 });
  assert.ok(g.diff < 0 && g.better && !g.worse, JSON.stringify(g));
  const b = analyseVsAcapsFast(bad, { floor: 5 });
  assert.ok(b.diff > 0 && b.worse && !b.better, JSON.stringify(b));
});

test('a panel worse than the comparator never counts as power, under the fast or the real analysis', () => {
  const panels = [];
  for (let i = 0; i < 60; i++) panels.push(handPanel(`W${i}`, i, 1, 0.01, 0.9));
  assert.equal(analyseVsAcapsFast(panels, { floor: 5 }).better, false);
  assert.equal(analyseVsAcapsReal(panels, { floor: 5 }).better, false);
  assert.equal(analyseVsAcapsReal(panels, { floor: 5 }).worse, true);
});

test('a constant forecast equal to the in-sample base rate is never "better" in 2,000 replicates, and its gain is exactly 0', () => {
  const rng = makeRng(hashSeed('constant-benchmark'));
  for (let rep = 0; rep < 2000; rep++) {
    const panels = [];
    for (let i = 0; i < 30; i++) {
      const y = rng.bernoulli(0.4);
      panels.push(handPanel(`C${rep}-${i}`, i, y, 0, 0.5));
    }
    const b = panels.reduce((s, p) => s + p.card.y, 0) / panels.length;
    // The constant panel forecast is the base rate itself.
    for (const p of panels) p.ps = Array(5).fill(b);
    const r = analyseAbsoluteFast(panels, { floor: 5, benchmark: 'in_sample_base_rate' });
    assert.equal(r.better, false, `replicate ${rep}`);
    assert.equal(r.gain, 0);
  }
});

test('the real absolute analysis of a constant base-rate forecast returns a zero interval and is never "better"', () => {
  const panels = [];
  for (let i = 0; i < 30; i++) panels.push(handPanel(`R${i}`, i, i % 3 === 0 ? 1 : 0, 0.33, 0.5));
  const b = panels.reduce((s, p) => s + p.card.y, 0) / panels.length;
  for (const p of panels) p.ps = Array(5).fill(b);
  const r = analyseAbsoluteReal(panels, { floor: 5 });
  assert.equal(r.gain, 0);
  assert.equal(r.better, false);
});

test('cards below the floor never reach paired(): the spy sees exactly the analysable card ids', () => {
  const rng = makeRng(hashSeed('spy'));
  const roster = makeRoster(params, rng);
  const cards = makeRiskCards(params, rng, 40);
  const panels = cards.map((c, i) => drawPanel(c, roster, params, rng, { kFixed: i % 2 === 0 ? 3 : 8 }));
  const seen = [];
  const spy = (A, B, o) => {
    seen.push(...A.map((d) => d.id));
    return repoPaired(A, B, o);
  };
  analyseVsAcapsReal(panels, { floor: 5, paired: spy });
  const expected = panels.filter((p, i) => i % 2 === 1).map((p) => p.card.id);
  assert.deepEqual(seen.sort(), expected.sort());
  assert.equal(seen.length, 20);
});

test('fast and real panel-vs-ACAPS decisions agree on at least 97% of 100 replicates at N = 60 (real-model panels)', () => {
  const sigmaParams = resolveParams({ sigma: 1.53 });
  let agree = 0;
  let disagree = 0;
  const cats = { better: 0, worse: 0, neither: 0 };
  for (let r = 0; r < 100; r++) {
    const rng = makeRng(hashSeed('agree', r));
    const cards = makeRiskCards(sigmaParams, rng, 90);
    const roster = makeRoster(sigmaParams, rng);
    const panels = [];
    for (const card of cards) {
      const panel = drawPanel(card, roster, sigmaParams, rng, { kFixed: 8 });
      if (panel && card.y !== null && panels.length < 60) panels.push(panel);
    }
    const fast = analyseVsAcapsFast(panels, { floor: 5 });
    const real = analyseVsAcapsReal(panels, { floor: 5 });
    const fastCat = fast.better ? 'better' : fast.worse ? 'worse' : 'neither';
    const realCat = real.better ? 'better' : real.worse ? 'worse' : 'neither';
    cats[fastCat] += 1;
    if (fastCat === realCat) agree += 1;
    else disagree += 1;
  }
  assert.ok(agree / 100 >= 0.97, `agreement ${agree}% with categories ${JSON.stringify(cats)}, disagreements ${disagree}`);
});

test('analyseAbsoluteCluster on copies nested in risks has a wider interval than the naive one (fails if clusters are ignored)', () => {
  const panels = [];
  const rng = makeRng(hashSeed('copies'));
  for (let g = 0; g < 60; g++) {
    const y = rng.bernoulli(0.5);
    const p = 0.2 + 0.6 * rng.next();
    panels.push(handPanel(`A${g}`, g, y, p, 0.5));
    panels.push(handPanel(`A${g}b`, g, y, p, 0.5));
  }
  const cl = analyseAbsoluteCluster(panels, { floor: 5, B: 2000, seed: 7 });
  const naive = analyseAbsoluteFast(panels, { floor: 5 });
  const naiveHalf = 1.96 * naive.sd / Math.sqrt(naive.n);
  assert.equal(cl.clusters, 60);
  assert.ok((cl.hi - cl.lo) / 2 > 1.2 * naiveHalf, `cluster half-width ${(cl.hi - cl.lo) / 2} vs naive ${naiveHalf}`);
  assert.ok(cl.rhoD > 0.9, `planted copies give ρ_D ${cl.rhoD}`);
});

test('the fast and the real absolute analyses agree on direction, and bss = gain / (b(1−b)) with b the sample base rate', () => {
  const rng = makeRng(hashSeed('bss'));
  const panels = modelPanels(rng, 200, 8);
  const fast = analyseAbsoluteFast(panels, { floor: 5 });
  const real = analyseAbsoluteReal(panels, { floor: 5 });
  const b = panels.reduce((s, p) => s + p.card.y, 0) / panels.length;
  assert.ok(b > 0 && b < 1);
  assert.ok(Math.abs(fast.bss - fast.gain / (b * (1 - b))) < 1e-12);
  assert.equal(fast.better, real.better);
  assert.equal(fast.worse, real.worse);
});
