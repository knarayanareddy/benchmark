import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  STATE,
  ACTION,
  KIND,
  newDissent,
  route,
  act,
  notify,
  close,
  loopLatencyMs,
} from '../src/dissent.js';
import { dispatch, DEFAULT_CAP, TYPES } from '../../core/src/dispatch.js';
import { LEVELS } from '../../core/src/anonymity.js';

test('five-state dissent lifecycle runs end-to-end and notify() bypasses dispatch() at weekly cap', () => {
  const d0 = newDissent({
    cardId: 'R1043',
    expert: 'e_8f21',
    country: 'TCD',
    kind: KIND.TWO_RISKS,
    text: 'Border security and food prices are distinct mechanisms.',
    now: 1000,
  });
  assert.equal(d0.status, STATE.OPEN);
  assert.equal(d0.level, LEVELS.PSEUDONYMOUS);
  assert.match(d0.by, /^Analyst \d{4}$/);
  assert.equal(d0.contactable, true);

  const d1 = route(d0, { queue: 'chad-desk', now: 1200 });
  assert.equal(d1.status, STATE.ROUTED);
  assert.equal(d1.queue, 'chad-desk');

  const d2 = act(d1, ACTION.SPLIT, { newCardIds: ['R1043a', 'R1043b'], now: 1800 });
  assert.equal(d2.status, STATE.ACTIONED);

  const n = notify(d2, { now: 2100 });
  assert.ok(n !== null);
  assert.equal(n.type, 'dissent_actioned');
  assert.equal(n.to, 'e_8f21');
  assert.equal(n.expert, 'e_8f21');
  assert.equal(n._next.status, STATE.NOTIFIED);
  assert.equal(loopLatencyMs(n._next), 1100);

  // Critical integration test: expert has ALREADY reached their 3/week cap,
  // yet `notify()` passed directly into `dispatch()` MUST still send.
  const fullHistory = Array.from({ length: DEFAULT_CAP.perWeek }, () => ({
    type: TYPES.new_statement,
    expert: 'e_8f21',
  }));
  const [routedNotif] = dispatch([n], DEFAULT_CAP, fullHistory);
  assert.equal(routedNotif.decision, 'send', 'dissent_actioned from notify() must never be deferred by cap');

  const d4 = close(n._next, { reason: 'receipt_sent', now: 2500 });
  assert.equal(d4.status, STATE.CLOSED);
  assert.equal(loopLatencyMs(d4), 1100);
});

test('ANONYMOUS and unrecognised-level dissents strip expert ID and never emit outbound notifications', () => {
  for (const lvl of [LEVELS.ANONYMOUS, 'ANONYMOUS', 'unknown-privacy-mode']) {
    const anon = newDissent({
      cardId: 'R1043',
      expert: 'e_SECRET_ID',
      name: 'Secret Name',
      country: 'TCD',
      kind: KIND.WINDOW,
      text: 'The window has no end date.',
      level: lvl,
      now: 5000,
    });
    assert.equal(anon.level, LEVELS.ANONYMOUS);
    assert.equal(anon.expert, null, 'raw expert id must not be stored on anonymous dissent');
    assert.equal(anon.by, 'anonymous');
    assert.equal(anon.contactable, false);
    assert.ok(!JSON.stringify(anon).includes('e_SECRET_ID'));
    assert.ok(!JSON.stringify(anon).includes('Secret Name'));

    const actioned = act(route(anon, { now: 5100 }), ACTION.REWRITE, { now: 5300 });
    assert.equal(notify(actioned, { now: 5400 }), null, 'cannot notify anonymous dissenter without un-anonymising');

    const closed = close(actioned, { reason: 'anonymous_actioned_on_card', now: 5500 });
    assert.equal(closed.status, STATE.CLOSED);
    assert.equal(loopLatencyMs(closed), 500);
  }
});

test('invalid dissent transitions and kinds throw explicit errors', () => {
  assert.throws(() => newDissent({ cardId: 'R1', expert: 'e1', kind: 'bad_kind' }), /unknown dissent kind/);
  const open = newDissent({ cardId: 'R1', expert: 'e1', kind: KIND.WINDOW });
  const routed = route(open);
  assert.throws(() => route(routed), /cannot route/);
  const closed = close(routed);
  assert.throws(() => act(closed, ACTION.RETIRE), /cannot act/);
  assert.throws(() => close(closed), /cannot close/);
});
