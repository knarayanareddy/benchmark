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
  assert.equal(c.needsAnalystRewrite, true);
  assert.ok(c.statement.includes('[…]'), 'redacted spans must be visibly marked rather than silently dropped');
});

test('decontaminate marks redactions explicitly rather than emitting broken grammar', () => {
  const a = decontaminate({ statement: 'Prices are expected to increase' });
  assert.notEqual(a.statement, 'Prices are increase');
  assert.equal(a.statement, 'Prices are […]');
  assert.equal(a.needsAnalystRewrite, true);

  const gaza = decontaminate({
    statement: 'A return to large-scale conflict in Gaza stokes a further deterioration of food security and humanitarian conditions',
  });
  assert.ok(!gaza.statement.includes('stokes a of food security'));
  assert.ok(gaza.statement.includes('stokes a […] of food security'));
  assert.deepEqual(gaza.redactedPhrases, ['further deterioration']);
});

test('fake non-date windows and reversed windows fail the window check', () => {
  const fake = gate({
    statement: 'Food insecurity will affect more than 25% of households in Mali.',
    window: { from: 'R1067', to: 'Active' },
  });
  assert.equal(fake.ok, false);
  assert.ok(fake.failed.some((f) => f.check === 'window'));

  const reversed = gate({
    statement: 'Food insecurity will affect more than 25% of households in Mali.',
    window: { from: '2027-05-01', to: '2026-11-01' },
  });
  assert.equal(reversed.ok, false);
  assert.match(reversed.failed.find((f) => f.check === 'window').reason, /before it starts/);

  // ACAPS DD-MM-YYYY dates pass when ordered chronologically
  const acapsDates = gate({
    statement: 'Food insecurity will affect more than 25% of households in Mali.',
    window: { from: '02-06-2026', to: '02-09-2026' },
  });
  assert.equal(acapsDates.ok, true);
});

test('unmeasurable directional prose fails observable until a concrete objective is attached', () => {
  const vagueWithoutMagicVerb = gate({
    statement: 'Increased violence in the capital and borders with Rwanda and DRC',
    window: win,
  });
  assert.equal(vagueWithoutMagicVerb.ok, false);
  assert.ok(vagueWithoutMagicVerb.failed.some((f) => f.check === 'observable'));

  const withObjective = gate({
    statement: 'Increased violence in the capital and borders with Rwanda and DRC',
    objective: 'ACLED records at least 25 armed clash incidents across border provinces within window.',
    window: win,
  });
  assert.equal(withObjective.ok, true, JSON.stringify(withObjective.failed));
});

test('an empty statement is rejected rather than passing observable', () => {
  assert.equal(gate('').ok, false);
  assert.equal(gate({ statement: '   ', window: win }).ok, false);
});
