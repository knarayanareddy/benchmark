import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LEVELS, DEFAULT_LEVEL, LEVEL_COPY,
  resolveLevel, aliasFor, attribute, leaksBy, publicable, PUBLIC,
} from '../../core/src/anonymity.js';

const A = { expertId: 'e-001', name: 'Amina Okoro', country: 'TCD', text: 'The crossing at Adré is the tell.', at: '2026-11-06T10:00:00Z' };

test('the default is the hedge, not the extreme', () => {
  assert.equal(DEFAULT_LEVEL, LEVELS.PSEUDONYMOUS);
});

test('identified attribution keeps the name and drops the internal id', () => {
  const out = attribute(A, LEVELS.IDENTIFIED);
  assert.equal(out.by, 'Amina Okoro');
  assert.equal(out.expertId, undefined, 'internal id must never reach a render');
  assert.equal(out.country, 'TCD');
});

test('pseudonymous attribution gives a stable alias and drops the name', () => {
  const a = attribute(A, LEVELS.PSEUDONYMOUS);
  const b = attribute(A, LEVELS.PSEUDONYMOUS);
  assert.equal(a.by, b.by, 'the alias must be stable across contributions');
  assert.match(a.by, /^Analyst \d\d$/);
  assert.equal(a.name, undefined);
  assert.equal(a.expertId, undefined);
});

test('two experts in the same country get different aliases', () => {
  const x = attribute(A, LEVELS.PSEUDONYMOUS);
  const y = attribute({ ...A, expertId: 'e-002', name: 'Bello Adamu' }, LEVELS.PSEUDONYMOUS);
  assert.notEqual(x.by, y.by);
});

test('anonymous attribution removes the metadata that would re-identify', () => {
  const out = attribute(A, LEVELS.ANONYMOUS);
  assert.equal(out.by, 'anonymous');
  assert.equal(out.country, undefined, 'country + panel of 5 is an identity');
  assert.equal(out.at, undefined, 'a timestamp in a small panel is an identity');
  assert.equal(out.expertId, undefined);
  assert.equal(out.name, undefined);
});

test('removed means absent, not blank', () => {
  const out = attribute(A, LEVELS.ANONYMOUS);
  assert.ok(!('name' in out) && !('expertId' in out), 'blanked fields still leak through object shape');
});

test('how much each level reveals to ACAPS is stated, not implied', () => {
  for (const lvl of Object.values(LEVELS)) {
    const copy = LEVEL_COPY[lvl];
    assert.ok(copy && copy.label && copy.toAcaps && copy.toPeers,
      `${lvl} must tell the expert what ACAPS sees and what peers see`);
  }
  assert.match(LEVEL_COPY[LEVELS.PSEUDONYMOUS].warn, /writing style/i);
  assert.match(LEVEL_COPY[LEVELS.ANONYMOUS].warn, /cannot be contacted/i);
});

test('an unknown level falls back visibly rather than silently', () => {
  const r = resolveLevel('super-anonymous');
  assert.equal(r.honoured, false);
  assert.equal(r.level, DEFAULT_LEVEL);
  assert.match(r.why, /unknown level/);
});

test('valid levels are honoured exactly', () => {
  for (const lvl of Object.values(LEVELS)) {
    const r = resolveLevel(lvl);
    assert.equal(r.level, lvl);
    assert.equal(r.honoured, true);
  }
});

test('the anonymity warning catches self-identification through the text', () => {
  const w = leaksBy({ ...A, text: 'Speaking as Amina Okoro, I think the border is the tell.' });
  assert.ok(w.some((x) => /names its author/.test(x)));
});

test('the warning fires on a panel too small to hide anyone', () => {
  const peers = [{ name: 'B' }, { name: 'C' }];
  const w = leaksBy(A, peers);
  assert.ok(w.some((x) => /panel of 2/.test(x)));
  assert.ok(w.some((x) => /may single out one person/.test(x)));
});

test('a clean contribution from a full panel produces no warning', () => {
  const peers = [{ name: 'B' }, { name: 'C' }, { name: 'D' }, { name: 'E' }, { name: 'F' }];
  assert.deepEqual(leaksBy(A, peers), []);
});

test('public output suppresses small counts instead of publishing them', () => {
  const { published, suppressedCells } = publicable({ TCD: 7, NER: 12, NGA: 31 });
  assert.deepEqual(published, { NER: 12, NGA: 31 });
  assert.equal(suppressedCells, 1, 'a count of 7 next to a country name is a person');
});

test('public anonymity is a rule, not a setting', () => {
  assert.equal(PUBLIC.attributable, false);
  assert.equal(PUBLIC.minCount, 10);
});

test('alias derivation is deterministic across runs and salts', () => {
  assert.equal(aliasFor('e-001', 'TCD'), aliasFor('e-001', 'TCD'));
  assert.notEqual(aliasFor('e-001', 'TCD', 'v2'), aliasFor('e-001', 'TCD', 'v1'));
});
