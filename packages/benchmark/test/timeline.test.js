import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normaliseRisk, neutralView, loadRadar } from '@benchmark/core/radar';
import { buildTimeline, hasHistory } from '@benchmark/core/timeline';

const rawExport = JSON.parse(readFileSync(new URL('../../../data/risk-radar.json', import.meta.url), 'utf8'));
const { risks } = loadRadar(rawExport);
const byId = new Map(risks.map((r) => [r.id, r]));

const trigger = (riskId, triggerId) => {
  const risk = byId.get(riskId);
  assert.ok(risk, `risk ${riskId} should exist`);
  const found = risk.triggers.find((t) => t.id === triggerId);
  assert.ok(found, `trigger ${triggerId} should exist on ${riskId}`);
  return risk.timeline.triggers.find((t) => t.id === triggerId);
};

const distinctDates = (entries) => new Set(entries.map((e) => e.date)).size;

// A trigger counts when one of its points is flagged: a same-day pair that disagrees with itself.
const conflictingTriggers = (key) =>
  risks.flatMap((r) => buildTimeline(r).triggers).filter((t) => t[key].some((p) => p.conflict)).length;

test('R0976 / T0400 parses completion and trend history in file order, as ISO dates and integers', () => {
  const t = trigger('R0976', 'T0400');
  assert.deepEqual(
    t.completionHistory,
    [
      { date: '2025-01-06', value: 50 },
      { date: '2025-01-06', value: 40 },
      { date: '2025-03-03', value: 30 },
      { date: '2025-07-24', value: 40 },
    ],
    'day-first dd-mm-yyyy, same-day lines kept in order, percentages as integers',
  );
  assert.deepEqual(t.trendHistory, [
    { date: '2025-03-03', value: 'Improved' },
    { date: '2025-05-28', value: 'Stable' },
  ]);
  assert.equal(t.dateEnteredISO, '2025-01-06');
  assert.equal(t.lastUpdateISO, '2025-07-24');
});

test('R1043 / T0619: two entries on 02-06-2026 (20% then 10%) are both kept and flagged as a conflict', () => {
  const t = trigger('R1043', 'T0619');
  assert.deepEqual(t.completionHistory, [
    { date: '2026-06-02', value: 20 },
    { date: '2026-06-02', value: 10 },
  ]);
  const tl = buildTimeline(byId.get('R1043'));
  const row = tl.triggers.find((x) => x.id === 'T0619');
  assert.deepEqual(row.completion.map((p) => p.conflict), [true, true]);
  assert.deepEqual(row.movement, { completion: 'none', trend: 'none' }, 'one distinct date gives no movement');
});

test('R1042 rationale updates: headers are day-first and kept in file order (07/08/2026 is 7 August)', () => {
  const updates = byId.get('R1042').timeline.rationaleUpdates;
  assert.deepEqual(
    updates.map((u) => u.date),
    ['2026-09-30', '2026-09-13', '2026-08-07', '2026-07-09', '2026-06-26'],
  );
  for (const u of updates) assert.ok(u.text.length > 0, 'each update carries its text');
  assert.doesNotMatch(updates[0].text, /^UPDATE/i, 'the header line is not part of the text');
});

test('a header matched case-insensitively: R1019 has "Update 11/06/2026" and three later UPPERCASE headers', () => {
  const updates = byId.get('R1019').timeline.rationaleUpdates;
  assert.deepEqual(
    updates.map((u) => u.date),
    ['2026-06-11', '2026-04-30', '2026-03-31', '2026-02-27'],
  );
});

test('R0254 has rationale text with no dated header: one entry with date null, the whole text kept', () => {
  const updates = byId.get('R0254').timeline.rationaleUpdates;
  assert.equal(updates.length, 1);
  assert.equal(updates[0].date, null);
  assert.match(updates[0].text, /^The intensity of armed conflict between PKK/);
  assert.match(updates[0].text, /ICG 16\/05\/2025/, 'inline dates are not headers and stay in the text');
});

