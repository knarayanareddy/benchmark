import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveParams, paramKeysAccessed, paramTable } from '../src/params.js';
import { loadAssumptions, EVIDENCE_TAGS } from '../src/assumptions.js';

test('defaults come from assumptions.json, frozen', () => {
  const p = resolveParams();
  assert.ok(Object.isFrozen(p));
  assert.equal(p.tau, 1.25);
  assert.equal(p.icc, 0.2);
  assert.equal(p.K, 15);
  assert.equal(p.kFixed, null);
  assert.equal(p.benchmark, 'in_sample_base_rate');
  assert.deepEqual(p.bandCounts, [3, 14, 44, 30, 8]);
});

test('every assumptions entry round-trips: the value the simulator reads is the value in the file', () => {
  const p = resolveParams();
  for (const entry of loadAssumptions().entries) {
    for (const key of entry.keys) {
      assert.deepEqual(p[key], entry.value[key], `${entry.id} ${key}`);
    }
  }
});

test('valid overrides are accepted, including null where the file allows it', () => {
  assert.equal(resolveParams({ icc: 0.4 }).icc, 0.4);
  assert.equal(resolveParams({ kFixed: 8 }).kFixed, 8);
  assert.equal(resolveParams({ kFixed: null }).kFixed, null);
  assert.equal(resolveParams({ floor: 3 }).floor, 3);
  assert.equal(resolveParams({ sigma: null }).sigma, null);
  assert.equal(resolveParams({ sigma: 2.36 }).sigma, 2.36);
});

test('an unknown override key throws', () => {
  assert.throws(() => resolveParams({ typo: 1 }), /unknown parameter typo/);
});

test('out-of-range and wrongly typed overrides throw', () => {
  assert.throws(() => resolveParams({ icc: 1.2 }), /icc = 1.2 is outside \[0, 0.6\]/);
  assert.throws(() => resolveParams({ icc: -0.1 }), RangeError);
  assert.throws(() => resolveParams({ icc: '0.2' }), /must be a finite number/);
  assert.throws(() => resolveParams({ icc: NaN }), RangeError);
  assert.throws(() => resolveParams({ kFixed: 2 }), /outside \[3, 15\]/);
  assert.throws(() => resolveParams({ kFixed: 'five' }), RangeError);
  assert.throws(() => resolveParams({ floor: 4 }), /must be one of/);
  assert.throws(() => resolveParams({ benchmark: 'fixed_0.6' }), /must be one of/);
  assert.throws(() => resolveParams({ sigma: null, icc: null }), /may not be null/);
  assert.throws(() => resolveParams({ bandCounts: [1, 2, 3, 4, 5] }), /must be one of/);
});

test('reading an unknown key from resolved parameters throws; writing to them throws', () => {
  const p = resolveParams();
  assert.throws(() => p.notAKey, /unknown parameter notAKey/);
  assert.equal('notAKey' in p, false);
  assert.throws(() => {
    p.tau = 2;
  }, TypeError);
  assert.throws(() => {
    p.bandCounts.push(1);
  }, TypeError);
  assert.equal(p.tau, 1.25);
  assert.equal(p.then, undefined, 'await and promise plumbing must not trip the guard');
});

test('paramKeysAccessed records exactly the keys read, in order', () => {
  const p = resolveParams({ icc: 0.3 });
  assert.deepEqual(paramKeysAccessed(p), []);
  void p.tau;
  void p.icc;
  void p.icc;
  assert.deepEqual(paramKeysAccessed(p), ['tau', 'icc']);
  assert.throws(() => paramKeysAccessed({ tau: 1 }), TypeError);
});

test('paramTable lists every key with its value, default, evidence tag and register id', () => {
  const assumptions = loadAssumptions();
  const p = resolveParams({ icc: 0.4 });
  const table = paramTable(p);
  const keys = assumptions.entries.flatMap((e) => e.keys);
  assert.equal(table.length, keys.length);
  assert.deepEqual(table.map((r) => r.key).sort(), [...keys].sort());
  const icc = table.find((r) => r.key === 'icc');
  assert.equal(icc.value, 0.4);
  assert.equal(icc.default, 0.2);
  assert.equal(icc.register, 'J05');
  assert.ok(EVIDENCE_TAGS.includes(icc.status));
  for (const row of table) {
    assert.ok(/^J\d{2}$/.test(row.register), row.key);
    assert.ok(EVIDENCE_TAGS.includes(row.status), row.key);
  }
  assert.equal(paramKeysAccessed(p).length, 0, 'reading the table does not count as reading parameters');
});
