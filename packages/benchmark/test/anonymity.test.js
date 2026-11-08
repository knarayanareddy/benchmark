import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LEVELS, DEFAULT_LEVEL, LEVEL_COPY, ALIAS_SPACE,
  resolveLevel, aliasFor, DEFAULT_DEV_SALT, panelAliases, attribute, leaksBy, publicable, PUBLIC,
} from '@benchmark/core/anonymity';
import { suppress } from '@benchmark/shared/validate';
import {
  aggregate,
  releaseAggregate,
  RELEASE_POLICIES,
} from '@benchmark/core/aggregate';

const SALT = 'test-deployment-salt-not-for-prod';
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
  const a = attribute(A, LEVELS.PSEUDONYMOUS, { salt: SALT });
  const b = attribute(A, LEVELS.PSEUDONYMOUS, { salt: SALT });
  assert.equal(a.by, b.by, 'the alias must be stable across contributions');
  assert.match(a.by, /^Analyst \d{4}$/);
  assert.equal(a.name, undefined);
  assert.equal(a.expertId, undefined);
});

test('two experts in the same country get different aliases', () => {
  const x = attribute(A, LEVELS.PSEUDONYMOUS, { salt: SALT });
  const y = attribute({ ...A, expertId: 'e-002', name: 'Bello Adamu' }, LEVELS.PSEUDONYMOUS, { salt: SALT });
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
  assert.equal(aliasFor('e-001', 'TCD', SALT), aliasFor('e-001', 'TCD', SALT));
  assert.notEqual(aliasFor('e-001', 'TCD', 'deploy-secret-v2'), aliasFor('e-001', 'TCD', 'deploy-secret-v1'));
});

test('pseudonyms fail closed: no salt, no persisted alias, no pseudonym (B-02)', () => {
  assert.throws(() => attribute(A, LEVELS.PSEUDONYMOUS), /deployment salt/);
  assert.throws(() => attribute(A, LEVELS.PSEUDONYMOUS, { salt: DEFAULT_DEV_SALT }), /deployment salt/);
  assert.throws(() => attribute(A, LEVELS.PSEUDONYMOUS, { salt: 'short' }), /deployment salt/);
  assert.throws(() => aliasFor('e-001', 'TCD'), /deployment salt/);
  assert.throws(() => aliasFor('e-001', 'TCD', DEFAULT_DEV_SALT), /deployment salt/);
  // A persisted alias needs no salt — that is the intended production path.
  assert.equal(attribute(A, LEVELS.PSEUDONYMOUS, { panelAliases: { [A.expertId]: 'Analyst 4242' } }).by, 'Analyst 4242');
  // No other level needs a salt.
  assert.doesNotThrow(() => attribute(A, LEVELS.IDENTIFIED));
  assert.doesNotThrow(() => attribute(A, LEVELS.ANONYMOUS));
});

test('publicable() validates its input shape and defaults to an object (B-20)', () => {
  assert.deepEqual(publicable(), { published: {}, suppressedCells: 0 });
  assert.throws(() => publicable([1, 2, 3]), TypeError);
  assert.throws(() => publicable(null), TypeError);
});

test('every casing of anonymous resolves to the anonymous level', () => {
  for (const req of ['anonymous', 'ANONYMOUS', 'Anonymous', ' AnOnYmOuS ']) {
    // .trim() is load-bearing — without it a padded value fails closed to
    // anonymous, which is safe but reports honoured:false for a valid choice.
    const r = resolveLevel(req);
    assert.equal(r.level, LEVELS.ANONYMOUS, `${req} must normalise`);
    assert.equal(r.honoured, true);
  }
  for (const req of ['identified', 'IDENTIFIED', 'Identified']) {
    assert.equal(resolveLevel(req).level, LEVELS.IDENTIFIED);
  }
});