test('the real file holds the audited counts', () => {
  const triggers = risks.flatMap((r) => r.triggers);
  assert.equal(triggers.length, 266);
  const tls = risks.flatMap((r) => r.timeline.triggers);
  assert.equal(tls.filter((t) => t.completionHistory.length > 0).length, 140, 'triggers with a completion history');
  assert.equal(tls.filter((t) => t.trendHistory.length > 0).length, 73, 'triggers with a trend history');
  assert.equal(tls.filter((t) => distinctDates(t.completionHistory) >= 2).length, 29, 'triggers with >=2 distinct completion dates');
  assert.equal(risks.filter((r) => r.timeline.rationaleUpdates.length > 0).length, 63, 'risks with rationale update text');
  const dated = risks.flatMap((r) => r.timeline.rationaleUpdates).filter((u) => u.date !== null);
  assert.equal(dated.length, 175, 'dated rationale entries');
  assert.equal(new Set(risks.filter((r) => r.timeline.rationaleUpdates.some((u) => u.date)).map((r) => r.id)).size, 62, 'risks with a dated entry');
});

test('same-day conflicts in the real file: 12 completion triggers and 2 trend triggers (see docs/11 for the audited 13)', () => {
  assert.equal(conflictingTriggers('completion'), 12);
  assert.equal(conflictingTriggers('trend'), 2);
});

test('buildTimeline movement on a real series: T0400 completion ends where it began (flat) and its trend falls', () => {
  const row = buildTimeline(byId.get('R0976')).triggers.find((t) => t.id === 'T0400');
  assert.equal(row.movement.completion, 'flat', 'first distinct date 40 (last of 06-01), last 40 (24-07)');
  assert.equal(row.movement.trend, 'down', 'Improved then Stable');
  assert.deepEqual(row.dateEntered, '2025-01-06');
  assert.deepEqual(row.lastUpdate, '2025-07-24');
});

test('buildTimeline movement: up, down, flat and none, from the first and last distinct dates', () => {
  const risk = (completion, trend = []) => ({
    timeline: {
      riskTrend: null,
      rationaleUpdates: [],
      triggers: [{ id: 'T1', title: null, description: null, completionHistory: completion, trendHistory: trend, dateEnteredISO: null, lastUpdateISO: null }],
    },
  });
  const m = (completion, trend) => buildTimeline(risk(completion, trend)).triggers[0].movement;
  assert.deepEqual(m([{ date: '2025-01-01', value: 10 }, { date: '2025-02-01', value: 60 }]).completion, 'up');
  assert.deepEqual(m([{ date: '2025-01-01', value: 60 }, { date: '2025-02-01', value: 10 }]).completion, 'down');
  assert.deepEqual(m([{ date: '2025-01-01', value: 40 }, { date: '2025-03-01', value: 60 }, { date: '2025-04-01', value: 40 }]).completion, 'flat');
  assert.deepEqual(m([{ date: '2025-01-01', value: 40 }]).completion, 'none');
  // a same-day correction counts as that day's reading, the last one written
  assert.deepEqual(m([{ date: '2025-01-01', value: 90 }, { date: '2025-01-01', value: 20 }, { date: '2025-02-01', value: 50 }]).completion, 'up');
  assert.deepEqual(m([], [{ date: '2025-01-01', value: 'Deteriorated' }, { date: '2025-02-01', value: 'Improved' }]).trend, 'up');
  assert.deepEqual(m([], [{ date: '2025-01-01', value: 'Improved' }, { date: '2025-02-01', value: 'Deteriorated' }]).trend, 'down');
});

test('a same-day pair with the same value is not a conflict; a disagreeing pair is', () => {
  const real = buildTimeline(byId.get('R0976')).triggers.find((t) => t.id === 'T0400');
  assert.deepEqual(real.completion.map((p) => p.conflict), [true, true, false, false], 'the 06-01-2025 pair is 50 then 40');
  const tl = buildTimeline({
    timeline: {
      riskTrend: null,
      rationaleUpdates: [],
      triggers: [{ id: 'T1', title: null, description: null, dateEnteredISO: null, lastUpdateISO: null, trendHistory: [], completionHistory: [{ date: '2025-01-01', value: 30 }, { date: '2025-01-01', value: 30 }, { date: '2025-02-01', value: 30 }] }],
    },
  });
  assert.deepEqual(tl.triggers[0].completion.map((p) => p.conflict), [false, false, false]);
});

