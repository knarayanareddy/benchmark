import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  SEVERITY,
  gate,
  decontaminate,
  evaluateObservable,
} from '@benchmark/core/gate';

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

test('gate separates hard structural blockers from observable authoring warnings (B4)', () => {
  // R1067: ACLED-style armed clashes in Badakhshan with a valid window has zero
  // hard blockers (dispatchable: true) while surfacing observable as a warning.
  const r1067 = gate({
    statement:
      'Escalating clashes between Interim Taliban Authority forces and armed opposition groups in Badakhshan deteriorates food security and increases protection risks',
    window: win,
  });
  assert.equal(r1067.ok, false, 'strict 5-check ok remains false until an objective is attached');
  assert.equal(r1067.dispatchable, true, 'lexical observable heuristic must warn rather than hard-block');
  assert.equal(r1067.blockers.length, 0);
  assert.equal(r1067.warnings.length, 1);
  assert.equal(r1067.warnings[0].check, 'observable');
  assert.equal(r1067.warnings[0].severity, SEVERITY.WARNING);

  // Missing window or leaking language remains a hard blocker (dispatchable: false)
  const missingWin = gate({ statement: 'US fund freeze' });
  assert.equal(missingWin.dispatchable, false);
  assert.ok(missingWin.blockers.some((b) => b.check === 'window'));
});

test('non-quantity digits (COVID-19, M23, calendar years) and "No" objectives do not spoof observable', () => {
  const covid = gate({
    statement: 'Deterioration of food security due to COVID-19 and economic crisis',
    window: win,
  });
  assert.equal(covid.ok, false, 'COVID-19 is a disease name, not a numeric threshold');
  assert.ok(covid.warnings.some((w) => w.check === 'observable'));

  const m23 = gate({
    statement:
      'The expansion of the areas under the control of the March 23 Movement (M23) in Nord-Kivu causes increased violence',
    window: win,
  });
  assert.equal(m23.ok, false, 'March 23 / M23 are proper-noun dates/names, not an outcome quantity');

  const noThresholdObj = gate({
    statement: 'Number of military junta bases and towns captured by armed resistance groups',
    objective: 'No specific threshold present for the trigger.',
    window: win,
  });
  assert.equal(noThresholdObj.ok, false, 'explicit "No specific threshold" annotation must override bare "Number of"');

  const bareNoObj = gate({
    statement: 'Increased violence in the capital',
    objective: 'No',
    window: win,
  });
  assert.equal(bareNoObj.ok, false, 'ACAPS placeholder objective "No" is not a written criterion');
});

test('evaluateObservable() measures precision and false-warn rate across 50 labelled corpus items', () => {
  const labelled = JSON.parse(
    fs.readFileSync(new URL('./fixtures/observable-labelled-50.json', import.meta.url), 'utf8')
  );
  assert.equal(labelled.length, 50);

  const audit = evaluateObservable(labelled);
  assert.equal(audit.n, 50);
  assert.equal(audit.tpWarn + audit.fpWarn + audit.tnPass + audit.fnPass, 50);
  assert.ok(audit.warnPrecision > 0.80, `expected >80% warn precision, got ${audit.warnPrecision}`);
  assert.ok(audit.fpWarn > 0, 'honest 50-item corpus benchmark includes ACLED false-warn cases like R1067');
  assert.ok(audit.disagreements.some((d) => d.id === 'R1067' && d.kind === 'false_warn'));
});


test('an empty statement fails the dedicated statement check, not observable (B-20)', () => {
  const r = gate({ statement: '', window: win });
  assert.equal(r.dispatchable, false);
  assert.ok(r.blockers.some((b) => b.check === 'statement'));
  assert.ok(!r.failed.some((f) => f.check === 'observable'));
});

test('no_leak catches trend-presupposing phrasings beyond the original eight (B-20)', () => {
  for (const s of [
    'Displacement is poised to deteriorate across the north, exceeding 500,000 by June.',
    'Food insecurity is set to worsen, passing IPC Phase 4 in three districts.',
    'Cases are projected to spike above 2,000 per week.',
    'Violence is already escalating in the east, with over 100 deaths per month.',
  ]) {
    const r = gate({ statement: s, window: win });
    assert.ok(r.blockers.some((b) => b.check === 'no_leak'), s);
  }
  const hazard = gate({ statement: 'Escalating clashes between armed groups lead to over 100,000 displaced.', window: win });
  assert.ok(!hazard.blockers.some((b) => b.check === 'no_leak'), 'hazard framing is not an outcome leak');
});