test('a capitalised ANONYMOUS really removes country and timestamp', () => {
  // The bug: resolveLevel returned the raw string, attribute() matched neither
  // branch, and fell through to pseudonymous — keeping country and at.
  const c = { expertId: 'e1', name: 'A Person', country: 'NL', at: '2026-11-06T10:00:00Z',
              region: 'Sahel', theme: 'health' };
  const r = resolveLevel('ANONYMOUS');
  const out = attribute(c, r.level);
  assert.equal(out.level, LEVELS.ANONYMOUS);
  assert.equal(out.country, undefined, 'country must be absent, not blank');
  assert.equal(out.at, undefined, 'timestamp must be absent, not blank');
  assert.equal(out.by, 'anonymous');
});

test('an unrecognised level fails closed, not open', () => {
  const c = { expertId: 'e1', name: 'A Person', country: 'NL', at: '2026-11-06T10:00:00Z',
              region: 'Sahel', theme: 'health' };
  const out = attribute(c, 'public');           // not a level at all
  assert.equal(out.level, LEVELS.ANONYMOUS, 'unknown input must not fall back to pseudonymous');
  assert.equal(out.country, undefined);
  assert.equal(out.at, undefined);
});

test('attribute() enforces an allowlist — email, IP, role and org never leak at any level', () => {
  const rich = {
    expertId: 'e-99',
    name: 'Amina Okoro',
    email: 'amina@agency.org',
    ip: '196.201.14.8',
    role: 'Country Director',
    org: 'Humanitarian NGO',
    sessionToken: 'tok_secret_123',
    country: 'TCD',
    at: '2026-11-06T10:00:00Z',
    cardId: 'R1043',
    p: 0.72,
    text: 'Border trade is disrupted.',
  };

  for (const lvl of [...Object.values(LEVELS), 'unrecognised-level']) {
    const out = attribute(rich, lvl, { salt: SALT });
    for (const pii of ['email', 'ip', 'role', 'org', 'sessionToken', 'expertId', 'name']) {
      assert.ok(!(pii in out), `${lvl} leaked disallowed field "${pii}"`);
    }
    assert.equal(out.cardId, 'R1043');
    assert.equal(out.p, 0.72);
    assert.equal(out.text, 'Border trade is disrupted.');
  }
});

test('9,000-slot alias space avoids small-panel collisions and panelAliases() guarantees a bijection', () => {
  assert.equal(ALIAS_SPACE, 9000);

  // Reject missing, short or public default salts on production panel assignment
  assert.throws(() => panelAliases(['e1', 'e2'], 'TCD', {}), /deployment salt/);
  assert.throws(() => panelAliases(['e1', 'e2'], 'TCD', { salt: 'v1' }), /deployment salt/);
  assert.throws(() => panelAliases(['e1', 'e2'], 'TCD', { salt: 'short' }), /deployment salt/);

  // 60 experts in one country -> 60 distinct aliases, independent of input order
  const ids = Array.from({ length: 60 }, (_, i) => `expert_${i + 1}`);
  const mapA = panelAliases(ids, 'SDN', { salt: 'deploy-secret-2026-sdn' });
  const mapB = panelAliases([...ids].reverse(), 'SDN', { salt: 'deploy-secret-2026-sdn' });
  assert.deepEqual(mapA, mapB, 'panel alias assignment must be order-independent');
  assert.equal(new Set(Object.values(mapA)).size, 60, 'zero collisions across 60 panellists');

  const attributed = attribute(
    { expertId: 'expert_1', country: 'SDN', text: 'Note' },
    LEVELS.PSEUDONYMOUS,
    { panelAliases: mapA }
  );
  assert.equal(attributed.by, mapA.expert_1);
});

