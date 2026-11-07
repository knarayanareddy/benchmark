import baseTest from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { KIND } from '@benchmark/domain/dissent';
import { BACKENDS, worldFor, DAY, CARD } from './helpers.js';

const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const PUB = publicKey.export({ type: 'spki', format: 'pem' });
const PRIV = privateKey.export({ type: 'pkcs8', format: 'pem' });
const REASON = 'The objection describes an immediate threat to the sender and to a colleague.';

for (const backend of BACKENDS) {
  const test = (name, fn) => baseTest(`[${backend}] ${name}`, () => fn());
  const world = async (o = {}) => {
    const w = await worldFor(backend, { breakGlassPublicKey: PUB, ...o });
    const mod2 = await w.svc.authenticate(await w.svc.createStaffSession({ id: 'mod2', role: 'moderator' }));
    const { card } = await w.svc.createCard(w.analyst, CARD);
    const anon = await w.enroll('anonymous', { name: 'Secret Person' });
    const { id } = await w.svc.submitDissent(anon.actor, { cardId: card.id, kind: KIND.WINDOW, text: 'I am being followed after sending my answers.' });
    return { ...w, mod2, card, anon, dissentId: id };
  };

  test('with no key configured the override does not exist, and the consent text says so', async () => {
    const w = await world({ breakGlassPublicKey: undefined });
    assert.equal((await w.answers.dissents.get(w.dissentId)).sealedIdentity, undefined);
    await assert.rejects(() => w.svc.requestBreakGlass(w.mod, { dissentId: w.dissentId, category: 'safety_threat', reason: REASON }), /not configured/);
    assert.match(w.svc.consentFor('anonymous').text, /No safety override is configured/);
  });

  test('with a key, an anonymous objection carries a sealed note that the database alone cannot read', async () => {
    const w = await world();
    const row = await w.answers.dissents.get(w.dissentId);
    assert.match(row.sealedIdentity, /^[A-Za-z0-9+/=]{300,}$/);
    assert.ok(!JSON.stringify(await w.answers.dissents.all()).includes(w.anon.expertId), 'the id is not in the answers store in clear');
    const again = await w.svc.submitDissent(w.anon.actor, { cardId: w.card.id, kind: KIND.WINDOW, text: 'another' });
    assert.notEqual((await w.answers.dissents.get(again.id)).sealedIdentity, row.sealedIdentity, 'two objections from one person are not linkable by their envelopes');
    assert.match(w.svc.consentFor('anonymous').text, /two ACAPS moderators together can open the sealed note/);
    assert.match(w.svc.consentFor('anonymous').text, /never opened this way/);
    const named = await w.enroll('pseudonymous');
    const d2 = await w.svc.submitDissent(named.actor, { cardId: w.card.id, kind: KIND.WINDOW, text: 'x' });
    assert.equal((await w.answers.dissents.get(d2.id)).sealedIdentity, undefined, 'only anonymous objections are sealed');
  });

  test('the sealed note never leaves the service through any staff or public view', async () => {
    const w = await world();
    for (const view of [await w.svc.listDissents(w.analyst), await w.svc.listDissents(w.mod), await w.svc.publicLedger(w.card.id)]) {
      assert.ok(!JSON.stringify(view).includes('sealedIdentity'));
    }
    await w.svc.routeDissent(w.analyst, w.dissentId, { expectedVersion: 0 });
    const acted = await w.svc.actDissent(w.mod, w.dissentId, { expectedVersion: 1, action: 'retire' });
    assert.ok(!JSON.stringify(acted).includes('sealedIdentity'));
    assert.ok(!JSON.stringify(await w.svc.exportMe(w.anon.actor)).includes('sealedIdentity'));
  });

  test('two moderators, a written reason, one opening, then the expert is told', async () => {
    const w = await world();
    const ask = (o) => w.svc.requestBreakGlass(w.mod, { dissentId: w.dissentId, category: 'safety_threat', reason: REASON, ...o });
    await assert.rejects(() => ask({ reason: 'because' }), /at least 20 characters/);
    await assert.rejects(() => ask({ category: 'curiosity' }), /category must be/);
    await assert.rejects(() => w.svc.requestBreakGlass(w.analyst, { dissentId: w.dissentId, category: 'safety_threat', reason: REASON }), /may not breakglass\.request/);
    await assert.rejects(() => ask({ dissentId: 'nope' }), /not found/);
    const r = await ask({});
    assert.equal(r.status, 'requested');
    await assert.rejects(() => ask({}), /already open/);

    await assert.rejects(() => w.svc.decideBreakGlass(w.mod, r.id, { approve: true }), /different moderator/);
    await assert.rejects(() => w.svc.collectBreakGlass(w.mod, r.id, { key: PRIV }), /not approved/);
    await assert.rejects(() => w.svc.decideBreakGlass(w.analyst, r.id, { approve: true }), /may not breakglass\.decide/);
    assert.equal((await w.svc.decideBreakGlass(w.mod2, r.id, { approve: true, note: 'agreed, verified out of band' })).status, 'approved');

    await assert.rejects(() => w.svc.collectBreakGlass(w.mod2, r.id, { key: PRIV }), /only the moderator who asked/);
    await assert.rejects(() => w.svc.collectBreakGlass(w.mod, r.id), /private key is required/);
    const other = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' });
    await assert.rejects(() => w.svc.collectBreakGlass(w.mod, r.id, { key: other }), /wrong key/);
    assert.equal((await w.answers.break_glass.get(r.id)).status, 'approved', 'a wrong key changes nothing');

    const out = await w.svc.collectBreakGlass(w.mod, r.id, { key: PRIV });
    assert.deepEqual([out.expertId, out.name, out.countries, out.notified], [w.anon.expertId, 'Secret Person', ['TCD'], true]);
    await assert.rejects(() => w.svc.collectBreakGlass(w.mod, r.id, { key: PRIV }), /not approved|already collected/);
    assert.ok(!JSON.stringify(await w.answers.break_glass.all()).includes(w.anon.expertId), 'the identity is stored nowhere');

    const box = await w.svc.inbox(w.anon.actor);
    assert.equal(box.notices.length, 1);
    assert.match(box.notices[0].text, /On 2026-11-07, two ACAPS moderators opened the sealed note on an anonymous objection you sent, because of a threat to someone's safety\.$/);
    assert.ok(!/mod1|mod2/.test(JSON.stringify(box.notices)), 'the notice does not name who');
    await w.svc.ackNotice(w.anon.actor, box.notices[0].id);
    assert.equal((await w.svc.inbox(w.anon.actor)).notices.length, 0);

    const log = await w.svc.readAudit(w.mod);
    assert.deepEqual(log.filter((l) => l.action.startsWith('breakglass')).map((l) => [l.action, l.actorId]),
      [['breakglass.request', 'mod1'], ['breakglass.approve', 'mod2'], ['breakglass.collect', 'mod1']]);
    assert.ok(!JSON.stringify(log).includes(w.anon.expertId), 'the audit log records that it happened, not whom');
  });

  test('a denied, expired or unapproved request opens nothing', async () => {
    const w = await world();
    const ask = () => w.svc.requestBreakGlass(w.mod, { dissentId: w.dissentId, category: 'safety_welfare', reason: REASON });
    const a = await ask();
    assert.equal((await w.svc.decideBreakGlass(w.mod2, a.id, { approve: false, note: 'no' })).status, 'denied');
    await assert.rejects(() => w.svc.collectBreakGlass(w.mod, a.id, { key: PRIV }), /not approved/);
    const b = await ask();
    w.clock.now += 25 * 3600 * 1000;
    await assert.rejects(() => w.svc.decideBreakGlass(w.mod2, b.id, { approve: true }), /expired/);
    assert.equal((await w.answers.break_glass.get(b.id)).status, 'expired');
    const c = await ask();
    await w.svc.decideBreakGlass(w.mod2, c.id, { approve: true });
    w.clock.now += 25 * 3600 * 1000;
    await assert.rejects(() => w.svc.collectBreakGlass(w.mod, c.id, { key: PRIV }), /expired/);
    assert.equal((await w.svc.inbox(w.anon.actor)).notices.length, 0, 'nobody was told because nothing was opened');
  });

  test('only anonymous objections can be opened; an erased sender yields no identity and no notice', async () => {
    const w = await world();
    const named = await w.enroll('identified');
    const d = await w.svc.submitDissent(named.actor, { cardId: w.card.id, kind: KIND.WINDOW, text: 'x' });
    await assert.rejects(() => w.svc.requestBreakGlass(w.mod, { dissentId: d.id, category: 'safety_threat', reason: REASON }), /no sealed identity/);
    const r = await w.svc.requestBreakGlass(w.mod, { dissentId: w.dissentId, category: 'legal_obligation', reason: REASON });
    await w.svc.decideBreakGlass(w.mod2, r.id, { approve: true });
    await w.svc.eraseMe(w.anon.actor);
    assert.deepEqual(await w.svc.collectBreakGlass(w.mod, r.id, { key: PRIV }), { erased: true });
    assert.equal((await w.roster.notices.all()).length, 0);
  });

  test('the key can be held by the service instead, and listing shows the trail without any identity', async () => {
    const w = await world({ breakGlassPrivateKey: PRIV });
    const r = await w.svc.requestBreakGlass(w.mod, { dissentId: w.dissentId, category: 'safety_threat', reason: REASON });
    await w.svc.decideBreakGlass(w.mod2, r.id, { approve: true });
    assert.equal((await w.svc.collectBreakGlass(w.mod, r.id)).expertId, w.anon.expertId);
    const list = await w.svc.listBreakGlass(w.mod);
    assert.equal(list.length, 1);
    assert.ok(!JSON.stringify(list).includes(w.anon.expertId));
    await assert.rejects(() => w.svc.listBreakGlass(w.analyst), /may not breakglass\.read/);
    assert.ok(DAY > 0);
  });
}
