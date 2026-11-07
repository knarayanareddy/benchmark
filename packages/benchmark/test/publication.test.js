import test from 'node:test';
import assert from 'node:assert/strict';
import {
  COOLING_OFF_MS, CHECKLIST, STATUS, TRANSITIONS, canTransition, validateResponse, validateReview, publicView, erasedRecord,
} from '@benchmark/core/publication';

const TEXT = 'The rainy season will cut the road to the district before the window opens.';
const HINT = 'I am the WFP country director in Juba';
const ALL = { noThirdParties: true, noLocationDetail: true, riskUnderstood: true };

test('cooling-off is 48 hours and the checklist is the three items the doc names', () => {
  assert.equal(COOLING_OFF_MS, 48 * 3600 * 1000);
  assert.deepEqual([...CHECKLIST], ['noThirdParties', 'noLocationDetail', 'riskUnderstood']);
});

test('the forward path is allowed; skipping a step is not', () => {
  assert.ok(canTransition('proposed', 'consented'));
  assert.ok(canTransition('consented', 'approved'));
  assert.ok(canTransition('approved', 'published'));
  assert.ok(!canTransition('consented', 'published'), 'a consented item cannot be published without approval');
  assert.ok(!canTransition('proposed', 'approved'), 'nothing is approved before the author has consented');
  assert.ok(!canTransition('published', 'approved'));
  assert.ok(!canTransition('nonsense', 'consented'));
});

test('withdrawal is available from every non-terminal state and from nothing terminal', () => {
  for (const s of [STATUS.PROPOSED, STATUS.CONSENTED, STATUS.APPROVED, STATUS.PUBLISHED]) {
    assert.ok(canTransition(s, STATUS.WITHDRAWN), `${s} must allow withdrawal`);
  }
  for (const s of [STATUS.DECLINED, STATUS.REJECTED, STATUS.WITHDRAWN]) {
    assert.deepEqual(TRANSITIONS[s], [], `${s} is terminal`);
    assert.ok(!canTransition(s, STATUS.WITHDRAWN));
  }
});

test('decline is a clean exit with nothing to keep', () => {
  assert.deepEqual(validateResponse({ decision: 'decline', text: 'ignored', displayName: 'Ignored Name' }), {
    ok: true, problems: [], value: { decision: 'decline', text: null, credit: null },
  });
});

test('uncredited text with an identifying hint is refused; the same text credited may name a role', () => {
  const refused = validateResponse({ decision: 'uncredited', text: HINT });
  assert.equal(refused.ok, false);
  assert.match(refused.problems.join(' '), /identify you/);
  assert.equal(validateResponse({ decision: 'uncredited', text: TEXT }).ok, true);
  const named = validateResponse({ decision: 'credited', text: HINT, displayName: 'Amina Ali', organisation: 'WFP' });
  assert.equal(named.ok, true);
  assert.deepEqual(named.value.credit, { mode: 'credited', displayName: 'Amina Ali', organisation: 'WFP' });
});

test('uncredited carries no credit at all', () => {
  const r = validateResponse({ decision: 'uncredited', text: `  ${TEXT}  `, displayName: 'Amina Ali' });
  assert.deepEqual(r.value, { decision: 'uncredited', text: TEXT, credit: { mode: 'uncredited' } });
});

test('the author controls the final text: it must be 1 to 2000 characters', () => {
  assert.equal(validateResponse({ decision: 'uncredited', text: '   ' }).ok, false);
  assert.equal(validateResponse({ decision: 'uncredited', text: 'x'.repeat(2001) }).ok, false);
  assert.equal(validateResponse({ decision: 'uncredited', text: 'x'.repeat(2000) }).ok, true);
});

test('displayName is 2 to 80 characters and organisation at most 120', () => {
  const base = { decision: 'credited', text: TEXT };
  assert.equal(validateResponse({ ...base, displayName: 'A' }).ok, false);
  assert.equal(validateResponse({ ...base, displayName: 'Ab' }).ok, true);
  assert.equal(validateResponse({ ...base, displayName: 'x'.repeat(81) }).ok, false);
  assert.equal(validateResponse({ ...base, displayName: 'x'.repeat(80) }).ok, true);
  assert.equal(validateResponse({ ...base, displayName: 'Ab', organisation: 'o'.repeat(121) }).ok, false);
  assert.equal(validateResponse({ ...base, displayName: 'Ab', organisation: 'o'.repeat(120) }).ok, true);
  assert.equal(validateResponse({ ...base, displayName: 'Ab', organisation: '  ' }).value.credit.organisation, null);
});

