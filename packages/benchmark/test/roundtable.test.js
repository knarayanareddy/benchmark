import test from 'node:test';
import assert from 'node:assert/strict';
import { validatePost, MAX_TEXT, MAX_POSTS_PER_RESPONDENT, KINDS } from '@benchmark/core/roundtable';

const ok = (input) => {
  const r = validatePost(input);
  assert.equal(r.ok, true, r.problems.join('; '));
  return r.post;
};
const refused = (input) => {
  const r = validatePost(input);
  assert.equal(r.ok, false);
  assert.equal(r.post, null);
  assert.ok(r.problems.length >= 1);
  return r.problems;
};

test('the constants are the contract: 600 characters, five posts per respondent, six kinds', () => {
  assert.equal(MAX_TEXT, 600);
  assert.equal(MAX_POSTS_PER_RESPONDENT, 5);
  assert.deepEqual([...KINDS], ['claim', 'evidence', 'counter', 'question', 'missing_risk', 'reply']);
});

test('a plain top-level post of each kind is accepted, trimmed, with no parent', () => {
  for (const kind of ['claim', 'evidence', 'counter', 'question', 'missing_risk']) {
    assert.deepEqual(ok({ kind, text: '  The rainy season is the main driver here.  ', parentId: null }), {
      kind, text: 'The rainy season is the main driver here.', parentId: null,
    });
  }
});

test('a reply needs a parentId and keeps it; the parentId is trimmed', () => {
  assert.deepEqual(ok({ kind: 'reply', text: 'I agree with the point about vaccination.', parentId: ' p_1 ' }), {
    kind: 'reply', text: 'I agree with the point about vaccination.', parentId: 'p_1',
  });
  assert.ok(refused({ kind: 'reply', text: 'A reply with nothing to reply to.' }).some((p) => /needs a parentId/.test(p)));
  assert.ok(refused({ kind: 'reply', text: 'A reply with an empty parent.', parentId: '   ' }).some((p) => /needs a parentId/.test(p)));
});

test('only a reply may have a parentId', () => {
  assert.ok(refused({ kind: 'claim', text: 'A claim that claims to answer something.', parentId: 'p_1' }).some((p) => /only a reply/.test(p)));
});

test('an unknown kind is refused', () => {
  assert.ok(refused({ kind: 'opinion', text: 'A perfectly fine sentence here.' }).some((p) => /kind must be one of/.test(p)));
  assert.ok(refused({ text: 'A perfectly fine sentence here.' }).some((p) => /kind must be one of/.test(p)));
});

test('text is 1 to 600 characters after trimming: 600 is accepted, 601 and empty are refused', () => {
  assert.equal(ok({ kind: 'claim', text: 'a'.repeat(600) }).text.length, 600);
  assert.ok(refused({ kind: 'claim', text: 'a'.repeat(601) }).some((p) => /1 to 600 characters/.test(p)));
  assert.ok(refused({ kind: 'claim', text: '   ' }).some((p) => /1 to 600 characters/.test(p)));
  assert.ok(refused({ kind: 'claim', text: undefined }).some((p) => /1 to 600 characters/.test(p)));
  assert.ok(refused({ kind: 'claim', text: 42 }).some((p) => /1 to 600 characters/.test(p)));
});

test('a stated probability, percentage or odds is refused (the secondlook guard)', () => {
  for (const text of [
    'I think it is about 60% likely.',
    'Odds are 3 to 1 against it.',
    'Roughly 7 in 10 districts will flood.',
    'The chance is 0.7 at most.',
    'It is a high probability event.',
  ]) {
    assert.ok(refused({ kind: 'claim', text }).some((p) => /must not state a probability/.test(p)), text);
  }
});

test('a stated own answer, estimate or forecast as a figure is refused, in the doc\'s wording', () => {
  for (const text of [
    'my estimate is 40',
    'Our forecast was 0.4 last month.',
    'My answer would be around a third.',
    'my number is 12',
    'my probability was low',
    'my estimate is high',
  ]) {
    assert.ok(refused({ kind: 'claim', text }).some((p) => /your own answer, estimate or forecast/.test(p)), text);
  }
});

test('ordinary discussion that mentions estimates without stating one is accepted', () => {
  for (const text of [
    'The estimate in the bulletin looks too low to me.',
    'Our team never saw a cholera case in that district before.',
    'Why did the forecast ignore the rainy season?',
    'Flooding in the district raises the chance of an outbreak.',
  ]) {
    ok({ kind: 'question', text });
  }
});

test('every problem is reported together, and a refused post has no post object', () => {
  const r = validatePost({ kind: 'bogus', text: 'x'.repeat(601), parentId: 'p_1' });
  assert.equal(r.ok, false);
  assert.equal(r.post, null);
  assert.equal(r.problems.length, 3);
});

test('a missing input object is refused rather than thrown', () => {
  assert.equal(validatePost(undefined).ok, false);
  assert.equal(validatePost(null).ok, false);
});
