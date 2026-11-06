import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gate, decontaminate } from '../../core/src/gate.js';

const win = { from: '2026-11-01', to: '2027-04-30' };

test('a well-formed statement passes', () => {
  const r = gate({ statement: 'Food insecurity will affect more than 25% of households in Mali.', window: win });
  assert.equal(r.ok, true, JSON.stringify(r.failed));
});

test('a statement with no window fails', () => {
  const r = gate({ statement: 'Food insecurity will affect more than 25% of households.' });
  assert.equal(r.ok, false);
  assert.ok(r.failed.some((f) => f.check === 'window'));
});

test('outcome-leaking language is caught', () => {
  const r = gate({ statement: 'Displacement is expected to worsen, exceeding 500,000 by June.', window: win });
  assert.equal(r.ok, false);
  assert.ok(r.failed.some((f) => f.check === 'no_leak'));
});

test('a statement of intent is not a condition', () => {
  const r = gate({ statement: 'Authorities intend to restrict access to 40% of affected districts.', window: win });
  assert.equal(r.ok, false);
  assert.ok(r.failed.some((f) => f.check === 'condition'));
});

test('two risks wearing one sentence are caught', () => {
  const r = gate({ statement: 'Cholera cases will exceed 10,000 and food insecurity will affect 30% of households as well as displace 5,000 people.', window: win });
  assert.equal(r.ok, false);
  assert.ok(r.failed.some((f) => f.check === 'single'));
});

test('decontamination keeps the original for audit', () => {
  const c = decontaminate({ statement: 'Displacement is expected to worsen beyond 500,000 and is expected to increase.', window: win });
  assert.ok(!/expected to/i.test(c.statement));
  assert.match(c.original, /expected to worsen/i);
});

test('an empty statement is rejected rather than passing observable', () => {
  assert.equal(gate('').ok, false);
  assert.equal(gate({ statement: '   ', window: win }).ok, false);
});