test('intervals and small-panel releases resist order-statistic & quartile inversion attacks (U1)', () => {
  // 1. Even on low-level aggregate() at n=3,4,5, smoothed bootstrap [lo, hi]
  //    must NOT collapse onto [min, max] (the individual boundary answers).
  for (const secret of [
    [0.17, 0.63, 0.89],
    [0.12, 0.44, 0.68, 0.91],
    [0.11, 0.29, 0.47, 0.68, 0.89],
  ]) {
    const raw = aggregate(secret.map((p, i) => ({ expertId: `e${i + 1}`, p })));
    assert.notEqual(raw.lo, secret[0], `n=${secret.length}: lo must not equal x_1 (${secret[0]})`);
    assert.notEqual(
      raw.hi,
      secret[secret.length - 1],
      `n=${secret.length}: hi must not equal x_n (${secret[secret.length - 1]})`
    );
  }

  // 2. On the released boundary (releaseAggregate), n=3 and n=4 are suppressed
  //    completely, and for n=5..9 q25/q75/iqr/min/max/spread are all null so
  //    neither [lo, estimate, hi] nor 2*q25 - estimate can solve individual answers.
  for (const small of [
    [0.17, 0.63, 0.89],
    [0.12, 0.44, 0.68, 0.91],
  ]) {
    for (const policy of Object.values(RELEASE_POLICIES)) {
      const held = releaseAggregate(
        small.map((p, i) => ({ expertId: `e${i + 1}`, p })),
        { policy, closed: true }
      );
      assert.equal(held.suppressed, true);
      assert.equal(held.needed, 5);
    }
  }

  const secret5 = [0.11, 0.29, 0.47, 0.68, 0.89];
  for (const policy of Object.values(RELEASE_POLICIES)) {
    const rel = releaseAggregate(
      secret5.map((p, i) => ({ expertId: `e${i + 1}`, p, level: LEVELS.ANONYMOUS })),
      { policy, closed: true }
    );
    assert.equal(rel.suppressed, false);
    assert.equal(rel.q25, null, `${policy}: q25 must be null below n=10`);
    assert.equal(rel.q75, null, `${policy}: q75 must be null below n=10`);
    assert.equal(rel.iqr, null);
    assert.equal(rel.min, null);
    assert.equal(rel.max, null);
    assert.equal(rel.spread, null);
    // Neither lo nor hi matches any participant's exact submission
    for (const p of secret5) {
      assert.ok(Math.abs(rel.lo - p) > 1e-4, `${policy}: lo (${rel.lo}) leaked submission ${p}`);
      assert.ok(Math.abs(rel.hi - p) > 1e-4, `${policy}: hi (${rel.hi}) leaked submission ${p}`);
    }
  }
});



import crypto from 'node:crypto';
import {
  assignAliases, ballotToken, coarsenToDay, identifyingHints, removeIdentifyingDetail,
} from '@benchmark/core/anonymity';

test('aliases are keyed: the same roster under a different secret gives different aliases (B-02)', () => {
  const ids = Array.from({ length: 30 }, (_, i) => `e${i}`);
  const a = ids.map((id) => aliasFor(id, 'SDN', 'secret-number-one'));
  const b = ids.map((id) => aliasFor(id, 'SDN', 'secret-number-two'));
  assert.notDeepEqual(a, b);
  for (const alias of a) {
    const n = Number(alias.split(' ')[1]);
    assert.ok(n >= 1000 && n < 1000 + ALIAS_SPACE);
  }
});

test('assignAliases never renames an existing expert, even under a rotated salt (B-02)', () => {
  const first = assignAliases({}, ['e1', 'e2', 'e3'], 'SDN', { salt: 'secret-number-one' });
  assert.equal(Object.keys(first.added).length, 3);
  const second = assignAliases(first.aliases, ['e1', 'e2', 'e3', 'e4'], 'SDN', { salt: 'secret-number-TWO' });
  for (const id of ['e1', 'e2', 'e3']) assert.equal(second.aliases[id], first.aliases[id], `${id} was renamed`);
  assert.deepEqual(Object.keys(second.added), ['e4'], 'only the new expert is added');
  assert.equal(new Set(Object.values(second.aliases)).size, 4, 'no collisions');
  assert.throws(() => assignAliases({}, ['e1'], 'SDN', {}), /deployment salt/);
});

