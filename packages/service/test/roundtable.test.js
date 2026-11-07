import baseTest from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import * as B from '@benchmark/core/blind';
import { identifyingHints } from '@benchmark/core/anonymity';
import { createServer } from '../src/http.js';
import { CONSENT_VERSION } from '../src/consent.js';
import { BACKENDS, worldFor, CARD, many, DAY } from './helpers.js';

const blindKey = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' });

const CLAIM = 'The rainy season, not vaccination, drives the spread in this district.';
const EVIDENCE = 'The bulletin shows three weeks of rising cases in the lowland villages.';
const NOTE = 'Names a clinic, which can identify the author.';
// Nothing a respondent holds may appear in any answer to an expert or a moderator.
const LEAK = /\bid:|\bbt:|\bex_|respondentKey/;
const PUBLIC_LABEL = /^Analyst \d{4}$/;

/** The message of a refusal, or null if the call succeeded. */
const reason = async (p) => { try { await p; return null; } catch (e) { return e.message; } };
const statusOf = async (p) => { try { await p; return null; } catch (e) { return e.status; } };

/** Flip the last hex digit: a signature that is well formed and wrong. */
const flip = (hex) => `${hex.slice(0, -1)}${hex.endsWith('0') ? '1' : '0'}`;

/** What the expert's browser does (as in secondlook.test.js). One secret per device, one token per card. */
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
  const setThread = (w, card, enabled = true) => w.svc.setThread(w.mod, { cardId: card.id, enabled });
  const closeR1 = (w, card) => w.svc.closeRound(w.mod, card.id);
  const openR2 = (w, card) => w.svc.openRound2(w.mod, card.id);
  const answer = (w, e, card, p = 0.4) => w.svc.submitEstimate(e.actor, { cardId: card.id, p });
  const threadOf = (w, card) => w.svc.setThread(w.mod, { cardId: card.id, enabled: true }).then(() => card);

  /** A device-held expert who joined now. Answers Round 1 on `card` unless told not to. */
  async function device(w, card, { answered = true, p = 0.4 } = {}) {
    const inv = await w.svc.createInvite(w.mod, { declaration: { countries: ['TCD'] } });
    const r = await w.svc.redeemInvite(inv.token, { level: 'anonymous', mode: 'device', consentVersion: CONSENT_VERSION });
    const actor = await w.svc.authenticate(r.sessionToken);
    const dev = deviceOf(w.svc);
    const b = await dev.ballot(actor, card.id);
    if (answered) await w.svc.submitAnonymousEstimate({ ...b, p });
    return { actor, expertId: r.expertId, dev, b };
  }

  test('a keyed expert who did NOT answer round 1 cannot open or post; a keyed expert who did can', async () => {
    const w = await world();
    const card = await threadOf(w, await openCard(w));
    const ada = await w.enroll('identified', { name: 'Ada Okafor' });
    const late = await w.enroll('identified', { name: 'Ben Mwangi' });
    await answer(w, ada, card);
    await closeR1(w, card);
    assert.match(await reason(w.svc.openThread(late.actor, { cardId: card.id })), /you did not answer round 1/);
    assert.match(await reason(w.svc.postToThread(late.actor, { cardId: card.id, kind: 'claim', text: CLAIM })), /you did not answer round 1/);
    assert.equal((await w.svc.openThread(ada.actor, { cardId: card.id })).canPost, true);
    assert.equal((await w.answers.thread_posts.all()).length, 0, 'the refused post was not stored');
  });

  test('a device-held ballot with no Round-1 row cannot open or post; a bad signature is refused everywhere', async () => {
    const w = await world();
    const card = await threadOf(w, await openCard(w));
    const answered = await device(w, card);
    const silent = await device(w, card, { answered: false });
    await closeR1(w, card);
    assert.match(await reason(w.svc.openAnonymousThread(silent.b)), /you did not answer round 1/);
    assert.match(await reason(w.svc.postAnonymous({ ...silent.b, kind: 'claim', text: CLAIM })), /you did not answer round 1/);
    // Valid ballot works; the same token with a wrong signature is refused by the ballot check.
    assert.equal((await w.svc.openAnonymousThread(answered.b)).canPost, true);
    const bad = { ...answered.b, signature: flip(answered.b.signature) };
    assert.match(await reason(w.svc.openAnonymousThread(bad)), /ballot signature invalid/);
    assert.match(await reason(w.svc.postAnonymous({ ...bad, kind: 'claim', text: CLAIM })), /ballot signature invalid/);
    assert.match(await reason(w.svc.eraseAnonymous(bad)), /ballot signature invalid/);
    assert.match(await reason(w.svc.openAnonymousThread({ ...answered.b, token: 'f'.repeat(64) })), /signature invalid/);
    assert.equal((await w.answers.thread_posts.all()).length, 0);
  });

  test('a device-held expert cannot use the keyed endpoints, and a keyed expert cannot use the device path', async () => {
    const w = await world();
    const card = await threadOf(w, await openCard(w));
    const dev = await device(w, card);
    const keyed = await w.enroll('identified', { name: 'Cara Haddad' });
    await answer(w, keyed, card);
    await closeR1(w, card);
    assert.match(await reason(w.svc.openThread(dev.actor, { cardId: card.id })), /held on your device/);
    assert.match(await reason(w.svc.postToThread(dev.actor, { cardId: card.id, kind: 'claim', text: CLAIM })), /held on your device/);
    assert.match(await reason(w.svc.openThread(w.mod, { cardId: card.id })), /experts only|may not roundtable\.read/);
  });

  test('posting is open only while round 1 is closed with a thread enabled; reading goes on through round 2', async () => {
    const w = await world();
    const card = await openCard(w);
    const other = await openCard(w, { ...CARD, statement: 'IPC Phase 4 will be declared in any Chad district by 30 April 2027.' });
    const ada = await w.enroll('identified', { name: 'Ada Okafor' });
    await answer(w, ada, card);
    await answer(w, ada, other);
    // A card whose thread is never enabled refuses everything, even after round 1 closes.
    await closeR1(w, other);
    assert.match(await reason(w.svc.openThread(ada.actor, { cardId: other.id })), /no discussion/);
    assert.match(await reason(w.svc.postToThread(ada.actor, { cardId: other.id, kind: 'claim', text: CLAIM })), /no discussion/);
    // Enabled while round 1 is still open: reading is refused, posting is refused.
    await setThread(w, card);
    assert.match(await reason(w.svc.openThread(ada.actor, { cardId: card.id })), /not open on this card/);
    assert.match(await reason(w.svc.postToThread(ada.actor, { cardId: card.id, kind: 'claim', text: CLAIM })), /only while round 1 is closed/);
    await closeR1(w, card);
    assert.equal((await w.svc.openThread(ada.actor, { cardId: card.id })).canPost, true);
    await w.svc.postToThread(ada.actor, { cardId: card.id, kind: 'claim', text: CLAIM });
    // Disabled again: nothing, not even reading.
    await setThread(w, card, false);
    assert.match(await reason(w.svc.openThread(ada.actor, { cardId: card.id })), /no discussion/);
    assert.match(await reason(w.svc.postToThread(ada.actor, { cardId: card.id, kind: 'claim', text: CLAIM })), /no discussion/);
    await setThread(w, card);
    await w.svc.moderate(w.mod, (await w.svc.listPending(w.mod, { cardId: card.id }))[0].id, { approve: true });
    // Round 2: reading continues for the same people; posting does not reopen.
    await openR2(w, card);
    const r2 = await w.svc.openThread(ada.actor, { cardId: card.id });
    assert.equal(r2.canPost, false);
    assert.equal(r2.posts.length, 1, 'the approved post is still shown in round 2');
    assert.match(await reason(w.svc.postToThread(ada.actor, { cardId: card.id, kind: 'claim', text: CLAIM })), /only while round 1 is closed/);
    assert.match(await reason(w.svc.setThread(w.mod, { cardId: card.id, enabled: false })), /round 1, not after round 2/);
  });

  test('another expert never sees a pending or rejected post; the author sees their own under mine; approval shows it to everyone', async () => {
    const w = await world();
    const card = await threadOf(w, await openCard(w));
    const ada = await w.enroll('identified', { name: 'Ada Okafor' });
    const ben = await w.enroll('identified', { name: 'Ben Mwangi' });
    await answer(w, ada, card);
    await answer(w, ben, card);
    await closeR1(w, card);
    const { id: pending } = await w.svc.postToThread(ada.actor, { cardId: card.id, kind: 'claim', text: CLAIM });
    const { id: rejected } = await w.svc.postToThread(ada.actor, { cardId: card.id, kind: 'counter', text: EVIDENCE });
    const adaView = await w.svc.openThread(ada.actor, { cardId: card.id });
    assert.deepEqual(adaView.mine.map((p) => [p.id, p.status]), [[pending, 'pending'], [rejected, 'pending']]);
    assert.deepEqual(await w.svc.openThread(ben.actor, { cardId: card.id }).then((v) => [v.posts, v.mine]), [[], []]);

    assert.deepEqual((await w.svc.listPending(w.mod, { cardId: card.id })).map((p) => p.id), [pending, rejected]);
    await w.svc.moderate(w.mod, rejected, { approve: false, note: NOTE });
    const benView = await w.svc.openThread(ben.actor, { cardId: card.id });
    assert.deepEqual([benView.posts, benView.mine], [[], []], 'a rejected post is invisible to others');
    assert.doesNotMatch(JSON.stringify(benView), /Names a clinic|rainy season/);
    const adaAfter = await w.svc.openThread(ada.actor, { cardId: card.id });
    assert.deepEqual(adaAfter.mine.find((p) => p.id === rejected), { id: rejected, kind: 'counter', text: EVIDENCE, status: 'rejected', note: NOTE });

    await w.svc.moderate(w.mod, pending, { approve: true });
    const shown = await w.svc.openThread(ben.actor, { cardId: card.id });
    assert.equal(shown.posts.length, 1);
    assert.deepEqual(shown.posts[0], { id: pending, kind: 'claim', parentId: null, label: 'Ada Okafor', text: CLAIM, day: shown.posts[0].day, own: false });
    assert.equal((await w.svc.openThread(ada.actor, { cardId: card.id })).posts[0].own, true);
    assert.deepEqual((await w.svc.openThread(ada.actor, { cardId: card.id })).mine.map((p) => p.status), ['rejected'], 'an approved post leaves mine; a rejected one stays');
  });

  test('no response to an expert and no response to a moderator carries a respondent key, an id: or bt: string, or an expert id', async () => {
    const w = await world();
    const card = await threadOf(w, await openCard(w));
    const ada = await w.enroll('identified', { name: 'Ada Okafor' });
    const pse = await w.enroll('pseudonymous', { name: 'Ben Mwangi' });
    const anon = await w.enroll('anonymous');
    const dev = await device(w, card);
    for (const e of [ada, pse, anon]) await answer(w, e, card);
    await closeR1(w, card);
    const payloads = [];
    for (const e of [ada, pse, anon]) {
      const { id } = await w.svc.postToThread(e.actor, { cardId: card.id, kind: 'claim', text: CLAIM });
      await w.svc.moderate(w.mod, id, { approve: true });
    }
    const dp = await w.svc.postAnonymous({ ...dev.b, kind: 'evidence', text: EVIDENCE });
    await w.svc.moderate(w.mod, dp.id, { approve: true });
    await w.svc.postToThread(ada.actor, { cardId: card.id, kind: 'claim', text: 'A pending claim that stays pending.' });
    for (const e of [ada, pse, anon]) {
      payloads.push(await w.svc.openThread(e.actor, { cardId: card.id }));
      payloads.push(await w.svc.inbox(e.actor));
    }
    payloads.push(await w.svc.openAnonymousThread(dev.b));
    payloads.push(await w.svc.listPending(w.mod));
    payloads.push(await w.svc.listPending(w.analyst, { cardId: card.id }));
    payloads.push(await w.svc.inbox(dev.actor));
    const dump = JSON.stringify(payloads);
    assert.doesNotMatch(dump, LEAK);
    for (const e of [ada, pse, anon, dev]) {
      assert.ok(!dump.includes(e.expertId), 'no expert id');
    }
    assert.ok(!dump.includes(dev.b.token), 'no ballot token in any payload');
    assert.ok(!dump.includes(`bt:${dev.b.token}`));
    assert.ok(dump.includes('Participant 1'), 'the device-held label is shown');
  });

  test('labels: identified shows the name, pseudonymous a stable alias, anonymous and device-held "Participant N", stable within a card', async () => {
    const w = await world();
    const card = await threadOf(w, await openCard(w));
    const named = await w.enroll('identified', { name: 'Ada Okafor' });
    const alias = await w.enroll('pseudonymous', { name: 'Ben Mwangi' });
    const anon = await w.enroll('anonymous');
    const dev = await device(w, card);
    for (const e of [named, alias, anon]) await answer(w, e, card);
    await closeR1(w, card);
    const a1 = await w.svc.postToThread(named.actor, { cardId: card.id, kind: 'claim', text: CLAIM });
    const a2 = await w.svc.postToThread(alias.actor, { cardId: card.id, kind: 'claim', text: EVIDENCE });
    const a3 = await w.svc.postAnonymous({ ...dev.b, kind: 'claim', text: CLAIM });
    const a4 = await w.svc.postToThread(anon.actor, { cardId: card.id, kind: 'counter', text: EVIDENCE });
    const a5 = await w.svc.postToThread(anon.actor, { cardId: card.id, kind: 'question', text: 'Is the lowland data complete?' });
    const a6 = await w.svc.postAnonymous({ ...dev.b, kind: 'question', text: 'Is the lowland data complete?' });
    for (const p of [a1, a2, a3, a4, a5, a6]) await w.svc.moderate(w.mod, p.id, { approve: true });
    const shown = (await w.svc.openThread(named.actor, { cardId: card.id })).posts;
    const by = (id) => shown.find((p) => p.id === id).label;
    assert.equal(by(a1.id), 'Ada Okafor');
    assert.match(by(a2.id), PUBLIC_LABEL, 'the pseudonymous label is an alias');
    assert.equal(by(a3.id), 'Participant 1');
    assert.equal(by(a4.id), 'Participant 2');
    assert.equal(by(a5.id), 'Participant 2', 'the same service-held expert is the same number');
    assert.equal(by(a6.id), 'Participant 1', 'the device-held ballot is the same number as in its own thread');
    const dump = JSON.stringify(shown);
    assert.doesNotMatch(dump, /Ben Mwangi/, 'a pseudonymous expert is never named');
  });

  test('participant numbers are per card, so the same people can get different numbers on another card', async () => {
    const w = await world();
    const first = await threadOf(w, await openCard(w));
    const second = await threadOf(w, await openCard(w, { ...CARD, statement: 'IPC Phase 4 will be declared in any Chad district by 30 April 2027.' }));
    const anon = await w.enroll('anonymous');
    const dev = await device(w, first);
    await answer(w, anon, first);
    await answer(w, anon, second);
    await w.svc.submitAnonymousEstimate({ ...(await dev.dev.ballot(dev.actor, second.id)), p: 0.4 });
    await closeR1(w, first);
    await closeR1(w, second);
    const p1 = await w.svc.postToThread(anon.actor, { cardId: first.id, kind: 'claim', text: CLAIM });
    await w.svc.postAnonymous({ ...dev.b, kind: 'claim', text: CLAIM });
    const devSecond = await w.svc.postAnonymous({ ...(await dev.dev.ballot(dev.actor, second.id)), kind: 'claim', text: CLAIM });
    const anonSecond = await w.svc.postToThread(anon.actor, { cardId: second.id, kind: 'claim', text: CLAIM });
    for (const p of [p1, devSecond, anonSecond]) await w.svc.moderate(w.mod, p.id, { approve: true });
    const onFirst = await w.svc.openThread(anon.actor, { cardId: first.id });
    const onSecond = await w.svc.openThread(anon.actor, { cardId: second.id });
    assert.equal(onFirst.posts[0].label, 'Participant 1');
    assert.equal(onSecond.posts.find((p) => p.id === anonSecond.id).label, 'Participant 2', 'the first poster on the first card is second on the next');
    assert.equal(onSecond.posts.find((p) => p.id === devSecond.id).label, 'Participant 1');
  });

  test('concurrent first posts on one card get distinct participant numbers, 1 to 5, with no gaps and no duplicates', async () => {
    const w = await world();
    const card = await threadOf(w, await openCard(w));
    const devs = await many(5, () => device(w, card));
    await closeR1(w, card);
    const posts = await Promise.all(devs.map((d) => w.svc.postAnonymous({ ...d.b, kind: 'claim', text: CLAIM })));
    for (const p of posts) await w.svc.moderate(w.mod, p.id, { approve: true });
    const labels = (await w.svc.openAnonymousThread(devs[0].b)).posts.map((p) => p.label).sort();
    assert.deepEqual(labels, ['Participant 1', 'Participant 2', 'Participant 3', 'Participant 4', 'Participant 5']);
    const rows = await w.answers.thread_participants.find({ cardId: card.id });
    assert.deepEqual(rows.map((r) => r.n).sort(), [1, 2, 3, 4, 5]);
  });

  test('limits: 600 characters at most, 5 posts and replies per respondent per card', async () => {
    const w = await world();
    const card = await threadOf(w, await openCard(w));
    const ada = await w.enroll('identified', { name: 'Ada Okafor' });
    await answer(w, ada, card);
    await closeR1(w, card);
    await w.svc.postToThread(ada.actor, { cardId: card.id, kind: 'claim', text: 'a'.repeat(600) });
    assert.equal(await statusOf(w.svc.postToThread(ada.actor, { cardId: card.id, kind: 'claim', text: 'a'.repeat(601) })), 400);
    for (let i = 1; i < 5; i++) await w.svc.postToThread(ada.actor, { cardId: card.id, kind: 'claim', text: `${CLAIM} ${i}` });
    const view = await w.svc.openThread(ada.actor, { cardId: card.id });
    assert.equal(view.canPost, false, 'no more room');
    assert.match(await reason(w.svc.postToThread(ada.actor, { cardId: card.id, kind: 'claim', text: CLAIM })), /limit of 5 posts/);
    assert.equal((await w.answers.thread_posts.find({ cardId: card.id, respondentKey: `id:${ada.expertId}` })).length, 5, 'refused posts are not stored');
  });

  test('replies: depth one, the same card only, and only to an approved top-level post or your own pending one', async () => {
    const w = await world();
    const card = await threadOf(w, await openCard(w));
    const other = await threadOf(w, await openCard(w, { ...CARD, statement: 'IPC Phase 4 will be declared in any Chad district by 30 April 2027.' }));
    const ada = await w.enroll('identified', { name: 'Ada Okafor' });
    const ben = await w.enroll('identified', { name: 'Ben Mwangi' });
    for (const c of [card, other]) { await answer(w, ada, c); await answer(w, ben, c); }
    await closeR1(w, card);
    await closeR1(w, other);
    const top = await w.svc.postToThread(ada.actor, { cardId: card.id, kind: 'claim', text: CLAIM });
    const topOther = await w.svc.postToThread(ada.actor, { cardId: other.id, kind: 'claim', text: CLAIM });
    const rejected = await w.svc.postToThread(ada.actor, { cardId: card.id, kind: 'claim', text: EVIDENCE });
    await w.svc.moderate(w.mod, topOther.id, { approve: true });
    await w.svc.moderate(w.mod, rejected.id, { approve: false, note: NOTE });
        // Someone else's pending post cannot be replied to: the refusal does not say whether it exists.
    assert.match(await reason(w.svc.postToThread(ben.actor, { cardId: card.id, kind: 'reply', text: 'A reply to a post nobody approved.', parentId: top.id })), /approved top-level post on this card/);
    // A post on another card cannot be replied to here.
    assert.match(await reason(w.svc.postToThread(ben.actor, { cardId: card.id, kind: 'reply', text: 'A reply on the wrong card.', parentId: topOther.id })), /approved top-level post on this card/);
    // A rejected post, even one's own, cannot be replied to.
    assert.match(await reason(w.svc.postToThread(ada.actor, { cardId: card.id, kind: 'reply', text: 'A reply to a rejected post.', parentId: rejected.id })), /approved top-level post on this card/);
    // Only replies carry a parent.
    assert.match(await reason(w.svc.postToThread(ben.actor, { cardId: card.id, kind: 'claim', text: 'A claim with a parent.', parentId: top.id })), /only a reply/);
    assert.match(await reason(w.svc.postToThread(ben.actor, { cardId: card.id, kind: 'reply', text: 'A reply with no parent.' })), /needs a parentId/);
    // Your own pending post can be replied to; the reply then waits for moderation like any post.
    const own = await w.svc.postToThread(ada.actor, { cardId: card.id, kind: 'reply', text: 'A reply to my own pending post.', parentId: top.id });
    assert.equal(own.status, 'pending');
    await w.svc.moderate(w.mod, top.id, { approve: true });
    const reply = await w.svc.postToThread(ben.actor, { cardId: card.id, kind: 'reply', text: 'A reply to an approved post.', parentId: top.id });
    await w.svc.moderate(w.mod, reply.id, { approve: true });
    // Depth one: a reply cannot be replied to.
    assert.match(await reason(w.svc.postToThread(ada.actor, { cardId: card.id, kind: 'reply', text: 'A reply to a reply.', parentId: reply.id })), /approved top-level post on this card/);
  });

  test('numbers are refused: a probability, a percentage, odds, a decimal or "my estimate is"; nothing is stored', async () => {
    const w = await world();
    const card = await threadOf(w, await openCard(w));
    const ada = await w.enroll('identified', { name: 'Ada Okafor' });
    await answer(w, ada, card);
    await closeR1(w, card);
    for (const text of ['I think it is about 60% likely.', 'my estimate is 40', 'The chance is 0.7.', 'The odds of 3 to 1 are fair.']) {
      assert.match(await reason(w.svc.postToThread(ada.actor, { cardId: card.id, kind: 'claim', text })), /must not state|your own answer/, text);
    }
    assert.equal((await w.answers.thread_posts.all()).length, 0);
  });

  test('identifying hints are advice: the post is kept and the author sees them; the moderator sees them with the post', async () => {
    const w = await world();
    const card = await threadOf(w, await openCard(w));
    const ada = await w.enroll('identified', { name: 'Ada Okafor' });
    await answer(w, ada, card);
    await closeR1(w, card);
    const text = 'I work for the WFP in Juba, so I see the lowland data first.';
    const r = await w.svc.postToThread(ada.actor, { cardId: card.id, kind: 'evidence', text });
    assert.equal(r.status, 'pending');
    assert.deepEqual(r.warnings, identifyingHints(text));
    assert.ok(r.warnings.length > 0);
    const [pending] = await w.svc.listPending(w.mod, { cardId: card.id });
    assert.deepEqual(pending.hints, identifyingHints(text));
    assert.equal(pending.id, r.id);
  });

  test('moderate: pending only; approve, or reject with a note of 1 to 300 characters; a second call conflicts; the audit holds the id only', async () => {
    const w = await world();
    const card = await threadOf(w, await openCard(w));
    const ada = await w.enroll('identified', { name: 'Ada Okafor' });
    await answer(w, ada, card);
    await closeR1(w, card);
    const a = await w.svc.postToThread(ada.actor, { cardId: card.id, kind: 'claim', text: CLAIM });
    const b = await w.svc.postToThread(ada.actor, { cardId: card.id, kind: 'claim', text: EVIDENCE });
    assert.equal(await statusOf(w.svc.moderate(w.mod, b.id, { approve: false })), 400, 'a rejection needs a note');
    assert.equal(await statusOf(w.svc.moderate(w.mod, b.id, { approve: false, note: '   ' })), 400);
    assert.equal(await statusOf(w.svc.moderate(w.mod, b.id, { approve: false, note: 'x'.repeat(301) })), 400);
    assert.equal(await statusOf(w.svc.moderate(w.mod, 'p_missing', { approve: true })), 404);
    assert.deepEqual(await w.svc.moderate(w.mod, a.id, { approve: true }), { id: a.id, status: 'approved' });
    assert.match(await reason(w.svc.moderate(w.mod, a.id, { approve: false, note: NOTE })), /not pending/);
    assert.equal(await statusOf(w.svc.moderate(w.mod, a.id, { approve: true })), 409, 'a second call conflicts');
    assert.deepEqual(await w.svc.moderate(w.mod, b.id, { approve: false, note: 'x'.repeat(300) }), { id: b.id, status: 'rejected' });
    assert.match(await reason(w.svc.moderate(ada.actor, b.id, { approve: true })), /may not roundtable\.moderate/);

    const log = (await w.svc.readAudit(w.mod)).filter((x) => /^roundtable\.(approve|reject)$/.test(x.action));
    assert.deepEqual(log.map((x) => [x.action, x.target]), [['roundtable.approve', a.id], ['roundtable.reject', b.id]]);
    const dump = JSON.stringify(log);
    assert.doesNotMatch(dump, /rainy season|Names a clinic|lowland|Ada Okafor/);
    assert.doesNotMatch(dump, LEAK);
    assert.ok(!dump.includes(ada.expertId));
    assert.ok(log.every((x) => x.reason === ''));
  });

  test('round 2 cannot open while a post is pending, and opens once it is moderated', async () => {
    const w = await world();
    const card = await threadOf(w, await openCard(w));
    const ada = await w.enroll('identified', { name: 'Ada Okafor' });
    await answer(w, ada, card);
    await closeR1(w, card);
    const p = await w.svc.postToThread(ada.actor, { cardId: card.id, kind: 'claim', text: CLAIM });
    assert.equal((await w.svc.listPending(w.mod, { cardId: card.id })).length, 1);
    assert.match(await reason(openR2(w, card)), /cannot open while discussion posts are waiting/);
    await w.svc.moderate(w.mod, p.id, { approve: false, note: NOTE });
    assert.equal((await w.svc.listPending(w.mod, { cardId: card.id })).length, 0);
    await openR2(w, card);
    assert.equal((await w.answers.cards.get(card.id)).round, 2);
  });

  test('sawThread: opening the thread before a Round-2 answer marks it, on keyed and device-held rows alike; no thread means no field', async () => {
    const w = await world();
    const card = await threadOf(w, await openCard(w));
    const plain = await openCard(w, { ...CARD, statement: 'IPC Phase 4 will be declared in any Chad district by 30 April 2027.' });
    const ada = await w.enroll('identified', { name: 'Ada Okafor' });
    const ben = await w.enroll('identified', { name: 'Ben Mwangi' });
    const dev = await device(w, card);
    const devWatcher = await device(w, card);
    for (const e of [ada, ben]) { await answer(w, e, card); await answer(w, e, plain); }
    await closeR1(w, card);
    await closeR1(w, plain);
    await w.svc.openThread(ada.actor, { cardId: card.id });
    await w.svc.openAnonymousThread(devWatcher.b);
    const viewed = async (key) => (await w.answers.thread_views.find({ cardId: card.id, respondentKey: key })).length;
    assert.equal(await viewed(`id:${ada.expertId}`), 1);
    assert.equal(await viewed(`id:${ben.expertId}`), 0);
    await openR2(w, card);
    await openR2(w, plain);
    await w.svc.submitEstimate(ada.actor, { cardId: card.id, p: 0.5 });
    await w.svc.submitEstimate(ben.actor, { cardId: card.id, p: 0.5 });
    await w.svc.submitEstimate(ada.actor, { cardId: plain.id, p: 0.5 });
    await w.svc.submitAnonymousEstimate({ ...devWatcher.b, p: 0.5 });
    await w.svc.submitAnonymousEstimate({ ...dev.b, p: 0.5 });
    const row = (c, key) => w.answers.estimates.get(`${c.id}|${key}|2`);
    assert.equal((await row(card, `id:${ada.expertId}`)).sawThread, true);
    assert.equal((await row(card, `id:${ben.expertId}`)).sawThread, false);
    assert.equal((await row(card, `bt:${devWatcher.b.token}`)).sawThread, true, 'device-held: the view is recorded server-side');
    assert.equal((await row(card, `bt:${dev.b.token}`)).sawThread, false);
    assert.equal('sawThread' in await row(plain, `id:${ada.expertId}`), false, 'a card with no thread stores no field');
  });

  test('discussionFor: keyed experts see only the cards they answered; device-held see all such cards; round 2 removes the card; no counts', async () => {
    const w = await world();
    const card = await threadOf(w, await openCard(w));
    const nothread = await openCard(w, { ...CARD, statement: 'IPC Phase 4 will be declared in any Chad district by 30 April 2027.' });
    const ada = await w.enroll('identified', { name: 'Ada Okafor' });
    const late = await w.enroll('identified', { name: 'Ben Mwangi' });
    const dev = await device(w, card);
    await answer(w, ada, card);
    await answer(w, ada, nothread);
    await closeR1(w, card);
    await closeR1(w, nothread);
    const mine = (await w.svc.inbox(ada.actor)).discussion;
    assert.deepEqual(mine.map((c) => [c.id, c.thread]), [[card.id, { available: true }]]);
    assert.deepEqual((await w.svc.inbox(late.actor)).discussion, []);
    const devs = (await w.svc.inbox(dev.actor)).discussion;
    assert.equal(devs.length, 1);
    assert.equal(devs[0].deviceHeld, true);
    for (const c of mine) assert.deepEqual(Object.keys(c).sort(), ['country', 'id', 'round', 'statement', 'theme', 'thread', 'version', 'window']);
    await openR2(w, card);
    assert.deepEqual((await w.svc.inbox(ada.actor)).discussion, []);
    assert.equal((await w.svc.listPending(w.mod, { cardId: card.id })).length, 0);
  });

  test('exportMe includes the expert\'s own posts and never a label; eraseMe removes them and keeps others\' replies', async () => {
    const w = await world();
    const card = await threadOf(w, await openCard(w));
    const named = await w.enroll('identified', { name: 'Ada Okafor' });
    const anon = await w.enroll('anonymous');
    const ben = await w.enroll('identified', { name: 'Ben Mwangi' });
    for (const e of [named, anon, ben]) await answer(w, e, card);
    await closeR1(w, card);
    const own = await w.svc.postToThread(named.actor, { cardId: card.id, kind: 'claim', text: CLAIM });
    const anonPost = await w.svc.postToThread(anon.actor, { cardId: card.id, kind: 'evidence', text: EVIDENCE });
    await w.svc.moderate(w.mod, own.id, { approve: true });
    await w.svc.moderate(w.mod, anonPost.id, { approve: true });
    const reply = await w.svc.postToThread(ben.actor, { cardId: card.id, kind: 'reply', text: 'Agreed, the lowland data is the key point.', parentId: own.id });
    await w.svc.moderate(w.mod, reply.id, { approve: true });

    const out = await w.svc.exportMe(named.actor);
    assert.deepEqual(out.threadPosts, [{ cardId: card.id, kind: 'claim', text: CLAIM, status: 'approved', day: out.threadPosts[0].day }]);
    const anonOut = await w.svc.exportMe(anon.actor);
    assert.equal(anonOut.threadPosts.length, 1);
    assert.equal(anonOut.threadPosts[0].text, EVIDENCE);
    assert.equal('label' in anonOut.threadPosts[0], false);
    assert.doesNotMatch(JSON.stringify(anonOut), /Participant|Agreed/);

    await w.svc.eraseMe(named.actor);
    const left = await w.answers.thread_posts.all();
    assert.deepEqual(left.map((p) => p.text).sort(), [EVIDENCE, 'Agreed, the lowland data is the key point.'].sort());
    assert.equal(left.find((p) => p.kind === 'reply').parentId, own.id, 'the reply to the erased post is kept');
    assert.equal((await w.answers.thread_posts.find({ cardId: card.id, respondentKey: `id:${named.expertId}` })).length, 0);
  });

  test('eraseMe removes the participant and view rows for that respondent and no one else\'s', async () => {
    const w = await world();
    const card = await threadOf(w, await openCard(w));
    const anon = await w.enroll('anonymous');
    const other = await w.enroll('anonymous');
    await answer(w, anon, card);
    await answer(w, other, card);
    await closeR1(w, card);
    await w.svc.openThread(anon.actor, { cardId: card.id });
    await w.svc.openThread(other.actor, { cardId: card.id });
    await w.svc.postToThread(anon.actor, { cardId: card.id, kind: 'claim', text: CLAIM });
    const o = await w.svc.postToThread(other.actor, { cardId: card.id, kind: 'claim', text: EVIDENCE });
    await w.svc.moderate(w.mod, o.id, { approve: true });
    await w.svc.eraseMe(anon.actor);
    assert.deepEqual((await w.answers.thread_participants.all()).map((r) => r.n), [2], 'only the other respondent keeps a number');
    assert.equal((await w.answers.thread_views.all()).length, 1, 'the other respondent keeps the view row');
    assert.equal((await w.answers.thread_posts.all()).length, 1);
    assert.equal((await w.svc.openThread(other.actor, { cardId: card.id })).posts[0].text, EVIDENCE);
  });

  test('eraseAnonymous works with a valid ballot and removes only that ballot\'s rows', async () => {
    const w = await world();
    const card = await threadOf(w, await openCard(w));
    const d1 = await device(w, card);
    const d2 = await device(w, card);
    await closeR1(w, card);
    await w.svc.openAnonymousThread(d1.b);
    await w.svc.openAnonymousThread(d2.b);
    await w.svc.postAnonymous({ ...d1.b, kind: 'claim', text: CLAIM });
    const second = await w.svc.postAnonymous({ ...d1.b, kind: 'counter', text: EVIDENCE });
    await w.svc.postAnonymous({ ...d2.b, kind: 'claim', text: CLAIM });
    assert.equal((await w.answers.thread_posts.all()).length, 3);
    assert.match(await reason(w.svc.eraseAnonymous({ ...d1.b, signature: flip(d1.b.signature) })), /signature invalid/);
    assert.equal((await w.svc.eraseAnonymous(d1.b)).removed, 2);
    const left = await w.answers.thread_posts.all();
    assert.equal(left.length, 1);
    assert.equal(left.some((p) => p.id === second.id), false);
    assert.deepEqual((await w.answers.thread_participants.all()).map((r) => r.n), [2], 'the other device keeps its number');
    assert.deepEqual((await w.answers.thread_views.all()).map((r) => r.respondentKey), [`bt:${d2.b.token}`]);
    assert.equal((await w.svc.openAnonymousThread(d2.b)).mine.length, 1, 'd2 sees its own pending post and nothing else');
  });

  test('applyRetention removes the thread rows of stale cards and leaves a live card alone', async () => {
    const w = await world();
    const stale = await threadOf(w, await openCard(w));
    const live = await threadOf(w, await openCard(w, { ...CARD, statement: 'IPC Phase 4 will be declared in any Chad district by 30 April 2027.' }));
    const ada = await w.enroll('identified', { name: 'Ada Okafor' });
    const anon = await w.enroll('anonymous');
    for (const c of [stale, live]) { await answer(w, ada, c); await answer(w, anon, c); }
    await closeR1(w, stale);
    await closeR1(w, live);
    await w.svc.openThread(anon.actor, { cardId: stale.id });
    const p = await w.svc.postToThread(anon.actor, { cardId: stale.id, kind: 'claim', text: CLAIM });
    await w.svc.moderate(w.mod, p.id, { approve: true });
    const q = await w.svc.postToThread(ada.actor, { cardId: live.id, kind: 'claim', text: CLAIM });
    await w.svc.moderate(w.mod, q.id, { approve: true });
    await w.svc.resolveCard(w.mod, { cardId: stale.id, outcome: 1, evidenceUrl: 'https://who.int/resolution' });
    w.clock.now += 400 * DAY;
    const r = await w.svc.applyRetention(w.mod);
    assert.deepEqual(r.cards, [stale.id]);
    assert.deepEqual((await w.answers.thread_posts.all()).map((x) => x.cardId), [live.id]);
    assert.deepEqual((await w.answers.thread_participants.all()).map((x) => x.cardId), []);
    assert.deepEqual((await w.answers.thread_views.all()).map((x) => x.cardId), []);
  });

  test('setThread: moderators and analysts only, round 1 only, a boolean only; audited by enable and disable', async () => {
    const w = await world();
    const card = await openCard(w);
    const ada = await w.enroll('identified', { name: 'Ada Okafor' });
    assert.match(await reason(w.svc.setThread(ada.actor, { cardId: card.id, enabled: true })), /may not roundtable\.moderate/);
    assert.equal(await statusOf(w.svc.setThread(w.mod, { cardId: card.id, enabled: 'yes' })), 400);
    assert.deepEqual(await w.svc.setThread(w.analyst, { cardId: card.id, enabled: true }), { cardId: card.id, enabled: true });
    await w.svc.setThread(w.mod, { cardId: card.id, enabled: false });
    const actions = (await w.svc.readAudit(w.mod)).filter((x) => x.action.startsWith('roundtable.')).map((x) => [x.action, x.target]);
    assert.deepEqual(actions, [['roundtable.enable', card.id], ['roundtable.disable', card.id]]);
    await answer(w, ada, card);
    await closeR1(w, card);
    await openR2(w, card);
    assert.match(await reason(w.svc.setThread(w.mod, { cardId: card.id, enabled: true })), /round 1, not after round 2/);
  });

  test('over HTTP: the staff pending route, the expert post route and both unauthenticated /api/anon/thread routes work end to end', async () => {
    const w = await world();
    const card = await threadOf(w, await openCard(w));
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
    const moderator = await w.svc.createStaffSession({ id: 'mod1', role: 'moderator' });
    const ada = await w.enroll('identified', { name: 'Ada Okafor' });
    const expertToken = ada.sessionToken;
    const dev = await device(w, card);
    try {
      assert.equal((await call('PUT', `/api/staff/cards/${card.id}/thread`, { token: moderator, body: { enabled: true } })).json.enabled, true);
      await answer(w, ada, card);
      await closeR1(w, card);
      assert.equal((await call('GET', '/api/staff/thread/pending')).status, 401, 'staff routes need a login');

      const posted = await call('POST', '/api/thread/posts', { token: expertToken, body: { cardId: card.id, kind: 'claim', text: CLAIM } });
      assert.equal(posted.status, 200);
      assert.equal(posted.json.status, 'pending');
      assert.deepEqual(posted.json.warnings, []);
      const opened = await call('POST', '/api/thread', { token: expertToken, body: { cardId: card.id } });
      assert.equal(opened.status, 200);
      assert.equal(opened.json.canPost, true);
      assert.equal((await call('POST', '/api/thread/posts', { body: { cardId: card.id, kind: 'claim', text: CLAIM } })).status, 401);

      const pending = await call('GET', `/api/staff/thread/pending?cardId=${card.id}`, { token: moderator });
      assert.equal(pending.status, 200);
      assert.equal(pending.json.length, 1);
      assert.equal((await call('POST', `/api/staff/thread/posts/${posted.json.id}/moderate`, { token: moderator, body: { approve: false } })).status, 400);
      const approved = await call('POST', `/api/staff/thread/posts/${posted.json.id}/moderate`, { token: moderator, body: { approve: true } });
      assert.deepEqual(approved.json, { id: posted.json.id, status: 'approved' });

      const anonOpen = await call('POST', '/api/anon/thread', { body: { ...dev.b } });
      assert.equal(anonOpen.status, 200, 'no Bearer needed');
      assert.equal(anonOpen.json.posts.length, 1);
      const anonPost = await call('POST', '/api/anon/thread/posts', { body: { ...dev.b, kind: 'evidence', text: EVIDENCE } });
      assert.equal(anonPost.status, 200);
      assert.equal(anonPost.json.status, 'pending');
      const bad = await call('POST', '/api/anon/thread/posts', { body: { ...dev.b, signature: flip(dev.b.signature), kind: 'evidence', text: EVIDENCE } });
      assert.equal(bad.status, 401);
      const erased = await call('POST', '/api/anon/thread/erase', { body: { ...dev.b } });
      assert.deepEqual(erased.json, { removed: 1 });

      const all = JSON.stringify([posted.json, opened.json, pending.json, approved.json, anonOpen.json, anonPost.json, erased.json]);
      assert.doesNotMatch(all, LEAK);
      assert.ok(!all.includes(ada.expertId));
      assert.ok(!all.includes(dev.b.token));
    } finally { await new Promise((r) => server.close(r)); }
  });
}
