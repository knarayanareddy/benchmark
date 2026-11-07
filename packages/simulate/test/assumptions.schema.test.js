// Schema and loader tests for assumptions.json (power-spec §F WP8a, §A.8, §R).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ASSUMPTIONS_PATH, EVIDENCE_TAGS, REVIEW_STATES,
  validate, loadAssumptions, getValue, listKeys, defaults, defaultsOf, unreviewedKeys, reviewSummary,
} from '../src/assumptions.js';

const REAL = JSON.parse(readFileSync(ASSUMPTIONS_PATH, 'utf8'));
const clone = (x) => structuredClone(x);
const entryOf = (data, id) => data.entries.find((e) => e.id === id);

/** Every parameter name that section A (and its table §A.8, plus §B.3/§B.4 constants) refers to. */
const SECTION_A_KEYS = [
  'bandCounts', 'bandHits', 'activeMix', 'statementsPerRisk', 'bandMix', 'shrinkM', 'bandRateUncertainty',
  'tau', 'sigma', 'fracUninformed', 'skillSpread', 'uninformedSd', 'icc', 'omega', 'sigmaBias', 'panelBias',
  'poolMethod', 'extremiseD', 'K', 'dropout', 'dropoutKappa', 'floor', 'kFixed', 'rosterSize',
  'yieldRisk', 'yieldTrigger', 'herd', 'herdSd', 'r2Noise', 'lambdaAcaps', 'lambdaBalanced',
  'pKeep', 'qOpen', 'c2', 'sawThreadShare', 'threadHerd', 'rhoLatent', 'copyShare', 'sharedErrRisk',
  'coupling', 'benchmark', 'triggerBase', 'triggerSpread', 'arrivalRisksPerMonth', 'arrivalTriggersPerMonth',
  'resolutionLagMonths', 'minEffect', 'comparator', 'rule', 'clamp', 'alpha', 'analysisReps', 'analysisSeed',
  'releaseFloor', 'sigmaRef', 'sigmaRefTrigger', 'masterSeed',
];

/** Expected defaults, typed here by hand from the spec, so a typo in the JSON fails the test. */
const EXPECTED = {
  tau: 1.25,
  sigma: null, sigmaRef: 1.53, sigmaRefTrigger: 2.36,
  fracUninformed: 0,
  skillSpread: 0.25, uninformedSd: 0.8,
  icc: 0.2,
  omega: 1,
  sigmaBias: 0.3, panelBias: 0,
  K: 15, dropout: 0.51, dropoutKappa: 10, floor: 5, kFixed: null, rosterSize: 40,
  yieldRisk: 0.6, yieldTrigger: 0.5,
  herd: 0.3, herdSd: 0.1, r2Noise: 0.1,
  lambdaAcaps: 0.3, lambdaBalanced: 0,
  pKeep: 0.3, qOpen: 0.6, c2: 0.7, sawThreadShare: 0, threadHerd: 0.15,
  coupling: 0.7, copyShare: 0, sharedErrRisk: 0.3,
  benchmark: 'in_sample_base_rate',
  triggerBase: 0.4, triggerSpread: 1.47,
  arrivalRisksPerMonth: 4.1, arrivalTriggersPerMonth: 10.75,
  resolutionLagMonths: 3,
  minEffect: null,
  comparator: 'midpoint',
  shrinkM: 0, bandRateUncertainty: false,
  poolMethod: 'median', extremiseD: 1,
  rule: 'mean',
  rhoLatent: 0.3,
  bandCounts: [3, 14, 44, 30, 8],
  bandHits: [1, 6, 21, 25, 7],
  activeMix: [0, 3, 8, 15, 2],
  statementsPerRisk: { activeRisks: 28, activeTriggers: 76 },
  bandMix: 'resolved',
  clamp: [0.01, 0.99], alpha: 0.05, analysisReps: 10000, analysisSeed: 7, releaseFloor: 5,
  masterSeed: 20261107,
};

test('the shipped assumptions.json validates with no problems', () => {
  assert.deepEqual(validate(REAL), []);
  assert.doesNotThrow(() => loadAssumptions());
});

test('the register has the 24 judgement calls J01 to J24, each once', () => {
  const ids = REAL.entries.map((e) => e.id);
  assert.equal(ids.length, 24);
  assert.deepEqual(ids, Array.from({ length: 24 }, (_, i) => `J${String(i + 1).padStart(2, '0')}`));
});

test('every parameter named in section A and its table is a key', () => {
  const keys = new Set(listKeys());
  const missing = SECTION_A_KEYS.filter((k) => !keys.has(k));
  assert.deepEqual(missing, []);
});

test('the key set is exactly the expected key set (no unlisted keys)', () => {
  assert.deepEqual([...listKeys()].sort(), Object.keys(EXPECTED).sort());
});

test('defaults() equals the spec values key by key', () => {
  assert.deepEqual(defaults(), EXPECTED);
});