test('ballot tokens are per card and per expert, keyed, and refuse a public secret (B-03)', () => {
  const t = ballotToken('ballot-secret-1234', 'R1', 'e1');
  assert.match(t, /^[0-9a-f]{64}$/);
  assert.equal(t, ballotToken('ballot-secret-1234', 'R1', 'e1'));
  assert.notEqual(t, ballotToken('ballot-secret-1234', 'R2', 'e1'), 'unlinkable across cards');
  assert.notEqual(t, ballotToken('ballot-secret-1234', 'R1', 'e2'));
  assert.notEqual(t, ballotToken('another-secret-5678', 'R1', 'e1'));
  assert.equal(t, crypto.createHmac('sha256', 'ballot-secret-1234').update('ballot:v1:R1:e1').digest('hex'));
  assert.throws(() => ballotToken(DEFAULT_DEV_SALT, 'R1', 'e1'), /deployment salt/);
  assert.throws(() => ballotToken(undefined, 'R1', 'e1'), /deployment salt/);
});

test('coarsenToDay drops the time of day and accepts ms, Date and ISO input (B-04)', () => {
  const want = { day: '2026-11-06', ms: Date.UTC(2026, 10, 6) };
  assert.deepEqual(coarsenToDay('2026-11-06T23:59:59.999Z'), want);
  assert.deepEqual(coarsenToDay(new Date('2026-11-06T00:00:01Z')), want);
  assert.deepEqual(coarsenToDay(Date.UTC(2026, 10, 6, 13, 7)), want);
  assert.throws(() => coarsenToDay('not a date'), TypeError);
});

test('leaksBy flags organisation, job title, first-person, uniqueness and self-location (B-04, B-20)', () => {
  const kinds = (text) => new Set(identifyingHints(text).map((h) => h.kind));
  assert.ok(kinds('WFP is moving trucks').has('organisation'));
  assert.ok(kinds('The country director said no').has('role'));
  assert.ok(kinds('I work on the Abyei file').has('first_person'));
  assert.ok(kinds('I am the only analyst there').has('unique'));
  assert.ok(kinds('I am based in Juba').has('place'));
  const w = leaksBy({ text: 'As the country director for WFP in Juba, I work on the only crossing.' }, []);
  assert.ok(w.length >= 4);
  assert.deepEqual(leaksBy({ text: 'The crossing at Adré is the tell.' }, []), [], 'a place that is the subject of the forecast is not flagged');
});

test('removeIdentifyingDetail strips every hinted span (B-04)', () => {
  const out = removeIdentifyingDetail('I work for WFP and I am based in Juba.');
  assert.ok(!/WFP|Juba|I work/.test(out), out);
  assert.equal(removeIdentifyingDetail('The crossing is closed.'), 'The crossing is closed.');
});

test('a bare id never rides into an anonymous payload (S1)', () => {
  const c = { id: 'e-SECRET-001', expertId: 'e-SECRET-001', name: 'Test Person', country: 'TCD', text: 'x', cardId: 'c1' };
  for (const lvl of [...Object.values(LEVELS), 'unrecognised-level']) {
    const out = attribute(c, lvl, { salt: SALT });
    assert.equal(out.id, undefined, `${lvl} echoed a bare id`);
    assert.ok(!JSON.stringify(out).includes('e-SECRET-001'), `${lvl} carried the expert id`);
  }
});

test('a value equal to an identifier the contribution carried is refused (S1 backstop)', () => {
  assert.throws(
    () => attribute({ expertId: 'e-7', cardId: 'e-7', text: 'x' }, LEVELS.ANONYMOUS),
    /identity leaked into "cardId"/
  );
});

test('a row with no usable count is suppressed by suppress(), never published (C3)', () => {
  const out = suppress([{ cell: 'a' }, { cell: 'b', count: NaN }, { cell: 'c', count: null }, { cell: 'd', count: 12 }], 10);
  assert.deepEqual(out.map((r) => r.suppressed === true), [true, true, true, false]);
  assert.equal(out[3].count, 12);
});
