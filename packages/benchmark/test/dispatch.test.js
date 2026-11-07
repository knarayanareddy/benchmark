import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dispatch, TYPES, matches, health } from '@benchmark/core/dispatch';

const card = { region: 'ML', theme: 'food' };

test('the declaration gates who is told', () => {
  assert.equal(matches(card, { regions: ['ML'] }), true);
  assert.equal(matches(card, { regions: ['SD'] }), false);
  assert.equal(matches(card, { regions: ['SD'], themes: ['food'] }), false, 'region miss must win');
  assert.equal(matches(card, {}), false, 'an empty Declaration must not mean "tell me everything" (B-13)');
  assert.equal(matches(card, { regions: [], themes: [], countries: [] }), false);
  assert.equal(matches(card, {}, { all: true }), true, 'matching everything is an explicit moderator choice');
  assert.equal(matches({ ...card, country: 'MLI' }, { countries: ['MLI'] }), true);
  assert.equal(matches({ ...card, country: 'MLI' }, { countries: ['SDN'] }), false);
});

test('a question with no theme or region is not hidden by a declared theme or region', () => {
  const bare = { country: 'MLI' };
  assert.equal(matches(bare, { countries: ['MLI'], themes: ['health'] }), true);
  assert.equal(matches(bare, { countries: ['MLI'], regions: ['Sahel & West/Central Africa'] }), true);
  assert.equal(matches(bare, { countries: ['SDN'], themes: ['health'] }), false, 'the country still gates');
  assert.equal(matches({ country: 'MLI', theme: 'food' }, { countries: ['MLI'], themes: ['health'] }), false, 'a classified question still needs the theme');
});

test('the weekly cap is enforced and never exceeded', () => {
  const cands = Array.from({ length: 8 }, () => ({ type: TYPES.new_statement, card, expert: 'e1' }));
  const out = dispatch(cands, { perWeek: 3, instantOnlyAbove: 3 }, []);
  assert.equal(out.filter((o) => o.decision === 'send').length, 3);
  assert.equal(out.filter((o) => o.decision === 'defer').length, 5);
});

test('the weekly cap is tracked per expert, not globally across the panel', () => {
  const eightExperts = Array.from({ length: 8 }, (_, i) => ({ type: TYPES.new_statement, card, expert: `e${i}` }));
  const allSend = dispatch(eightExperts, { perWeek: 3 }, []);
  assert.equal(allSend.filter((o) => o.decision === 'send').length, 8);
  assert.equal(allSend.filter((o) => o.decision === 'defer').length, 0);

  const oneExpertFiveCards = Array.from({ length: 5 }, () => ({ type: TYPES.new_statement, card, expert: 'e0' }));
  const capped = dispatch(oneExpertFiveCards, { perWeek: 3 }, []);
  assert.equal(capped.filter((o) => o.decision === 'send').length, 3);
  assert.equal(capped.filter((o) => o.decision === 'defer').length, 2);
});

test('dissent feedback is never suppressed by the cap', () => {
  const history = Array.from({ length: 3 }, () => ({ type: TYPES.new_statement, expert: 'e1' }));
  const out = dispatch([{ type: TYPES.dissent_actioned, card, expert: 'e1' }], { perWeek: 3 }, history);
  assert.equal(out[0].decision, 'send');

  // Also verify string type ('dissent_actioned') and `to` key as emitted by dissent.js notify(),
  // plus ensuring historical 'dissent_actioned' items never consume weekly cap slots.
  const stringHistory = [
    { type: 'dissent_actioned', to: 'e1' },
    { type: 'dissent_actioned', expert: 'e1' },
    { type: TYPES.new_statement, expert: 'e1' },
    { type: TYPES.new_statement, expert: 'e1' },
  ];
  const fromNotifyShape = dispatch(
    [
      { type: 'dissent_actioned', to: 'e1', body: 'Split.' },
      { type: TYPES.new_statement, card, expert: 'e1' },
      { type: TYPES.new_statement, card, expert: 'e1' },
    ],
    { perWeek: 3 },
    stringHistory
  );
  assert.equal(fromNotifyShape[0].decision, 'send', 'string dissent_actioned must bypass cap');
  assert.equal(fromNotifyShape[1].decision, 'send', 'prior dissent_actioned history must not consume cap (2/3 used -> 3/3)');
  assert.equal(fromNotifyShape[2].decision, 'defer', 'fourth regular notification defers at cap');
});

test('dissent feedback outranks everything else', () => {
  const out = dispatch(
    [
      { type: TYPES.new_statement, card, expert: 'a' },
      { type: TYPES.dissent_actioned, card, expert: 'b' },
      { type: TYPES.contested, card, expert: 'c' },
    ],
    { perWeek: 3 },
    [],
  );
  assert.equal(out[0].type, TYPES.dissent_actioned);
});

test('a domain nobody completes is flagged as uncovered', () => {
  const events = [
    ...Array.from({ length: 6 }, () => ({ domain: 'YEM', type: 'sent' })),
    { domain: 'YEM', type: 'completed' },
    ...Array.from({ length: 6 }, () => ({ domain: 'ML', type: 'sent' })),
    ...Array.from({ length: 4 }, () => ({ domain: 'ML', type: 'completed' })),
  ];
  const h = health(events);
  assert.equal(h.find((r) => r.domain === 'YEM').uncovered, true);
  assert.equal(h.find((r) => r.domain === 'ML').uncovered, false);
});
