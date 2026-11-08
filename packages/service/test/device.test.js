import baseTest from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import * as B from '@benchmark/core/blind';
import { KIND } from '@benchmark/domain/dissent';
import { createServer } from '../src/http.js';
import { CONSENT_VERSION } from '../src/consent.js';
import { BACKENDS, worldFor, CARD, many } from './helpers.js';

const blindKey = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' });
const bk = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const BG_PUB = bk.publicKey.export({ type: 'spki', format: 'pem' });

/** What the expert's browser does, using only the public key and its own secret. */
function device(svc) {
  const secret = Uint8Array.from(crypto.randomBytes(32));
  const pk = svc.blindPublicKey();
  const n = B.bytesToBig(Buffer.from(pk.n, 'base64url')); const e = B.bytesToBig(Buffer.from(pk.e, 'base64url'));
  return {
    secret,
    async ballot(actor, cardId) {
      const { token, r } = B.deriveBallot(secret, cardId, n);
      const blinded = B.bytesToHex(B.bigToBytes(B.blind(n, e, B.ballotMessage(cardId, token), r), B.modulusBytes(n)));
      const { signature } = await svc.issueBlindToken(actor, { cardId, blinded });
      const sig = B.unblind(n, B.bytesToBig(B.hexToBytes(signature)), r);
      assert.equal(B.verify(n, e, B.ballotMessage(cardId, token), sig), true, 'the device checks the signature before using it');
      return { cardId, token, signature: B.bytesToHex(B.bigToBytes(sig, B.modulusBytes(n))) };
    },
  };
}

