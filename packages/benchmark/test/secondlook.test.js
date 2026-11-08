import test from 'node:test';
import assert from 'node:assert/strict';
import { ARMS, assignArm, validateSecondLook, contentForArm, summariseArms } from '@benchmark/core/secondlook';
import { hmacSha256Hex } from '@benchmark/core/hmac';

const GOOD = {
  acapsReasoning: 'ACAPS reads this risk from the recent ACLED trend and the seasonal pattern.',
  sources: [{ label: 'ACLED dashboard', url: 'https://acleddata.com/dashboard' }],
  higher: ['Rainy-season flooding raises cholera risk in the district.'],
  lower: ['Vaccination campaigns reached most of the district in October.'],
};
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);

test('good content validates, and every string is trimmed in the result', () => {
  const r = validateSecondLook({
    acapsReasoning: `  ${GOOD.acapsReasoning}  `,
    sources: [{ label: ' ACLED ', url: ' https://acleddata.com/dashboard ' }],
    higher: [` ${GOOD.higher[0]} `],
    lower: [GOOD.lower[0]],
  });
  assert.equal(r.ok, true);
  assert.deepEqual(r.problems, []);
  assert.deepEqual(r.content, {
    acapsReasoning: GOOD.acapsReasoning,
    sources: [{ label: 'ACLED', url: 'https://acleddata.com/dashboard' }],
    higher: GOOD.higher,
    lower: GOOD.lower,
  });
});

test('every problem is reported at once, and nothing throws', () => {
  const r = validateSecondLook({
    acapsReasoning: 'too short',
    sources: [{ label: '', url: 'http://example.org/a' }],
    higher: ['tiny'],
    lower: 'not a list',
  });
  assert.equal(r.ok, false);
  assert.equal(r.content, null);
  for (const label of ['acapsReasoning', 'sources[0].label', 'sources[0].url', 'higher[0]', 'lower']) {
    assert.ok(r.problems.some((p) => p.startsWith(label)), `a problem for ${label}`);
  }
  for (const junk of [null, undefined, 42, 'text', []]) {
    assert.equal(validateSecondLook(junk).ok, false);
  }
});

test('length limits: acapsReasoning 20..2000, sources 1..8, labels 1..120, higher/lower 1..5 items of 10..500', () => {
  const ok = (over) => validateSecondLook({ ...GOOD, ...over }).ok;
  assert.equal(ok({ acapsReasoning: 'x'.repeat(19) }), false);
  assert.equal(ok({ acapsReasoning: 'x'.repeat(20) }), true);
  assert.equal(ok({ acapsReasoning: 'x'.repeat(2000) }), true);
  assert.equal(ok({ acapsReasoning: 'x'.repeat(2001) }), false);
  assert.equal(ok({ sources: [] }), false);
  assert.equal(ok({ sources: Array.from({ length: 9 }, () => GOOD.sources[0]) }), false);
  assert.equal(ok({ sources: [{ label: 'x'.repeat(121), url: GOOD.sources[0].url }] }), false);
  assert.equal(ok({ sources: [{ label: 'x'.repeat(120), url: GOOD.sources[0].url }] }), true);
  assert.equal(ok({ higher: [] }), false);
  assert.equal(ok({ higher: Array.from({ length: 6 }, () => GOOD.higher[0]) }), false);
  assert.equal(ok({ lower: ['too short'] }), false);
  assert.equal(ok({ lower: ['x'.repeat(501)] }), false);
  assert.equal(ok({ lower: ['x'.repeat(500)] }), true);
});