test('defaultsOf() equals defaults() for the same file', () => {
  const a = loadAssumptions();
  assert.deepEqual(defaultsOf(a), defaults(a));
});

test('getValue returns the default and rejects an unknown key', () => {
  assert.equal(getValue('tau'), 1.25);
  assert.throws(() => getValue('notAKey'), /Unknown assumption key "notAKey"/);
});

test('only the two calls the project owner has decided are reviewed; every other call is still unreviewed', () => {
  const decided = REAL.entries.filter((e) => e.review.state !== 'proposed').map((e) => e.id).sort();
  assert.deepEqual(decided, ['J04', 'J13']);
  const decidedKeys = new Set(REAL.entries.filter((e) => decided.includes(e.id)).flatMap((e) => e.keys));
  const unreviewed = unreviewedKeys();
  assert.ok(unreviewed.length > 0);
  assert.deepEqual([...unreviewed].sort(), listKeys().filter((k) => !decidedKeys.has(k)).sort());
  assert.deepEqual(reviewSummary(), { proposed: 22, accepted: 2, changed: 0, vetoed: 0 });
});

test('every RAN entry carries a source string, and every effect-if-wrong item has a tag and source', () => {
  for (const entry of REAL.entries) {
    if (entry.evidence.tag === 'RAN') {
      assert.ok(typeof entry.evidence.source === 'string' && entry.evidence.source.trim() !== '', `${entry.id} is RAN without a source`);
    }
    assert.ok(entry.ifWrong.length >= 1, `${entry.id} has no effect if wrong`);
    for (const item of entry.ifWrong) {
      assert.ok(EVIDENCE_TAGS.includes(item.tag), `${entry.id} effect has tag ${item.tag}`);
      assert.ok(typeof item.source === 'string' && item.source.trim() !== '', `${entry.id} effect has no source`);
    }
  }
});

test('every entry has all text fields non-empty and at least two options unless CODE', () => {
  for (const entry of REAL.entries) {
    for (const field of ['plain', 'why', 'veto']) {
      assert.ok(entry[field].trim() !== '', `${entry.id}.${field} is empty`);
    }
    if (entry.evidence.tag !== 'CODE') assert.ok(entry.options.length >= 2, `${entry.id} needs two options`);
  }
});

test('the ten required topics each map to an entry', () => {
  const required = ['J03', 'J04', 'J05', 'J06', 'J08', 'J10', 'J11', 'J13', 'J14', 'J16', 'J18'];
  const ids = new Set(REAL.entries.map((e) => e.id));
  for (const id of required) assert.ok(ids.has(id), `${id} missing`);
});

test('a copy with a value outside its range fails and names the key and the range', () => {
  const bad = clone(REAL);
  entryOf(bad, 'J05').value.icc = 0.9;
  const errors = validate(bad);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /J05.*0\.9 for "icc".*outside the allowed range 0 to 0\.6/);
});

test('a copy with an unknown evidence tag fails', () => {
  const bad = clone(REAL);
  entryOf(bad, 'J01').evidence.tag = 'GUESS';
  const errors = validate(bad);
  assert.ok(errors.some((e) => /J01.*evidence tag "GUESS" is not one of RAN, DOC, INFERRED, ASSUMED, CODE/.test(e)), errors.join('\n'));
});

test('a copy with a duplicate entry id fails', () => {
  const bad = clone(REAL);
  bad.entries.push(clone(entryOf(bad, 'J06')));
  const errors = validate(bad);
  assert.ok(errors.some((e) => /The id J06 appears more than once/.test(e)), errors.join('\n'));
});

test('a copy where one key is defined by two entries fails', () => {
  const bad = clone(REAL);
  entryOf(bad, 'J06').keys = ['omega', 'icc'];
  entryOf(bad, 'J06').value.icc = 1;
  entryOf(bad, 'J06').range.icc = { min: 0, max: 2 };
  const errors = validate(bad);
  assert.ok(errors.some((e) => /The key "icc" is defined in more than one entry/.test(e)), errors.join('\n'));
});

test('a copy with a missing plain-language description fails', () => {
  const bad = clone(REAL);
  delete entryOf(bad, 'J07').plain;
  const errors = validate(bad);
  assert.ok(errors.some((e) => /J07.*plain-language description \("plain"\) is missing/.test(e)), errors.join('\n'));
});

test('a copy with no effect-if-wrong fails', () => {
  const bad = clone(REAL);
  delete entryOf(bad, 'J09').ifWrong;
  const errors = validate(bad);
  assert.ok(errors.some((e) => /J09.*effect if wrong \("ifWrong"\) is missing/.test(e)), errors.join('\n'));
});

test('a copy with an unknown review state fails', () => {
  const bad = clone(REAL);
  entryOf(bad, 'J10').review.state = 'maybe';
  const errors = validate(bad);
  assert.ok(errors.some((e) => /J10.*review state "maybe" is not one of proposed, accepted, changed, vetoed/.test(e)), errors.join('\n'));
});

