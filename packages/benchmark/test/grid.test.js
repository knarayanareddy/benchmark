import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildGrid, MIN_CELL } from '@benchmark/core/grid';
import { REGIONS, THEMES } from '@benchmark/core/taxonomy';

const [R0, R1] = REGIONS;
const T0 = 'conflict';
const T1 = 'health';

const risk = (id, region, theme) => ({ id, region, theme });
const card = (id, over = {}) => ({ id, status: 'open', ...over });
const cell = (grid, region, theme) => grid.cells.find((c) => c.region === region && c.theme === theme);

test('every region x theme cell is present, zeros included', () => {
  const grid = buildGrid([], []);
  assert.equal(grid.cells.length, REGIONS.length * Object.keys(THEMES).length);
  assert.deepEqual(grid.regions, [...REGIONS]);
  assert.deepEqual(grid.themes, Object.keys(THEMES));
  assert.equal(grid.minCell, 10);
  assert.ok(grid.cells.every((c) => c.risks === 0 && c.cards === 0 && c.live === 0 && c.small === true));
});

test('risks and cards are counted in their derived cell', () => {
  const grid = buildGrid(
    [risk('r1', R0, T0), risk('r2', R0, T0), risk('r3', R1, T1)],
    [card('c1', { region: R0, theme: T0 }), card('c2', { region: R1, theme: T1 })],
  );
  assert.deepEqual(
    { risks: cell(grid, R0, T0).risks, cards: cell(grid, R0, T0).cards },
    { risks: 2, cards: 1 },
  );
  assert.deepEqual({ risks: cell(grid, R1, T1).risks, cards: cell(grid, R1, T1).cards }, { risks: 1, cards: 1 });
  assert.equal(grid.unplaced.cards, 0);
});

test('a card with no region or theme takes its risk values first', () => {
  const grid = buildGrid(
    [risk('r1', R1, T1)],
    [card('c1', { riskId: 'r1', region: null, theme: null })],
  );
  assert.equal(cell(grid, R1, T1).cards, 1);
  assert.equal(grid.unplaced.cards, 0);
});

test('fallback order: own value, then risk, then country region', () => {
  // KEN maps to R0 (East & Southern Africa); the risk sits in R1 (MENA), so each source is distinguishable.
  const grid = buildGrid(
    [risk('r1', R1, T1)],
    [
      card('own', { region: R0, theme: T0, riskId: 'r1', country: 'SYR' }),
      card('viaRisk', { riskId: 'r1', country: 'KEN', theme: T0 }),
      card('viaCountry', { country: 'KEN', theme: T1 }),
    ],
  );
  assert.equal(cell(grid, R0, T0).cards, 1, 'own region beats the risk region');
  assert.equal(cell(grid, R1, T0).cards, 1, 'no card region: the risk region beats the country');
  assert.equal(cell(grid, R0, T1).cards, 1, 'no card or risk: the country region');
  assert.equal(cell(grid, R1, T1).cards, 0);
  assert.equal(grid.unplaced.cards, 0);
});

test('a card with no region uses its risk region, not its country region', () => {
  const grid = buildGrid([risk('r1', R1, T1)], [card('c1', { riskId: 'r1', country: 'KEN', theme: T1 })]);
  assert.equal(cell(grid, R1, T1).cards, 1);
  assert.equal(cell(grid, R0, T1).cards, 0);
});

test('an unknown country region with no risk makes the card unplaced', () => {
  const grid = buildGrid([], [card('c1', { country: 'ZZZ', theme: T0 })]);
  assert.equal(grid.unplaced.cards, 1);
  assert.ok(grid.cells.every((c) => c.cards === 0));
});

test('a card with a theme but no derivable region is unplaced', () => {
  const grid = buildGrid([], [card('c1', { theme: T0 })]);
  assert.equal(grid.unplaced.cards, 1);
});

test('a card with an unknown theme is unplaced, not put in a wrong cell', () => {
  const grid = buildGrid([], [card('c1', { region: R0, theme: 'weather' })]);
  assert.equal(grid.unplaced.cards, 1);
  assert.ok(grid.cells.every((c) => c.cards === 0));
});

test('risks without a region or theme are counted as unplaced', () => {
  const grid = buildGrid([risk('r1', null, T0), risk('r2', R0, null)], []);
  assert.equal(grid.unplaced.risks, 2);
  assert.ok(grid.cells.every((c) => c.risks === 0));
});

test('live counts open and closed only; resolved and others are not live', () => {
  const statuses = ['open', 'closed', 'resolved', 'requested', 'collected', 'expired'];
  const grid = buildGrid([], statuses.map((status, i) => card(`c${i}`, { region: R0, theme: T0, status })));
  const c = cell(grid, R0, T0);
  assert.equal(c.cards, statuses.length);
  assert.equal(c.live, 2);
});

test('a retired card is counted in neither cards nor live: a split does not double', () => {
  const grid = buildGrid(
    [risk('r1', R0, T0)],
    [
      card('parent', { region: R0, theme: T0, status: 'retired', riskId: 'r1' }),
      card('childA', { region: R0, theme: T0, status: 'open', riskId: 'r1', parentId: 'parent' }),
      card('childB', { region: R0, theme: T0, status: 'open', riskId: 'r1', parentId: 'parent' }),
    ],
  );
  const c = cell(grid, R0, T0);
  assert.equal(c.cards, 2, 'the two children, not three');
  assert.equal(c.live, 2);
  assert.equal(grid.unplaced.cards, 0);
});

test('a retired card without a region or theme is not counted as unplaced either', () => {
  const grid = buildGrid([], [card('c1', { status: 'retired', country: 'ZZZ' })]);
  assert.equal(grid.unplaced.cards, 0);
});

test('small flags a cell at 9 risks and clears it at 10', () => {
  assert.equal(MIN_CELL, 10);
  const ten = Array.from({ length: 10 }, (_, i) => risk(`a${i}`, R0, T0));
  const nine = ten.slice(0, 9);
  assert.equal(cell(buildGrid(nine, []), R0, T0).small, true);
  assert.equal(cell(buildGrid(ten, []), R0, T0).small, false);
});

test('small is computed from risks, not cards', () => {
  const grid = buildGrid([], Array.from({ length: 20 }, (_, i) => card(`c${i}`, { region: R0, theme: T0 })));
  assert.equal(cell(grid, R0, T0).small, true);
});

test('the output carries no expert or answer fields', () => {
  const grid = buildGrid([risk('r1', R0, T0)], [card('c1', { region: R0, theme: T0 })]);
  const json = JSON.stringify(grid);
  assert.doesNotMatch(json, /expert|answer|estimate|respondent|ballot/i);
  assert.deepEqual(Object.keys(grid.cells[0]).sort(), ['cards', 'live', 'region', 'risks', 'small', 'theme']);
});
