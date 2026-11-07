// Data the ported screens read: the ACAPS reading on Round 2 only, the Pulse circle, and the expert's own record.
import baseTest from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { BACKENDS, worldFor, CARD, many } from './helpers.js';
import { CONSENT_VERSION } from '../src/consent.js';
import { createServer } from '../src/http.js';
import { BAND_MIDPOINT } from '@benchmark/core/aggregate';

const blindKey = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' });
const ACAPS_KEY = /acaps/i;
// The record and circle fields as JSON keys. "answered" is left out: a dispatch preview's own counts use that word.
const RECORD_KEYS = /"(record|revised|objections|circle|withView|openCards)"\s*:/;
const EXPECTED_P = Math.round(BAND_MIDPOINT.High * 100);

for (const backend of BACKENDS) {
  const test = (/** @type {string} */ name, /** @type {() => Promise<void>} */ fn) => baseTest(`[${backend}] ${name}`, () => fn());

  /** Expert A has answered c1 and c2 in Round 1; c1 is closed and open for Round 2 with A's revision pending. */
  async function roundTwoWorld(opts = {}) {
    const w = await worldFor(backend, opts);
    const c1 = (await w.svc.createCard(w.analyst, CARD)).card;
    const c2 = (await w.svc.createCard(w.analyst, { ...CARD, statement: 'A second question about Chad.' })).card;
    const e = await w.enroll('identified', { countries: ['TCD'] });
    await w.svc.submitEstimate(e.actor, { cardId: c1.id, p: 0.4 });
    await w.svc.submitEstimate(e.actor, { cardId: c2.id, p: 0.5 });
    await w.svc.closeRound(w.mod, c1.id);
    await w.svc.openRound2(w.mod, c1.id);
    return { ...w, c1, c2, e };
  }

  test('ACAPS on Round 2 only: an integer percentage on the revision entry, never on a Round-1 payload', async () => {
    const w = await roundTwoWorld();
    const t = (await w.svc.createCard(w.analyst, { ...CARD, theme: 'conflict', statement: 'A thread question about Chad.' })).card;
    await w.svc.setThread(w.mod, { cardId: t.id, enabled: true });
    await w.svc.submitEstimate(w.e.actor, { cardId: t.id, p: 0.3 });
    await w.svc.closeRound(w.mod, t.id);
    const open = (await w.svc.createCard(w.analyst, { ...CARD, theme: 'food', statement: 'An open question about Chad.' })).card;

    const box = await w.svc.inbox(w.e.actor);
    const r2 = box.openForRevision.find((c) => c.id === w.c1.id);
    assert.equal(r2.acaps.p, EXPECTED_P);
    assert.ok(Number.isInteger(r2.acaps.p));

    assert.deepEqual(box.toAnswer.map((c) => c.id), [open.id]);
    assert.equal(box.discussion.length, 1);
    for (const c of [...box.toAnswer, ...box.discussion]) assert.equal('acaps' in c, false, `round-1 card ${c.id} carries acaps`);
    const serialised = JSON.stringify({ ...box, openForRevision: undefined });
    assert.doesNotMatch(serialised, ACAPS_KEY);

    const p = await w.svc.pulse(w.e.actor);
    assert.doesNotMatch(JSON.stringify(p), ACAPS_KEY);
    for (const e of [...p.asks, ...p.radar]) assert.equal('acaps' in e.card, false);
  });

  test('ACAPS is null on a Round-2 card that has no reading, and the switch off nulls every Round-2 reading', async () => {
    const w = await worldFor(backend);
    const unrated = (await w.svc.createCard(w.analyst, { ...CARD, probability: undefined })).card;
    assert.equal(unrated.acapsP, null);
    const e = await w.enroll('identified', { countries: ['TCD'] });
    await w.svc.submitEstimate(e.actor, { cardId: unrated.id, p: 0.4 });
    await w.svc.closeRound(w.mod, unrated.id);
    await w.svc.openRound2(w.mod, unrated.id);
    const entry = (await w.svc.inbox(e.actor)).openForRevision[0];
    assert.equal(entry.acaps, null);
    assert.equal('acaps' in entry, true);

    const off = await roundTwoWorld({ showAcapsRound2: false });
    const offEntry = (await off.svc.inbox(off.e.actor)).openForRevision[0];
    assert.equal(offEntry.acaps, null, 'the switch off: null, the key still present');
    assert.equal(offEntry.yourEstimate, 0.4);
  });

  test('ACAPS on the Round-2 reading comes through HTTP, and a Round-1 payload over HTTP has no acaps', async () => {
    const w = await roundTwoWorld();
    const open = (await w.svc.createCard(w.analyst, { ...CARD, theme: 'food', statement: 'An open question about Chad.' })).card;
    const server = createServer({
      service: w.svc,
      verifyStaff: async (_req, body) => (body.credential === 'mod-ok' ? { id: 'mod1', role: 'moderator' } : null),
      limits: { writesPerMinute: 10000, burstWrites: 10000 },
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const base = `http://127.0.0.1:${server.address().port}`;
    const get = async (/** @type {string} */ path) => {
      const res = await fetch(base + path, { headers: { authorization: `Bearer ${w.e.sessionToken}` } });
      return { status: res.status, json: await res.json() };
    };
    try {
      const inbox = await get('/api/inbox');
      assert.equal(inbox.status, 200);
      assert.equal(inbox.json.openForRevision.find((c) => c.id === w.c1.id).acaps.p, EXPECTED_P);
      assert.deepEqual(inbox.json.toAnswer.map((c) => c.id), [open.id]);
      assert.doesNotMatch(JSON.stringify({ ...inbox.json, openForRevision: undefined }), ACAPS_KEY);
      const pulse = await get('/api/pulse');
      assert.equal(pulse.status, 200);
      assert.doesNotMatch(JSON.stringify(pulse.json), ACAPS_KEY);
    } finally {
      await new Promise((r) => server.close(r));
    }
  });

  test('the circle: members is null below five people (forming), a number at five; uninvited and other-country people do not count', async () => {
    const w = await worldFor(backend);
    const e = await w.enroll('identified', { countries: ['TCD'] });
    let p = await w.svc.pulse(e.actor);
    assert.deepEqual(p.circle, { country: 'TCD', members: null, openCards: 0, withView: 0 });

    await w.enroll('anonymous', { countries: ['TCD'] });
    await w.enroll('pseudonymous', { countries: ['TCD'] });
    await w.enroll('identified', { countries: ['KEN'] });
    await w.svc.createInvite(w.mod, { declaration: { countries: ['TCD'] } });
    p = await w.svc.pulse(e.actor);
    assert.equal(p.circle.members, null, 'three consented people in TCD, one in KEN, one uninvited: forming');

    await w.enroll('identified', { countries: ['TCD'] });
    p = await w.svc.pulse(e.actor);
    assert.equal(p.circle.members, null, 'four consented people in TCD: still forming');

    await w.enroll('identified', { countries: ['TCD'] });
    p = await w.svc.pulse(e.actor);
    assert.equal(p.circle.members, 5, 'five consented people in TCD');
  });

  test('the circle is the first declared country', async () => {
    const w = await worldFor(backend);
    const e = await w.enroll('identified', { countries: ['TCD', 'KEN'] });
    await w.svc.createCard(w.analyst, { ...CARD, country: 'KEN', region: 'East & Southern Africa', statement: 'A Kenya question.' });
    const p = await w.svc.pulse(e.actor);
    assert.equal(p.circle.country, 'TCD');
    assert.equal(p.circle.openCards, 0, 'the Kenya card is not in the TCD circle');
  });

  test('the circle: withView counts only cards with a closed panel release of n >= 5; openCards counts open and closed, not retired', async () => {
    const w = await worldFor(backend);
    const people = await many(5, () => w.enroll('identified', { countries: ['TCD'] }));
    const viewer = people[0];
    const full = (await w.svc.createCard(w.analyst, CARD)).card;
    for (const p of people) await w.svc.submitEstimate(p.actor, { cardId: full.id, p: 0.3 });
    await w.svc.closeRound(w.mod, full.id);
    // Closed, but only two answers: no release is published for it (the ledger holds n >= 5 only).
    const thin = (await w.svc.createCard(w.analyst, { ...CARD, statement: 'A thin question about Chad.' })).card;
    for (const p of people.slice(0, 2)) await w.svc.submitEstimate(p.actor, { cardId: thin.id, p: 0.3 });
    await w.svc.closeRound(w.mod, thin.id);
    // Open, with five answers: counted as open, but no closed release yet.
    const open = (await w.svc.createCard(w.analyst, { ...CARD, statement: 'An open question about Chad.' })).card;
    for (const p of people) await w.svc.submitEstimate(p.actor, { cardId: open.id, p: 0.3 });
    // Retired, and resolved: neither counted.
    const retired = (await w.svc.createCard(w.analyst, { ...CARD, statement: 'A retired question about Chad.' })).card;
    await w.answers.cards.update(retired.id, retired.version, { ...retired, status: 'retired', version: retired.version + 1 });
    const resolved = (await w.svc.createCard(w.analyst, { ...CARD, statement: 'A resolved question about Chad.' })).card;
    await w.svc.resolveCard(w.mod, { cardId: resolved.id, outcome: 1, evidenceUrl: 'https://example.org/bulletin' });
    // An open release with n of five: a card with a view needs a CLOSED release.
    await w.answers.releases.append({ cardId: open.id, round: 1, visibility: 'panel', n: 5, closed: false, at: w.clock.now, snapshot: {} });
    // A Kenya card with a closed full release is not in the TCD circle.
    const kenya = (await w.svc.createCard(w.analyst, { ...CARD, country: 'KEN', region: 'East & Southern Africa', statement: 'A Kenya question.' })).card;
    for (const p of people) await w.svc.submitEstimate(p.actor, { cardId: kenya.id, p: 0.3 });
    await w.svc.closeRound(w.mod, kenya.id);

    const p = await w.svc.pulse(viewer.actor);
    assert.deepEqual(p.circle, { country: 'TCD', members: 5, openCards: 3, withView: 1 });
  });

  test('record counts a keyed expert: answered, revised and objections, and a pseudonymous expert the same way', async () => {
    const w = await roundTwoWorld();
    const c3 = (await w.svc.createCard(w.analyst, { ...CARD, theme: 'food', statement: 'A third question about Chad.' })).card;
    await w.svc.submitEstimate(w.e.actor, { cardId: c3.id, p: 0.2 });
    await w.svc.submitEstimate(w.e.actor, { cardId: w.c1.id, p: 0.45 });
    await w.svc.submitDissent(w.e.actor, { cardId: w.c2.id, kind: 'window', text: 'The window is too short.' });
    assert.deepEqual((await w.svc.pulse(w.e.actor)).record, { answered: 3, revised: 1, objections: 1 });

    const ps = await w.enroll('pseudonymous', { countries: ['TCD'] });
    await w.svc.submitEstimate(ps.actor, { cardId: w.c2.id, p: 0.3 });
    await w.svc.submitDissent(ps.actor, { cardId: w.c2.id, kind: 'window', text: 'Also too short.' });
    assert.deepEqual((await w.svc.pulse(ps.actor)).record, { answered: 1, revised: 0, objections: 1 });
  });

  test('record counts a service-held anonymous expert\'s answers through their recomputed keys, but objections are 0', async () => {
    const w = await worldFor(backend);
    const c1 = (await w.svc.createCard(w.analyst, CARD)).card;
    const c2 = (await w.svc.createCard(w.analyst, { ...CARD, statement: 'A second question about Chad.' })).card;
    const n = await w.enroll('anonymous', { countries: ['TCD'] });
    await w.svc.submitEstimate(n.actor, { cardId: c1.id, p: 0.4 });
    await w.svc.submitEstimate(n.actor, { cardId: c2.id, p: 0.4 });
    await w.svc.closeRound(w.mod, c1.id);
    await w.svc.openRound2(w.mod, c1.id);
    await w.svc.submitEstimate(n.actor, { cardId: c1.id, p: 0.45 });
    await w.svc.submitDissent(n.actor, { cardId: c2.id, kind: 'window', text: 'An anonymous objection.' });
    assert.equal((await w.answers.dissents.find({ cardId: c2.id })).length, 1, 'the dissent exists, so the zero is real');
    const record = (await w.svc.pulse(n.actor)).record;
    assert.deepEqual(record, { answered: 2, revised: 1, objections: 0 });
  });

  test('record is null for a device-held expert, whose answers the server cannot attribute', async () => {
    const w = await worldFor(backend, { blindKey });
    const inv = await w.svc.createInvite(w.mod, { declaration: { countries: ['TCD'] } });
    const r = await w.svc.redeemInvite(inv.token, { level: 'anonymous', consentVersion: CONSENT_VERSION, mode: 'device' });
    const actor = await w.svc.authenticate(r.sessionToken);
    await w.svc.createCard(w.analyst, CARD);
    const p = await w.svc.pulse(actor);
    assert.equal(p.record, null);
    assert.deepEqual(p.circle, { country: 'TCD', members: null, openCards: 1, withView: 0 });
  });

  test('no record number reaches a staff route or another expert\'s view', async () => {
    const w = await roundTwoWorld();
    const other = await w.enroll('identified', { countries: ['TCD'] });
    await w.svc.submitEstimate(w.e.actor, { cardId: w.c1.id, p: 0.5 });
    await w.svc.submitDissent(w.e.actor, { cardId: w.c2.id, kind: 'window', text: 'Too short.' });
    const mine = (await w.svc.pulse(w.e.actor)).record;
    assert.deepEqual(mine, { answered: 2, revised: 1, objections: 1 });

    const staff = {
      listCards: await w.svc.listCards(w.mod),
      listCardsAnalyst: await w.svc.listCards(w.analyst),
      listDissents: await w.svc.listDissents(w.analyst),
      listExperts: await w.svc.listExperts(w.mod),
      readAudit: await w.svc.readAudit(w.mod),
      previewDispatch: await w.svc.previewDispatch(w.mod, { cardId: w.c2.id }),
      publicLedger: await w.svc.publicLedger(w.c2.id),
      listPublic: await w.svc.listPublic(),
      listRisks: await w.svc.listRisks(w.analyst),
    };
    for (const [route, body] of Object.entries(staff)) {
      const json = JSON.stringify(body);
      assert.doesNotMatch(json, RECORD_KEYS, `${route} carries a record field`);
      assert.doesNotMatch(json, /"revised":1|"objections":1|"answered":2/, `${route} carries this expert's counts`);
    }

    const otherPulse = await w.svc.pulse(other.actor);
    assert.deepEqual(otherPulse.record, { answered: 0, revised: 0, objections: 0 });
    assert.doesNotMatch(JSON.stringify(otherPulse), /"revised":1|"objections":1|"answered":2/);
  });
}
