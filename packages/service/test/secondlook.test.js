import baseTest from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import * as B from '@benchmark/core/blind';
import { ARMS, assignArm } from '@benchmark/core/secondlook';
import { hmacSha256Hex } from '@benchmark/core/hmac';
import { createServer } from '../src/http.js';
import { CONSENT_VERSION } from '../src/consent.js';
import { BACKENDS, worldFor, CARD, many, SECRETS, DAY } from './helpers.js';

const blindKey = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' });

// What a moderator would write. The markers below let the leak checks find it in any payload.
const CONTENT = {
  acapsReasoning: 'The reading rests on three months of case reports and the rainy-season pattern.',
  sources: [{ label: 'WHO bulletin', url: 'https://who.int/bulletin' }],
  higher: ['Flooding in the district raises the chance of an outbreak this season.'],
  lower: ['Vaccination reached most of the district in October, lowering the chance.'],
};
const NO_BACKGROUND = 'there is no extra background for this question';
// The ACAPS number, in any spelling, and anything that would reveal an arm or the text.
const NUMBER_LEAK = /\d\s*%|\b0\.705\b|acapsP|acapsBand/;
const ARM_LEAK = /\bbalanced\b|\bacaps_view\b|\bcontrol\b/;
const TEXT_LEAK = /rainy-season|Vaccination reached|reading rests|Flooding in the district/;

/** The arm the service assigns, recomputed from the same secret and the same respondent key. */
const armOf = (cardId, key) => assignArm(hmacSha256Hex(SECRETS.ballot, `arm:v1:${cardId}:${key}`));

/** The message of a refusal, or null if the call succeeded. */
const reason = async (p) => { try { await p; return null; } catch (e) { return e.message; } };

const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);

/** What the expert's browser does, using only the public key and its own secret (as in device.test.js). */
function deviceOf(svc) {
  const secret = Uint8Array.from(crypto.randomBytes(32));
  const pk = svc.blindPublicKey();
  const n = B.bytesToBig(Buffer.from(pk.n, 'base64url')); const e = B.bytesToBig(Buffer.from(pk.e, 'base64url'));
  return {
    async ballot(actor, cardId) {
      const { token, r } = B.deriveBallot(secret, cardId, n);
      const blinded = B.bytesToHex(B.bigToBytes(B.blind(n, e, B.ballotMessage(cardId, token), r), B.modulusBytes(n)));
      const { signature } = await svc.issueBlindToken(actor, { cardId, blinded });
      const sig = B.unblind(n, B.bytesToBig(B.hexToBytes(signature)), r);
      return { cardId, token, signature: B.bytesToHex(B.bigToBytes(sig, B.modulusBytes(n))) };
    },
  };
}