test('no probability figure or rating-as-probability may appear in any string', () => {
  const bad = [
    'About 70% of the district will flood by December.',
    'Roughly 70 per cent chance of flooding in the district.',
    'Flooding is 12.5 percent likely to recur in the district.',
    'The district has a very low probability of recurrence this season.',
    'The outcome carries High Probability in the modelling.',
    'Experts saw a medium probability in the earlier round.',
  ];
  for (const s of bad) {
    assert.equal(validateSecondLook({ ...GOOD, acapsReasoning: s }).ok, false, s);
    assert.equal(validateSecondLook({ ...GOOD, higher: [s] }).ok, false, s);
    assert.equal(validateSecondLook({ ...GOOD, lower: [s] }).ok, false, s);
    assert.equal(validateSecondLook({ ...GOOD, sources: [{ label: s.slice(0, 120), url: GOOD.sources[0].url }] }).ok, false, s);
  }
  assert.equal(validateSecondLook({ ...GOOD, acapsReasoning: 'The reading relies on three months of trend data.' }).ok, true);
});

test('sources must be https addresses', () => {
  for (const url of ['http://example.org/a', 'javascript:alert(1)', 'not a url', '', 'ftp://example.org/x']) {
    assert.equal(validateSecondLook({ ...GOOD, sources: [{ label: 'x', url }] }).ok, false, url);
  }
  assert.equal(validateSecondLook({ ...GOOD, sources: [{ label: 'x', url: 'https://example.org/a' }] }).ok, true);
});

test('assignArm is deterministic, rejects non-hex and short input, and is roughly uniform over 900 keys', () => {
  const hex = hmacSha256Hex('a-test-secret-of-some-length', 'arm-check:0');
  assert.equal(assignArm(hex), assignArm(hex));
  assert.throws(() => assignArm('zzzzzzzz'), TypeError);
  assert.throws(() => assignArm('abc'), TypeError);
  assert.throws(() => assignArm(undefined), TypeError);
  const counts = Object.fromEntries(ARMS.map((a) => [a, 0]));
  for (let i = 0; i < 900; i++) counts[assignArm(hmacSha256Hex('a-test-secret-of-some-length', `key:${i}`))]++;
  for (const arm of ARMS) {
    assert.ok(counts[arm] >= 0.26 * 900 && counts[arm] <= 0.40 * 900, `${arm} got ${counts[arm]} of 900`);
  }
});

test('for one respondent, the arm varies independently across card ids', () => {
  const counts = Object.fromEntries(ARMS.map((a) => [a, 0]));
  for (let i = 0; i < 900; i++) counts[assignArm(hmacSha256Hex('a-test-secret-of-some-length', `arm:v1:C${i}:id:ex_same`))]++;
  for (const arm of ARMS) {
    assert.ok(counts[arm] >= 0.26 * 900 && counts[arm] <= 0.40 * 900, `${arm} got ${counts[arm]} of 900`);
  }
});

test('contentForArm: control gets nothing; each arm gets only its own fields', () => {
  const c = validateSecondLook(GOOD).content;
  assert.equal(contentForArm(c, 'control'), null);
  assert.deepEqual(contentForArm(c, 'balanced'), { kind: 'balanced', higher: GOOD.higher, lower: GOOD.lower });
  assert.deepEqual(contentForArm(c, 'acaps_view'), {
    kind: 'acaps_view', acapsReasoning: GOOD.acapsReasoning, sources: GOOD.sources,
  });
  assert.deepEqual(Object.keys(contentForArm(c, 'acaps_view').sources[0]).sort(), ['label', 'url']);
  assert.throws(() => contentForArm(c, 'anchored'), RangeError);
  assert.throws(() => contentForArm(c, undefined), RangeError);
});