test('a vetoed entry without a reviewer, date or note fails', () => {
  const bad = clone(REAL);
  Object.assign(entryOf(bad, 'J11').review, { state: 'vetoed' });
  const errors = validate(bad);
  assert.ok(errors.some((e) => /J11.*needs the reviewer/.test(e)), errors.join('\n'));
  assert.ok(errors.some((e) => /J11.*needs a date/.test(e)), errors.join('\n'));
  assert.ok(errors.some((e) => /J11.*needs a note/.test(e)), errors.join('\n'));
});

test('a null value fails unless the range allows null', () => {
  const bad = clone(REAL);
  entryOf(bad, 'J08').value.K = null;
  const errors = validate(bad);
  assert.ok(errors.some((e) => /J08.*"K" has no value \(null\)/.test(e)), errors.join('\n'));
});

test('a value not in its oneOf list fails', () => {
  const bad = clone(REAL);
  entryOf(bad, 'J22').value.rule = 'average';
  const errors = validate(bad);
  assert.ok(errors.some((e) => /J22.*the value "average" for "rule" is not one of the allowed values/.test(e)), errors.join('\n'));
});

test('a key with no range fails', () => {
  const bad = clone(REAL);
  delete entryOf(bad, 'J01').range.tau;
  const errors = validate(bad);
  assert.ok(errors.some((e) => /J01.*no range is given for key "tau"/.test(e)), errors.join('\n'));
});

test('an entry with an invalid range (min above max) fails', () => {
  const bad = clone(REAL);
  entryOf(bad, 'J01').range.tau = { min: 2, max: 1 };
  const errors = validate(bad);
  assert.ok(errors.some((e) => /range for "tau" needs a "min" and a "max"/.test(e)), errors.join('\n'));
});

test('a RAN entry with no source fails', () => {
  const bad = clone(REAL);
  delete entryOf(bad, 'J16').evidence.source;
  const errors = validate(bad);
  assert.ok(errors.some((e) => /J16.*evidence has no source/.test(e)), errors.join('\n'));
});

test('an effect-if-wrong item with no tag or source fails', () => {
  const bad = clone(REAL);
  delete entryOf(bad, 'J02').ifWrong[0].tag;
  delete entryOf(bad, 'J02').ifWrong[0].source;
  const errors = validate(bad);
  assert.ok(errors.some((e) => /J02, effect if wrong 1: the tag/.test(e)), errors.join('\n'));
  assert.ok(errors.some((e) => /J02, effect if wrong 1: no source/.test(e)), errors.join('\n'));
});

test('validate lists every problem at once, not only the first', () => {
  const bad = clone(REAL);
  entryOf(bad, 'J05').value.icc = 0.9;
  entryOf(bad, 'J01').evidence.tag = 'GUESS';
  delete entryOf(bad, 'J07').plain;
  bad.entries.push(clone(entryOf(bad, 'J06')));
  const errors = validate(bad);
  assert.ok(errors.length >= 4, `expected at least 4 problems, got ${errors.length}`);
});

test('loadAssumptions rejects a bad file and reports every problem in one error', () => {
  const dir = mkdtempSync(join(tmpdir(), 'assumptions-'));
  const bad = clone(REAL);
  entryOf(bad, 'J05').value.icc = 0.9;
  delete entryOf(bad, 'J09').ifWrong;
  const file = join(dir, 'bad.json');
  writeFileSync(file, JSON.stringify(bad));
  assert.throws(() => loadAssumptions(file), (err) => {
    assert.match(err.message, /has 2 problem\(s\)/);
    assert.match(err.message, /outside the allowed range/);
    assert.match(err.message, /effect if wrong/);
    return true;
  });
});

test('a changed default in the file is what defaults() returns (round trip, not a code constant)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'assumptions-'));
  const changed = clone(REAL);
  entryOf(changed, 'J05').value.icc = 0.4;
  const file = join(dir, 'changed.json');
  writeFileSync(file, JSON.stringify(changed));
  const a = loadAssumptions(file);
  assert.equal(getValue('icc', a), 0.4);
  assert.equal(defaults(a).icc, 0.4);
  assert.equal(defaults().icc, 0.2);
});

test('the loaded object is frozen, including its entries', () => {
  const a = loadAssumptions();
  assert.ok(Object.isFrozen(a));
  assert.ok(Object.isFrozen(a.entries));
  assert.ok(Object.isFrozen(a.entries[0]));
  assert.ok(Object.isFrozen(a.entries[0].value));
  assert.throws(() => { a.entries[0].value.tau = 9; }, TypeError);
});

test('review states and evidence tags are the spec sets', () => {
  assert.deepEqual([...EVIDENCE_TAGS], ['RAN', 'DOC', 'INFERRED', 'ASSUMED', 'CODE']);
  assert.deepEqual([...REVIEW_STATES], ['proposed', 'accepted', 'changed', 'vetoed']);
});
