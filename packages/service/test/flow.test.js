import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createService } from '../src/service.js';
import { createRosterStore, createAnswerStore } from '../src/store.js';
import { CONSENT_VERSION } from '../src/consent.js';
import { ACTION, KIND } from '../../benchmark/src/dissent.js';
import { ballotToken } from '../../core/src/anonymity.js';

const SECRETS = { ballot: 'ballot-secret-for-tests-0001', alias: 'alias-secret-for-tests-00002' };
const DAY = 86400000;
const T0 = Date.UTC(2026, 10, 7, 10, 23, 45, 123);
const WINDOW = { from: '2026-11-01', to: '2027-04-30' };
const CARD = {
  statement: 'Cholera cases in Chad will exceed 10,000 by 30 April 2027.',
  country: 'TCD', region: 'Sahel', theme: 'health', window: WINDOW,
  objective: 'WHO weekly bulletin cumulative cases above 10,000', resolutionSource: 'IPC',
  resolver: 'R. Resolver', probability: 'High',
};

function world(overrides = {}) {
  const roster = createRosterStore();
  const answers = createAnswerStore();
  const clock = { now: T0 };
  const svc = createService({ roster, answers, secrets: SECRETS, now: () => clock.now, ...overrides });
  const mod = svc.authenticate(svc.createStaffSession({ id: 'mod1', role: 'moderator' }));
  const analyst = svc.authenticate(svc.createStaffSession({ id: 'an1', role: 'analyst' }));
  const enroll = (level, { name, countries = ['TCD'] } = {}) => {
    const inv = svc.createInvite(mod, { declaration: { countries }, name });
    const r = svc.redeemInvite(inv.token, { level, consentVersion: CONSENT_VERSION });
    return { ...r, actor: svc.authenticate(r.sessionToken), invite: inv };
  };
  return { roster, answers, clock, svc, mod, analyst, enroll };
}

test('the service refuses to start without out-of-database secrets (B-03)', () => {
  const roster = createRosterStore();
  const answers = createAnswerStore();
  assert.throws(() => createService({ roster, answers }), /secrets\.ballot is required/);
  assert.throws(() => createService({ roster, answers, secrets: { ballot: 'short', alias: SECRETS.alias } }), /secrets\.ballot/);
  assert.throws(() => createService({ roster, answers, secrets: { ballot: SECRETS.ballot, alias: SECRETS.ballot } }), /must differ/);
});

test('invites are single-use, expiring, bound to a Declaration, and need an explicit level and consent (B-01)', () => {
  const w = world();
  assert.throws(() => w.svc.createInvite(w.mod, { declaration: { countries: [] } }), /at least one country/);
  assert.throws(() => w.svc.createInvite(w.analyst, { declaration: { countries: ['TCD'] } }), /may not invite\.create/);
  const inv = w.svc.createInvite(w.mod, { declaration: { countries: ['TCD'] } });
  assert.throws(() => w.svc.redeemInvite(inv.token, { level: 'public', consentVersion: CONSENT_VERSION }), /choose an anonymity level/);
  assert.throws(() => w.svc.redeemInvite(inv.token, { consentVersion: CONSENT_VERSION }), /choose an anonymity level/);
  assert.throws(() => w.svc.redeemInvite(inv.token, { level: 'anonymous', consentVersion: 'old' }), /consent must be given/);
  const ok = w.svc.redeemInvite(inv.token, { level: 'anonymous', consentVersion: CONSENT_VERSION });
  assert.equal(ok.expertId, inv.expertId);
  assert.throws(() => w.svc.redeemInvite(inv.token, { level: 'anonymous', consentVersion: CONSENT_VERSION }), /already used/);
  assert.throws(() => w.svc.redeemInvite('nope', { level: 'anonymous', consentVersion: CONSENT_VERSION }), /not recognised/);
  const exp = w.svc.createInvite(w.mod, { declaration: { countries: ['TCD'] }, ttlMs: 1000 });
  w.clock.now += 2000;
  assert.throws(() => w.svc.redeemInvite(exp.token, { level: 'anonymous', consentVersion: CONSENT_VERSION }), /expired/);
  const rec = w.roster.experts.get(inv.expertId).consent;
  assert.equal(rec.version, CONSENT_VERSION);
  assert.match(rec.textHash, /^[0-9a-f]{64}$/);
  assert.throws(() => w.svc.authenticate('forged'), /authentication required|invalid/);
});