test('summariseArms: hand-computed pooled numbers, with the ACAPS comparison and sawCount', () => {
  // acapsP 0.705: |0.2 - 0.705| - |0.3 - 0.705| = 0.505 - 0.405 = 0.1 (moved toward ACAPS)
  const toward = Array.from({ length: 5 }, (_, i) => ({ arm: 'balanced', p1: 0.2, p2: 0.3, acapsP: 0.705, saw: i < 2 }));
  // |0.6 - 0.705| - |0.2 - 0.705| = 0.105 - 0.505 = -0.4 (moved away from ACAPS)
  const away = Array.from({ length: 5 }, () => ({ arm: 'acaps_view', p1: 0.6, p2: 0.2, acapsP: 0.705, saw: true }));
  const small = Array.from({ length: 2 }, () => ({ arm: 'control', p1: 0.5, p2: 0.9, acapsP: null, saw: false }));
  const s = summariseArms([...toward, ...away, ...small]);
  assert.deepEqual(Object.keys(s), [...ARMS]);
  assert.equal(s.balanced.n, 5);
  assert.equal(s.balanced.suppressed, false);
  near(s.balanced.meanShift, 0.1);
  near(s.balanced.meanTowardAcaps, 0.1);
  assert.equal(s.balanced.nWithAcaps, 5);
  assert.equal(s.balanced.sawCount, 2);
  assert.equal(s.acaps_view.n, 5);
  near(s.acaps_view.meanShift, -0.4);
  near(s.acaps_view.meanTowardAcaps, -0.4);
  assert.equal(s.acaps_view.sawCount, 5);
  assert.deepEqual(s.control, { n: 2, suppressed: true, meanShift: null, meanTowardAcaps: null, nWithAcaps: null, sawCount: null });
});

test('summariseArms suppresses an arm under the floor and never reports its small-cell values', () => {
  const s = summariseArms(Array.from({ length: 4 }, () => ({ arm: 'balanced', p1: 0.2, p2: 0.3, acapsP: 0.7, saw: true })));
  assert.deepEqual(s.balanced, { n: 4, suppressed: true, meanShift: null, meanTowardAcaps: null, nWithAcaps: null, sawCount: null });
  assert.equal(s.control.suppressed, true);
  assert.equal(summariseArms(Array.from({ length: 2 }, () => ({ arm: 'balanced', p1: 0.2, p2: 0.3, acapsP: 0.7, saw: true })), { floor: 2 }).balanced.suppressed, false);
});

test('summariseArms withholds the ACAPS comparison below the floor, and handles a missing ACAPS reading', () => {
  const four = Array.from({ length: 4 }, () => ({ arm: 'balanced', p1: 0.2, p2: 0.3, acapsP: 0.7, saw: false }));
  const unrated = Array.from({ length: 5 }, () => ({ arm: 'balanced', p1: 0.2, p2: 0.3, acapsP: null, saw: false }));
  const s = summariseArms([...four, ...unrated]);
  assert.equal(s.balanced.n, 9);
  near(s.balanced.meanShift, 0.1);
  assert.equal(s.balanced.meanTowardAcaps, null, 'only four pairs have a reading: below the floor');
  assert.equal(s.balanced.nWithAcaps, null, 'the count of a small cell is withheld too');
  assert.equal(summariseArms([]).control.n, 0);
});

test('the guard catches a probability slipped in as a decimal, odds, words or a rating, and leaves ordinary numbers alone', () => {
  const wrap = (s) => validateSecondLook({ acapsReasoning: `${s} plus enough other words to pass`, sources: [{ label: 'x', url: 'https://a.org' }], higher: ['a first reason that is long enough'], lower: ['a second reason that is long enough'] });
  for (const bad of ['It is about 70%', 'roughly 0.7 likely', 'around .65', '7 in 10', 'seven in ten odds', 'a 70 percent chance', 'about three quarters likely to happen', 'the chance is around 7', 'probability is high', 'High probability of famine', '12 percentage points above', 'ACAPS puts it at 80 pts']) {
    assert.equal(wrap(bad).ok, false, `should refuse: ${bad}`);
  }
  for (const fine of ['The 2024 harvest failed in three districts and prices doubled.', 'About 1.5 million people were displaced since 2023.', 'Cholera cases rose in 12 districts in the last 3 weeks.', 'The rains started in March and the border closed in April.']) {
    assert.equal(wrap(fine).ok, true, `should accept: ${fine}`);
  }
});
