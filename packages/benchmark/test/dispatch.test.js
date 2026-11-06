import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dispatch, TYPES, matches, health } from '../../core/src/dispatch.js';

const card = { region: 'ML', theme: 'food' };

test('the declaration gates who is told', () => {
  assert.equal(matches(card, { regions: ['ML'] }), true);
  assert.equal(matches(card, { regions: ['SD'] }), false);
  assert.equal(matches(card, { regions: ['SD'], themes: ['food'] }), false, 'region miss must win');
  assert.equal(matches(card, {}), true, 'empty declaration means everything');
});

test('the weekly cap is enforced and never exceeded', () => {
  const cands = Array.from({ length: 8 }, (_, i) => ({ type: TYPES.new_statement, card, expert: `e${i}` }));
  const out = dispatch(cands, { perWeek: 3, instantOnlyAbove: 3 }, []);
  assert.equal(out.filter((o) => o.decision === 'send').length, 3);
  assert.equal(out.filter((o) => o.decision === 'defer').length, 5);
});

test('dissent feedback is never suppressed by the cap', () => {
  const history = Array.from({ length: 3 }, () => ({ type: TYPES.new_statement }));
  const out = dispatch([{ type: TYPES.dissent_actioned, card, expert: 'e1' }], { perWeek: 3 }, history);
  assert.equal(out[0].decision, 'send');
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
