import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  STATE,
  ACTION,
  KIND,
  newDissent,
  route,
  act,
  notify,
  close,
  ledgerEntry,
  cardLedger,
  loopLatencyMs,
} from '../src/dissent.js';
import { dispatch, DEFAULT_CAP, TYPES } from '../../core/src/dispatch.js';
import { LEVELS } from '../../core/src/anonymity.js';
import { compose, LOOP_KIND } from '../../shared/loop.js';

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
  assert.match(d0.id, /^d_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);

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

test('notify() delegates to shared loop.js compose() with zero duplicated copy strings', () => {
  const src = fs.readFileSync(new URL('../src/dissent.js', import.meta.url), 'utf8');
  assert.ok(!src.includes('You said '), 'dissent.js must not duplicate notification copy from shared/loop.js');

  // SPLIT with 2 child cards matches compose(LOOP_KIND.SPLIT, { count: 2, deepLinks })
  const split = act(
    route(newDissent({ cardId: 'R1043', expert: 'e1', country: 'TCD', kind: KIND.TWO_RISKS })),
    ACTION.SPLIT,
    { newCardIds: ['R1043a', 'R1043b'] }
  );
  const splitNotif = notify(split);
  const wantSplit = compose(LOOP_KIND.SPLIT, { count: 2, deepLinks: ['/c/R1043a', '/c/R1043b'] });
  assert.equal(splitNotif.body, wantSplit.body);
  assert.deepEqual(splitNotif.deepLinks, wantSplit.deepLinks);

  // REWRITE with new title passes title through to compose(LOOP_KIND.REWRITE, { title })
  const rewritten = act(
    route(newDissent({ cardId: 'R1067', expert: 'e1', country: 'AFG', kind: KIND.WINDOW })),
    ACTION.REWRITE,
    { title: 'Armed clashes in Badakhshan exceed 25 ACLED events before 30 June 2027' }
  );
  const rewriteNotif = notify(rewritten);
  const wantRewrite = compose(LOOP_KIND.REWRITE, {
    title: 'Armed clashes in Badakhshan exceed 25 ACLED events before 30 June 2027',
  });
  assert.equal(rewriteNotif.body, wantRewrite.body);

  // RETIRE and RESOLVE_EARLY match shared/loop.js verbatim
  for (const action of [ACTION.RETIRE, ACTION.RESOLVE_EARLY]) {
    const d = act(
      route(newDissent({ cardId: 'R1', expert: 'e1', country: 'SDN', kind: KIND.ALREADY_HAPPENING })),
      action
    );
    assert.equal(notify(d).body, compose(action).body);
  }
});

test('dissent IDs use collision-safe UUIDs rather than a restart-prone counter', () => {
  const ids = new Set(
    Array.from({ length: 100 }, () =>
      newDissent({ cardId: 'R1043', expert: 'e1', kind: KIND.WINDOW }).id
    )
  );
  assert.equal(ids.size, 100);
  for (const id of ids) {
    assert.notEqual(id, 'd_1', 'must not emit sequential counter IDs that collide across restarts');
  }
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

test('invalid dissent transitions and kinds throw explicit errors, including skipping route() or notify()', () => {
  assert.throws(() => newDissent({ cardId: 'R1', expert: 'e1', kind: 'bad_kind' }), /unknown dissent kind/);
  const open = newDissent({ cardId: 'R1', expert: 'e1', kind: KIND.WINDOW });

  // B6 regression: OPEN -> ACTIONED skipping route() must fail
  assert.throws(
    () => act(open, ACTION.REWRITE),
    /must be routed first/,
    'act() must reject unrouted OPEN dissents'
  );

  // B3 regression: OPEN -> CLOSED with no analyst must fail
  assert.throws(
    () => close(open, { reason: 'ignored' }),
    /cannot close unrouted dissent/,
    'close() must reject unrouted OPEN dissents'
  );

  const routed = route(open);
  assert.throws(() => route(routed), /cannot route/);

  // B3 regression: ROUTED -> CLOSED without a non-empty dismissal reason must fail
  assert.throws(() => close(routed), /non-empty reason/);
  assert.throws(() => close(routed, { reason: '   ' }), /non-empty reason/);

  // B3 regression: contactable ACTIONED dissent cannot close before notify()
  const actionedContactable = act(routed, ACTION.REWRITE);
  assert.throws(
    () => close(actionedContactable, { reason: 'skip_inbox' }),
    /before notify\(\)/,
    'contactable dissenter must not be closed without notification'
  );

  const dismissed = close(routed, { reason: 'duplicate_of_R1043b' });
  assert.equal(dismissed.status, STATE.CLOSED);
  assert.equal(dismissed.closeReason, 'duplicate_of_R1043b');
  assert.throws(() => act(dismissed, ACTION.RETIRE), /cannot act/);
  assert.throws(() => close(dismissed, { reason: 'again' }), /cannot close/);
});

test('cardLedger() provides an addressless "you said, we did" loop for ANONYMOUS dissenters (B4)', () => {
  const anon = newDissent({
    cardId: 'R1043',
    expert: 'e_SECRET_99',
    name: 'Hidden Person',
    country: 'TCD',
    kind: KIND.ALREADY_HAPPENING,
    level: LEVELS.ANONYMOUS,
    now: 1000,
  });
  // Before action, ledgerEntry is null
  assert.equal(ledgerEntry(anon), null);
  assert.equal(ledgerEntry(route(anon, { now: 1100 })), null);

  const anonClosed = close(
    act(route(anon, { now: 1100 }), ACTION.RESOLVE_EARLY, { now: 1400 }),
    { now: 1500 }
  );
  // Outbound notification is still null (safe), while card-level ledger entry closes the loop!
  const entry = ledgerEntry(anonClosed);
  assert.ok(entry !== null);
  assert.equal(entry.cardId, 'R1043');
  assert.equal(entry.action, ACTION.RESOLVE_EARLY);
  assert.equal(entry.body, compose(LOOP_KIND.RESOLVE_EARLY).body);

  // Zero identifying, pseudonymous, or correlation fields survive into the ledger
  for (const forbidden of ['expert', 'to', 'by', 'name', 'country', 'level', 'dissentId', 'id']) {
    assert.ok(!(forbidden in entry), `ledgerEntry leaked field "${forbidden}"`);
  }
  assert.ok(!JSON.stringify(entry).includes('e_SECRET_99'));
  assert.ok(!JSON.stringify(entry).includes('Hidden Person'));

  const dismissedOnly = close(
    route(newDissent({ cardId: 'R1043', expert: 'e2', kind: KIND.WINDOW })),
    { reason: 'out_of_scope' }
  );
  const ledger = cardLedger([anonClosed, dismissedOnly], 'R1043');
  assert.equal(ledger.length, 1, 'unactioned dismissals do not appear as "we did" card changes');
  assert.equal(ledger[0].action, ACTION.RESOLVE_EARLY);
});

