#!/usr/bin/env node
/**
 * End-to-end journey harness. Exercises all five transitions of the dissent
 * state machine, verifies that `notify()` bypasses `dispatch()` even when the
 * expert has hit their weekly cap, and checks that `ANONYMOUS` dissent drops
 * the expert identifier and closes without leaking a recipient.
 */
import {
  newDissent,
  route,
  act,
  notify,
  close,
  cardLedger,
  loopLatencyMs,
  STATE,
  ACTION,
  KIND,
} from '@benchmark/domain/dissent';
import { dispatch, DEFAULT_CAP, TYPES } from '@benchmark/core/dispatch';
import { LEVELS } from '@benchmark/core/anonymity';
import { compose, LOOP_KIND } from '@benchmark/shared/loop';

const TEST_SALT = 'test-deployment-salt-not-for-prod';

const d = newDissent({ salt: TEST_SALT,
  cardId: 'R1043',
  expert: 'e_8f21',
  country: 'TCD',
  kind: KIND.TWO_RISKS,
  text: 'This is a drought risk and a displacement risk.',
});
console.log(`1  raised      ${d.id}  state=${d.status}  by="${d.by}"`);

// Verify strict routing invariant: cannot jump OPEN -> ACTIONED directly
let skippedThrew = false;
try {
  act(d, ACTION.SPLIT);
} catch {
  skippedThrew = true;
}
if (!skippedThrew) {
  console.error('✗ act() allowed OPEN -> ACTIONED without routing');
  process.exit(1);
}

const routed = route(d, { queue: 'analyst' });
console.log(`2  routed      state=${routed.status}  queue=${routed.queue}`);

const actioned = act(routed, ACTION.SPLIT, { newCardIds: ['R1043a', 'R1043b'] });
console.log(`3  actioned    state=${actioned.status}  action=${actioned.action}`);

const n = notify(actioned);
if (n.body !== compose(LOOP_KIND.SPLIT, { count: 2 }).body) {
  console.error('✗ notify() drifted from shared packages/shared/loop.js compose()');
  process.exit(1);
}
const cappedHistory = Array.from({ length: DEFAULT_CAP.perWeek }, () => ({
  type: TYPES.new_statement,
  expert: 'e_8f21',
}));
const [dispatched] = dispatch([n], DEFAULT_CAP, cappedHistory);
if (dispatched.decision !== 'send') {
  console.error('✗ dissent_actioned notification was suppressed by the weekly cap');
  process.exit(1);
}
console.log(`4  notified    state=${n._next.status}  dispatch=${dispatched.decision} (at ${DEFAULT_CAP.perWeek}/${DEFAULT_CAP.perWeek} weekly cap)`);
console.log(`               "${n.body}"  links: ${n.deepLinks.join(', ')}`);

const closed = close(n._next, { reason: 'delivered' });
console.log(`5  closed      state=${closed.status}`);

// Verify ANONYMOUS dissent never retains expert id or emits an outbound recipient,
// yet still closes the feedback loop on the card via `cardLedger()` ("you said, we did").
const anon = newDissent({ salt: TEST_SALT,
  cardId: 'R1043',
  expert: 'e_secret',
  kind: KIND.WINDOW,
  level: LEVELS.ANONYMOUS,
});
const anonActioned = act(
  route(anon),
  ACTION.REWRITE,
  { title: 'Cross-border attacks in Ouaddaï exceed 15 ACLED events before 30 June 2027' }
);
const anonClosed = close(anonActioned, { reason: 'anonymous_opt_out' });
const ledger = cardLedger([closed, anonClosed], 'R1043');
if (
  anon.expert !== null ||
  notify(anonActioned) !== null ||
  anonClosed.status !== STATE.CLOSED ||
  ledger.length !== 2 ||
  JSON.stringify(ledger).includes('e_secret') ||
  JSON.stringify(ledger).includes('e_8f21')
) {
  console.error('✗ anonymous dissent leaked expert id or failed to record de-identified card ledger');
  process.exit(1);
}
console.log(`6  ledger      ${ledger.length} de-identified "you said, we did" entries on R1043 (anonymous loop closed without address)`);

const ms = loopLatencyMs(closed);
console.log(`\nin-process state-machine execution: ${ms} ms (note: measures synchronous code path, not human analyst turnaround)`);
if (ms > 60000) { console.error('✗ state machine exceeded 60000 ms'); process.exit(1); }
console.log('✓ five-state dissent loop, cap-bypass dispatch, and anonymous opt-out verified');
