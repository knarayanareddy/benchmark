import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSeries } from '@benchmark/core/series';

const at = (iso) => Date.parse(iso);
const snap = (over = {}) => ({ suppressed: false, estimate: 0.4, lo: 0.3, hi: 0.5, n: 6, ...over });
const doc = (round, over = {}) => ({
  cardId: 'c1', round, visibility: 'panel', n: 6, closed: true,
  at: at('2026-03-10T12:00:00Z'), snapshot: snap(), ...over,
});

test('floor is honoured exactly: n=4 withheld, n=5 shown', () => {
  const { points, withheld } = buildSeries([doc(1, { n: 4 }), doc(2, { n: 5 })]);
  assert.deepEqual(withheld, [{ round: 1 }]);
  assert.equal(points.length, 1);
  assert.equal(points[0].round, 2);
  assert.equal(points[0].n, 5);
});

test('a floor below 5 cannot lower the release floor', () => {
  const { points, withheld } = buildSeries([doc(1, { n: 4 })], { floor: 1 });
  assert.equal(points.length, 0);
  assert.deepEqual(withheld, [{ round: 1 }]);
});

test('a raised floor withholds more', () => {
  const { points, withheld } = buildSeries([doc(1, { n: 6 })], { floor: 7 });
  assert.equal(points.length, 0);
  assert.deepEqual(withheld, [{ round: 1 }]);
});

test('a suppressed snapshot is withheld with no numeric field anywhere in the entry', () => {
  const releases = [
    doc(1, { n: 40, snapshot: snap({ suppressed: true, estimate: null, lo: null, hi: null }) }),
    doc(2, { n: 12, snapshot: snap({ suppressed: true, estimate: 0.31, lo: 0.2, hi: 0.4 }) }),
  ];
  const { points, withheld } = buildSeries(releases);
  assert.equal(points.length, 0);
  assert.deepEqual(withheld, [{ round: 1 }, { round: 2 }]);
  const json = JSON.stringify(withheld);
  assert.equal(/\d/.test(json.replace(/"round":\d+/g, '')), false, json);
});

test('a missing or malformed snapshot is withheld, never shown with guessed numbers', () => {
  const { points, withheld } = buildSeries([
    doc(1, { snapshot: undefined }),
    doc(2, { snapshot: snap({ estimate: null }) }),
    doc(3, { snapshot: snap({ releaseHeld: true }) }),
  ]);
  assert.equal(points.length, 0);
  assert.deepEqual(withheld, [{ round: 1 }, { round: 2 }, { round: 3 }]);
});

test('points are ordered by round, ties keep input order', () => {
  const releases = [
    doc(2, { n: 9, at: at('2026-03-12T00:00:00Z') }),
    doc(1, { n: 7 }),
    doc(2, { n: 6, at: at('2026-03-11T00:00:00Z') }),
  ];
  const { points } = buildSeries(releases);
  assert.deepEqual(points.map((p) => [p.round, p.n]), [[1, 7], [2, 9], [2, 6]]);
});

test('input is not mutated', () => {
  const releases = [doc(2, { n: 6 }), doc(1, { n: 4 })];
  const before = structuredClone(releases);
  const order = releases.slice();
  buildSeries(releases);
  assert.deepEqual(releases, before);
  assert.deepEqual(releases, order);
});

test('day is the UTC calendar day of at, at the midnight edges', () => {
  const { points } = buildSeries([
    doc(1, { at: at('2026-03-10T00:00:00.000Z') }),
    doc(2, { at: at('2026-03-10T23:59:59.999Z') }),
    doc(3, { at: at('2026-03-11T00:00:00.000Z') }),
  ]);
  assert.deepEqual(points.map((p) => p.day), ['2026-03-10', '2026-03-10', '2026-03-11']);
});

test('point shape carries only round, day, n, estimate, lo, hi', () => {
  const { points } = buildSeries([doc(1)]);
  assert.deepEqual(Object.keys(points[0]).sort(), ['day', 'estimate', 'hi', 'lo', 'n', 'round']);
  assert.deepEqual([points[0].estimate, points[0].lo, points[0].hi], [0.4, 0.3, 0.5]);
});

test('documents without a numeric round are ignored entirely', () => {
  const { points, withheld } = buildSeries([
    doc(1), { ...doc(1), round: '2' }, { ...doc(1), round: undefined }, null, 'x',
  ]);
  assert.equal(points.length, 1);
  assert.equal(withheld.length, 0);
});

test('an unreadable at withholds the round instead of guessing a day', () => {
  const { points, withheld } = buildSeries([doc(1, { at: 'not a date' })]);
  assert.equal(points.length, 0);
  assert.deepEqual(withheld, [{ round: 1 }]);
});

test('non-array input is rejected', () => {
  assert.throws(() => buildSeries(/** @type {any} */ (null)), TypeError);
});