test('sessions expire', () => {
  const w = world();
  const e = w.enroll('identified');
  assert.equal(w.svc.authenticate(e.sessionToken).expertId, e.expertId);
  w.clock.now += 13 * 3600 * 1000;
  assert.throws(() => w.svc.authenticate(e.sessionToken), /expired/);
});

test('cards need a gate pass, a written objective, a source and a named resolver (B-10); roles are split (B-12)', () => {
  const w = world();
  assert.throws(() => w.svc.createCard(w.analyst, { ...CARD, objective: '' }), /objective/);
  assert.throws(() => w.svc.createCard(w.analyst, { ...CARD, resolver: '' }), /resolver/);
  assert.throws(() => w.svc.createCard(w.analyst, { ...CARD, resolutionSource: 'a blog' }), /resolutionSource/);
  assert.throws(() => w.svc.createCard(w.analyst, { ...CARD, window: undefined }), /gate/);
  assert.throws(() => w.svc.createCard(w.analyst, { ...CARD, statement: 'Displacement is poised to deteriorate, exceeding 500,000 by June.' }), /gate/);
  const { card } = w.svc.createCard(w.analyst, CARD);
  assert.equal(card.seedP, 0.705, 'seeded on the High band midpoint, not 0.80');
  const e = w.enroll('identified');
  assert.throws(() => w.svc.createCard(e.actor, CARD), /may not card\.author/);
  assert.throws(() => w.svc.closeRound(w.analyst, card.id), /may not round\.manage/);
  assert.throws(() => w.svc.readAudit(w.analyst), /may not audit\.read/);
  assert.throws(() => w.svc.closeRound(null, card.id), /authentication/);
});

test('estimates: clamped, one per round, anonymous rows carry no identity and a day-coarse time (B-04, B-06)', () => {
  const w = world();
  const { card } = w.svc.createCard(w.analyst, CARD);
  const anon = w.enroll('anonymous');
  const named = w.enroll('identified');
  assert.deepEqual(
    { p: w.svc.submitEstimate(anon.actor, { cardId: card.id, p: 1 }).p, clamped: true },
    { p: 0.99, clamped: true }
  );
  w.svc.submitEstimate(named.actor, { cardId: card.id, p: 0.4 });
  assert.throws(() => w.svc.submitEstimate(anon.actor, { cardId: card.id, p: 0.5 }), /already answered/);
  assert.throws(() => w.svc.submitEstimate(named.actor, { cardId: card.id, p: 0.5 }), /already answered/);
  assert.throws(() => w.svc.submitEstimate(named.actor, { cardId: 'missing', p: 0.5 }), /not found/);
  assert.throws(() => w.svc.submitEstimate(w.analyst, { cardId: card.id, p: 0.5 }), /may not estimate\.submit/);
  const rows = w.answers.estimates.all();
  const anonRow = rows.find((r) => r.level === 'anonymous');
  assert.equal(anonRow.expertId, null);
  assert.equal(anonRow.at % DAY, 0, 'anonymous time is coarsened to the day');
  assert.ok(!JSON.stringify(anonRow).includes(anon.expertId));
  assert.equal(anonRow.respondentKey, ballotToken(SECRETS.ballot, card.id, anon.expertId));
  assert.equal(rows.find((r) => r.level === 'identified').at, T0, 'a known expert keeps the exact time');
  assert.throws(() => w.svc.submitEstimate(anon.actor, { cardId: card.id, p: Number.NaN }), /finite/);
});

test('roster and answers are separate: neither store alone re-links an anonymous answer (B-03)', () => {
  const w = world();
  const { card } = w.svc.createCard(w.analyst, CARD);
  const anon = w.enroll('anonymous', { name: 'Secret Person' });
  w.svc.submitEstimate(anon.actor, { cardId: card.id, p: 0.3 });
  const answersDump = JSON.stringify(w.answers.estimates.all()) + JSON.stringify(w.answers.audit.all());
  const rosterDump = JSON.stringify(w.roster.experts.all()) + JSON.stringify(w.roster.sessions.all());
  assert.ok(!answersDump.includes(anon.expertId) && !answersDump.includes('Secret Person'));
  assert.ok(!rosterDump.includes('"p":0.3'));
  for (const secret of Object.values(SECRETS)) {
    assert.ok(!answersDump.includes(secret) && !rosterDump.includes(secret), 'secrets are never stored');
  }
  const key = w.answers.estimates.all()[0].respondentKey;
  const guesses = [`${card.id}:${anon.expertId}`, `${card.id}${anon.expertId}`, `ballot:v1:${card.id}:${anon.expertId}`];
  for (const g of guesses) assert.notEqual(crypto.createHash('sha256').update(g).digest('hex'), key, 'not an unkeyed hash');
  // The residual risk, stated as a test: server access PLUS the secret does re-link.
  assert.equal(ballotToken(SECRETS.ballot, card.id, anon.expertId), key);
});