test('span is the earliest and latest dated point over trigger and rationale points; points is their count', () => {
  const tl = buildTimeline(byId.get('R0976'));
  const dates = [
    ...tl.triggers.flatMap((t) => [...t.completion, ...t.trend].map((p) => p.date)),
    ...tl.rationaleUpdates.flatMap((u) => (u.date ? [u.date] : [])),
  ];
  assert.deepEqual(tl.span, { from: [...dates].sort()[0], to: [...dates].sort().at(-1) });
  assert.equal(tl.points, dates.length);
  assert.ok(tl.points > 0);
});

test('a risk with only undated text has no span and no points', () => {
  const tl = buildTimeline(byId.get('R0254'));
  assert.equal(tl.rationaleUpdates.length, 1, 'the undated text is still carried');
  assert.equal(tl.triggers.length, 0);
  assert.equal(tl.points, 0);
  assert.equal(tl.span, null);
  assert.equal(hasHistory(byId.get('R0254')), false);
});

test('hasHistory is true for a risk with dated history and false for one without', () => {
  assert.equal(hasHistory(byId.get('R0976')), true);
  const bare = risks.find(
    (r) => r.timeline.rationaleUpdates.length === 0 && r.timeline.triggers.every((t) => t.completionHistory.length === 0 && t.trendHistory.length === 0),
  );
  assert.ok(bare, 'the export has a risk with no history');
  assert.equal(hasHistory(bare), false);
});

test('a record from the old export (no timeline fields) gives an empty timeline and does not throw', () => {
  // the export as it was before ingest.py added the timeline fields
  const old = rawExport.map((r) => {
    const rest = { ...r };
    delete rest.riskTrend;
    delete rest.rationaleUpdates;
    rest.triggerList = r.triggerList.map((t) => {
      const kept = { ...t };
      for (const k of ['completionHistory', 'trendHistory', 'dateEnteredISO', 'lastUpdateISO']) delete kept[k];
      return kept;
    });
    return rest;
  });
  assert.equal(old.length, 139);
  for (const raw of old) {
    const risk = normaliseRisk(raw);
    assert.deepEqual(buildTimeline(risk), { riskTrend: null, rationaleUpdates: [], triggers: [], span: null, points: 0 });
    assert.equal(hasHistory(risk), false);
  }
  assert.deepEqual(buildTimeline(undefined), { riskTrend: null, rationaleUpdates: [], triggers: [], span: null, points: 0 });
  assert.equal(hasHistory(null), false);
});

test('malformed history entries are dropped, not crashed on', () => {
  const tl = buildTimeline({
    timeline: {
      riskTrend: '',
      rationaleUpdates: [null, { date: '2025-13-40', text: 'bad date kept as undated' }, 'x'],
      triggers: [
        { id: 'T1', completionHistory: [{ date: '2025-01-01', value: 'high' }, { date: 'yesterday', value: 10 }, { date: '2025-01-02', value: 12.5 }, null], trendHistory: 'nope' },
        { title: 'no id' },
      ],
    },
  });
  assert.equal(tl.riskTrend, null);
  assert.deepEqual(tl.rationaleUpdates, [{ date: null, text: 'bad date kept as undated' }]);
  assert.equal(tl.triggers.length, 0, 'no valid integer completion point and no trend points');
  assert.equal(tl.points, 0);
});

test('neutralView stays exactly the seven keys even when the risk carries a timeline', () => {
  const risk = byId.get('R0976');
  assert.ok(risk.timeline.triggers.some((t) => t.completionHistory.length > 0), 'the risk really carries history');
  const view = neutralView(risk);
  assert.deepEqual(Object.keys(view).sort(), ['country', 'id', 'isos', 'region', 'riskType', 'theme', 'title']);
  const payload = JSON.stringify(view);
  assert.doesNotMatch(payload, /rationaleUpdates|completionHistory|trendHistory|dateEnteredISO|lastUpdateISO|"timeline"/);
  assert.ok(JSON.stringify(risk).includes('completionHistory'), 'the full risk does carry the history, so the check is not vacuous');
});
