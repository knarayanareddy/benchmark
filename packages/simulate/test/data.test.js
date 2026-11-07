import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadHistorical, bandOffsets, latentMoments, muForBase } from '../src/data.js';
import { makeRng } from '../src/rng.js';
import { BAND_MIDPOINT, ACAPS_BANDS } from '@benchmark/core/aggregate';

const RADAR = new URL('../../../data/risk-radar.json', import.meta.url);
const BASELINE = new URL('../../../data/baseline-fit.json', import.meta.url);

/** Counts recomputed straight from the raw export, independently of the loader. */
function rawCounts() {
  const raw = JSON.parse(readFileSync(RADAR, 'utf8'));
  const active = raw.filter((r) => r.status === 'Active');
  return {
    total: raw.length,
    resolved: raw.filter((r) => r.outcome === 0 || r.outcome === 1).length,
    materialised: raw.filter((r) => r.outcome === 1).length,
    active: active.length,
    activeTriggers: active.reduce((s, r) => s + (Array.isArray(r.triggerList) ? r.triggerList.length : 0), 0),
  };
}

test('loader counts equal the real export: 139 risks, 104 resolved, 61 materialised, 28 active, 76 triggers', () => {
  const h = loadHistorical();
  const raw = rawCounts();
  assert.equal(h.total, 139);
  assert.equal(h.n, 104);
  assert.equal(h.materialised, 61);
  assert.equal(h.active.risks, 28);
  assert.equal(h.active.triggers, 76);
  assert.equal(h.total, raw.total);
  assert.equal(h.n, raw.resolved);
  assert.equal(h.materialised, raw.materialised);
  assert.equal(h.active.risks, raw.active);
  assert.equal(h.active.triggers, raw.activeTriggers);
  assert.equal(h.resolved.length, 104);
});

test('rated resolved risks, band counts and hit rates are the measured ones', () => {
  const h = loadHistorical();
  assert.equal(h.rated, 99);
  assert.deepEqual(h.bandCounts, [3, 14, 44, 30, 8]);
  assert.deepEqual(h.bandHits, [1, 6, 21, 25, 7]);
  assert.deepEqual(
    h.bandRates.map((r) => Math.round(r * 1e4) / 1e4),
    [0.3333, 0.4286, 0.4773, 0.8333, 0.875]
  );
  assert.equal(h.resolved.filter((r) => r.band === null).length, 5);
  assert.equal(h.resolved.filter((r) => r.band !== null).length, 99);
});

test('base rate matches data/baseline-fit.json to 4 dp', () => {
  const h = loadHistorical();
  const fit = JSON.parse(readFileSync(BASELINE, 'utf8'));
  assert.ok(Math.abs(h.base - fit.brier.baseRate) < 5e-5, `${h.base} vs ${fit.brier.baseRate}`);
  assert.ok(Math.abs(h.base - 0.5865) < 5e-5);
});

test('active mix and triggers per risk match the real Active list', () => {
  const h = loadHistorical();
  assert.deepEqual(h.activeMix, [0, 3, 8, 15, 2]);
  assert.equal(h.activeMix.reduce((s, c) => s + c, 0), 28);
  const t = h.active.triggersPerRisk;
  assert.equal(t.length, 28);
  assert.equal(t.reduce((s, c) => s + c, 0), 76);
  assert.equal(Math.max(...t), 4);
  assert.equal(Math.min(...t), 1);
  const tally = (k) => t.filter((c) => c === k).length;
  assert.deepEqual([tally(4), tally(3), tally(2), tally(1)], [3, 16, 7, 2]);
});

test('each resolved risk carries the ACAPS band midpoint and its 0/1 outcome', () => {
  const h = loadHistorical();
  for (const r of h.resolved) {
    assert.ok(r.y === 0 || r.y === 1);
    if (r.band === null) {
      assert.equal(r.a, null);
    } else {
      assert.equal(r.a, BAND_MIDPOINT[ACAPS_BANDS[r.band].label]);
    }
  }
  const midpoints = ACAPS_BANDS.map((b) => BAND_MIDPOINT[b.label]);
  assert.deepEqual(midpoints, [0.1, 0.305, 0.505, 0.705, 0.905]);
});

// Independent quadrature, a different grid from data.js (Simpson on [-15, 15]).
function expitIntegral(o, tau) {
  const m = 20000;
  const lo = -15;
  const h = 30 / m;
  let s = 0;
  for (let i = 0; i <= m; i++) {
    const z = lo + i * h;
    const w = i === 0 || i === m ? 1 : i % 2 === 1 ? 4 : 2;
    s += w * (1 / (1 + Math.exp(-(o + tau * z)))) * Math.exp(-0.5 * z * z);
  }
  return ((s * h) / 3) / Math.sqrt(2 * Math.PI);
}

test('bandOffsets reproduce each rate to 1e-6 on 200 random (rate, tau) pairs', () => {
  const rng = makeRng(20261107);
  for (let i = 0; i < 200; i++) {
    const rate = rng.uniform(0.02, 0.98);
    const tau = rng.uniform(0.3, 2);
    const [o] = bandOffsets([rate], tau);
    assert.ok(Math.abs(expitIntegral(o, tau) - rate) < 1e-6, `rate ${rate} tau ${tau}`);
  }
});

test('bandOffsets with a shift moves every offset by the shift', () => {
  const base = bandOffsets([0.2, 0.5, 0.8], 1.25);
  const moved = bandOffsets([0.2, 0.5, 0.8], 1.25, 0.4);
  moved.forEach((o, b) => assert.ok(Math.abs(o - base[b] - 0.4) < 1e-12));
});

test('muForBase(0.4, 1.47) reproduces the base rate to 1e-6', () => {
  const mu = muForBase(0.4, 1.47);
  assert.ok(Math.abs(expitIntegral(mu, 1.47) - 0.4) < 1e-6);
});

test('bandOffsets rejects rates at the edges and a non-positive tau', () => {
  assert.throws(() => bandOffsets([0], 1), RangeError);
  assert.throws(() => bandOffsets([1], 1), RangeError);
  assert.throws(() => bandOffsets([0.5], 0), RangeError);
});

test('latentMoments: one band gives its offset and variance tau squared; two bands add between-band spread', () => {
  const one = latentMoments([1], [0.7], 1.25);
  assert.equal(one.mean, 0.7);
  assert.ok(Math.abs(one.variance - 1.5625) < 1e-12);

  const two = latentMoments([1, 1], [-1, 1], 0.5);
  assert.ok(Math.abs(two.mean) < 1e-12);
  assert.ok(Math.abs(two.variance - (0.25 + 1)) < 1e-12);

  assert.throws(() => latentMoments([1], [0, 1], 1), RangeError);
});
