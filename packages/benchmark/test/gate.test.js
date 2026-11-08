import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  SEVERITY,
  gate,
  decontaminate,
  evaluateObservable,
} from '../../core/src/gate.js';

// A resolution window must be in the future and bounded (C1). The suite used to
// pin a window that closed nine weeks earlier as valid — the exact hindsight
// contamination docs/03 says invalidates the design.
const NOW = Date.UTC(2026, 10, 8); // 2026-11-08, the date the review was written
const win = { from: '2027-01-01', to: '2027-04-30' };
const g = (card, opts) => gate(card, { now: NOW, ...opts });

test('a well-formed statement passes', () => {
  const r = g({ statement: 'Food insecurity will affect more than 25% of households in Mali.', window: win });
  assert.equal(r.ok, true, JSON.stringify(r.failed));
});

test('a statement with no window fails', () => {
  const r = g({ statement: 'Food insecurity will affect more than 25% of households.' });
  assert.equal(r.ok, false);
  assert.ok(r.failed.some((f) => f.check === 'window'));
});

test('outcome-leaking language is caught', () => {
  const r = g({ statement: 'Displacement is expected to worsen, exceeding 500,000 by June.', window: win });
  assert.equal(r.ok, false);
  assert.ok(r.failed.some((f) => f.check === 'no_leak'));
});

test('a statement of intent is not a condition', () => {
  const r = g({ statement: 'Authorities intend to restrict access to 40% of affected districts.', window: win });
  assert.equal(r.ok, false);
  assert.ok(r.failed.some((f) => f.check === 'condition'));
});

