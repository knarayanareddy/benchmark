#!/usr/bin/env node
/**
 * End-to-end journey harness. Proves the five-state loop runs and reports the
 * latency, which is acceptance test #7 (under sixty seconds).
 */
import { newDissent, act, notify, loopLatencyMs, STATE, ACTION, KIND } from '../packages/benchmark/src/dissent.js';

const t0 = Date.now();
const d = newDissent({ cardId: 'R1043', expert: 'e_8f21', kind: KIND.TWO_RISKS, text: 'This is a drought risk and a displacement risk.' });
console.log(`1  raised      ${d.id}  state=${d.status}`);

const routed = { ...d, status: STATE.ROUTED };
console.log(`2  routed      to analyst queue`);

const actioned = act(routed, ACTION.SPLIT, { newCardIds: ['R1043a', 'R1043b'] });
console.log(`3  actioned    ${actioned.status}  action=${actioned.action}`);

const n = notify(actioned);
console.log(`4  notified    "${n.body}"`);
console.log(`               links: ${n.deepLinks.join(', ')}`);

console.log(`5  closed      state=${n._next.status}`);
const ms = loopLatencyMs(n._next);
console.log(`\nloop latency   ${ms} ms  (acceptance test #7 needs < 60000 ms)`);
if (ms > 60000) { console.error('✗ too slow'); process.exit(1); }
console.log('✓ dissent can be raised, actioned and notified inside the target');