test('every statistic leaves through cardRelease: withheld while open, floored, ledgered, stable (B-05)', () => {
  const w = world();
  const { card } = w.svc.createCard(w.analyst, CARD);
  const experts = Array.from({ length: 6 }, (_, i) => w.enroll(i % 2 ? 'anonymous' : 'pseudonymous'));
  experts.slice(0, 4).forEach((e, i) => w.svc.submitEstimate(e.actor, { cardId: card.id, p: 0.2 + i * 0.1 }));

  const open = w.svc.cardRelease(card.id);
  assert.equal(open.suppressed, true, 'open round withholds interim statistics (on_close)');
  w.svc.closeRound(w.mod, card.id);
  const small = w.svc.cardRelease(card.id);
  assert.equal(small.suppressed, true, 'n=4 is below the floor of 5');
  assert.equal(w.answers.releases.all().length, 0, 'a suppressed release is not ledgered');

  assert.throws(() => w.svc.submitEstimate(experts[4].actor, { cardId: card.id, p: 0.5 }), /not open/);
  const w2 = world();
  const c2 = w2.svc.createCard(w2.analyst, CARD).card;
  const e2 = Array.from({ length: 6 }, (_, i) => w2.enroll(i % 2 ? 'anonymous' : 'pseudonymous'));
  e2.forEach((e, i) => w2.svc.submitEstimate(e.actor, { cardId: c2.id, p: 0.2 + i * 0.1 }));
  w2.svc.closeRound(w2.mod, c2.id);
  const rel = w2.svc.cardRelease(c2.id);
  assert.equal(rel.suppressed, false);
  assert.equal(rel.n, 6);
  assert.equal(rel.q25, null, 'quartiles stay masked below n=10');
  assert.deepEqual(w2.svc.cardRelease(c2.id), rel, 'asking again returns the ledgered snapshot, not a fresh draw');
  assert.equal(w2.answers.releases.all().length, 1);
  assert.equal(w2.svc.cardRelease(c2.id, { visibility: 'public' }).suppressed, true, 'public floor is 10');
  assert.ok(!/ex_|ballot|respondent/.test(JSON.stringify(rel)), 'a release never carries a key');
});

test('Round 2 reaches anonymous experts by pull, shows the Round-1 result, and needs Round 1 (B-11)', () => {
  const w = world();
  const { card } = w.svc.createCard(w.analyst, CARD);
  const anon = w.enroll('anonymous');
  const others = Array.from({ length: 5 }, () => w.enroll('identified'));
  w.svc.submitEstimate(anon.actor, { cardId: card.id, p: 0.2 });
  others.forEach((e, i) => w.svc.submitEstimate(e.actor, { cardId: card.id, p: 0.5 + i * 0.05 }));
  const late = w.enroll('identified');

  assert.equal(w.svc.inbox(anon.actor).toAnswer.length, 0);
  assert.equal(w.svc.inbox(anon.actor).openForRevision.length, 0, 'not open for revision before round 2');
  w.svc.closeRound(w.mod, card.id);
  assert.throws(() => w.svc.openRound2(w.analyst, card.id), /may not round\.manage/);
  w.svc.openRound2(w.mod, card.id);

  const box = w.svc.inbox(anon.actor);
  assert.equal(box.openForRevision.length, 1, 'the anonymous expert finds Round 2 by coming to the app');
  assert.equal(box.openForRevision[0].yourEstimate, 0.2);
  assert.equal(box.openForRevision[0].release.n, 6, 'they see the Round-1 distribution');
  assert.ok(!('toAnswer' in box.openForRevision[0]));
  assert.throws(() => w.svc.submitEstimate(late.actor, { cardId: card.id, p: 0.5 }), /did not answer round 1/);
  const r2 = w.svc.submitEstimate(anon.actor, { cardId: card.id, p: 0.35 });
  assert.equal(r2.round, 2);
  assert.equal(w.svc.inbox(anon.actor).openForRevision.length, 0);
  assert.equal(w.answers.estimates.find((e) => e.round === 2).length, 1);
});

