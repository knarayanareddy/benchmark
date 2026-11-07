import baseTest from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import * as B from '@benchmark/core/blind';
import { createServer } from '../src/http.js';
import { ValidationError, ForbiddenError, AuthError } from '../src/errors.js';
import { CONSENT_VERSION } from '../src/consent.js';
import { BACKENDS, worldFor, CARD } from './helpers.js';

const blindKey = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' });

// Markers the leak checks look for in every payload, log row and store document.
const ORG = 'Chadian Relief Collective';
const DEVICE_ORG = 'Ndjamena Device Circle';
const OTHER_ORG = 'Juba Field Monitors';

const GOOD = {
  organisation: `  ${ORG}  `, roleType: 'local_ngo', countries: ['tcd'], themes: ['health', 'food'], weeklyCap: 4,
};
// What staff set on the invite. The profile screen never edits regions, so a save must leave these alone.
const STAFF_REGIONS = ['Sahel & West/Central Africa', 'Legacy free text'];

/** What a device-held browser does: blind the ballot, get it signed, unblind (as in secondlook.test.js). */
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
  const world = (o = {}) => worldFor(backend, o);

  /** Every row of every answers table, as one string. Nothing here may hold profile fields. */
  async function answersText(w) {
    const parts = [];
    for (const name of Object.keys(w.answers)) parts.push(JSON.stringify(await w.answers[name].all()));
    return parts.join('\n');
  }
  const auditOf = async (w) => JSON.parse(JSON.stringify(await w.svc.readAudit(w.mod)));

  test('a new expert needs setup, gets the defaults, and sees the declaration staff gave them', async () => {
    const w = await world();
    const e = await w.enroll('identified', { name: 'Ada Test', countries: ['TCD'] });
    const p = await w.svc.getProfile(e.actor);
    assert.equal(p.needsSetup, true);
    assert.equal(p.organisation, null);
    assert.equal(p.roleType, null);
    assert.equal(p.weeklyCap, 3);
    assert.equal(p.minMatch, undefined, 'there is no minimum-match setting');
    assert.deepEqual(p.declaration, { countries: ['TCD'], regions: [], themes: [] });
    assert.equal(p.name, 'Ada Test');
    assert.equal(p.level, 'identified');
    assert.equal(p.mode, 'server');
    assert.deepEqual(Object.keys(p.vocab.themes).sort(), ['climate', 'conflict', 'displacement', 'food', 'health', 'political_economic']);
    assert.deepEqual(Object.keys(p.vocab).sort(), ['roleTypes', 'themes'], 'regions are not in the profile vocabulary');
    assert.ok(p.vocab.roleTypes.local_ngo);
  });

  test('setProfile saves what was typed, trimmed, and clears needsSetup; it returns the same shape as getProfile', async () => {
    const w = await world();
    const e = await w.enroll('identified');
    const saved = await w.svc.setProfile(e.actor, GOOD);
    assert.equal(saved.needsSetup, false);
    assert.equal(saved.organisation, ORG);
    assert.equal(saved.roleType, 'local_ngo');
    assert.deepEqual(saved.declaration, { countries: ['TCD'], regions: [], themes: ['health', 'food'] });
    assert.equal(saved.weeklyCap, 4);
    assert.deepEqual(await w.svc.getProfile(e.actor), saved);
  });

  test('a save keeps the declaration\'s regions exactly as staff stored them, free text included', async () => {
    const w = await world();
    const inv = await w.svc.createInvite(w.mod, { name: 'Invited Expert', declaration: { countries: ['TCD'], regions: STAFF_REGIONS, themes: ['health'] } });
    const r = await w.svc.redeemInvite(inv.token, { level: 'identified', consentVersion: CONSENT_VERSION });
    const actor = await w.svc.authenticate(r.sessionToken);
    const start = await w.svc.getProfile(actor);
    assert.deepEqual(start.declaration.regions, STAFF_REGIONS);
    const saved = await w.svc.setProfile(actor, { ...GOOD, countries: ['SDN'], themes: ['conflict'] });
    assert.deepEqual(saved.declaration, { countries: ['SDN'], regions: STAFF_REGIONS, themes: ['conflict'] });
    assert.deepEqual((await w.svc.getProfile(actor)).declaration.regions, STAFF_REGIONS);
    assert.deepEqual((await w.svc.exportMe(actor)).expert.declaration.regions, STAFF_REGIONS);
    await w.svc.setProfile(actor, { ...GOOD, countries: ['TCD'] });
    assert.deepEqual((await w.roster.experts.get(actor.expertId)).declaration.regions, STAFF_REGIONS, 'and a second save too');
  });

  test('stale minMatch, regions and other unknown keys in the body are ignored, not refused', async () => {
    const w = await world();
    const inv = await w.svc.createInvite(w.mod, { declaration: { countries: ['TCD'], regions: STAFF_REGIONS, themes: [] } });
    const r = await w.svc.redeemInvite(inv.token, { level: 'identified', consentVersion: CONSENT_VERSION });
    const actor = await w.svc.authenticate(r.sessionToken);
    const saved = await w.svc.setProfile(actor, { ...GOOD, minMatch: 999, regions: ['Atlantis'], whatever: { x: 1 } });
    assert.equal(saved.needsSetup, false);
    assert.equal(saved.weeklyCap, 4);
    assert.ok(!('minMatch' in saved));
    assert.deepEqual(saved.declaration.regions, STAFF_REGIONS, 'a regions input cannot edit the stored regions');
    assert.ok(!JSON.stringify(await w.svc.exportMe(actor)).includes('Atlantis'));
  });

  test('completedAt is set by the first save and kept by later ones', async () => {
    const w = await world();
    const e = await w.enroll('identified');
    await w.svc.setProfile(e.actor, GOOD);
    const first = (await w.roster.experts.get(e.expertId)).profile.completedAt;
    assert.equal(typeof first, 'number');
    w.clock.now += 5 * 24 * 3600 * 1000;
    await w.svc.setProfile(e.actor, { ...GOOD, weeklyCap: 5 });
    assert.equal((await w.roster.experts.get(e.expertId)).profile.completedAt, first);
  });

  test('empty organisation and roleType are stored as null; a lower-case country is accepted as ISO3', async () => {
    const w = await world();
    const e = await w.enroll('identified');
    const p = await w.svc.setProfile(e.actor, { ...GOOD, organisation: '   ', roleType: '', countries: [' sdn '] });
    assert.equal(p.organisation, null);
    assert.equal(p.roleType, null);
    assert.deepEqual(p.declaration.countries, ['SDN']);
  });

  test('boundaries are accepted: weeklyCap 1 and 7, a 120-character organisation', async () => {
    const w = await world();
    const e = await w.enroll('identified');
    for (const weeklyCap of [1, 7]) {
      const p = await w.svc.setProfile(e.actor, { ...GOOD, weeklyCap });
      assert.equal(p.weeklyCap, weeklyCap);
    }
    const p = await w.svc.setProfile(e.actor, { ...GOOD, organisation: 'x'.repeat(120) });
    assert.equal(p.organisation.length, 120);
  });

  test('an omitted weeklyCap keeps the stored value, or the default on the first save', async () => {
    const w = await world();
    const e = await w.enroll('identified');
    const first = await w.svc.setProfile(e.actor, { ...GOOD, weeklyCap: 6 });
    assert.equal(first.weeklyCap, 6);
    const again = await w.svc.setProfile(e.actor, { countries: ['TCD'] });
    assert.equal(again.weeklyCap, 6);
    const fresh = await w.enroll('identified');
    const defaults = await w.svc.setProfile(fresh.actor, { countries: ['TCD'] });
    assert.equal(defaults.weeklyCap, 3);
  });

  test('every invalid field is refused, with a clear message, and a refused save changes NOTHING', async () => {
    const w = await world();
    const e = await w.enroll('identified');
    await w.svc.setProfile(e.actor, GOOD);
    const before = JSON.stringify(await w.svc.exportMe(e.actor));
    const beforeProfile = await w.svc.getProfile(e.actor);
    const bad = [
      { ...GOOD, themes: ['nope'] },
      { ...GOOD, themes: ['constructor'] },
      { ...GOOD, roleType: 'boss' },
      { ...GOOD, roleType: 'constructor' },
      { ...GOOD, weeklyCap: 0 },
      { ...GOOD, weeklyCap: 8 },
      { ...GOOD, weeklyCap: 2.5 },
      { ...GOOD, weeklyCap: '3' },
      { ...GOOD, organisation: 'x'.repeat(121) },
      { ...GOOD, organisation: 42 },
      { ...GOOD, countries: [] },
      { ...GOOD, countries: ['TC'] },
      { ...GOOD, countries: ['TCD1'] },
      { ...GOOD, countries: 'TCD' },
      { ...GOOD, countries: ['TCD', 'SUDAN'] },
    ];
    for (const input of bad) {
      await assert.rejects(w.svc.setProfile(e.actor, input), ValidationError);
    }
    assert.equal(JSON.stringify(await w.svc.exportMe(e.actor)), before, 'the stored record is byte-identical');
    assert.deepEqual(await w.svc.getProfile(e.actor), beforeProfile);
  });

  test('a refused save names every problem at once', async () => {
    const w = await world();
    const e = await w.enroll('identified');
    const err = await w.svc.setProfile(e.actor, { organisation: 42, roleType: 'boss', countries: [], weeklyCap: 9 }).catch((x) => x);
    assert.ok(err instanceof ValidationError);
    assert.ok(err.problems.length >= 4, err.message);
    assert.match(err.message, /organisation/);
    assert.match(err.message, /roleType/);
    assert.match(err.message, /country/);
    assert.match(err.message, /weeklyCap/);
  });

  test('staff cannot read or write a profile: experts only', async () => {
    const w = await world();
    await assert.rejects(w.svc.getProfile(w.mod), ForbiddenError);
    await assert.rejects(w.svc.getProfile(w.analyst), ForbiddenError);
    await assert.rejects(w.svc.setProfile(w.mod, GOOD), ForbiddenError);
  });

  test('organisation and roleType are shown only to their owner: another expert cannot read them', async () => {
    const w = await world();
    const owner = await w.enroll('identified');
    const other = await w.enroll('identified');
    await w.svc.setProfile(owner.actor, { ...GOOD, organisation: ORG });
    await w.svc.setProfile(other.actor, { ...GOOD, organisation: OTHER_ORG, roleType: 'researcher' });
    const seenByOther = JSON.stringify(await w.svc.getProfile(other.actor));
    assert.ok(!seenByOther.includes(ORG), 'the owner\'s organisation is not in another expert\'s profile');
    assert.equal((await w.svc.getProfile(owner.actor)).organisation, ORG);
    assert.equal((await w.svc.getProfile(other.actor)).roleType, 'researcher');
  });

  test('listExperts for a moderator never carries organisation, roleType or the profile', async () => {
    const w = await world();
    const e = await w.enroll('identified', { name: 'Ada Test' });
    await w.svc.setProfile(e.actor, GOOD);
    const payload = JSON.stringify(await w.svc.listExperts(w.mod));
    assert.ok(!payload.includes(ORG));
    assert.doesNotMatch(payload, /"(organisation|roleType|profile|weeklyCap)"|local_ngo|Relief/);
  });

  test('saving a profile writes no audit row, and the audit log never holds the organisation or an expert id', async () => {
    const w = await world();
    const e = await w.enroll('identified');
    const before = await auditOf(w);
    await w.svc.setProfile(e.actor, GOOD);
    await w.svc.setProfile(e.actor, { ...GOOD, organisation: OTHER_ORG });
    assert.deepEqual(await auditOf(w), before, 'the audit table is unchanged by a save');
    const log = JSON.stringify(await auditOf(w));
    assert.ok(!log.includes(e.expertId));
    assert.ok(!log.includes(OTHER_ORG));
  });

  test('the expert\'s export includes the whole profile and the declaration', async () => {
    const w = await world();
    const e = await w.enroll('identified');
    await w.svc.setProfile(e.actor, GOOD);
    const exp = (await w.svc.exportMe(e.actor)).expert;
    assert.equal(exp.profile.organisation, ORG);
    assert.equal(exp.profile.roleType, 'local_ngo');
    assert.equal(exp.profile.weeklyCap, 4);
    assert.equal(exp.profile.minMatch, undefined);
    assert.equal(typeof exp.profile.completedAt, 'number');
    assert.deepEqual(exp.declaration, { countries: ['TCD'], regions: [], themes: ['health', 'food'] });
  });

  test('erasing the account removes the profile: the old token is refused and the roster has no row for the expert', async () => {
    const w = await world();
    const e = await w.enroll('identified');
    await w.svc.setProfile(e.actor, GOOD);
    await w.svc.eraseMe(e.actor);
    // The old token no longer authenticates, so nothing can reach the profile with it.
    await assert.rejects(async () => w.svc.getProfile(await w.svc.authenticate(e.sessionToken)), AuthError);
    assert.ok(!(await w.roster.experts.get(e.expertId)));
    assert.ok(!(await w.roster.experts.all()).some((x) => x.id === e.expertId));
    assert.ok(!(await w.roster.experts.all()).some((x) => JSON.stringify(x).includes(ORG)));
  });

  test('saving the profile changes neither the anonymity level, token mode, consent nor name', async () => {
    const w = await world();
    const e = await w.enroll('pseudonymous', { name: 'Ada Test' });
    const stored = async () => {
      const x = await w.roster.experts.get(e.expertId);
      return { level: x.level, tokenMode: x.tokenMode ?? null, consent: x.consent, name: x.name };
    };
    const before = await stored();
    await w.svc.setProfile(e.actor, GOOD);
    await w.svc.setProfile(e.actor, { ...GOOD, organisation: OTHER_ORG, roleType: 'other' });
    assert.deepEqual(await stored(), before);
    assert.equal(before.level, 'pseudonymous');
    assert.equal(before.name, 'Ada Test');
  });

  test('a device-held expert can set and read a profile, and nothing in it reaches the answers store', async () => {
    const w = await world({ blindKey });
    const card = (await w.svc.createCard(w.analyst, CARD)).card;
    const inv = await w.svc.createInvite(w.mod, { declaration: { countries: ['TCD'] } });
    const r = await w.svc.redeemInvite(inv.token, { level: 'anonymous', mode: 'device', consentVersion: CONSENT_VERSION });
    const actor = await w.svc.authenticate(r.sessionToken);
    const saved = await w.svc.setProfile(actor, { ...GOOD, organisation: DEVICE_ORG });
    assert.equal(saved.mode, 'device');
    assert.equal(saved.level, 'anonymous');
    assert.equal(saved.organisation, DEVICE_ORG);
    assert.equal((await w.svc.getProfile(actor)).organisation, DEVICE_ORG);
    // The device answers too, so the answers store is not empty when it is scanned.
    const b = await deviceOf(w.svc).ballot(actor, card.id);
    await w.svc.submitAnonymousEstimate({ ...b, p: 0.4 });
    assert.match(await answersText(w), /"p":0\.4/, 'the scan has real answer rows to look through');
    assert.ok(!(await answersText(w)).includes(DEVICE_ORG), 'no answers document holds the organisation');
    assert.ok(JSON.stringify(await w.roster.experts.all()).includes(DEVICE_ORG), 'the roster does hold it (control for the scan)');
  });

  test('a declaration made by staff is the starting point, and the first save overwrites it', async () => {
    const w = await world();
    const inv = await w.svc.createInvite(w.mod, {
      name: 'Invited Expert', declaration: { countries: ['TCD'], regions: ['Sahel & West/Central Africa'], themes: ['health'] },
    });
    const r = await w.svc.redeemInvite(inv.token, { level: 'identified', consentVersion: CONSENT_VERSION });
    const actor = await w.svc.authenticate(r.sessionToken);
    const start = await w.svc.getProfile(actor);
    assert.equal(start.needsSetup, true);
    assert.deepEqual(start.declaration, { countries: ['TCD'], regions: ['Sahel & West/Central Africa'], themes: ['health'] });
    const saved = await w.svc.setProfile(actor, { ...GOOD, countries: ['SDN'], themes: ['conflict'] });
    assert.deepEqual(saved.declaration, { countries: ['SDN'], regions: ['Sahel & West/Central Africa'], themes: ['conflict'] });
    assert.equal(saved.needsSetup, false);
    assert.equal((await w.svc.getProfile(actor)).declaration.countries[0], 'SDN');
  });

  test('over HTTP: GET and PUT /api/me/profile for an expert, refused for staff and without a token', async () => {
    const w = await world();
    const e = await w.enroll('identified');
    const server = createServer({ service: w.svc, limits: { writesPerMinute: 10000, burstWrites: 10000, readsPerMinute: 10000 } });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const base = `http://127.0.0.1:${server.address().port}`;
    const call = async (method, path, { token, body } = {}) => {
      const res = await fetch(base + path, {
        method,
        headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
        body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
      });
      const text = await res.text();
      return { status: res.status, json: text ? JSON.parse(text) : null };
    };
    try {
      assert.equal((await call('GET', '/api/me/profile')).status, 401);
      const staff = await w.svc.createStaffSession({ id: 'mod1', role: 'moderator' });
      assert.equal((await call('GET', '/api/me/profile', { token: staff })).status, 403);
      assert.equal((await call('PUT', '/api/me/profile', { token: staff, body: GOOD })).status, 403);

      const start = await call('GET', '/api/me/profile', { token: e.sessionToken });
      assert.equal(start.status, 200);
      assert.equal(start.json.needsSetup, true);

      const bad = await call('PUT', '/api/me/profile', { token: e.sessionToken, body: { ...GOOD, weeklyCap: 9 } });
      assert.equal(bad.status, 400);
      assert.ok(bad.json.problems.some((p) => /weeklyCap/.test(p)));
      assert.equal((await call('PUT', '/api/me/profile', { token: e.sessionToken, body: '{not json' })).status, 400);
      assert.equal((await call('GET', '/api/me/profile', { token: e.sessionToken })).json.needsSetup, true, 'a refused save changed nothing');

      const ok = await call('PUT', '/api/me/profile', { token: e.sessionToken, body: GOOD });
      assert.equal(ok.status, 200);
      assert.equal(ok.json.needsSetup, false);
      assert.equal(ok.json.organisation, ORG);
      const again = await call('GET', '/api/me/profile', { token: e.sessionToken });
      assert.deepEqual(again.json, ok.json);
    } finally {
      await new Promise((r) => server.close(r));
    }
  });
}
