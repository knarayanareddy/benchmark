// The optional context an expert can give with an answer (confidence, evidence, conflict of interest, a reason).
// It is stored on the answer row, validated, scrubbed of contact details, and never shown to staff or anyone else.
import baseTest from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import * as B from '@benchmark/core/blind';
import { createServer } from '../src/http.js';
import { CONSENT_VERSION } from '../src/consent.js';
import { ValidationError } from '../src/errors.js';
import { BACKENDS, worldFor, CARD } from './helpers.js';

const blindKey = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' });

const REASON = 'Field notes from Abeche cite the market survey directly.';
// What the reason, and the other context, look like once they are in a store or an output.
const CONTEXT_LEAK = /Abeche|Field notes|local_source|"coi"|"confidence"|"evidenceType"/;
// The ACAPS reading, in any spelling an expert could see.
const ACAPS_LEAK = /acapsP|acapsBand|probability|0\.\d/;
const BASE_KEYS = ['at', 'cardId', 'expertId', 'level', 'p', 'respondentKey', 'round'];

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
  const rejectsValidation = (p) => assert.rejects(p, (err) => err instanceof ValidationError && err.status === 400);

  /** A device-held expert: declared for TCD, no login needed to answer later. */
  async function deviceExpert(w) {
    const inv = await w.svc.createInvite(w.mod, { declaration: { countries: ['TCD'] } });
    const r = await w.svc.redeemInvite(inv.token, { level: 'anonymous', mode: 'device', consentVersion: CONSENT_VERSION });
    return { expertId: r.expertId, actor: await w.svc.authenticate(r.sessionToken), dev: deviceOf(w.svc) };
  }

  test('the inbox and Pulse give an expert the resolution: the objective, the source and the resolver', async () => {
    const w = await world();
    const card = await openCard(w);
    const named = await w.enroll('identified');
    const dev = await deviceExpert(w);
    const expected = { objective: card.objective, source: card.resolutionSource, resolver: card.resolver };
    assert.deepEqual(expected, { objective: CARD.objective, source: CARD.resolutionSource, resolver: CARD.resolver });

    for (const actor of [named.actor, dev.actor]) {
      const box = await w.svc.inbox(actor);
      assert.equal(box.toAnswer.length, 1);
      assert.deepEqual(box.toAnswer[0].resolution, expected);
    }
    const p = await w.svc.pulse(named.actor);
    const entry = [...p.asks, ...p.radar].find((x) => x.card.id === card.id);
    assert.ok(entry, 'Pulse places the card');
    assert.deepEqual(entry.card.resolution, expected);
  });

  test('a card with no objective gives an expert no resolution (null), never an invented one', async () => {
    const w = await world();
    const card = await openCard(w);
    // The store refuses an objective-less card on every backend, so the read path is where it can be seen.
    const { cards } = w.answers;
    const get = cards.get.bind(cards);
    const find = cards.find.bind(cards);
    const drop = (/** @type {any} */ c) => { if (!c) return c; const { objective: _o, ...rest } = c; return rest; };
    cards.get = async (/** @type {string} */ id) => drop(await get(id));
    cards.find = async (/** @type {any} */ where, /** @type {any} */ pred) => (await find(where, pred)).map(drop);
    const e = await w.enroll('identified');
    const box = await w.svc.inbox(e.actor);
    assert.equal(box.toAnswer.find((c) => c.id === card.id).resolution, null);
  });

  test('no ACAPS band or probability appears in any expert\'s inbox before they answer, whichever way they hold their key', async () => {
    const w = await world();
    await openCard(w);
    const named = await w.enroll('identified');
    const anon = await w.enroll('anonymous', { name: 'Jo Expert' });
    const dev = await deviceExpert(w);
    for (const actor of [named.actor, anon.actor, dev.actor]) {
      const box = await w.svc.inbox(actor);
      assert.equal(box.toAnswer.length, 1);
      assert.doesNotMatch(JSON.stringify(box), ACAPS_LEAK);
    }
  });

  test('valid context is stored on the answer row for a keyed, a device-held and a service-held anonymous expert', async () => {
    const w = await world();
    const card = await openCard(w);
    const named = await w.enroll('identified');
    const anon = await w.enroll('anonymous', { name: 'Jo Expert' });
    const dev = await deviceExpert(w);
    await w.svc.submitEstimate(named.actor, { cardId: card.id, p: 0.3, confidence: 3, evidenceType: 'data', coi: true, reason: REASON });
    await w.svc.submitEstimate(anon.actor, { cardId: card.id, p: 0.5, confidence: 1, evidenceType: 'none', coi: false, reason: REASON });
    const b = await dev.dev.ballot(dev.actor, card.id);
    await w.svc.submitAnonymousEstimate({ ...b, p: 0.6, confidence: 2, evidenceType: 'analysis', coi: true, reason: REASON });

    const rows = await w.answers.estimates.find({ cardId: card.id });
    assert.equal(rows.length, 3);
    const keyed = rows.find((r) => r.expertId === named.expertId);
    assert.ok(keyed, 'the keyed row is linked to its expert, as before');
    assert.deepEqual([keyed.confidence, keyed.evidenceType, keyed.coi, keyed.reason], [3, 'data', true, REASON]);

    const anonRows = rows.filter((r) => r.expertId === null);
    assert.equal(anonRows.length, 2);
    const serviceHeld = anonRows.find((r) => !r.respondentKey.startsWith('bt:'));
    assert.ok(serviceHeld, 'the service-held anonymous row is not keyed by a ballot');
    assert.deepEqual([serviceHeld.confidence, serviceHeld.evidenceType, serviceHeld.coi, serviceHeld.reason], [1, 'none', false, REASON]);
    assert.equal(serviceHeld.name, undefined, 'the service-held anonymous row carries no name');
    assert.doesNotMatch(JSON.stringify(rows), /Jo Expert/);

    const device = anonRows.find((r) => r.respondentKey === `bt:${b.token}`);
    assert.ok(device, 'the device-held row is keyed by its ballot');
    assert.deepEqual([device.confidence, device.evidenceType, device.coi, device.reason], [2, 'analysis', true, REASON]);
  });

  test('invalid context is refused with a ValidationError and writes nothing, for a keyed and a device-held expert; both can still answer', async () => {
    const w = await world();
    const card = await openCard(w);
    const named = await w.enroll('identified');
    const dev = await deviceExpert(w);
    const b = await dev.dev.ballot(dev.actor, card.id);
    const bad = [
      { confidence: 0 }, { confidence: 4 }, { confidence: '2' },
      { evidenceType: 'hearsay' },
      { reason: 'x'.repeat(601) },
      { reason: 42 },
    ];
    for (const ctx of bad) {
      await rejectsValidation(w.svc.submitEstimate(named.actor, { cardId: card.id, p: 0.4, ...ctx }));
      await rejectsValidation(w.svc.submitAnonymousEstimate({ ...b, p: 0.4, ...ctx }));
      assert.equal((await w.answers.estimates.all()).length, 0, `nothing written for ${JSON.stringify(ctx).slice(0, 40)}`);
    }
    await w.svc.submitEstimate(named.actor, { cardId: card.id, p: 0.4, confidence: 2, reason: 'x'.repeat(600) });
    await w.svc.submitAnonymousEstimate({ ...b, p: 0.4, confidence: 2 });
    assert.equal((await w.answers.estimates.all()).length, 2, 'both answered after the refusals, and a 600-character reason is accepted');
  });

  test('a reason that gives an email address or a phone number is stored with both removed, and neither is in any stored row', async () => {
    const w = await world();
    const card = await openCard(w);
    const e = await w.enroll('identified');
    await w.svc.submitEstimate(e.actor, { cardId: card.id, p: 0.4, reason: 'write to me at jo@example.org or +44 7700 900123' });
    const rows = await w.answers.estimates.all();
    assert.equal(rows[0].reason, 'write to me at [removed] or [removed]');
    const dump = JSON.stringify(rows);
    assert.doesNotMatch(dump, /jo@example\.org/);
    assert.doesNotMatch(dump, /7700 900123/);
  });

  test('an answer with no context stores exactly the keys it always did', async () => {
    const w = await world();
    const card = await openCard(w);
    const e = await w.enroll('identified');
    await w.svc.submitEstimate(e.actor, { cardId: card.id, p: 0.4 });
    const [row] = await w.answers.estimates.all();
    assert.deepEqual(Object.keys(row).sort(), BASE_KEYS);
  });

  test('the context never appears in the release, the staff list, the second-look summary, the expert list or the audit log', async () => {
    const w = await world();
    const card = await openCard(w);
    const e = await w.enroll('identified', { name: 'Jo Expert' });
    await w.svc.submitEstimate(e.actor, { cardId: card.id, p: 0.4, confidence: 2, evidenceType: 'local_source', coi: true, reason: REASON });
    await w.svc.closeRound(w.mod, card.id);
    const outputs = [
      await w.svc.cardRelease(card.id),
      await w.svc.cardRelease(card.id, { round: 1 }),
      await w.svc.listCards(w.analyst),
      await w.svc.secondLookSummary(w.mod),
      await w.svc.listExperts(w.mod),
      await w.svc.readAudit(w.mod),
    ];
    assert.ok((await w.svc.readAudit(w.mod)).length > 0, 'the audit log has entries to scan');
    for (const out of outputs) assert.doesNotMatch(JSON.stringify(out), CONTEXT_LEAK);
  });

  test('an expert\'s own export carries their reason, and erasure removes it from the answers store', async () => {
    const w = await world();
    const card = await openCard(w);
    const e = await w.enroll('identified');
    await w.svc.submitEstimate(e.actor, { cardId: card.id, p: 0.4, confidence: 3, evidenceType: 'data', coi: false, reason: REASON });
    const exported = await w.svc.exportMe(e.actor);
    assert.equal(exported.estimates.length, 1);
    assert.deepEqual(
      [exported.estimates[0].reason, exported.estimates[0].confidence, exported.estimates[0].evidenceType, exported.estimates[0].coi],
      [REASON, 3, 'data', false],
    );
    await w.svc.eraseMe(e.actor);
    assert.equal((await w.answers.estimates.all()).length, 0);
    assert.doesNotMatch(JSON.stringify(await w.answers.estimates.all()), /Abeche/);
  });

  test('over HTTP both answer routes pass the context through, and a refused one writes nothing', async () => {
    const w = await world();
    const card = await openCard(w);
    const server = createServer({ service: w.svc, limits: { writesPerMinute: 10000, burstWrites: 10000, readsPerMinute: 10000 } });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const base = `http://127.0.0.1:${server.address().port}`;
    const post = (/** @type {string} */ p, /** @type {object} */ body, /** @type {Record<string, string>} */ headers = {}) => fetch(base + p, {
      method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body),
    });
    try {
      const e = await w.enroll('identified');
      const auth = { authorization: `Bearer ${e.sessionToken}` };
      const bad = await post('/api/estimates', { cardId: card.id, p: 0.3, confidence: 9 }, auth);
      assert.equal(bad.status, 400);
      assert.match((await bad.json()).error, /confidence/);
      assert.equal((await w.answers.estimates.all()).length, 0);
      const ok = await post('/api/estimates', { cardId: card.id, p: 0.42, confidence: 2, evidenceType: 'data', coi: true, reason: REASON }, auth);
      assert.equal(ok.status, 200);
      const keyed = (await w.answers.estimates.all())[0];
      assert.deepEqual([keyed.confidence, keyed.evidenceType, keyed.coi, keyed.reason], [2, 'data', true, REASON]);

      const dev = await deviceExpert(w);
      const b = await dev.dev.ballot(dev.actor, card.id);
      const badAnon = await post('/api/anon/estimates', { ...b, p: 0.5, evidenceType: 'hearsay' });
      assert.equal(badAnon.status, 400);
      assert.equal((await w.answers.estimates.all()).length, 1, 'the refused ballot is not spent');
      const okAnon = await post('/api/anon/estimates', { ...b, p: 0.5, confidence: 1, reason: 'Device note.' });
      assert.equal(okAnon.status, 200);
      const row = (await w.answers.estimates.all()).find((r) => r.respondentKey === `bt:${b.token}`);
      assert.deepEqual([row.confidence, row.reason], [1, 'Device note.']);
    } finally { await new Promise((r) => server.close(r)); }
  });
}
