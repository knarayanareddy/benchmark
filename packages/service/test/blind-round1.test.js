import baseTest from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { BACKENDS, worldFor, CARD, many } from './helpers.js';
import { CONSENT_VERSION } from '../src/consent.js';
import * as B from '@benchmark/core/blind';

const blindKey = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' });
// Anything that would tell an expert what ACAPS thinks, in any spelling.
const LEAK = /acaps(P|Band)|acaps_p|seedP|0\.705|"High"|midpoint/;

for (const backend of BACKENDS) {
  const test = (name, fn) => baseTest(`[${backend}] ${name}`, () => fn());

  test('Round 1 is blind: no payload an expert can reach carries ACAPS\'s reading (R9)', async () => {
    const w = await worldFor(backend, { blindKey });
    const { card } = await w.svc.createCard(w.analyst, CARD);
    assert.equal(card.acapsP, 0.705, 'it is stored, for scoring');
    const named = await w.enroll('identified');
    const anon = await w.enroll('anonymous');
    const inv = await w.svc.createInvite(w.mod, { declaration: { countries: ['TCD'] } });
    const dev = await w.svc.redeemInvite(inv.token, { level: 'anonymous', mode: 'device', consentVersion: CONSENT_VERSION });
    const devActor = await w.svc.authenticate(dev.sessionToken);

    for (const actor of [named.actor, anon.actor, devActor]) {
      const box = await w.svc.inbox(actor);
      assert.equal(box.toAnswer.length, 1);
      assert.doesNotMatch(JSON.stringify(box), LEAK);
      assert.ok(!('seedP' in box.toAnswer[0]) && !('acapsP' in box.toAnswer[0]));
    }
    // The staff list is for staff, but it never needs the reading either.
    assert.doesNotMatch(JSON.stringify(await w.svc.listCards(w.analyst)), LEAK);
    // And a submitted answer echoes only the expert's own number.
    const r = await w.svc.submitEstimate(named.actor, { cardId: card.id, p: 0.3 });
    assert.doesNotMatch(JSON.stringify(r), LEAK);
  });

  test('a card ACAPS never rated opens with no reading and no invented number', async () => {
    const w = await worldFor(backend);
    const { probability: _drop, ...unrated } = CARD;
    const { card } = await w.svc.createCard(w.analyst, unrated);
    assert.equal(card.acapsP, null);
    assert.equal(card.acapsBand, null);
    const e = await w.enroll('identified');
    assert.equal((await w.svc.inbox(e.actor)).toAnswer.length, 1);
  });

  test('a split or rewrite child keeps the parent\'s ACAPS reading for scoring, still unseen by experts', async () => {
    const w = await worldFor(backend);
    const { card } = await w.svc.createCard(w.analyst, CARD);
    const e = await w.enroll('identified');
    const { id } = await w.svc.submitDissent(e.actor, { cardId: card.id, kind: 'two_risks', text: 'two' });
    await w.svc.routeDissent(w.analyst, id, { expectedVersion: 0 });
    const res = await w.svc.actDissent(w.analyst, id, {
      expectedVersion: 1, action: 'split',
      statements: ['Cholera cases in Chad will exceed 10,000 by 30 April 2027.', 'IPC Phase 4 will be declared in any Chad district by 30 April 2027.'],
    });
    for (const kid of res.newCards) {
      const c = await w.answers.cards.get(kid);
      assert.equal(c.acapsP, 0.705);
    }
    const box = await w.svc.inbox(e.actor);
    assert.doesNotMatch(JSON.stringify(box), LEAK);
  });

  test('Round 2 shows the panel distribution and the expert\'s own first answer, never ACAPS\'s reading', async () => {
    const w = await worldFor(backend);
    const { card } = await w.svc.createCard(w.analyst, CARD);
    const es = await many(6, () => w.enroll('identified'));
    for (const [i, e] of es.entries()) await w.svc.submitEstimate(e.actor, { cardId: card.id, p: 0.2 + i * 0.1 });
    await w.svc.closeRound(w.mod, card.id);
    await w.svc.openRound2(w.mod, card.id);
    const box = await w.svc.inbox(es[0].actor);
    assert.equal(box.openForRevision[0].yourEstimate, 0.2);
    assert.equal(box.openForRevision[0].release.n, 6);
    assert.doesNotMatch(JSON.stringify(box), LEAK);
  });

  test('the blind Round-1 result is ledgered at close and cannot change when Round 2 revises it (the primary endpoint)', async () => {
    const w = await worldFor(backend);
    const { card } = await w.svc.createCard(w.analyst, CARD);
    const es = await many(6, () => w.enroll('identified'));
    for (const [i, e] of es.entries()) await w.svc.submitEstimate(e.actor, { cardId: card.id, p: 0.2 + i * 0.1 });
    await w.svc.closeRound(w.mod, card.id);
    const round1 = await w.svc.cardRelease(card.id);
    assert.equal(round1.suppressed, false);
    await w.svc.openRound2(w.mod, card.id);
    for (const e of es) await w.svc.submitEstimate(e.actor, { cardId: card.id, p: 0.9 });
    const again = await w.svc.cardRelease(card.id, { round: 1 });
    assert.deepEqual(again, round1, 'revising in Round 2 does not touch the published Round-1 snapshot');
    const rows = await w.answers.estimates.find({ cardId: card.id });
    assert.equal(rows.filter((r) => r.round === 1).length, 6, 'every blind first answer is still stored, unchanged');
    const kept = rows.filter((r) => r.round === 1).map((r) => r.p).sort((a, b) => a - b);
    kept.forEach((v, i) => assert.ok(Math.abs(v - (0.2 + i * 0.1)) < 1e-9, `round-1 answer ${i} is ${v}`));
  });

  test('the device-held path leaks nothing either: the key, the card list and the status', async () => {
    const w = await worldFor(backend, { blindKey });
    const { card } = await w.svc.createCard(w.analyst, CARD);
    const pk = w.svc.blindPublicKey();
    assert.doesNotMatch(JSON.stringify(pk), LEAK);
    const inv = await w.svc.createInvite(w.mod, { declaration: { countries: ['TCD'] } });
    const dev = await w.svc.redeemInvite(inv.token, { level: 'anonymous', mode: 'device', consentVersion: CONSENT_VERSION });
    const actor = await w.svc.authenticate(dev.sessionToken);
    const n = B.bytesToBig(Buffer.from(pk.n, 'base64url')); const e = B.bytesToBig(Buffer.from(pk.e, 'base64url'));
    const { token, r } = B.deriveBallot(Uint8Array.from(crypto.randomBytes(32)), card.id, n);
    const blinded = B.bytesToHex(B.bigToBytes(B.blind(n, e, B.ballotMessage(card.id, token), r), B.modulusBytes(n)));
    const { signature } = await w.svc.issueBlindToken(actor, { cardId: card.id, blinded });
    const sig = B.bytesToHex(B.bigToBytes(B.unblind(n, B.bytesToBig(B.hexToBytes(signature)), r), B.modulusBytes(n)));
    const st = await w.svc.anonymousStatus({ cardId: card.id, token, signature: sig });
    assert.doesNotMatch(JSON.stringify(st), LEAK);
  });
}

baseTest('the database column is named for what it is, and may be empty', async () => {
  const { PGlite } = await import('@electric-sql/pglite');
  const { migrate } = await import('../src/migrate.js');
  const db = new PGlite();
  await migrate(db);
  const cols = (await db.query("select column_name, is_nullable from information_schema.columns where table_schema='answers' and table_name='cards'")).rows;
  assert.ok(cols.some((c) => c.column_name === 'acaps_p' && c.is_nullable === 'YES'));
  assert.ok(!cols.some((c) => c.column_name === 'seed_p'), 'no column still says "seed"');
  await db.exec(`insert into answers.cards(k,doc,status,round,country,win_from,win_to,objective,resolution_source,resolver)
    values ('X','{}','open',1,'TCD','2026-11-01','2027-04-30','o','IPC','r')`);
});