for (const backend of BACKENDS) {
  const test = (name, fn) => baseTest(`[${backend}] ${name}`, () => fn());
  const world = async (o = {}) => {
    const w = await worldFor(backend, { blindKey, ...o });
    const { card } = await w.svc.createCard(w.analyst, CARD);
    const enrollDevice = async () => {
      const inv = await w.svc.createInvite(w.mod, { declaration: { countries: ['TCD'] } });
      const r = await w.svc.redeemInvite(inv.token, { level: 'anonymous', mode: 'device', consentVersion: CONSENT_VERSION });
      return { ...r, actor: await w.svc.authenticate(r.sessionToken), dev: device(w.svc) };
    };
    return { ...w, card, enrollDevice };
  };

  test('not configured: a device-held key cannot be chosen, and there is no key to fetch', async () => {
    const w = await worldFor(backend);
    const inv = await w.svc.createInvite(w.mod, { declaration: { countries: ['TCD'] } });
    await assert.rejects(() => w.svc.redeemInvite(inv.token, { level: 'anonymous', mode: 'device', consentVersion: CONSENT_VERSION }), /not configured/);
    assert.throws(() => w.svc.blindPublicKey(), /not configured/);
  });

  test('a device-held key is an anonymous-level choice, shown with its own consent text, and recorded', async () => {
    const w = await world();
    const inv = await w.svc.createInvite(w.mod, { declaration: { countries: ['TCD'] } });
    await assert.rejects(() => w.svc.redeemInvite(inv.token, { level: 'pseudonymous', mode: 'device', consentVersion: CONSENT_VERSION }), /anonymous level only/);
    const text = w.svc.consentFor('anonymous', { device: true }).text;
    assert.match(text, /key that only your device holds/);
    assert.match(text, /nothing can be opened for a safety concern/);
    assert.match(text, /lose your recovery code/);
    assert.notEqual(text, w.svc.consentFor('anonymous').text);
    const e = await w.enrollDevice();
    assert.equal(e.mode, 'device');
    const row = await w.roster.experts.get(e.expertId);
    assert.equal(row.tokenMode, 'device');
    assert.match(row.consent.textHash, /^[0-9a-f]{64}$/);
    assert.throws(() => w.svc.consentFor('identified', { device: true }), /anonymous level only/);
  });

  test('the whole flow: blind-sign, unblind, answer with no login, revise in round 2, and it counts in the release', async () => {
    const w = await world();
    const experts = await many(6, () => w.enrollDevice());
    const ballots = [];
    for (const [i, e] of experts.entries()) {
      const b = await e.dev.ballot(e.actor, w.card.id);
      ballots.push(b);
      const r = await w.svc.submitAnonymousEstimate({ ...b, p: 0.2 + i * 0.1 });
      assert.equal(r.round, 1);
    }
    assert.deepEqual(await w.svc.anonymousStatus(ballots[0]), { cardId: w.card.id, round: 1, status: 'open', round1: 0.2, round2: null });
    await assert.rejects(() => w.svc.submitAnonymousEstimate({ ...ballots[0], p: 0.5 }), /already answered/);
    await w.svc.closeRound(w.mod, w.card.id);
    const rel = await w.svc.cardRelease(w.card.id);
    assert.equal(rel.n, 6);
    assert.equal(rel.suppressed, false);
    await w.svc.openRound2(w.mod, w.card.id);
    const box = await w.svc.inbox(experts[0].actor);
    assert.equal(box.deviceMode, true);
    assert.equal(box.openForRevision.length, 1, 'the server offers every open round-2 card; the device knows which it answered');
    assert.equal(box.openForRevision[0].release.n, 6);
    const r2 = await w.svc.submitAnonymousEstimate({ ...ballots[0], p: 0.9 });
    assert.equal(r2.round, 2);
    assert.equal((await w.svc.anonymousStatus(ballots[0])).round2, 0.9);
    const late = await experts[1].dev.ballot(experts[1].actor, w.card.id); // same token, re-fetched: idempotent
    assert.equal(late.token, ballots[1].token);
    assert.equal(late.signature, ballots[1].signature, 'asking again repeats the same signature');
    assert.ok(!/ex_|bt:|token/.test(JSON.stringify(rel)), 'a release never carries a key');
  });

  test('one token per expert per card, and never a second under a different blinding', async () => {
    const w = await world();
    const e = await w.enrollDevice();
    await e.dev.ballot(e.actor, w.card.id);
    const pk = w.svc.blindPublicKey();
    const n = B.bytesToBig(Buffer.from(pk.n, 'base64url'));
    const other = B.bytesToHex(B.bigToBytes(B.blind(n, B.bytesToBig(Buffer.from(pk.e, 'base64url')), B.ballotMessage(w.card.id, 'c'.repeat(64)), 987654321n), B.modulusBytes(n)));
    await assert.rejects(() => w.svc.issueBlindToken(e.actor, { cardId: w.card.id, blinded: other }), /already issued/);
    await assert.rejects(() => w.svc.issueBlindToken(e.actor, { cardId: w.card.id, blinded: 'zz' }), /hex/);
    await assert.rejects(() => w.svc.issueBlindToken(e.actor, { cardId: w.card.id, blinded: '00' }), /out of range/);
    const plain = await w.enroll('anonymous');
    await assert.rejects(() => w.svc.issueBlindToken(plain.actor, { cardId: w.card.id, blinded: other }), /did not choose a device-held key/);
    await assert.rejects(() => w.svc.issueBlindToken(w.analyst, { cardId: w.card.id, blinded: other }), /may not estimate\.submit/);
  });

  test('a new token cannot be issued once the card is past round 1', async () => {
    const w = await world();
    const e = await w.enrollDevice();
    await w.svc.closeRound(w.mod, w.card.id);
    await assert.rejects(() => e.dev.ballot(e.actor, w.card.id), /round 1/);
  });

  test('forged, borrowed and altered ballots are refused', async () => {
    const w = await world();
    const { card: c2 } = await w.svc.createCard(w.analyst, { ...CARD, statement: 'IPC Phase 4 will be declared in any Chad district by 30 April 2027.' });
    const e = await w.enrollDevice();
    const b = await e.dev.ballot(e.actor, w.card.id);
    await assert.rejects(() => w.svc.submitAnonymousEstimate({ ...b, cardId: c2.id, p: 0.5 }), /signature invalid/, 'a card-1 ballot is useless on card 2');
    await assert.rejects(() => w.svc.submitAnonymousEstimate({ ...b, token: 'd'.repeat(64), p: 0.5 }), /signature invalid/);
    await assert.rejects(() => w.svc.submitAnonymousEstimate({ ...b, signature: '00'.repeat(256), p: 0.5 }), /signature invalid/);
    await assert.rejects(() => w.svc.submitAnonymousEstimate({ ...b, signature: 'nothex', p: 0.5 }), /hex/);
    await assert.rejects(() => w.svc.submitAnonymousEstimate({ ...b, token: 'short', p: 0.5 }), /64 hex/);
    await assert.rejects(() => w.svc.submitAnonymousEstimate({ ...b, p: Number.NaN }), /finite/);
    assert.equal((await w.svc.submitAnonymousEstimate({ ...b, p: 1 })).p, 0.99, 'clamped like every answer');
    assert.equal((await w.answers.estimates.all()).length, 1);
  });

  test('round 2 needs a round-1 answer from the same ballot', async () => {
    const w = await world();
    const a = await w.enrollDevice(); const b = await w.enrollDevice();
    const ballotA = await a.dev.ballot(a.actor, w.card.id);
    const ballotB = await b.dev.ballot(b.actor, w.card.id);
    await w.svc.submitAnonymousEstimate({ ...ballotA, p: 0.3 });
    await w.svc.closeRound(w.mod, w.card.id);
    await w.svc.openRound2(w.mod, w.card.id);
    await assert.rejects(() => w.svc.submitAnonymousEstimate({ ...ballotB, p: 0.4 }), /did not answer round 1/);
    assert.equal((await w.svc.submitAnonymousEstimate({ ...ballotA, p: 0.4 })).round, 2);
  });

  test('concurrent submissions of one ballot: exactly one wins', async () => {
    const w = await world();
    const e = await w.enrollDevice();
    const b = await e.dev.ballot(e.actor, w.card.id);
    const r = await Promise.allSettled(Array.from({ length: 5 }, () => w.svc.submitAnonymousEstimate({ ...b, p: 0.5 })));
    assert.equal(r.filter((x) => x.status === 'fulfilled').length, 1);
  });

  test('neither store alone, nor both together, can link an answer to an expert', async () => {
    const w = await world();
    const e = await w.enrollDevice();
    const b = await e.dev.ballot(e.actor, w.card.id);
    await w.svc.submitAnonymousEstimate({ ...b, p: 0.3 });
    const answersDump = JSON.stringify(await w.answers.estimates.all());
    const rosterDump = JSON.stringify(await w.roster.issuances.all()) + JSON.stringify(await w.roster.experts.all());
    assert.ok(answersDump.includes(b.token), 'the answers hold the token');
    assert.ok(!answersDump.includes(e.expertId), 'the answers never hold the expert');
    assert.ok(!rosterDump.includes(b.token), 'the roster never holds the token');
    assert.ok(!rosterDump.includes(b.signature), 'nor the unblinded signature');
    const issued = (await w.roster.issuances.all())[0];
    assert.equal(issued.expertId, e.expertId, 'the roster knows THAT this expert took part');
    const pk = w.svc.blindPublicKey();
    const n = B.bytesToBig(Buffer.from(pk.n, 'base64url'));
    const fdhHex = B.fdh(B.ballotMessage(w.card.id, b.token), n).toString(16);
    assert.notEqual(issued.blinded, fdhHex, 'the stored blinded value is not the hash of the ballot');
    assert.notEqual(issued.blinded, b.token);
    assert.ok(!(answersDump + rosterDump).includes(Buffer.from(e.dev.secret).toString('hex')), 'the device secret is stored nowhere');
    const row = (await w.answers.estimates.all())[0];
    assert.deepEqual([row.expertId, row.level, row.respondentKey], [null, 'anonymous', `bt:${b.token}`]);
    assert.ok(row.at % 86400000 === 0, 'day-coarse');
  });

  test('a device-held expert cannot answer through the keyed path, cannot be opened by break-glass, and erases from the device', async () => {
    const w = await world({ breakGlassPublicKey: BG_PUB });
    const e = await w.enrollDevice();
    await assert.rejects(() => w.svc.submitEstimate(e.actor, { cardId: w.card.id, p: 0.5 }), /held on your device/);
    const d = await w.svc.submitDissent(e.actor, { cardId: w.card.id, kind: KIND.WINDOW, text: 'x' });
    const row = await w.answers.dissents.get(d.id);
    assert.equal(row.level, 'anonymous');
    assert.equal(row.sealedIdentity, undefined, 'nothing is sealed for a device-held expert');
    const mod2 = await w.svc.authenticate(await w.svc.createStaffSession({ id: 'mod2', role: 'moderator' }));
    await assert.rejects(() => w.svc.requestBreakGlass(w.mod, { dissentId: d.id, category: 'safety_threat', reason: 'x'.repeat(30) }), /device-held key, which cannot be opened by design/);
    void mod2;

    const b = await e.dev.ballot(e.actor, w.card.id);
    await w.svc.submitAnonymousEstimate({ ...b, p: 0.3 });
    assert.match((await w.svc.exportMe(e.actor)).note, /cannot be listed or erased from here/);
    assert.equal((await w.svc.eraseAnonymousEstimate(b)).removed, 1, 'the device erases its own answer');
    assert.equal((await w.answers.estimates.all()).length, 0);
    await w.svc.eraseMe(e.actor);
    assert.equal((await w.roster.issuances.all()).length, 0);
  });

  test('over HTTP the anonymous endpoints need no login, and the key is public', async () => {
    const w = await world();
    const server = createServer({ service: w.svc, limits: { writesPerMinute: 10000, burstWrites: 10000, readsPerMinute: 10000 } });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const base = `http://127.0.0.1:${server.address().port}`;
    const post = (p, body, headers = {}) => fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
    try {
      const key = await (await fetch(`${base}/api/blind/key`)).json();
      assert.equal(key.scheme, B.BLIND_SCHEME);
      assert.match(key.n, /^[\w-]{300,}$/);
      assert.ok(!('d' in key) && !('p' in key), 'only the public half');
      assert.equal((await post('/api/blind/issue', { cardId: w.card.id, blinded: '01' })).status, 401, 'issuing needs a login');
      const e = await w.enrollDevice();
      const b = await e.dev.ballot(e.actor, w.card.id);
      const ok = await post('/api/anon/estimates', { ...b, p: 0.42 });
      assert.equal(ok.status, 200, 'answering needs no Authorization header');
      assert.equal((await ok.json()).p, 0.42);
      assert.equal((await post('/api/anon/estimates', { ...b, p: 0.1 })).status, 409);
      const st = await (await post('/api/anon/status', b)).json();
      assert.equal(st.round1, 0.42);
      assert.equal((await post('/api/anon/status', { ...b, token: 'e'.repeat(64) })).status, 401);
      assert.equal((await (await post('/api/anon/erase', b)).json()).removed, 1);
      const text = await (await fetch(`${base}/api/consent/anonymous?mode=device`)).json();
      assert.equal(text.device, true);
    } finally { await new Promise((r) => server.close(r)); }
  });
}