test('the Declaration decides who is told; an empty or mismatched one gets nothing (B-13)', () => {
  const w = world();
  w.svc.createCard(w.analyst, CARD);
  const tcd = w.enroll('identified', { countries: ['TCD'] });
  const sdn = w.enroll('identified', { countries: ['SDN'] });
  assert.equal(w.svc.inbox(tcd.actor).toAnswer.length, 1);
  assert.equal(w.svc.inbox(sdn.actor).toAnswer.length, 0);
  assert.throws(() => w.svc.setDeclaration(tcd.actor, { countries: [] }), /at least one country/);
  w.svc.setDeclaration(sdn.actor, { countries: ['TCD', 'SDN'] });
  assert.equal(w.svc.inbox(sdn.actor).toAnswer.length, 1);
});

test('dissent: optimistic concurrency, split spawns versioned children, parent keeps its estimates (B-12)', () => {
  const w = world();
  const { card } = w.svc.createCard(w.analyst, CARD);
  const raiser = w.enroll('identified', { name: 'Amina Okoro' });
  w.svc.submitEstimate(raiser.actor, { cardId: card.id, p: 0.4 });
  const { id, version } = w.svc.submitDissent(raiser.actor, { cardId: card.id, kind: KIND.TWO_RISKS, text: 'This is two risks.' });
  assert.equal(version, 0);

  const analyst2 = w.svc.authenticate(w.svc.createStaffSession({ id: 'an2', role: 'analyst' }));
  w.svc.routeDissent(w.analyst, id, { expectedVersion: 0 });
  assert.throws(() => w.svc.routeDissent(analyst2, id, { expectedVersion: 0 }), /changed: you saw version 0/);
  assert.throws(() => w.svc.routeDissent(analyst2, id, {}), /expectedVersion/);

  assert.throws(() => w.svc.actDissent(w.analyst, id, { expectedVersion: 1, action: ACTION.SPLIT, statements: ['only one'] }), /at least two/);
  assert.throws(
    () => w.svc.actDissent(w.analyst, id, { expectedVersion: 1, action: ACTION.SPLIT, statements: ['Displacement is expected to worsen.', 'Cholera cases will exceed 5,000 by 30 April 2027.'] }),
    /gate/
  );
  assert.equal(w.answers.cards.all().length, 1, 'a rejected split writes nothing');

  const res = w.svc.actDissent(w.analyst, id, {
    expectedVersion: 1, action: ACTION.SPLIT, title: 'Split cholera and food',
    statements: ['Cholera cases in Chad will exceed 10,000 by 30 April 2027.', 'IPC Phase 4 will be declared in any Chad district by 30 April 2027.'],
  });
  assert.deepEqual(res.newCards, [`${card.id}a`, `${card.id}b`]);
  assert.equal(w.answers.cards.get(card.id).status, 'retired');
  assert.equal(w.answers.cards.get(card.id).retiredBy, id);
  assert.equal(w.answers.estimates.find((e) => e.cardId === card.id).length, 1, 'parent estimates stay on the parent');
  for (const kid of res.newCards) {
    const c = w.answers.cards.get(kid);
    assert.equal(c.parentId, card.id);
    assert.equal(c.status, 'open');
    assert.equal(w.answers.estimates.find((e) => e.cardId === kid).length, 0, 'children start clean');
  }
  assert.throws(() => w.svc.submitEstimate(raiser.actor, { cardId: card.id, p: 0.5 }), /not open/);

  assert.throws(() => w.svc.closeDissent(w.analyst, id, { expectedVersion: 2, reason: 'x' }), /before notify/);
  assert.deepEqual(w.svc.notifyDissent(w.analyst, id, { expectedVersion: 2 }), { sent: true });
  const box = w.svc.inbox(raiser.actor);
  assert.equal(box.notifications.length, 1);
  assert.equal(box.notifications[0].type, 'dissent_actioned');
  w.svc.closeDissent(w.analyst, id, { expectedVersion: 3, reason: 'done' });
  assert.equal(w.answers.dissents.get(id).status, 'closed');
  assert.equal(w.svc.listDissents(w.analyst)[0].expert, undefined, 'analysts do not see expert ids');
  assert.equal(w.svc.listDissents(w.mod)[0].expert, raiser.expertId);
});

