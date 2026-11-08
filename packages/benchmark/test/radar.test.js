import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normaliseRisk, neutralView, loadRadar } from '@benchmark/core/radar';
import { themeOfText } from '@benchmark/core/taxonomy';

const rawExport = JSON.parse(readFileSync(new URL('../../../data/risk-radar.json', import.meta.url), 'utf8'));

const NEUTRAL_KEYS = ['country', 'id', 'isos', 'region', 'riskType', 'theme', 'title'];
const RESTRICTED = ['status', 'outcome', 'level', 'probability', 'impact', 'rationale', 'triggers'];

const one = (pred, label) => {
  const found = rawExport.find(pred);
  assert.ok(found, `the export should contain ${label}`);
  return found;
};

test('normaliseRisk on a single-country record with an outcome of 0', () => {
  const raw = one((r) => r.id === 'R0353', 'R0353');
  const risk = normaliseRisk(raw);
  assert.equal(risk.id, 'R0353');
  assert.equal(risk.country, 'Afghanistan');
  assert.deepEqual(risk.isos, ['AFG']);
  assert.equal(risk.region, 'South & Central Asia');
  assert.equal(risk.outcome, 0);
  assert.equal(risk.status, 'Not materialised');
  assert.equal(risk.riskType, 'New emerging risk');
  assert.equal(risk.level, null, 'an empty riskLevel is null');
  assert.equal(risk.probability, null);
  assert.equal(risk.impact, null);
  assert.equal(risk.rationale, raw.rationale);
  assert.deepEqual(risk.triggers, []);
  assert.equal(risk.theme, 'conflict', 'the title says Taliban attacks and violence');
});

test('normaliseRisk splits a multi-country iso list and maps the region from the first code', () => {
  const raw = one((r) => r.iso === 'CIV, BEN, TGO, GHA', 'the four-country record');
  const risk = normaliseRisk(raw);
  assert.deepEqual(risk.isos, ['CIV', 'BEN', 'TGO', 'GHA']);
  assert.equal(risk.region, 'Sahel & West/Central Africa');
  assert.equal(risk.country, 'Ivory Coast, Benin, Togo, Ghana');
});

test('normaliseRisk keeps a null outcome as null and reads triggerList', () => {
  const raw = one((r) => r.outcome === null && r.triggerList.length > 0, 'a record with no outcome and triggers');
  const risk = normaliseRisk(raw);
  assert.equal(risk.outcome, null);
  assert.ok(risk.triggers.length > 0);
  assert.equal(risk.triggers.length, raw.triggerList.length);
  for (const [i, t] of risk.triggers.entries()) {
    assert.equal(t.id, raw.triggerList[i].triggerId);
    assert.equal(t.title, raw.triggerList[i].title);
    assert.equal(t.description, raw.triggerList[i].description);
  }
  assert.equal(Object.keys(risk.triggers[0]).sort().join(','), 'description,id,title');
});

test('normaliseRisk tolerates garbage input and drops triggers without an id', () => {
  const risk = normaliseRisk({ id: ' R1 ', iso: 'sdn, , ', outcome: '1', triggerList: [{ triggerId: 'T1' }, { title: 'no id' }, null] });
  assert.equal(risk.id, 'R1');
  assert.deepEqual(risk.isos, ['SDN']);
  assert.equal(risk.outcome, 1);
  assert.deepEqual(risk.triggers, [{ id: 'T1', title: null, description: null }]);
  const empty = normaliseRisk(null);
  assert.equal(empty.id, '');
  assert.deepEqual(empty.isos, []);
  assert.equal(empty.region, null);
  assert.equal(empty.outcome, null);
});

test('theme is derived from the title alone, so the hidden rationale cannot change it', () => {
  const a = normaliseRisk({ id: 'T1', title: 'Flooding in the north', rationale: 'Armed clashes and violence.' });
  const b = normaliseRisk({ id: 'T2', title: 'Flooding in the north', rationale: 'Cholera and measles outbreaks.' });
  assert.equal(a.theme, 'climate');
  assert.equal(b.theme, a.theme);
});

test('theme equals themeOfText(title) for every record of the export', () => {
  for (const raw of rawExport) {
    const risk = normaliseRisk(raw);
    assert.equal(risk.theme, themeOfText(risk.title), risk.id);
  }
});

test('neutralView returns exactly the seven allowed keys', () => {
  for (const raw of rawExport) {
    assert.deepEqual(Object.keys(neutralView(normaliseRisk(raw))).sort(), NEUTRAL_KEYS);
  }
});

test('neutralView never carries a restricted field, even when the input has them', () => {
  const full = normaliseRisk(one((r) => r.id === 'R0353', 'R0353'));
  // the input is a full risk with every restricted field set
  const loaded = { ...full, status: 'Active', outcome: 1, level: 'High', probability: 'High', impact: 'High', rationale: full.rationale, triggers: full.triggers };
  const view = neutralView(loaded);
  for (const key of RESTRICTED) {
    assert.equal(Object.hasOwn(view, key), false, `${key} leaked into the neutral view`);
  }
  assert.deepEqual(Object.keys(view).sort(), NEUTRAL_KEYS);
});

