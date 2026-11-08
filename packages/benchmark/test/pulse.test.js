import { test } from 'node:test';
import assert from 'node:assert/strict';
import { whyAsked, rankAsks, WEEK_MS, NEEDS_VIEWS_BELOW } from '@benchmark/core/pulse';

const NOW = Date.UTC(2026, 10, 7);
const DAY = 24 * 60 * 60 * 1000;
const none = () => 0;
const full = () => 9;

const card = (id, over = {}) => ({ id, country: 'TCD', theme: 'food', createdAt: NOW - DAY, ...over });
const profile = (over = {}) => ({ weeklyCap: 3, declaration: { countries: ['TCD'], themes: [] }, ...over });

test('the constants are the agreed ones', () => {
  assert.equal(NEEDS_VIEWS_BELOW, 5);
  assert.equal(WEEK_MS, 7 * DAY);
});

test('whyAsked gives the three labels, and only labels', () => {
  const decl = { countries: ['TCD'], themes: ['food'] };
  assert.deepEqual(whyAsked(card('a'), decl, { responses: 9 }), [{ label: 'Covers TCD' }, { label: 'Theme match' }]);
  assert.deepEqual(whyAsked(card('a'), decl, { responses: 2 }), [
    { label: 'Covers TCD' },
    { label: 'Theme match' },
    { label: 'The circle needs more views' },
  ]);
});

test('whyAsked: the circle label appears below 5 responses and not at 5', () => {
  assert.deepEqual(whyAsked(card('a'), {}, { responses: 4 }), [{ label: 'The circle needs more views' }]);
  assert.deepEqual(whyAsked(card('a'), {}, { responses: 5 }), []);
  assert.deepEqual(whyAsked(card('a'), {}, { responses: NaN }), [{ label: 'The circle needs more views' }], 'an unknown count is treated as thin');
});

test('whyAsked has no region label: regions are not a matching rule any more', () => {
  const why = whyAsked(card('a', { country: 'SDN' }), { regions: ['East & Southern Africa'] }, { responses: 9 });
  assert.deepEqual(why, []);
});

test('whyAsked does not match on a country the person did not declare', () => {
  assert.deepEqual(whyAsked(card('a'), { countries: ['SDN'] }, { responses: 9 }), []);
});

test('whyAsked does not change its inputs', () => {
  const c = card('a');
  const decl = { countries: ['TCD'], themes: ['food'] };
  const cCopy = structuredClone(c);
  const dCopy = structuredClone(decl);
  whyAsked(c, decl, { responses: 1 });
  assert.deepEqual(c, cCopy);
  assert.deepEqual(decl, dCopy);
});

test('asks are capped at weeklyCap; the rest go to radar with the beyond-cap reason', () => {
  const cards = ['a', 'b', 'c', 'd', 'e'].map((id) => card(id));
  const { asks, radar } = rankAsks(cards, profile({ weeklyCap: 3 }), { now: NOW, responsesOf: full });
  assert.equal(asks.length, 3);
  assert.equal(radar.length, 2);
  assert.deepEqual([...asks, ...radar].map((e) => e.card.id).sort(), ['a', 'b', 'c', 'd', 'e']);
  for (const e of radar) assert.equal(e.reason, "Covers TCD (beyond this week's cap)");
});

test('a weeklyCap of 0 puts every candidate on the radar', () => {
  const { asks, radar } = rankAsks([card('a'), card('b')], profile({ weeklyCap: 0 }), { now: NOW, responsesOf: full });
  assert.equal(asks.length, 0);
  assert.equal(radar.length, 2);
});

test('a card older than seven days goes to radar, even with spare capacity', () => {
  const old = card('old', { createdAt: NOW - 8 * DAY });
  const { asks, radar } = rankAsks([old], profile({ weeklyCap: 7 }), { now: NOW, responsesOf: full });
  assert.equal(asks.length, 0);
  assert.equal(radar.length, 1);
  assert.equal(radar[0].card.id, 'old');
  assert.equal(radar[0].reason, 'Covers TCD (older than a week)');
});

test('an old card does not take a slot from a recent one', () => {
  const cards = [card('old', { createdAt: NOW - 9 * DAY }), card('new', { createdAt: NOW - DAY })];
  const { asks, radar } = rankAsks(cards, profile({ weeklyCap: 1 }), { now: NOW, responsesOf: full });
  assert.deepEqual(asks.map((e) => e.card.id), ['new']);
  assert.deepEqual(radar.map((e) => e.card.id), ['old']);
  assert.match(radar[0].reason, /older than a week/);
});

test('exactly seven days old is still this week', () => {
  const { asks } = rankAsks([card('edge', { createdAt: NOW - WEEK_MS })], profile(), { now: NOW, responsesOf: full });
  assert.deepEqual(asks.map((e) => e.card.id), ['edge']);
});

