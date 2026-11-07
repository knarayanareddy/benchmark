import baseTest from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createService } from '../src/service.js';
import { createRosterStore, createAnswerStore } from '../src/store.js';
import { createPgStores } from '../src/pg-store.js';
import { migrate } from '../src/migrate.js';
import { CONSENT_VERSION } from '../src/consent.js';
import { ACTION, KIND } from '@benchmark/domain/dissent';
import { ballotToken } from '@benchmark/core/anonymity';
import { BACKENDS, SECRETS, DAY, T0, CARD, many, worldFor, pgDriverStores, PGlite } from './helpers.js';

for (const backend of BACKENDS) {
const test = (name, fn) => baseTest(`[${backend}] ${name}`, () => fn());
const world = (o) => worldFor(backend, o);

test('the service refuses to start without out-of-database secrets (B-03)', async () => {
  const roster = createRosterStore();
  const answers = createAnswerStore();
  assert.throws(() => createService({ roster, answers }), /secrets\.ballot is required/);
  assert.throws(() => createService({ roster, answers, secrets: { ballot: 'short', alias: SECRETS.alias } }), /secrets\.ballot/);
  assert.throws(() => createService({ roster, answers, secrets: { ballot: SECRETS.ballot, alias: SECRETS.ballot } }), /must differ/);
});

test('invites are single-use, expiring, bound to a Declaration, and need an explicit level and consent (B-01)', async () => {
  const w = await world();
  await assert.rejects(() => w.svc.createInvite(w.mod, { declaration: { countries: [] } }), /at least one country/);
  await assert.rejects(() => w.svc.createInvite(w.analyst, { declaration: { countries: ['TCD'] } }), /may not invite\.create/);
  const inv = await w.svc.createInvite(w.mod, { declaration: { countries: ['TCD'] } });
  await assert.rejects(() => w.svc.redeemInvite(inv.token, { level: 'public', consentVersion: CONSENT_VERSION }), /choose an anonymity level/);
  await assert.rejects(() => w.svc.redeemInvite(inv.token, { consentVersion: CONSENT_VERSION }), /choose an anonymity level/);
  await assert.rejects(() => w.svc.redeemInvite(inv.token, { level: 'anonymous', consentVersion: 'old' }), /consent must be given/);
  const ok = await w.svc.redeemInvite(inv.token, { level: 'anonymous', consentVersion: CONSENT_VERSION });
  assert.equal(ok.expertId, inv.expertId);
  await assert.rejects(() => w.svc.redeemInvite(inv.token, { level: 'anonymous', consentVersion: CONSENT_VERSION }), /already used/);
  await assert.rejects(() => w.svc.redeemInvite('nope', { level: 'anonymous', consentVersion: CONSENT_VERSION }), /not recognised/);
  const exp = await w.svc.createInvite(w.mod, { declaration: { countries: ['TCD'] }, ttlMs: 1000 });
  w.clock.now += 2000;
  await assert.rejects(() => w.svc.redeemInvite(exp.token, { level: 'anonymous', consentVersion: CONSENT_VERSION }), /expired/);
  const rec = (await w.roster.experts.get(inv.expertId)).consent;
  assert.equal(rec.version, CONSENT_VERSION);
  assert.match(rec.textHash, /^[0-9a-f]{64}$/);
  await assert.rejects(() => w.svc.authenticate('forged'), /authentication required|invalid/);
});

test('sessions expire', async () => {
  const w = await world();
  const e = await w.enroll('identified');
  assert.equal((await w.svc.authenticate(e.sessionToken)).expertId, e.expertId);
  w.clock.now += 13 * 3600 * 1000;
  assert.equal((await w.svc.authenticate(e.sessionToken)).expertId, e.expertId, 'an expert session outlasts a working day');
  const staff = await w.svc.createStaffSession({ id: 'mod9', role: 'moderator' });
  w.clock.now += 13 * 3600 * 1000;
  await assert.rejects(() => w.svc.authenticate(staff), /expired/, 'a staff session does not');
  w.clock.now += 31 * 24 * 3600 * 1000;
  await assert.rejects(() => w.svc.authenticate(e.sessionToken), /expired/);
});

test('cards need a gate pass, a written objective, a source and a named resolver (B-10); roles are split (B-12)', async () => {
  const w = await world();
  await assert.rejects(() => w.svc.createCard(w.analyst, { ...CARD, objective: '' }), /objective/);
  await assert.rejects(() => w.svc.createCard(w.analyst, { ...CARD, resolver: '' }), /resolver/);
  await assert.rejects(() => w.svc.createCard(w.analyst, { ...CARD, resolutionSource: 'a blog' }), /resolutionSource/);
  await assert.rejects(() => w.svc.createCard(w.analyst, { ...CARD, window: undefined }), /gate/);
  await assert.rejects(() => w.svc.createCard(w.analyst, { ...CARD, statement: 'Displacement is poised to deteriorate, exceeding 500,000 by June.' }), /gate/);
  const { card } = await w.svc.createCard(w.analyst, CARD);
  assert.equal(card.seedP, 0.705, 'seeded on the High band midpoint, not 0.80');
  const e = await w.enroll('identified');
  await assert.rejects(() => w.svc.createCard(e.actor, CARD), /may not card\.author/);
  await assert.rejects(() => w.svc.closeRound(w.analyst, card.id), /may not round\.manage/);
  await assert.rejects(() => w.svc.readAudit(w.analyst), /may not audit\.read/);
  await assert.rejects(() => w.svc.closeRound(null, card.id), /authentication/);
});

test('estimates: clamped, one per round, anonymous rows carry no identity and a day-coarse time (B-04, B-06)', async () => {
  const w = await world();
  const { card } = await w.svc.createCard(w.analyst, CARD);
  const anon = await w.enroll('anonymous');
  const named = await w.enroll('identified');
  assert.deepEqual(
    { p: (await w.svc.submitEstimate(anon.actor, { cardId: card.id, p: 1 })).p, clamped: true },
    { p: 0.99, clamped: true }
  );
  await w.svc.submitEstimate(named.actor, { cardId: card.id, p: 0.4 });
  await assert.rejects(() => w.svc.submitEstimate(anon.actor, { cardId: card.id, p: 0.5 }), /already answered/);
  await assert.rejects(() => w.svc.submitEstimate(named.actor, { cardId: card.id, p: 0.5 }), /already answered/);
  await assert.rejects(() => w.svc.submitEstimate(named.actor, { cardId: 'missing', p: 0.5 }), /not found/);
  await assert.rejects(() => w.svc.submitEstimate(w.analyst, { cardId: card.id, p: 0.5 }), /may not estimate\.submit/);
  const rows = await w.answers.estimates.all();
  const anonRow = rows.find((r) => r.level === 'anonymous');
  assert.equal(anonRow.expertId, null);
  assert.equal(anonRow.at % DAY, 0, 'anonymous time is coarsened to the day');
  assert.ok(!JSON.stringify(anonRow).includes(anon.expertId));
  assert.equal(anonRow.respondentKey, ballotToken(SECRETS.ballot, card.id, anon.expertId));
  assert.equal(rows.find((r) => r.level === 'identified').at, T0, 'a known expert keeps the exact time');
  await assert.rejects(() => w.svc.submitEstimate(anon.actor, { cardId: card.id, p: Number.NaN }), /finite/);
});

test('roster and answers are separate: neither store alone re-links an anonymous answer (B-03)', async () => {
  const w = await world();
  const { card } = await w.svc.createCard(w.analyst, CARD);
  const anon = await w.enroll('anonymous', { name: 'Secret Person' });
  await w.svc.submitEstimate(anon.actor, { cardId: card.id, p: 0.3 });
  const answersDump = JSON.stringify(await w.answers.estimates.all()) + JSON.stringify(await w.answers.audit.all());
  const rosterDump = JSON.stringify(await w.roster.experts.all()) + JSON.stringify(await w.roster.sessions.all());
  assert.ok(!answersDump.includes(anon.expertId) && !answersDump.includes('Secret Person'));
  assert.ok(!rosterDump.includes('"p":0.3'));
  for (const secret of Object.values(SECRETS)) {
    assert.ok(!answersDump.includes(secret) && !rosterDump.includes(secret), 'secrets are never stored');
  }
  const key = (await w.answers.estimates.all())[0].respondentKey;
  const guesses = [`${card.id}:${anon.expertId}`, `${card.id}${anon.expertId}`, `ballot:v1:${card.id}:${anon.expertId}`];
  for (const g of guesses) assert.notEqual(crypto.createHash('sha256').update(g).digest('hex'), key, 'not an unkeyed hash');
  // The residual risk, stated as a test: server access PLUS the secret does re-link.
  assert.equal(ballotToken(SECRETS.ballot, card.id, anon.expertId), key);
});

test('every statistic leaves through cardRelease: withheld while open, floored, ledgered, stable (B-05)', async () => {
  const w = await world();
  const { card } = await w.svc.createCard(w.analyst, CARD);
  const experts = await many(6, (i) => w.enroll(i % 2 ? 'anonymous' : 'pseudonymous'));
  for (const [i, e] of experts.slice(0, 4).entries()) await w.svc.submitEstimate(e.actor, { cardId: card.id, p: 0.2 + i * 0.1 });

  const open = await w.svc.cardRelease(card.id);
  assert.equal(open.suppressed, true, 'open round withholds interim statistics (on_close)');
  await w.svc.closeRound(w.mod, card.id);
  const small = await w.svc.cardRelease(card.id);
  assert.equal(small.suppressed, true, 'n=4 is below the floor of 5');
  assert.equal((await w.answers.releases.all()).length, 0, 'a suppressed release is not ledgered');

  await assert.rejects(() => w.svc.submitEstimate(experts[4].actor, { cardId: card.id, p: 0.5 }), /not open/);
  const w2 = await world();
  const c2 = (await w2.svc.createCard(w2.analyst, CARD)).card;
  const e2 = await many(6, (i) => w2.enroll(i % 2 ? 'anonymous' : 'pseudonymous'));
  for (const [i, e] of e2.entries()) await w2.svc.submitEstimate(e.actor, { cardId: c2.id, p: 0.2 + i * 0.1 });
  await w2.svc.closeRound(w2.mod, c2.id);
  const rel = await w2.svc.cardRelease(c2.id);
  assert.equal(rel.suppressed, false);
  assert.equal(rel.n, 6);
  assert.equal(rel.q25, null, 'quartiles stay masked below n=10');
  assert.deepEqual(await w2.svc.cardRelease(c2.id), rel, 'asking again returns the ledgered snapshot, not a fresh draw');
  assert.equal((await w2.answers.releases.all()).length, 1);
  assert.equal((await w2.svc.cardRelease(c2.id, { visibility: 'public' })).suppressed, true, 'public floor is 10');
  assert.ok(!/ex_|ballot|respondent/.test(JSON.stringify(rel)), 'a release never carries a key');
});

test('Round 2 reaches anonymous experts by pull, shows the Round-1 result, and needs Round 1 (B-11)', async () => {
  const w = await world();
  const { card } = await w.svc.createCard(w.analyst, CARD);
  const anon = await w.enroll('anonymous');
  const others = await many(5, () => w.enroll('identified'));
  await w.svc.submitEstimate(anon.actor, { cardId: card.id, p: 0.2 });
  for (const [i, e] of others.entries()) await w.svc.submitEstimate(e.actor, { cardId: card.id, p: 0.5 + i * 0.05 });
  const late = await w.enroll('identified');

  assert.equal((await w.svc.inbox(anon.actor)).toAnswer.length, 0);
  assert.equal((await w.svc.inbox(anon.actor)).openForRevision.length, 0, 'not open for revision before round 2');
  await w.svc.closeRound(w.mod, card.id);
  await assert.rejects(() => w.svc.openRound2(w.analyst, card.id), /may not round\.manage/);
  await w.svc.openRound2(w.mod, card.id);

  const box = await w.svc.inbox(anon.actor);
  assert.equal(box.openForRevision.length, 1, 'the anonymous expert finds Round 2 by coming to the app');
  assert.equal(box.openForRevision[0].yourEstimate, 0.2);
  assert.equal(box.openForRevision[0].release.n, 6, 'they see the Round-1 distribution');
  assert.ok(!('toAnswer' in box.openForRevision[0]));
  await assert.rejects(() => w.svc.submitEstimate(late.actor, { cardId: card.id, p: 0.5 }), /did not answer round 1/);
  const r2 = await w.svc.submitEstimate(anon.actor, { cardId: card.id, p: 0.35 });
  assert.equal(r2.round, 2);
  assert.equal((await w.svc.inbox(anon.actor)).openForRevision.length, 0);
  assert.equal((await w.answers.estimates.find({ round: 2 })).length, 1);
});

test('the Declaration decides who is told; an empty or mismatched one gets nothing (B-13)', async () => {
  const w = await world();
  await w.svc.createCard(w.analyst, CARD);
  const tcd = await w.enroll('identified', { countries: ['TCD'] });
  const sdn = await w.enroll('identified', { countries: ['SDN'] });
  assert.equal((await w.svc.inbox(tcd.actor)).toAnswer.length, 1);
  assert.equal((await w.svc.inbox(sdn.actor)).toAnswer.length, 0);
  await assert.rejects(() => w.svc.setDeclaration(tcd.actor, { countries: [] }), /at least one country/);
  await w.svc.setDeclaration(sdn.actor, { countries: ['TCD', 'SDN'] });
  assert.equal((await w.svc.inbox(sdn.actor)).toAnswer.length, 1);
});

test('dissent: optimistic concurrency, split spawns versioned children, parent keeps its estimates (B-12)', async () => {
  const w = await world();
  const { card } = await w.svc.createCard(w.analyst, CARD);
  const raiser = await w.enroll('identified', { name: 'Amina Okoro' });
  await w.svc.submitEstimate(raiser.actor, { cardId: card.id, p: 0.4 });
  const { id, version } = await w.svc.submitDissent(raiser.actor, { cardId: card.id, kind: KIND.TWO_RISKS, text: 'This is two risks.' });
  assert.equal(version, 0);

  const analyst2 = await w.svc.authenticate(await w.svc.createStaffSession({ id: 'an2', role: 'analyst' }));
  await w.svc.routeDissent(w.analyst, id, { expectedVersion: 0 });
  await assert.rejects(() => w.svc.routeDissent(analyst2, id, { expectedVersion: 0 }), /changed: you saw version 0/);
  await assert.rejects(() => w.svc.routeDissent(analyst2, id, {}), /expectedVersion/);

  await assert.rejects(() => w.svc.actDissent(w.analyst, id, { expectedVersion: 1, action: ACTION.SPLIT, statements: ['only one'] }), /at least two/);
  await assert.rejects(
    () => w.svc.actDissent(w.analyst, id, { expectedVersion: 1, action: ACTION.SPLIT, statements: ['Displacement is expected to worsen.', 'Cholera cases will exceed 5,000 by 30 April 2027.'] }),
    /gate/
  );
  assert.equal((await w.answers.cards.all()).length, 1, 'a rejected split writes nothing');

  const res = await w.svc.actDissent(w.analyst, id, {
    expectedVersion: 1, action: ACTION.SPLIT, title: 'Split cholera and food',
    statements: ['Cholera cases in Chad will exceed 10,000 by 30 April 2027.', 'IPC Phase 4 will be declared in any Chad district by 30 April 2027.'],
  });
  assert.deepEqual(res.newCards, [`${card.id}a`, `${card.id}b`]);
  assert.equal((await w.answers.cards.get(card.id)).status, 'retired');
  assert.equal((await w.answers.cards.get(card.id)).retiredBy, id);
  assert.equal((await w.answers.estimates.find({ cardId: card.id })).length, 1, 'parent estimates stay on the parent');
  for (const kid of res.newCards) {
    const c = await w.answers.cards.get(kid);
    assert.equal(c.parentId, card.id);
    assert.equal(c.status, 'open');
    assert.equal((await w.answers.estimates.find({ cardId: kid })).length, 0, 'children start clean');
  }
  await assert.rejects(() => w.svc.submitEstimate(raiser.actor, { cardId: card.id, p: 0.5 }), /not open/);

  await assert.rejects(() => w.svc.closeDissent(w.analyst, id, { expectedVersion: 2, reason: 'x' }), /before notify/);
  assert.deepEqual(await w.svc.notifyDissent(w.analyst, id, { expectedVersion: 2 }), { sent: true });
  const box = await w.svc.inbox(raiser.actor);
  assert.equal(box.notifications.length, 1);
  assert.equal(box.notifications[0].type, 'dissent_actioned');
  await w.svc.closeDissent(w.analyst, id, { expectedVersion: 3, reason: 'done' });
  assert.equal((await w.answers.dissents.get(id)).status, 'closed');
  assert.equal((await w.svc.listDissents(w.analyst))[0].expert, undefined, 'analysts do not see expert ids');
  assert.equal((await w.svc.listDissents(w.mod))[0].expert, raiser.expertId);
});

test('anonymous dissents: no id stored, no notification, addressless day-coarse ledger entry (B-04, B-11)', async () => {
  const w = await world();
  const { card } = await w.svc.createCard(w.analyst, CARD);
  const anon = await w.enroll('anonymous');
  const { id } = await w.svc.submitDissent(anon.actor, { cardId: card.id, kind: KIND.WINDOW, text: 'The window is too long.' });
  const row = await w.answers.dissents.get(id);
  assert.equal(row.expert, null);
  assert.equal(row.by, 'anonymous');
  assert.equal(row.createdAt % DAY, 0);
  await w.svc.routeDissent(w.analyst, id, { expectedVersion: 0 });
  await w.svc.actDissent(w.analyst, id, { expectedVersion: 1, action: ACTION.RETIRE, title: 'Retired' });
  assert.equal(await w.svc.notifyDissent(w.analyst, id, { expectedVersion: 2 }), null);
  await w.svc.closeDissent(w.analyst, id, { expectedVersion: 2, reason: 'anonymous_actioned_on_card' });
  const [entry] = await w.svc.publicLedger(card.id);
  assert.equal(entry.actionedAt % DAY, 0, 'public ledger time is coarsened to the day');
  assert.ok(!/expert|by|dissentId|level/.test(Object.keys(entry).join(',')));
  assert.equal((await w.answers.notifications.all()).length, 0);
});

test('free text is checked for identifying detail and the warning is returned, not enforced (B-04)', async () => {
  const w = await world();
  const { card } = await w.svc.createCard(w.analyst, CARD);
  const e = await w.enroll('pseudonymous');
  const r = await w.svc.submitDissent(e.actor, { cardId: card.id, kind: KIND.WINDOW, text: 'As the country director for WFP in Juba, I work on this.' });
  assert.ok(r.warnings.length >= 3);
  assert.ok(await w.answers.dissents.get(r.id), 'still stored: it is advice, not a block');
});

test('pseudonyms are persisted per expert x country and survive a secret rotation (B-02)', async () => {
  const w = await world();
  const { card } = await w.svc.createCard(w.analyst, CARD);
  const e = await w.enroll('pseudonymous');
  const d1 = await w.svc.submitDissent(e.actor, { cardId: card.id, kind: KIND.WINDOW, text: 'a' });
  const alias1 = (await w.answers.dissents.get(d1.id)).by;
  assert.match(alias1, /^Analyst \d{4}$/);
  assert.equal((await w.roster.aliases.all()).length, 1);
  const rotated = createService({
    roster: w.roster, answers: w.answers, now: () => w.clock.now,
    secrets: { ballot: SECRETS.ballot, alias: 'a-completely-different-alias-secret' },
  });
  const actor = await rotated.authenticate(e.sessionToken);
  const d2 = await rotated.submitDissent(actor, { cardId: card.id, kind: KIND.WINDOW, text: 'b' });
  assert.equal((await w.answers.dissents.get(d2.id)).by, alias1, 'a rotated secret must not rename anyone');
  assert.equal((await w.roster.aliases.all()).length, 1);
});

test('the audit log records staff actions, never expert answers, and cannot be edited (B-12)', async () => {
  const w = await world();
  const { card } = await w.svc.createCard(w.analyst, CARD);
  const e = await w.enroll('anonymous');
  await w.svc.submitEstimate(e.actor, { cardId: card.id, p: 0.5 });
  await w.svc.closeRound(w.mod, card.id);
  const log = await w.svc.readAudit(w.mod);
  assert.deepEqual(log.map((l) => l.action), ['card.create', 'invite.create', 'round.close']);
  assert.ok(log.every((l) => l.actorId && l.at));
  assert.equal(JSON.stringify(log).includes(e.expertId), false, 'invites are logged by a hashed handle');
  assert.equal(typeof w.answers.audit.update, 'undefined');
  assert.equal(typeof w.answers.audit.remove, 'undefined');
  assert.equal(typeof w.answers.audit.put, 'undefined');
});

test('resolution needs an https evidence link; retention deletes raw rows but keeps released aggregates (B-17, B-19)', async () => {
  const w = await world();
  const { card } = await w.svc.createCard(w.analyst, CARD);
  const es = await many(5, () => w.enroll('identified'));
  for (const [i, e] of es.entries()) await w.svc.submitEstimate(e.actor, { cardId: card.id, p: 0.3 + i * 0.1 });
  await w.svc.closeRound(w.mod, card.id);
  const rel = await w.svc.cardRelease(card.id);
  assert.equal(rel.suppressed, false);
  await assert.rejects(() => w.svc.resolveCard(w.mod, { cardId: card.id, outcome: 1 }), /https evidenceUrl/);
  await assert.rejects(() => w.svc.resolveCard(w.mod, { cardId: card.id, outcome: 1, evidenceUrl: 'http://x.org' }), /https/);
  await assert.rejects(() => w.svc.resolveCard(w.mod, { cardId: card.id, outcome: 2, evidenceUrl: 'https://x.org' }), /outcome/);
  await assert.rejects(() => w.svc.resolveCard(w.analyst, { cardId: card.id, outcome: 1, evidenceUrl: 'https://x.org' }), /may not card\.resolve/);
  await w.svc.resolveCard(w.mod, { cardId: card.id, outcome: 'unobservable', evidenceUrl: 'https://acleddata.com/x' });
  assert.equal((await w.svc.applyRetention(w.mod, { months: 12 })).removed, 0, 'not yet old enough');
  w.clock.now += 13 * 30 * DAY;
  assert.equal((await w.svc.applyRetention(w.mod, { months: 12 })).removed, 5);
  assert.equal((await w.answers.estimates.all()).length, 0);
  assert.equal((await w.answers.releases.all()).length, 1, 'the released aggregate is kept');
});

test('export and erase: including anonymous estimates, whose key only the secret can recompute (B-17)', async () => {
  const w = await world();
  const { card } = await w.svc.createCard(w.analyst, CARD);
  const anon = await w.enroll('anonymous');
  const named = await w.enroll('pseudonymous');
  await w.svc.submitEstimate(anon.actor, { cardId: card.id, p: 0.3 });
  await w.svc.submitEstimate(named.actor, { cardId: card.id, p: 0.6 });
  await w.svc.submitDissent(named.actor, { cardId: card.id, kind: KIND.WINDOW, text: 'x' });

  const mine = await w.svc.exportMe(anon.actor);
  assert.equal(mine.estimates.length, 1);
  assert.equal(mine.estimates[0].p, 0.3);
  assert.match(mine.note, /unlinkable/);

  assert.deepEqual(await w.svc.eraseMe(anon.actor), { erased: true });
  assert.equal((await w.answers.estimates.all()).length, 1, 'only the other expert remains');
  assert.equal(await w.roster.experts.get(anon.expertId), undefined);
  await assert.rejects(() => w.svc.authenticate(anon.sessionToken), /invalid|expired/);
  await w.svc.eraseMe(named.actor);
  assert.equal((await w.answers.estimates.all()).length, 0);
  assert.equal((await w.answers.dissents.all()).length, 0);
  assert.equal((await w.roster.aliases.all()).length, 0);
  const log = JSON.stringify(await w.answers.audit.all());
  assert.ok(!log.includes(anon.expertId) && !log.includes(named.expertId));
  assert.equal((await w.answers.audit.all()).filter((l) => l.action === 'erase.self').length, 2);
});

test('state survives a restart (JSON snapshot for memory, the database for Postgres)', async () => {
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bm-'));
  const files = { roster: path.join(dir, 'roster.json'), answers: path.join(dir, 'answers.json') };
  const db = backend === 'postgres' ? new PGlite() : null;
  if (db) await migrate(db);
  const shared = backend === 'pg-driver' ? await pgDriverStores() : null;
  const open = () => {
    const stores = shared || (db
      ? createPgStores({ roster: db, answers: db })
      : { roster: createRosterStore({ file: files.roster }), answers: createAnswerStore({ file: files.answers }) });
    return { ...stores, svc: createService({ ...stores, secrets: SECRETS }) };
  };
  const a = open();
  const mod = await a.svc.authenticate(await a.svc.createStaffSession({ id: 'm', role: 'moderator' }));
  await a.svc.createCard(mod, { ...CARD, id: 'RPERSIST' });
  const b = open();
  assert.equal((await b.answers.cards.get('RPERSIST')).statement, CARD.statement);
  assert.equal((await b.answers.audit.all()).length, 1);
  assert.equal((await b.svc.authenticate(await b.svc.createStaffSession({ id: 'x', role: 'analyst' }))).role, 'analyst');
  if (!db && !shared) assert.ok(!fs.readFileSync(files.answers, 'utf8').includes(SECRETS.ballot));
  fs.rmSync(dir, { recursive: true });
});

test('a returning expert gets back in with a re-invite that changes nothing about their level or consent (B-01)', async () => {
  const w = await world();
  const e = await w.enroll('anonymous', { name: 'Back Again' });
  await assert.rejects(() => w.svc.createReinvite(w.analyst, e.expertId), /may not invite\.create/);
  await assert.rejects(() => w.svc.createReinvite(w.mod, 'ex_nobody'), /no such expert/);
  const pending = await w.svc.createInvite(w.mod, { declaration: { countries: ['TCD'] } });
  assert.ok(pending.expertId);
  await assert.rejects(() => w.svc.createReinvite(w.mod, pending.expertId), /not completed onboarding/, 'cannot re-invite someone who never joined');

  const list = await w.svc.listExperts(w.mod);
  assert.equal(list.find((x) => x.id === e.expertId).joined, true);
  assert.equal(list.find((x) => x.id === pending.expertId).joined, false);
  assert.ok(!JSON.stringify(list).includes('anonymous'), 'the list does not reveal anyone\'s anonymity level');
  await assert.rejects(() => w.svc.listExperts(w.analyst), /may not invite\.create/);

  const before = await w.roster.experts.get(e.expertId);
  const link = await w.svc.createReinvite(w.mod, e.expertId);
  const back = await w.svc.redeemInvite(link.token, {});
  assert.deepEqual([back.expertId, back.level, back.returning], [e.expertId, 'anonymous', true]);
  assert.equal((await w.svc.authenticate(back.sessionToken)).expertId, e.expertId);
  assert.deepEqual(await w.roster.experts.get(e.expertId), before, 'level, consent and key mode are untouched');
  await assert.rejects(() => w.svc.redeemInvite(link.token, {}), /already used/);
  assert.ok((await w.svc.readAudit(w.mod)).some((l) => l.action === 'invite.reinvite'));
});

test('concurrent writers: one invite redeem wins, one ballot wins, one dissent edit wins (B-05, B-06, B-12)', async () => {
  const w = await world();
  const { card } = await w.svc.createCard(w.analyst, CARD);
  const inv = await w.svc.createInvite(w.mod, { declaration: { countries: ['TCD'] } });
  const redeem = () => w.svc.redeemInvite(inv.token, { level: 'identified', consentVersion: CONSENT_VERSION });
  const r = await Promise.allSettled([redeem(), redeem(), redeem()]);
  assert.equal(r.filter((x) => x.status === 'fulfilled').length, 1, 'exactly one redemption');

  const e = await w.enroll('anonymous');
  const answers = await Promise.allSettled(Array.from({ length: 5 }, () => w.svc.submitEstimate(e.actor, { cardId: card.id, p: 0.5 })));
  assert.equal(answers.filter((x) => x.status === 'fulfilled').length, 1, 'exactly one ballot');
  assert.equal((await w.answers.estimates.all()).length, 1);

  const raiser = await w.enroll('identified');
  const { id } = await w.svc.submitDissent(raiser.actor, { cardId: card.id, kind: KIND.WINDOW, text: 'x' });
  const edits = await Promise.allSettled([
    w.svc.routeDissent(w.analyst, id, { expectedVersion: 0 }),
    w.svc.routeDissent(w.analyst, id, { expectedVersion: 0 }),
  ]);
  assert.equal(edits.filter((x) => x.status === 'fulfilled').length, 1, 'exactly one edit');
  assert.equal((await w.answers.dissents.get(id)).version, 1);
});
}
