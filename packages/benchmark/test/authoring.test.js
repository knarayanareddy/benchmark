import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  suggestSources, suggestSplit, objectiveKind, classifyHeadline, validateCardInput,
  buildWorklist, summariseWorklist, importAuthored, scoreRaters, WORKLIST_HEADER, RESOLUTION_SOURCES,
} from '@benchmark/core/authoring';
import { toCsv, parseCsvObjects } from '@benchmark/core/csv';

const GOOD = {
  statement: 'Cholera cases in Chad will exceed 10,000 by 30 April 2027.', country: 'TCD',
  window: { from: '2026-11-01', to: '2027-04-30' }, objective: 'WHO bulletin above 10,000',
  resolutionSource: 'IPC', resolver: 'R. Resolver',
};

test('source suggestions are keyword starting points; ambiguous text gets none', () => {
  assert.deepEqual(suggestSources('Food insecurity reaches IPC Phase 4'), ['IPC']);
  assert.ok(suggestSources('Displacement and clashes in the north').includes('UNHCR'));
  assert.ok(suggestSources('Displacement and clashes in the north').includes('ACLED'));
  assert.deepEqual(suggestSources('Things get generally worse'), []);
  assert.ok(RESOLUTION_SOURCES.includes('official_decree'));
});

test('a compound statement gets split suggestions; a single claim gets none', () => {
  const s = suggestSplit('Closure of IDP camps and forced returns of IDPs, as well as forced repatriation of Nigerian refugees, leads to displacement');
  assert.ok(s.length >= 2, JSON.stringify(s));
  assert.deepEqual(suggestSplit('Cholera cases will exceed 10,000 by June 2027.'), []);
});

test('ACAPS-written objectives are sorted by whether they could ever be a prior criterion', () => {
  assert.equal(objectiveKind(''), 'none');
  assert.equal(objectiveKind('No specific threshold present'), 'no_threshold');
  assert.equal(objectiveKind('YES. the number of renewed attacks or attempts.'), 'yes_no_note');
  assert.equal(objectiveKind('The IMF Executive Board approved a 38-month arrangement for Burundi.'), 'retrospective', 'outcome text is not a criterion fixed in advance');
  assert.equal(objectiveKind('In Burundi, annual inflation as of February 2024 was 17.8 percent.'), 'retrospective');
  assert.equal(objectiveKind('ACLED records more than 50 fatalities in Kidal region in a calendar month.'), 'candidate');
});

test('classifyHeadline never calls anything ready and says what is missing', () => {
  const noThreshold = classifyHeadline({ statement: 'Taliban attacks on provincial capitals lead to civil war violence levels.' });
  assert.equal(noThreshold.status, 'needs_threshold');
  assert.ok(noThreshold.missing.includes('measurable threshold or event'));
  assert.ok(noThreshold.missing.includes('resolver'));
  const hasSignal = classifyHeadline({ statement: 'Food insecurity will reach IPC Phase 4 in three districts.' });
  assert.equal(hasSignal.status, 'needs_objective');
  assert.ok(hasSignal.missing.includes('objective') && !hasSignal.missing.includes('measurable threshold or event'));
  assert.deepEqual(hasSignal.sources, ['IPC']);
  const bundled = classifyHeadline({ statement: 'Cholera cases will exceed 10,000 as well as famine will be declared in Borno.' });
  assert.equal(bundled.status, 'needs_rewrite');
  assert.ok(bundled.blockers.some((b) => b.startsWith('single')));
  assert.ok(bundled.split.length >= 2);
  const leak = classifyHeadline({ statement: 'Displacement is poised to deteriorate, exceeding 500,000 by June.' });
  assert.equal(leak.status, 'needs_rewrite');
});

test('validateCardInput is the one rule, and reports every problem at once', () => {
  assert.equal(validateCardInput(GOOD).ok, true);
  assert.equal(validateCardInput({ ...GOOD, country: 'tcd' }).card.country, 'TCD');
  const bad = validateCardInput({ ...GOOD, country: 'Chad', objective: '', resolver: '', resolutionSource: 'a blog', window: undefined });
  assert.equal(bad.ok, false);
  const text = bad.problems.join(' | ');
  for (const must of [/ISO 3-letter/, /resolver/, /resolutionSource/, /objective/, /gate window/]) assert.match(text, must);
});

