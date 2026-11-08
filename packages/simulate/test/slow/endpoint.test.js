// Slow Monte Carlo cases moved out of the fast test folder so `npm test` stays quick. Run them with `npm run test:slow`. Assertions are unchanged.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aggregate } from '@benchmark/core/aggregate';
import { makeRng, hashSeed } from '../../src/rng.js';
import { resolveParams } from '../../src/params.js';
import { makeRiskCards, makeRoster, drawPanel } from '../../src/model.js';
import { median, analyseVsAcapsFast, analyseVsAcapsReal, analyseAbsoluteFast, analyseAbsoluteReal } from '../../src/endpoint.js';

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

