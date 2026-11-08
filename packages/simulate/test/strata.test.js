import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { REGIONS, THEMES } from '@benchmark/core/taxonomy';
import { MIN_CELL } from '@benchmark/core/grid';
import { bonferroniAdjust, bonferroniAlpha, holmAdjust, strataSupply } from '../src/strata.js';

const radar = JSON.parse(readFileSync(new URL('../../../data/risk-radar.json', import.meta.url), 'utf8'));
const supply = strataSupply(radar);

test('strataSupply: 28 active risks, 76 triggers, 104 statements, 104 with outcomes (the real export)', () => {
  assert.equal(supply.totals.risks, 139);
  assert.equal(supply.totals.active, 28);
  assert.equal(supply.totals.activeTriggers, 76);
  assert.equal(supply.totals.statements, 104);
  assert.equal(supply.totals.outcomes, 104);
  assert.equal(supply.totals.unplaced, 0);
});

test('strataSupply: region x theme is the full 6 x 6 grid from taxonomy, and cells add up to the totals', () => {
  assert.equal(supply.byRegionTheme.length, REGIONS.length * Object.keys(THEMES).length);
  assert.equal(supply.byRegion.length, REGIONS.length);
  const sumRisks = supply.byRegionTheme.reduce((s, c) => s + c.risks, 0);
  const sumActive = supply.byRegionTheme.reduce((s, c) => s + c.active, 0);
  const sumTriggers = supply.byRegionTheme.reduce((s, c) => s + c.activeTriggers, 0);
  assert.equal(sumRisks, supply.totals.risks);
  assert.equal(sumActive, supply.totals.active);
  assert.equal(sumTriggers, supply.totals.activeTriggers);
});

test('strataSupply: the largest active region has 13 risks (power spec, Analysis 6)', () => {
  assert.equal(supply.maxRisks.activeRegion, 13);
  const largest = supply.byRegion.find((c) => c.active === 13);
  assert.equal(largest.region, 'East & Southern Africa');
});

test('strataSupply: on the active basis the largest region x theme cell has 4 risks, and no cell reaches 5', () => {
  assert.equal(supply.maxRisks.activeCell, 4);
  assert.equal(supply.byRegionTheme.filter((c) => c.active >= 5).length, 0);
});

test('strataSupply: cells with 5 or more risks number 11 and with 10 or more number 3 (all 139 risks)', () => {
  assert.equal(supply.byRegionTheme.filter((c) => c.risks >= 5).length, 11);
  assert.equal(supply.byRegionTheme.filter((c) => c.risks >= 10).length, 3);
  assert.equal(supply.maxRisks.allCell, 22);
});

test('strataSupply: a cell is small exactly when it has fewer than MIN_CELL risks', () => {
  assert.equal(MIN_CELL, 10);
  for (const c of supply.byRegionTheme) assert.equal(c.small, c.risks < MIN_CELL, `${c.region} / ${c.theme}`);
  assert.equal(supply.byRegionTheme.filter((c) => !c.small).length, 3);
});

test('strataSupply counts an invented radar exactly, with a region-less risk left unplaced', () => {
  const tiny = [
    { id: 'R1', title: 'Armed clash in the north', iso: 'SDN', status: 'Active', triggerList: [{ triggerId: 'T1' }, { triggerId: 'T2' }] },
    { id: 'R2', title: 'Armed clash again', iso: 'SDN', status: 'Materialised', outcome: 1, triggerList: [] },
    { id: 'R3', title: 'Something unmapped', iso: 'ZZZ', status: 'Active', triggerList: [] },
  ];
  const s = strataSupply(tiny);
  assert.equal(s.totals.risks, 3);
  assert.equal(s.totals.active, 2);
  assert.equal(s.totals.activeTriggers, 2);
  assert.equal(s.totals.unplaced, 1);
  const cell = s.byRegionTheme.find((c) => c.region === 'East & Southern Africa' && c.theme === 'conflict');
  assert.equal(cell.risks, 2);
  assert.equal(cell.outcomes, 1);
});

test('bonferroniAlpha divides alpha by the number of comparisons', () => {
  assert.equal(bonferroniAlpha(0.05, 15), 0.05 / 15);
  assert.equal(bonferroniAlpha(0.05, 1), 0.05);
  assert.throws(() => bonferroniAlpha(0.05, 0), RangeError);
});

test('bonferroniAdjust multiplies by the count and caps at 1', () => {
  assert.deepEqual(bonferroniAdjust([0.01, 0.04]), [0.02, 0.08]);
  assert.deepEqual(bonferroniAdjust([0.5, 0.9]), [1, 1]);
});

test('holmAdjust matches the worked example and never exceeds Bonferroni or drops below the raw p', () => {
  const raw = [0.01, 0.04, 0.03, 0.005];
  assert.deepEqual(holmAdjust(raw), [0.03, 0.06, 0.06, 0.02]);
  const bonf = bonferroniAdjust(raw);
  const holm = holmAdjust(raw);
  raw.forEach((p, i) => {
    assert.ok(holm[i] <= bonf[i] + 1e-12, 'Holm is never above Bonferroni');
    assert.ok(holm[i] >= p - 1e-12, 'Holm is never below the raw p');
  });
});

test('holmAdjust is monotone in the sorted p-values', () => {
  const raw = [0.2, 0.001, 0.04, 0.6, 0.011, 0.03];
  const holm = holmAdjust(raw);
  const order = raw.map((_, i) => i).sort((a, b) => raw[a] - raw[b]);
  for (let k = 1; k < order.length; k++) {
    assert.ok(holm[order[k]] >= holm[order[k - 1]] - 1e-12);
  }
});