for (const backend of BACKENDS) {
  const test = (name, fn) => baseTest(`[${backend}] ${name}`, () => fn());
  const world = (o = {}) => worldFor(backend, { blindKey, ...o });

  const openCard = async (w, input = CARD) => (await w.svc.createCard(w.analyst, input)).card;
  const setBg = (w, card, content = CONTENT) => w.svc.setSecondLook(w.analyst, { cardId: card.id, content });
  const closeAndOpen = async (w, card) => { await w.svc.closeRound(w.mod, card.id); await w.svc.openRound2(w.mod, card.id); };

  /** An identified expert whose arm on this card is `arm`. Enrols until one lands there. */
  async function expertFor(w, card, arm) {
    for (let i = 0; i < 200; i++) {
      const e = await w.enroll('identified');
      if (armOf(card.id, `id:${e.expertId}`) === arm) return e;
    }
    throw new Error(`no expert in ${arm}`);
  }

  /** A device-held expert whose ballot for this card is in `arm`. Answers Round 1 with it. */
  async function deviceFor(w, card, arm) {
    for (let i = 0; i < 200; i++) {
      const inv = await w.svc.createInvite(w.mod, { declaration: { countries: ['TCD'] } });
      const r = await w.svc.redeemInvite(inv.token, { level: 'anonymous', mode: 'device', consentVersion: CONSENT_VERSION });
      const e = { ...r, actor: await w.svc.authenticate(r.sessionToken) };
      const b = await deviceOf(w.svc).ballot(e.actor, card.id);
      if (armOf(card.id, `bt:${b.token}`) !== arm) continue;
      await w.svc.submitAnonymousEstimate({ ...b, p: 0.4 });
      return { e, b };
    }
    throw new Error(`no device-held expert in ${arm}`);
  }

  test('setSecondLook: analysts and moderators may write, experts may not; the write is versioned and audited', async () => {
    const w = await world();
    const card = await openCard(w);
    const e = await w.enroll('identified');
    await assert.rejects(() => w.svc.setSecondLook(e.actor, { cardId: card.id, content: CONTENT }), /may not card\.author/);
    assert.deepEqual(await w.svc.setSecondLook(w.analyst, { cardId: card.id, content: CONTENT }), { cardId: card.id, version: 1 });
    assert.deepEqual(await w.svc.setSecondLook(w.mod, { cardId: card.id, content: CONTENT }), { cardId: card.id, version: 2 });
    const stored = await w.answers.cards.get(card.id);
    assert.deepEqual(stored.secondLook, CONTENT);
    const log = (await w.svc.readAudit(w.mod)).filter((a) => a.action === 'card.secondlook');
    assert.equal(log.length, 2);
    assert.equal(log[0].target, card.id);
    assert.equal(log[0].reason, '');
  });

  test('setSecondLook refuses bad content in one error, and refuses once Round 1 closes', async () => {
    const w = await world();
    const card = await openCard(w);
    await assert.rejects(() => w.svc.setSecondLook(w.analyst, { cardId: card.id, content: { ...CONTENT, higher: ['about 70% of districts flood'] } }), (err) => (
      err.status === 400 && /^second look content cannot be saved:/.test(err.message) && err.problems.length === 1
    ));
    await w.svc.closeRound(w.mod, card.id);
    await assert.rejects(() => setBg(w, card), /fixed once Round 1 closes/);
    await w.svc.openRound2(w.mod, card.id);
    await assert.rejects(() => setBg(w, card), /fixed once Round 1 closes/);
  });

  test('staff can read back the saved background and whether it is locked; experts cannot', async () => {
    const w = await world();
    const card = await openCard(w);
    assert.deepEqual(await w.svc.getSecondLook(w.analyst, card.id), { cardId: card.id, locked: false, content: null });
    await setBg(w, card);
    assert.deepEqual(await w.svc.getSecondLook(w.analyst, card.id), { cardId: card.id, locked: false, content: CONTENT });
    const e = await w.enroll('identified');
    await assert.rejects(() => w.svc.getSecondLook(e.actor, card.id), /may not card\.author/);
    await assert.rejects(() => w.svc.getSecondLook(w.analyst, 'nope'), /not found/);
    await w.svc.closeRound(w.mod, card.id);
    assert.equal((await w.svc.getSecondLook(w.analyst, card.id)).locked, true);
  });

  test('listCards says only whether a card has background; nothing the staff list returns carries the content or an arm', async () => {
    const w = await world();
    const card = await openCard(w);
    const bare = await openCard(w, { ...CARD, statement: 'IPC Phase 4 will be declared in any Chad district by 30 April 2027.' });
    await setBg(w, card);
    const list = await w.svc.listCards(w.analyst);
    assert.equal(list.find((c) => c.id === card.id).hasSecondLook, true);
    assert.equal(list.find((c) => c.id === bare.id).hasSecondLook, false);
    const dump = JSON.stringify(list);
    assert.doesNotMatch(dump, ARM_LEAK);
    assert.doesNotMatch(dump, TEXT_LEAK);
    assert.doesNotMatch(dump, NUMBER_LEAK);
  });

  test('inbox offers the background only to a non-control arm; no payload names an arm, shows the text or the ACAPS number', async () => {
    const w = await world();
    const card = await openCard(w);
    await setBg(w, card);
    const ctrl = await expertFor(w, card, 'control');
    const bal = await expertFor(w, card, 'balanced');
    const acaps = await expertFor(w, card, 'acaps_view');
    for (const e of [ctrl, bal, acaps]) await w.svc.submitEstimate(e.actor, { cardId: card.id, p: 0.4 });
    await closeAndOpen(w, card);
    for (const [arm, e] of [['control', ctrl], ['balanced', bal], ['acaps_view', acaps]]) {
      const box = await w.svc.inbox(e.actor);
      assert.equal(box.openForRevision.length, 1);
      assert.deepEqual(box.openForRevision[0].secondLook, { available: arm !== 'control' });
      const dump = JSON.stringify(box);
      assert.doesNotMatch(dump, ARM_LEAK);
      assert.doesNotMatch(dump, TEXT_LEAK);
      assert.doesNotMatch(dump, NUMBER_LEAK);
    }
  });

  test('a card with no background offers nothing: available is false, and opening it gives the same refusal as control', async () => {
    const w = await world();
    const card = await openCard(w);
    const e = await w.enroll('identified');
    await w.svc.submitEstimate(e.actor, { cardId: card.id, p: 0.4 });
    await closeAndOpen(w, card);
    assert.deepEqual((await w.svc.inbox(e.actor)).openForRevision[0].secondLook, { available: false });
    assert.equal(await reason(w.svc.openSecondLook(e.actor, { cardId: card.id })), NO_BACKGROUND);
  });

  test('openSecondLook refuses outside Round 2, without a Round-1 answer, and for control; success returns only the arm\'s content, and is recorded once', async () => {
    const w = await world();
    const card = await openCard(w);
    await setBg(w, card);
    const ctrl = await expertFor(w, card, 'control');
    const bal = await expertFor(w, card, 'balanced');
    const acaps = await expertFor(w, card, 'acaps_view');
    const late = await w.enroll('identified');
    assert.match(await reason(w.svc.openSecondLook(bal.actor, { cardId: card.id })), /only in Round 2/);
    for (const e of [ctrl, bal, acaps]) await w.svc.submitEstimate(e.actor, { cardId: card.id, p: 0.4 });
    await closeAndOpen(w, card);
    assert.match(await reason(w.svc.openSecondLook(late.actor, { cardId: card.id })), /did not answer round 1/);
    assert.equal(await reason(w.svc.openSecondLook(ctrl.actor, { cardId: card.id })), NO_BACKGROUND);

    const got = await w.svc.openSecondLook(bal.actor, { cardId: card.id });
    assert.deepEqual(got, { kind: 'balanced', higher: CONTENT.higher, lower: CONTENT.lower });
    assert.deepEqual(await w.svc.openSecondLook(bal.actor, { cardId: card.id }), got, 'opening again gives the same text');
    const shown = await w.svc.openSecondLook(acaps.actor, { cardId: card.id });
    assert.deepEqual(shown, { kind: 'acaps_view', acapsReasoning: CONTENT.acapsReasoning, sources: CONTENT.sources });
    assert.doesNotMatch(JSON.stringify(shown), NUMBER_LEAK, 'the ACAPS view carries the reasoning, never the number');
    const views = await w.answers.second_look.all();
    assert.equal(views.length, 2, 'one view row per opener, never a second one');
    assert.ok(!JSON.stringify(views).includes(late.expertId));
  });

  test('a second look cannot be opened after the expert has answered Round 2', async () => {
    const w = await world();
    const card = await openCard(w);
    await setBg(w, card);
    const acaps = await expertFor(w, card, 'acaps_view');
    await w.svc.submitEstimate(acaps.actor, { cardId: card.id, p: 0.4 });
    await closeAndOpen(w, card);
    await w.svc.submitEstimate(acaps.actor, { cardId: card.id, p: 0.5 });
    assert.match(await reason(w.svc.openSecondLook(acaps.actor, { cardId: card.id })), /already answered round 2/);
  });

  test('Round-2 rows carry the server-computed arm and whether the expert opened the background; a client cannot set them, and Round-1 rows never carry them', async () => {
    const w = await world();
    const card = await openCard(w);
    await setBg(w, card);
    const bal = await expertFor(w, card, 'balanced');
    const acaps = await expertFor(w, card, 'acaps_view');
    const ctrl = await expertFor(w, card, 'control');
    // Round 1 is blind: the client's arm and view fields are ignored there too.
    await w.svc.submitEstimate(bal.actor, { cardId: card.id, p: 0.4, arm: 'acaps_view', sawSecondLook: true });
    await w.svc.submitEstimate(acaps.actor, { cardId: card.id, p: 0.4 });
    await w.svc.submitEstimate(ctrl.actor, { cardId: card.id, p: 0.4 });
    assert.equal('arm' in await w.answers.estimates.get(`${card.id}|id:${bal.expertId}|1`), false);
    await closeAndOpen(w, card);
    await w.svc.openSecondLook(bal.actor, { cardId: card.id });
    await w.svc.submitEstimate(bal.actor, { cardId: card.id, p: 0.5, arm: 'control', sawSecondLook: false, viewed: false });
    await w.svc.submitEstimate(acaps.actor, { cardId: card.id, p: 0.5, arm: 'control', sawSecondLook: true, viewed: true });
    await w.svc.submitEstimate(ctrl.actor, { cardId: card.id, p: 0.5, arm: 'acaps_view', sawSecondLook: true });
    const row = (e) => w.answers.estimates.get(`${card.id}|id:${e.expertId}|2`);
    assert.deepEqual([(await row(bal)).arm, (await row(bal)).sawSecondLook], ['balanced', true], 'opened: true, whatever the body said');
    assert.deepEqual([(await row(acaps)).arm, (await row(acaps)).sawSecondLook], ['acaps_view', false], 'never opened');
    assert.deepEqual([(await row(ctrl)).arm, (await row(ctrl)).sawSecondLook], ['control', false]);
    assert.match(await reason(w.svc.openSecondLook(acaps.actor, { cardId: card.id })), /already answered round 2/);
  });

  test('a Round-2 answer on a card with no background stores neither field', async () => {
    const w = await world();
    const card = await openCard(w);
    const e = await w.enroll('identified');
    await w.svc.submitEstimate(e.actor, { cardId: card.id, p: 0.4 });
    await closeAndOpen(w, card);
    await w.svc.submitEstimate(e.actor, { cardId: card.id, p: 0.5, arm: 'acaps_view', sawSecondLook: true });
    const r2 = await w.answers.estimates.get(`${card.id}|id:${e.expertId}|2`);
    assert.equal('arm' in r2, false);
    assert.equal('sawSecondLook' in r2, false);
  });

  test('device-held: the anonymous second look follows the same rules; the answer holds no expert id; client fields change nothing', async () => {
    const w = await world();
    const card = await openCard(w);
    await setBg(w, card);
    const ctrl = await deviceFor(w, card, 'control');
    const bal = await deviceFor(w, card, 'balanced');
    const acaps = await deviceFor(w, card, 'acaps_view');
    await closeAndOpen(w, card);

    assert.equal(await reason(w.svc.openAnonymousSecondLook(ctrl.b)), NO_BACKGROUND);
    const shown = await w.svc.openAnonymousSecondLook(acaps.b);
    assert.deepEqual(shown, { kind: 'acaps_view', acapsReasoning: CONTENT.acapsReasoning, sources: CONTENT.sources });
    assert.doesNotMatch(JSON.stringify(shown), NUMBER_LEAK);
    assert.match(await reason(w.svc.openAnonymousSecondLook({ ...bal.b, token: 'e'.repeat(64) })), /signature invalid/);

    // The server decides the arm and whether the view happened, whatever the body says.
    await w.svc.submitAnonymousEstimate({ ...bal.b, p: 0.5, arm: 'acaps_view', sawSecondLook: true, viewed: true });
    await w.svc.submitAnonymousEstimate({ ...acaps.b, p: 0.5, arm: 'balanced', sawSecondLook: false });
    const rows = await w.answers.estimates.find({ cardId: card.id, round: 2 });
    const row = (b) => rows.find((r) => r.respondentKey === `bt:${b.token}`);
    assert.deepEqual([row(bal.b).arm, row(bal.b).sawSecondLook], ['balanced', false], 'never opened');
    assert.deepEqual([row(acaps.b).arm, row(acaps.b).sawSecondLook], ['acaps_view', true], 'opened');
    const dump = JSON.stringify([...rows, ...(await w.answers.second_look.all())]);
    for (const d of [ctrl, bal, acaps]) assert.ok(!dump.includes(d.e.expertId), 'no expert id in an anonymous answer or its view row');
    for (const r of rows) assert.equal(r.expertId, null);
    const box = await w.svc.inbox(ctrl.e.actor);
    assert.deepEqual(box.openForRevision[0].secondLook, { available: true }, 'a device cannot know its arm, so the server says only that content exists');
    assert.doesNotMatch(JSON.stringify(box), ARM_LEAK);
  });

  test('the round-2 summary pools across cards, reports only aggregates, and is hand-checkable', async () => {
    const w = await world();
    const cards = [await openCard(w), await openCard(w)];
    for (const c of cards) await setBg(w, c);
    const es = await many(40, () => w.enroll('identified'));
    for (const c of cards) for (const e of es) await w.svc.submitEstimate(e.actor, { cardId: c.id, p: 0.4 });
    for (const c of cards) await w.svc.closeRound(w.mod, c.id);
    for (const c of cards) await w.svc.openRound2(w.mod, c.id);
    const expected = { control: 0, balanced: 0, acaps_view: 0 };
    for (const c of cards) {
      for (const e of es) {
        const arm = armOf(c.id, `id:${e.expertId}`);
        expected[arm]++;
        // Balanced experts open the background; the ACAPS view is offered but not opened.
        if (arm === 'balanced') await w.svc.openSecondLook(e.actor, { cardId: c.id });
        await w.svc.submitEstimate(e.actor, { cardId: c.id, p: 0.5 });
      }
    }
    for (const arm of ARMS) assert.ok(expected[arm] >= 5, `the panel reaches ${arm}`);

    const s = await w.svc.secondLookSummary(w.mod);
    assert.equal(s.cards, 2);
    for (const arm of ARMS) {
      const a = s.arms[arm];
      assert.equal(a.n, expected[arm]);
      assert.equal(a.suppressed, false);
      // Every pair moved 0.4 -> 0.5. ACAPS reads 0.705: |0.4-0.705| - |0.5-0.705| = 0.305 - 0.205 = 0.1.
      near(a.meanShift, 0.1);
      near(a.meanTowardAcaps, 0.1);
      assert.equal(a.nWithAcaps, expected[arm]);
      assert.equal(a.sawCount, arm === 'balanced' ? expected.balanced : 0);
    }
    const dump = JSON.stringify(s);
    assert.doesNotMatch(dump, /ex_|id:|bt:/, 'no respondent key');
    assert.doesNotMatch(dump, NUMBER_LEAK);
    for (const e of es) assert.ok(!dump.includes(e.expertId));
    await assert.rejects(() => w.svc.secondLookSummary(w.analyst), /may not audit\.read/);
    await assert.rejects(() => w.svc.secondLookSummary(es[0].actor), /may not audit\.read/);
  });

  test('the round-2 summary withholds every arm under the floor of five', async () => {
    const w = await world();
    const card = await openCard(w);
    await setBg(w, card);
    const es = await many(3, () => w.enroll('identified'));
    for (const e of es) await w.svc.submitEstimate(e.actor, { cardId: card.id, p: 0.4 });
    await closeAndOpen(w, card);
    for (const e of es) await w.svc.submitEstimate(e.actor, { cardId: card.id, p: 0.5 });
    const s = await w.svc.secondLookSummary(w.mod);
    assert.equal(s.cards, 1);
    assert.equal(ARMS.reduce((sum, arm) => sum + s.arms[arm].n, 0), 3);
    for (const arm of ARMS) {
      assert.deepEqual(s.arms[arm], { n: s.arms[arm].n, suppressed: true, meanShift: null, meanTowardAcaps: null, nWithAcaps: null, sawCount: null });
    }
  });

  test('erasing an expert removes their view rows and no one else\'s', async () => {
    const w = await world();
    const card = await openCard(w);
    await setBg(w, card);
    const bal = await expertFor(w, card, 'balanced');
    const other = await expertFor(w, card, 'balanced');
    await w.svc.submitEstimate(bal.actor, { cardId: card.id, p: 0.4 });
    await w.svc.submitEstimate(other.actor, { cardId: card.id, p: 0.4 });
    await closeAndOpen(w, card);
    await w.svc.openSecondLook(bal.actor, { cardId: card.id });
    await w.svc.openSecondLook(other.actor, { cardId: card.id });
    await w.svc.eraseMe(bal.actor);
    assert.deepEqual((await w.answers.second_look.all()).map((r) => r.respondentKey), [`id:${other.expertId}`]);
  });

  test('an anonymous erase removes its view row; retention removes the view rows of the cards it purges', async () => {
    const w = await world();
    const card = await openCard(w);
    await setBg(w, card);
    const dev = await deviceFor(w, card, 'acaps_view');
    const dev2 = await deviceFor(w, card, 'acaps_view');
    await closeAndOpen(w, card);
    await w.svc.openAnonymousSecondLook(dev.b);
    await w.svc.openAnonymousSecondLook(dev2.b);
    await w.svc.eraseAnonymousEstimate(dev.b);
    assert.deepEqual((await w.answers.second_look.all()).map((r) => r.respondentKey), [`bt:${dev2.b.token}`]);
    await w.svc.resolveCard(w.mod, { cardId: card.id, outcome: 1, evidenceUrl: 'https://who.int/resolution' });
    w.clock.now += 400 * DAY;
    const r = await w.svc.applyRetention(w.mod);
    assert.deepEqual(r.cards, [card.id]);
    assert.equal((await w.answers.second_look.all()).length, 0);
    assert.equal((await w.answers.estimates.all()).length, 0);
  });

  test('export strips the arm and the view flag from the expert\'s own answers', async () => {
    const w = await world();
    const card = await openCard(w);
    await setBg(w, card);
    const bal = await expertFor(w, card, 'balanced');
    await w.svc.submitEstimate(bal.actor, { cardId: card.id, p: 0.4 });
    await closeAndOpen(w, card);
    await w.svc.openSecondLook(bal.actor, { cardId: card.id });
    await w.svc.submitEstimate(bal.actor, { cardId: card.id, p: 0.5 });
    const { estimates } = await w.svc.exportMe(bal.actor);
    assert.equal(estimates.length, 2);
    const r2 = estimates.find((r) => r.round === 2);
    assert.equal(r2.p, 0.5);
    assert.equal('arm' in r2, false);
    assert.equal('sawSecondLook' in r2, false);
    assert.doesNotMatch(JSON.stringify(estimates), /"arm"|sawSecondLook/);
  });

  test('over HTTP: the routes, a login only where there was one, and no body can choose an arm', async () => {
    const w = await world();
    const card = await openCard(w);
    const server = createServer({ service: w.svc, limits: { writesPerMinute: 10000, burstWrites: 10000, readsPerMinute: 10000 } });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const base = `http://127.0.0.1:${server.address().port}`;
    const call = async (method, path, { token, body } = {}) => {
      const res = await fetch(base + path, {
        method,
        headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      return { status: res.status, json: await res.json() };
    };
    const analyst = await w.svc.createStaffSession({ id: 'an1', role: 'analyst' });
    const moderator = await w.svc.createStaffSession({ id: 'mod1', role: 'moderator' });
    try {
      assert.equal((await call('PUT', `/api/staff/cards/${card.id}/second-look`, { token: analyst, body: { ...CONTENT, lower: ['x'] } })).status, 400);
      assert.equal((await call('PUT', `/api/staff/cards/${card.id}/second-look`, { body: CONTENT })).status, 401);
      assert.equal((await call('PUT', `/api/staff/cards/${card.id}/second-look`, { token: analyst, body: CONTENT })).json.version, 1);

      const bal = await expertFor(w, card, 'balanced');
      const acaps = await expertFor(w, card, 'acaps_view');
      const dev = await deviceFor(w, card, 'acaps_view');
      await w.svc.submitEstimate(bal.actor, { cardId: card.id, p: 0.4 });
      await w.svc.submitEstimate(acaps.actor, { cardId: card.id, p: 0.4 });
      await closeAndOpen(w, card);

      assert.equal((await call('POST', '/api/second-look', { body: { cardId: card.id } })).status, 401);
      const opened = await call('POST', '/api/second-look', { token: bal.sessionToken, body: { cardId: card.id } });
      assert.deepEqual(opened.json, { kind: 'balanced', higher: CONTENT.higher, lower: CONTENT.lower });
      const anon = await call('POST', '/api/anon/second-look', { body: { ...dev.b } });
      assert.equal(anon.json.kind, 'acaps_view');
      assert.doesNotMatch(JSON.stringify(anon.json), NUMBER_LEAK);

      const answered = await call('POST', '/api/estimates', { token: bal.sessionToken, body: { cardId: card.id, p: 0.5, arm: 'acaps_view', sawSecondLook: false } });
      assert.equal(answered.status, 200);
      const balRow = await w.answers.estimates.get(`${card.id}|id:${bal.expertId}|2`);
      assert.deepEqual([balRow.arm, balRow.sawSecondLook], ['balanced', true]);
      const anonAnswer = await call('POST', '/api/anon/estimates', { body: { ...dev.b, p: 0.5, arm: 'balanced', sawSecondLook: false } });
      assert.equal(anonAnswer.status, 200);
      assert.equal((await w.answers.estimates.get(`${card.id}|bt:${dev.b.token}|2`)).arm, 'acaps_view');

      assert.equal((await call('GET', '/api/staff/second-look/summary', { token: analyst })).status, 403);
      const sum = await call('GET', '/api/staff/second-look/summary', { token: moderator });
      assert.equal(sum.status, 200);
      assert.equal(sum.json.cards, 1);
    } finally { await new Promise((r) => server.close(r)); }
  });
}