test('anonymous dissents: no id stored, no notification, addressless day-coarse ledger entry (B-04, B-11)', () => {
  const w = world();
  const { card } = w.svc.createCard(w.analyst, CARD);
  const anon = w.enroll('anonymous');
  const { id } = w.svc.submitDissent(anon.actor, { cardId: card.id, kind: KIND.WINDOW, text: 'The window is too long.' });
  const row = w.answers.dissents.get(id);
  assert.equal(row.expert, null);
  assert.equal(row.by, 'anonymous');
  assert.equal(row.createdAt % DAY, 0);
  w.svc.routeDissent(w.analyst, id, { expectedVersion: 0 });
  w.svc.actDissent(w.analyst, id, { expectedVersion: 1, action: ACTION.RETIRE, title: 'Retired' });
  assert.equal(w.svc.notifyDissent(w.analyst, id, { expectedVersion: 2 }), null);
  w.svc.closeDissent(w.analyst, id, { expectedVersion: 2, reason: 'anonymous_actioned_on_card' });
  const [entry] = w.svc.publicLedger(card.id);
  assert.equal(entry.actionedAt % DAY, 0, 'public ledger time is coarsened to the day');
  assert.ok(!/expert|by|dissentId|level/.test(Object.keys(entry).join(',')));
  assert.equal(w.answers.notifications.all().length, 0);
});

test('free text is checked for identifying detail and the warning is returned, not enforced (B-04)', () => {
  const w = world();
  const { card } = w.svc.createCard(w.analyst, CARD);
  const e = w.enroll('pseudonymous');
  const r = w.svc.submitDissent(e.actor, { cardId: card.id, kind: KIND.WINDOW, text: 'As the country director for WFP in Juba, I work on this.' });
  assert.ok(r.warnings.length >= 3);
  assert.ok(w.answers.dissents.get(r.id), 'still stored: it is advice, not a block');
});

test('pseudonyms are persisted per expert x country and survive a secret rotation (B-02)', () => {
  const w = world();
  const { card } = w.svc.createCard(w.analyst, CARD);
  const e = w.enroll('pseudonymous');
  const d1 = w.svc.submitDissent(e.actor, { cardId: card.id, kind: KIND.WINDOW, text: 'a' });
  const alias1 = w.answers.dissents.get(d1.id).by;
  assert.match(alias1, /^Analyst \d{4}$/);
  assert.equal(w.roster.aliases.all().length, 1);
  const rotated = createService({
    roster: w.roster, answers: w.answers, now: () => w.clock.now,
    secrets: { ballot: SECRETS.ballot, alias: 'a-completely-different-alias-secret' },
  });
  const actor = rotated.authenticate(e.sessionToken);
  const d2 = rotated.submitDissent(actor, { cardId: card.id, kind: KIND.WINDOW, text: 'b' });
  assert.equal(w.answers.dissents.get(d2.id).by, alias1, 'a rotated secret must not rename anyone');
  assert.equal(w.roster.aliases.all().length, 1);
});

test('the audit log records staff actions, never expert answers, and cannot be edited (B-12)', () => {
  const w = world();
  const { card } = w.svc.createCard(w.analyst, CARD);
  const e = w.enroll('anonymous');
  w.svc.submitEstimate(e.actor, { cardId: card.id, p: 0.5 });
  w.svc.closeRound(w.mod, card.id);
  const log = w.svc.readAudit(w.mod);
  assert.deepEqual(log.map((l) => l.action), ['card.create', 'invite.create', 'round.close']);
  assert.ok(log.every((l) => l.actorId && l.at));
  assert.equal(JSON.stringify(log).includes(e.expertId), false, 'invites are logged by a hashed handle');
  assert.equal(typeof w.answers.audit.update, 'undefined');
  assert.equal(typeof w.answers.audit.remove, 'undefined');
  assert.equal(typeof w.answers.audit.put, 'undefined');
});