test('a serialised neutral view contains no restricted key and no rationale or trigger text', () => {
  const keyPattern = new RegExp(`"(${RESTRICTED.join('|')})"\\s*:`);
  const withRationale = one((r) => r.rationale && r.triggerList.length > 0, 'a record with rationale and triggers');
  const risk = normaliseRisk(withRationale);
  const payload = JSON.stringify(neutralView(risk));
  assert.doesNotMatch(payload, keyPattern);
  assert.equal(payload.includes(risk.rationale), false, 'the rationale text must not appear');
  for (const t of risk.triggers) {
    assert.equal(payload.includes(t.description), false, 'trigger description must not appear');
  }
  for (const raw of rawExport) {
    assert.doesNotMatch(JSON.stringify(neutralView(normaliseRisk(raw))), keyPattern);
  }
});

test('neutralView copies isos rather than sharing the array', () => {
  const risk = normaliseRisk(one((r) => r.iso === 'CIV, BEN, TGO, GHA', 'the four-country record'));
  const view = neutralView(risk);
  view.isos.push('XXX');
  assert.equal(risk.isos.length, 4);
});

test('loadRadar sorts by id, indexes by id, and keeps every export record', () => {
  const { risks, byId } = loadRadar(rawExport);
  assert.equal(risks.length, 139);
  assert.equal(byId.size, 139);
  const ids = risks.map((r) => r.id);
  assert.deepEqual(ids, [...ids].sort());
  assert.equal(byId.get('R0353').country, 'Afghanistan');
});

test('loadRadar is tolerant: non-arrays give an empty radar, id-less records are skipped', () => {
  for (const bad of [null, undefined, {}, 'nope', 42]) {
    const { risks, byId } = loadRadar(bad);
    assert.deepEqual(risks, []);
    assert.equal(byId.size, 0);
  }
  const { risks, byId } = loadRadar([{ title: 'no id' }, { id: '' }, { id: 'B' }, { id: 'A' }, null]);
  assert.deepEqual(risks.map((r) => r.id), ['A', 'B']);
  assert.equal(byId.has('A'), true);
});

test('loadRadar keeps the first record when an id repeats', () => {
  const { byId } = loadRadar([{ id: 'X', title: 'first' }, { id: 'X', title: 'second' }]);
  assert.equal(byId.get('X').title, 'first');
});

test('loadRadar does not change its input', () => {
  const copy = structuredClone(rawExport);
  loadRadar(rawExport);
  assert.deepEqual(rawExport, copy);
});

test('normaliseRisk carries the timeline source data and leaves risk.triggers as it was', () => {
  const raw = one((r) => r.id === 'R0976', 'R0976');
  const risk = normaliseRisk(raw);
  assert.equal(risk.timeline.riskTrend, raw.riskTrend);
  assert.deepEqual(risk.timeline.rationaleUpdates, raw.rationaleUpdates);
  const t = risk.timeline.triggers.find((x) => x.id === 'T0400');
  assert.deepEqual(Object.keys(t).sort(), ['completionHistory', 'dateEnteredISO', 'description', 'id', 'lastUpdateISO', 'title', 'trendHistory']);
  assert.deepEqual(t.completionHistory, raw.triggerList.find((x) => x.triggerId === 'T0400').completionHistory);
  assert.equal(t.dateEnteredISO, '2025-01-06');
  assert.equal(Object.keys(risk.triggers[0]).sort().join(','), 'description,id,title', 'the existing trigger shape is untouched');
});

test('normaliseRisk gives an empty timeline to a record from the old export', () => {
  const old = { id: 'R9', title: 'Old', triggerList: [{ triggerId: 'T1', title: 'a' }] };
  const risk = normaliseRisk(old);
  assert.deepEqual(risk.timeline, {
    riskTrend: null,
    rationaleUpdates: [],
    triggers: [{ id: 'T1', title: 'a', description: null, completionHistory: [], trendHistory: [], dateEnteredISO: null, lastUpdateISO: null }],
  });
  assert.deepEqual(normaliseRisk(null).timeline, { riskTrend: null, rationaleUpdates: [], triggers: [], });
});

test('neutralView does not carry the timeline even when the risk has one', () => {
  const risk = normaliseRisk(one((r) => r.id === 'R0976', 'R0976'));
  assert.ok(risk.timeline.triggers.some((t) => t.completionHistory.length > 0));
  assert.deepEqual(Object.keys(neutralView(risk)).sort(), NEUTRAL_KEYS);
  assert.doesNotMatch(JSON.stringify(neutralView(risk)), /rationaleUpdates|completionHistory|trendHistory/);
});