test('a credited choice in a sensitive country needs acknowledgedRisk; elsewhere it does not', () => {
  const credited = { decision: 'credited', text: TEXT, displayName: 'Amina Ali' };
  const sensitive = validateResponse(credited, { sensitive: true });
  assert.equal(sensitive.ok, false);
  assert.match(sensitive.problems.join(' '), /acknowledgedRisk/);
  assert.equal(validateResponse({ ...credited, acknowledgedRisk: 'yes' }, { sensitive: true }).ok, false, 'only the boolean true counts');
  assert.equal(validateResponse({ ...credited, acknowledgedRisk: true }, { sensitive: true }).ok, true);
  assert.equal(validateResponse(credited, { sensitive: false }).ok, true);
});

test('an unknown decision is refused', () => {
  assert.equal(validateResponse({ decision: 'publish' }).ok, false);
  assert.equal(validateResponse(undefined).ok, false);
});

test('approval needs every checklist item; a rejection needs a note', () => {
  assert.equal(validateReview({ approve: true, checked: ALL }).ok, true);
  for (const k of CHECKLIST) {
    const r = validateReview({ approve: true, checked: { ...ALL, [k]: false } });
    assert.equal(r.ok, false, `approval must fail without ${k}`);
    assert.match(r.problems.join(' '), new RegExp(k));
  }
  assert.equal(validateReview({ approve: true, checked: { noThirdParties: true, noLocationDetail: true } }).ok, false);
  assert.equal(validateReview({ approve: false, note: '' }).ok, false);
  assert.equal(validateReview({ approve: false }).ok, false);
  assert.equal(validateReview({ approve: false, note: 'x'.repeat(301) }).ok, false);
  assert.deepEqual(validateReview({ approve: false, note: ' names the district ' }).value, { approve: false, note: 'names the district' });
  assert.equal(validateReview({ approve: 'yes', checked: ALL }).ok, false, 'approve must be a boolean');
});

test('the public view has exactly five keys and a credit line only when credited', () => {
  const pub = {
    id: 'pub_1', text: TEXT, cardStatement: 'S', country: 'TCD', day: '2026-11-09', status: 'published', version: 4,
    expertId: 'ex_1', proposer: 'mod1', reviewer: 'mod2', credit: { mode: 'credited', displayName: 'Amina Ali', organisation: 'WFP' },
  };
  const v = publicView(pub);
  assert.deepEqual(Object.keys(v).sort(), ['cardStatement', 'country', 'creditLine', 'day', 'id', 'text']);
  assert.equal(v.creditLine, 'Amina Ali, WFP');
  assert.equal(publicView({ ...pub, credit: { mode: 'credited', displayName: 'Amina Ali', organisation: null } }).creditLine, 'Amina Ali');
  assert.equal(publicView({ ...pub, credit: { mode: 'uncredited' } }).creditLine, null);
});

test('an erased record keeps only the id, the status, the day, the version and the database keys', () => {
  const pub = {
    id: 'pub_1', version: 3, status: 'published', expertId: 'ex_1', sourceKind: 'dissent', sourceId: 'd_1', cardId: 'C1',
    proposer: 'mod1', reviewer: 'mod2', country: 'TCD', cardStatement: 'S', text: TEXT, originalText: TEXT,
    credit: { mode: 'credited', displayName: 'Amina Ali', organisation: 'WFP' }, note: 'n', publishAfter: 1, sensitive: true,
  };
  const r = erasedRecord(pub, { status: 'withdrawn', day: '2026-11-07', version: 4 });
  assert.deepEqual(Object.keys(r).sort(), ['cardId', 'day', 'expertId', 'id', 'proposer', 'reviewer', 'sourceId', 'sourceKind', 'status', 'version']);
  assert.deepEqual(r, {
    id: 'pub_1', status: 'withdrawn', day: '2026-11-07', version: 4, expertId: 'ex_1', sourceKind: 'dissent', sourceId: 'd_1',
    cardId: 'C1', proposer: 'mod1', reviewer: 'mod2',
  });
  assert.doesNotMatch(JSON.stringify(r), /Amina|WFP|rainy season/);
});