test('a card with no createdAt counts as old: radar, never an ask', () => {
  const { asks, radar } = rankAsks([card('nodate', { createdAt: null })], profile(), { now: NOW, responsesOf: full });
  assert.equal(asks.length, 0);
  assert.deepEqual(radar.map((e) => e.card.id), ['nodate']);
  assert.match(radar[0].reason, /older than a week/);
});

test('the thin circle comes first, before a newer card', () => {
  const cards = [
    card('newer-full', { createdAt: NOW - DAY }),
    card('older-thin', { createdAt: NOW - 3 * DAY }),
  ];
  const responsesOf = (c) => (c.id === 'older-thin' ? 1 : 9);
  const { asks } = rankAsks(cards, profile({ weeklyCap: 2 }), { now: NOW, responsesOf });
  assert.deepEqual(asks.map((e) => e.card.id), ['older-thin', 'newer-full']);
});

test('ties within the same circle state: newer card first, then id ascending', () => {
  const cards = [
    card('b', { createdAt: NOW - 2 * DAY }),
    card('c', { createdAt: NOW - DAY }),
    card('a', { createdAt: NOW - 2 * DAY }),
  ];
  const { asks } = rankAsks(cards, profile({ weeklyCap: 7 }), { now: NOW, responsesOf: full });
  assert.deepEqual(asks.map((e) => e.card.id), ['c', 'a', 'b']);
});

test('the cap picks from the top of the ranking, not from the input order', () => {
  const cards = [card('first-in-input', { createdAt: NOW - 3 * DAY }), card('newest', { createdAt: NOW - DAY })];
  const { asks, radar } = rankAsks(cards, profile({ weeklyCap: 1 }), { now: NOW, responsesOf: full });
  assert.deepEqual(asks.map((e) => e.card.id), ['newest']);
  assert.deepEqual(radar.map((e) => e.card.id), ['first-in-input']);
});

test('the thin-circle label shows on the entry and in the reason', () => {
  const { asks } = rankAsks([card('x')], profile(), { now: NOW, responsesOf: none });
  assert.deepEqual(asks[0].why, [{ label: 'Covers TCD' }, { label: 'The circle needs more views' }]);
  assert.equal(asks[0].reason, 'Covers TCD · The circle needs more views');
});

test('each entry is exactly { card, why, reason }', () => {
  const { asks } = rankAsks([card('x', { theme: 'food' })], profile({ declaration: { countries: ['TCD'], themes: ['food'] } }), { now: NOW, responsesOf: full });
  assert.deepEqual(Object.keys(asks[0]).sort(), ['card', 'reason', 'why']);
  assert.equal(asks[0].reason, 'Covers TCD · Theme match');
});

test('the output never carries a score, pts or outside field, anywhere', () => {
  const cards = [card('a'), card('b', { createdAt: NOW - 9 * DAY }), card('c', { theme: 'health' })];
  const out = rankAsks(cards, profile({ weeklyCap: 1 }), { now: NOW, responsesOf: none });
  const json = JSON.stringify(out);
  assert.doesNotMatch(json, /"(score|pts|outside|minMatch)"\s*:/);
  assert.equal(Object.hasOwn(out, 'outside'), false);
  assert.deepEqual(Object.keys(out).sort(), ['asks', 'radar']);
});

test('a candidate the caller did not supply is never listed', () => {
  const { asks, radar } = rankAsks([card('a')], profile(), { now: NOW, responsesOf: full });
  assert.deepEqual([...asks, ...radar].map((e) => e.card.id), ['a']);
});

test('an empty declaration matches nothing: no asks and no radar', () => {
  const cards = [card('a'), card('b')];
  for (const declaration of [{}, { countries: [], regions: [], themes: [] }, null, undefined]) {
    const r = rankAsks(cards, { weeklyCap: 3, declaration }, { now: NOW, responsesOf: none });
    assert.deepEqual(r, { asks: [], radar: [] });
  }
});

test('a declaration with only themes still ranks (a theme is a declared dimension)', () => {
  const { asks } = rankAsks([card('a', { country: 'SDN' })], { weeklyCap: 3, declaration: { themes: ['food'] } }, { now: NOW, responsesOf: full });
  assert.equal(asks.length, 1);
  assert.equal(asks[0].reason, 'Theme match');
});

test('rankAsks does not mutate its inputs', () => {
  const cards = [card('a'), card('b', { createdAt: NOW - 9 * DAY })];
  const prof = profile({ declaration: { countries: ['TCD'], regions: ['Sahel & West/Central Africa'], themes: ['food'] } });
  const cardsCopy = structuredClone(cards);
  const profCopy = structuredClone(prof);
  rankAsks(Object.freeze(structuredClone(cards)), prof, { now: NOW, responsesOf: none });
  rankAsks(cards, prof, { now: NOW, responsesOf: none });
  assert.deepEqual(cards, cardsCopy);
  assert.deepEqual(prof, profCopy);
});