test('the worklist covers every headline and trigger, leaves author columns empty, and is deterministic', () => {
  const blocks = JSON.parse(fs.readFileSync(new URL('../../../data/risk-radar.json', import.meta.url), 'utf8'));
  const rows = buildWorklist(blocks);
  assert.equal(rows.length, 139 + 266);
  assert.deepEqual(buildWorklist(blocks), rows);
  for (const r of rows) {
    assert.ok(['needs_rewrite', 'needs_threshold', 'needs_objective'].includes(r.status), r.id);
    for (const k of WORKLIST_HEADER.filter((h) => h.startsWith('author_'))) assert.equal(r[k], '', `${r.id}.${k} must be left to a human`);
  }
  const s = summariseWorklist(rows);
  assert.equal(s.risks.total, 139);
  assert.equal(s.triggers.total, 266);
  assert.equal(s.prospectiveRisks.total, 28);
  assert.equal(s.prospectiveTriggers.total, 76);
  for (const t of [s.risks, s.triggers, s.prospectiveRisks, s.prospectiveTriggers]) {
    assert.equal(t.needs_rewrite + t.needs_threshold + t.needs_objective, t.total);
  }
  assert.equal(s.openable, 0, 'no script opens a card');
});

test('the committed worklist and summary are exactly what the generator produces', () => {
  const blocks = JSON.parse(fs.readFileSync(new URL('../../../data/risk-radar.json', import.meta.url), 'utf8'));
  const rows = buildWorklist(blocks);
  assert.equal(fs.readFileSync(new URL('../../../data/authoring-worklist.csv', import.meta.url), 'utf8'), toCsv([...WORKLIST_HEADER], rows));
  assert.deepEqual(JSON.parse(fs.readFileSync(new URL('../../../data/authoring-summary.json', import.meta.url), 'utf8')), summariseWorklist(rows));
});

test('the importer accepts a filled row, rejects an incomplete one, and skips untouched rows', () => {
  const blocks = JSON.parse(fs.readFileSync(new URL('../../../data/risk-radar.json', import.meta.url), 'utf8'));
  const rows = buildWorklist(blocks).slice(0, 4);
  const filled = { ...rows[0], author_statement: GOOD.statement, author_window_from: '2026-11-01', author_window_to: '2027-04-30', author_objective: GOOD.objective, author_source: 'IPC', author_resolver: 'R. Resolver', country: 'TCD' };
  const half = { ...rows[1], author_objective: 'something', country: 'TCD' };
  const csv = toCsv([...WORKLIST_HEADER], [filled, half, rows[2], rows[3]]);
  const r = importAuthored(parseCsvObjects(csv));
  assert.equal(r.accepted.length, 1);
  assert.equal(r.accepted[0].resolutionSource, 'IPC');
  assert.equal(r.rejected.length, 1);
  assert.match(r.rejected[0].problems.join(' '), /resolver/);
  assert.equal(r.untouched, 2);
});

test('rater scoring refuses to produce a number from raters who disagree', () => {
  const mk = (id, a, b, statement = 'Cases will exceed 10,000 by June 2027.') => ({ id, statement, objective: '', rater_a: a, rater_b: b });
  const agree = [
    mk('1', 'resolvable', 'resolvable'), mk('2', 'needs_criterion', 'needs_criterion', 'Things get worse.'),
    mk('3', 'resolvable', 'resolvable'), mk('4', 'needs_criterion', 'needs_criterion', 'Tensions rise.'),
    mk('5', 'resolvable', 'resolvable'), mk('6', 'needs_criterion', 'needs_criterion', 'The situation deteriorates.'),
  ];
  const ok = scoreRaters(agree);
  assert.equal(ok.ok, true);
  assert.equal(ok.n, 6);
  assert.equal(ok.kappa.kappa, 1);
  assert.ok(ok.result.warnPrecisionCI, 'reported with an interval');

  const split = agree.map((r, i) => (i % 2 ? { ...r, rater_b: r.rater_a === 'resolvable' ? 'needs_criterion' : 'resolvable' } : r));
  const bad = scoreRaters(split);
  assert.equal(bad.ok, false);
  assert.match(bad.reason, /agree too little/);
  assert.ok(bad.disagreements.length >= 2);

  assert.match(scoreRaters([mk('1', 'resolvable', '')]).reason, /both raters/);
  assert.equal(scoreRaters([mk('1', '', '')]).ok, false, 'unlabelled rows are not labels');
});