test('two risks wearing one sentence are caught', () => {
  const r = g({ statement: 'Cholera cases will exceed 10,000 and food insecurity will affect 30% of households as well as displace 5,000 people.', window: win });
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

test('a window that has already closed, has zero length, or spans decades is not dispatchable', () => {
  const fake = g({
    statement: 'Food insecurity will affect more than 25% of households in Mali.',
    window: { from: 'R1067', to: 'Active' },
  });
  assert.equal(fake.ok, false);
  assert.ok(fake.failed.some((f) => f.check === 'window'));

  const reversed = g({
    statement: 'Food insecurity will affect more than 25% of households in Mali.',
    window: { from: '2027-05-01', to: '2026-11-01' },
  });
  assert.equal(reversed.ok, false);
  assert.match(reversed.failed.find((f) => f.check === 'window').reason, /before it starts/);

  // ACAPS DD-MM-YYYY is accepted only when the day is unambiguous (13–31);
  // `01-02-2027` reads as 1 Feb to ACAPS and 2 Jan to everyone else.
  const ambiguous = g({
    statement: 'Food insecurity will affect more than 25% of households in Mali.',
    window: { from: '01-02-2027', to: '01-03-2027' },
  });
  assert.equal(ambiguous.dispatchable, false, 'an ambiguous DD/MM date must not be guessed');

  const acapsDates = g({
    statement: 'Food insecurity will affect more than 25% of households in Mali.',
    window: { from: '13-02-2027', to: '28-03-2027' },
  });
  assert.equal(acapsDates.dispatchable, true, JSON.stringify(acapsDates.blockers));

  // Closed windows: prospective evaluation is the whole claim of the design.
  const closed = g({
    statement: 'Food insecurity will affect more than 25% of households in Mali.',
    window: { from: '1990-01-01', to: '1990-12-31' },
  });
  assert.equal(closed.dispatchable, false);
  assert.match(closed.blockers.find((b) => b.check === 'window').reason, /already closed/);

  const zeroLength = g({
    statement: 'Food insecurity will affect more than 25% of households in Mali.',
    window: { from: '2027-01-01', to: '2027-01-01' },
  });
  assert.equal(zeroLength.dispatchable, false, 'a zero-length window has no resolution moment');

  const decades = g({
    statement: 'Food insecurity will affect more than 25% of households in Mali.',
    window: { from: '2027-01-01', to: '2077-01-01' },
  });
  assert.equal(decades.dispatchable, false, 'a 50-year window is not a forecast');

  // A short-fuse card still dispatches, but warns: the release gate cannot
  // reach a panel of 5 inside the window.
  const tight = g({
    statement: 'Food insecurity will affect more than 25% of households in Mali.',
    window: { from: '2026-11-08', to: '2026-11-11' },
  });
  assert.equal(tight.dispatchable, true);
  assert.ok(tight.warnings.some((w) => /day\(s\) until the window closes/.test(w.reason)));
});

test('dispatchable and scoreable are different questions (C2/R5)', () => {
  // 101 of 139 scored triggers carry no written objective. `observable` is a
  // warning because the lexical rule false-warns on 22% of real prose — that is
  // a reason not to block the card, not a reason to score it.
  const vague = g({
    statement: 'Increased violence in the capital and borders with Rwanda and DRC',
    window: win,
  });
  assert.equal(vague.dispatchable, true, 'a lexical warning must not block a valid conflict card');
  assert.equal(vague.scoreable, false, 'but nothing may be scored against a criterion nobody wrote');

  const objective = g({
    statement: 'Increased violence in the capital and borders with Rwanda and DRC',
    objective: 'ACLED records at least 25 armed clash incidents across border provinces within window.',
    window: win,
  });
  assert.equal(objective.scoreable, true, JSON.stringify(objective.failed));

  // A hard blocker is neither dispatchable nor scoreable.
  const bundled = g({
    statement: 'Cholera cases will exceed 10,000 as well as displace 5,000 people.',
    window: win,
  });
  assert.equal(bundled.dispatchable, false);
  assert.equal(bundled.scoreable, false);
});

test('unmeasurable directional prose fails observable until a concrete objective is attached', () => {
  const vagueWithoutMagicVerb = g({
    statement: 'Increased violence in the capital and borders with Rwanda and DRC',
    window: win,
  });
  assert.equal(vagueWithoutMagicVerb.ok, false);
  assert.ok(vagueWithoutMagicVerb.failed.some((f) => f.check === 'observable'));

  const withObjective = g({
    statement: 'Increased violence in the capital and borders with Rwanda and DRC',
    objective: 'ACLED records at least 25 armed clash incidents across border provinces within window.',
    window: win,
  });
  assert.equal(withObjective.ok, true, JSON.stringify(withObjective.failed));
});

test('an empty statement is rejected rather than passing observable', () => {
  assert.equal(g('').ok, false);
  assert.equal(g({ statement: '   ', window: win }).ok, false);
});

test('gate separates hard structural blockers from observable authoring warnings (B4)', () => {
  // R1067: ACLED-style armed clashes in Badakhshan with a valid window has zero
  // hard blockers (dispatchable: true) while surfacing observable as a warning.
  const r1067 = g({
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
  const missingWin = g({ statement: 'US fund freeze' });
  assert.equal(missingWin.dispatchable, false);
  assert.ok(missingWin.blockers.some((b) => b.check === 'window'));
});

test('non-quantity digits (COVID-19, M23, calendar years) and "No" objectives do not spoof observable', () => {
  const covid = g({
    statement: 'Deterioration of food security due to COVID-19 and economic crisis',
    window: win,
  });
  assert.equal(covid.ok, false, 'COVID-19 is a disease name, not a numeric threshold');
  assert.ok(covid.warnings.some((w) => w.check === 'observable'));

  const m23 = g({
    statement:
      'The expansion of the areas under the control of the March 23 Movement (M23) in Nord-Kivu causes increased violence',
    window: win,
  });
  assert.equal(m23.ok, false, 'March 23 / M23 are proper-noun dates/names, not an outcome quantity');

  const noThresholdObj = g({
    statement: 'Number of military junta bases and towns captured by armed resistance groups',
    objective: 'No specific threshold present for the trigger.',
    window: win,
  });
  assert.equal(noThresholdObj.ok, false, 'explicit "No specific threshold" annotation must override bare "Number of"');

  const bareNoObj = g({
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