test('resolution needs an https evidence link; retention deletes raw rows but keeps released aggregates (B-17, B-19)', () => {
  const w = world();
  const { card } = w.svc.createCard(w.analyst, CARD);
  const es = Array.from({ length: 5 }, () => w.enroll('identified'));
  es.forEach((e, i) => w.svc.submitEstimate(e.actor, { cardId: card.id, p: 0.3 + i * 0.1 }));
  w.svc.closeRound(w.mod, card.id);
  const rel = w.svc.cardRelease(card.id);
  assert.equal(rel.suppressed, false);
  assert.throws(() => w.svc.resolveCard(w.mod, { cardId: card.id, outcome: 1 }), /https evidenceUrl/);
  assert.throws(() => w.svc.resolveCard(w.mod, { cardId: card.id, outcome: 1, evidenceUrl: 'http://x.org' }), /https/);
  assert.throws(() => w.svc.resolveCard(w.mod, { cardId: card.id, outcome: 2, evidenceUrl: 'https://x.org' }), /outcome/);
  assert.throws(() => w.svc.resolveCard(w.analyst, { cardId: card.id, outcome: 1, evidenceUrl: 'https://x.org' }), /may not card\.resolve/);
  w.svc.resolveCard(w.mod, { cardId: card.id, outcome: 'unobservable', evidenceUrl: 'https://acleddata.com/x' });
  assert.equal(w.svc.applyRetention(w.mod, { months: 12 }).removed, 0, 'not yet old enough');
  w.clock.now += 13 * 30 * DAY;
  assert.equal(w.svc.applyRetention(w.mod, { months: 12 }).removed, 5);
  assert.equal(w.answers.estimates.all().length, 0);
  assert.equal(w.answers.releases.all().length, 1, 'the released aggregate is kept');
});

test('export and erase: including anonymous estimates, whose key only the secret can recompute (B-17)', () => {
  const w = world();
  const { card } = w.svc.createCard(w.analyst, CARD);
  const anon = w.enroll('anonymous');
  const named = w.enroll('pseudonymous');
  w.svc.submitEstimate(anon.actor, { cardId: card.id, p: 0.3 });
  w.svc.submitEstimate(named.actor, { cardId: card.id, p: 0.6 });
  w.svc.submitDissent(named.actor, { cardId: card.id, kind: KIND.WINDOW, text: 'x' });

  const mine = w.svc.exportMe(anon.actor);
  assert.equal(mine.estimates.length, 1);
  assert.equal(mine.estimates[0].p, 0.3);
  assert.match(mine.note, /unlinkable/);

  assert.deepEqual(w.svc.eraseMe(anon.actor), { erased: true });
  assert.equal(w.answers.estimates.all().length, 1, 'only the other expert remains');
  assert.equal(w.roster.experts.get(anon.expertId), undefined);
  assert.throws(() => w.svc.authenticate(anon.sessionToken), /invalid|expired/);
  w.svc.eraseMe(named.actor);
  assert.equal(w.answers.estimates.all().length, 0);
  assert.equal(w.answers.dissents.all().length, 0);
  assert.equal(w.roster.aliases.all().length, 0);
  const log = JSON.stringify(w.answers.audit.all());
  assert.ok(!log.includes(anon.expertId) && !log.includes(named.expertId));
  assert.equal(w.answers.audit.all().filter((l) => l.action === 'erase.self').length, 2);
});

test('state survives a restart when a store file is configured', async () => {
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bm-'));
  const files = { roster: path.join(dir, 'roster.json'), answers: path.join(dir, 'answers.json') };
  const open = () => {
    const roster = createRosterStore({ file: files.roster });
    const answers = createAnswerStore({ file: files.answers });
    return { roster, answers, svc: createService({ roster, answers, secrets: SECRETS }) };
  };
  const a = open();
  const mod = a.svc.authenticate(a.svc.createStaffSession({ id: 'm', role: 'moderator' }));
  a.svc.createCard(mod, { ...CARD, id: 'RPERSIST' });
  const b = open();
  assert.equal(b.answers.cards.get('RPERSIST').statement, CARD.statement);
  assert.equal(b.answers.audit.all().length, 1);
  assert.ok(!fs.readFileSync(files.answers, 'utf8').includes(SECRETS.ballot));
  fs.rmSync(dir, { recursive: true });
  void ACTION;
});
