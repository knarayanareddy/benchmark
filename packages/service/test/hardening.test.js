// Privacy and state hardening found in review: preview row order, split/rewrite lineage, the anonymous name,
// a profile save racing an erasure, demo content in publication, and anonymous answers in the dispatch preview.
import baseTest from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import { ACTION } from '@benchmark/domain/dissent';
import { BACKENDS, worldFor, CARD } from './helpers.js';
import { CONSENT_VERSION } from '../src/consent.js';
import { ConflictError } from '../src/errors.js';

const blindKey = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' });
const RAW = JSON.parse(readFileSync(new URL('../../../data/risk-radar.json', import.meta.url), 'utf8'));
const RADAR = [structuredClone(RAW.find((r) => r.id === 'R1066'))];
const RISK = 'R1066';
const ids = (/** @type {{ card: { id: string } }[]} */ list) => list.map((e) => e.card.id);
const PROFILE = { countries: ['TCD'], regions: [], themes: [], weeklyCap: 3 };
const GOOD = { organisation: 'Hardening Org', roleType: 'local_ngo', countries: ['TCD'], themes: ['health'], weeklyCap: 4 };

for (const backend of BACKENDS) {
  const test = (/** @type {string} */ name, /** @type {() => Promise<void>} */ fn) => baseTest(`[${backend}] ${name}`, () => fn());
  const world = (/** @type {Record<string, any>} */ o = {}) => worldFor(backend, { blindKey, radar: RADAR, ...o });
  const openCard = async (/** @type {any} */ w, /** @type {Record<string, any>} */ input = CARD) => (await w.svc.createCard(w.analyst, input)).card;

  /** An objection routed and actioned by an analyst, ready for a split, rewrite, or publication. */
  async function actionedDissent(/** @type {any} */ w, /** @type {any} */ expert, /** @type {any} */ card, /** @type {string} */ action, /** @type {Record<string, any>} */ extra = {}) {
    const { id, version } = await w.svc.submitDissent(expert.actor, { cardId: card.id, kind: 'window', text: 'The window is wrong.' });
    await w.svc.routeDissent(w.analyst, id, { expectedVersion: version });
    const acted = await w.svc.actDissent(w.analyst, id, { expectedVersion: version + 1, action, note: 'n', ...extra });
    return { id, acted };
  }

  // ── 1. preview row order is independent of roster order ──────────────────
  test('the dispatch preview is the same whatever order the same experts were invited in', async () => {
    const specs = [
      { level: 'anonymous', themes: [] },
      { level: 'anonymous', themes: ['health'] },
      { level: 'identified', name: 'Ada Ordered', themes: [] },
      { level: 'anonymous', themes: ['health'] },
    ];
    const build = async (/** @type {typeof specs} */ order) => {
      const w = await world();
      await w.svc.createCard(w.analyst, { ...CARD, id: 'C-ORDER-1' });
      for (const s of order) {
        const e = await w.enroll(s.level, { name: s.name, countries: ['TCD'] });
        await w.svc.setProfile(e.actor, { ...PROFILE, themes: s.themes });
      }
      return w;
    };
    const a = await build(specs);
    const b = await build([...specs].reverse());
    const cardPreview = (/** @type {any} */ w) => w.svc.previewDispatch(w.mod, { cardId: 'C-ORDER-1' });
    const draftPreview = (/** @type {any} */ w) => w.svc.previewDispatch(w.mod, { draft: { country: 'TCD', region: '', theme: 'health' } });
    const pa = await cardPreview(a);
    const pb = await cardPreview(b);
    // The rows must really differ in content, or sorting on the whole row would be tested by nothing.
    const anon = pa.rows.filter((/** @type {any} */ r) => r.level === 'anonymous');
    assert.equal(anon.length, 3);
    assert.ok(new Set(anon.map((/** @type {any} */ r) => JSON.stringify(r.why))).size > 1, 'same label, different reasons');
    assert.equal(JSON.stringify(pa), JSON.stringify(pb), 'card preview: same rows in the same order');
    assert.equal(JSON.stringify(await draftPreview(a)), JSON.stringify(await draftPreview(b)), 'draft preview: same rows in the same order');
  });

  // ── 2. split and rewrite keep the risk link and the demo flag ────────────
  test('split and rewrite children carry the parent riskId and demo flag; the retired parent is marked retired', async () => {
    const w = await world();
    const parent = await openCard(w);
    await w.answers.cards.update(parent.id, parent.version, { ...parent, riskId: RISK, demo: true, version: parent.version + 1 });
    const e = await w.enroll('identified', { name: 'Splitter', countries: ['TCD'] });
    const { acted } = await actionedDissent(w, e, { id: parent.id }, ACTION.SPLIT, { statements: ['Chad cholera cases exceed 5,000.', 'Chad cholera deaths exceed 100.'] });
    assert.equal(acted.newCards.length, 2);
    for (const id of acted.newCards) {
      const child = await w.answers.cards.get(id);
      assert.equal(child.riskId, RISK, 'child links to the risk');
      assert.equal(child.demo, true, 'child is still demo content');
      assert.equal(child.parentId, parent.id);
    }
    const retired = await w.answers.cards.get(parent.id);
    assert.equal(retired.status, 'retired');
    assert.equal(retired.retiredBy, acted.dissent.id);

    const r = await openCard(w, { ...CARD, statement: 'Cholera in Chad will be reported weekly.' });
    await w.answers.cards.update(r.id, r.version, { ...r, riskId: RISK, version: r.version + 1 });
    const e2 = await w.enroll('identified', { name: 'Rewriter', countries: ['TCD'] });
    const rewritten = await actionedDissent(w, e2, { id: r.id }, ACTION.REWRITE, { statements: ['Chad cholera will be reported weekly by WHO.'] });
    const child = await w.answers.cards.get(rewritten.acted.newCards[0]);
    assert.equal(child.riskId, RISK);
    assert.equal(child.demo, false, 'a real card stays real');
  });

  // ── 3. the typed name: kept where the safety override needs it, dropped where nothing can ever use it ──
  test('a service-held anonymous expert keeps the typed name on the roster (the safety override needs it) but it never reaches an objection', async () => {
    const w = await world();
    const card = await openCard(w);
    const inv = await w.svc.createInvite(w.mod, { name: 'Zorblax', declaration: { countries: ['TCD'] } });
    const r = await w.svc.redeemInvite(inv.token, { level: 'anonymous', consentVersion: CONSENT_VERSION });
    const actor = await w.svc.authenticate(r.sessionToken);
    assert.equal((await w.roster.experts.get(r.expertId)).name, 'Zorblax', 'kept for the two-moderator override');

    // An anonymous objection still works, and carries no name.
    const { id, version } = await w.svc.submitDissent(actor, { cardId: card.id, kind: 'window', text: 'Anonymous objection.' });
    assert.ok(!JSON.stringify(await w.svc.listDissents(w.mod)).includes('Zorblax'), 'the objection');
    await w.svc.routeDissent(w.analyst, id, { expectedVersion: version });
    const acted = await w.svc.actDissent(w.analyst, id, { expectedVersion: version + 1, action: ACTION.RESOLVE_EARLY, note: 'n' });
    assert.equal(acted.dissent.status, 'actioned');
    assert.ok(!JSON.stringify(await w.answers.dissents.all()).includes('Zorblax'));
  });

  test('a device-held anonymous expert loses the typed name: nothing can ever open it, so nothing may keep it', async () => {
    const w = await world();
    const inv = await w.svc.createInvite(w.mod, { name: 'Zorblax', declaration: { countries: ['TCD'] } });
    await w.svc.redeemInvite(inv.token, { level: 'anonymous', mode: 'device', consentVersion: CONSENT_VERSION });
    assert.ok(!JSON.stringify(await w.roster.experts.all()).includes('Zorblax'));
    assert.ok(!JSON.stringify(await w.svc.listExperts(w.mod)).includes('Zorblax'));
  });

  test('identified and pseudonymous experts keep the name typed at invite', async () => {
    const w = await world();
    for (const level of ['identified', 'pseudonymous']) {
      const inv = await w.svc.createInvite(w.mod, { name: `Named ${level}`, declaration: { countries: ['TCD'] } });
      const r = await w.svc.redeemInvite(inv.token, { level, consentVersion: CONSENT_VERSION });
      assert.equal((await w.roster.experts.get(r.expertId)).name, `Named ${level}`);
      assert.ok(JSON.stringify(await w.svc.listExperts(w.mod)).includes(`Named ${level}`));
    }
  });

  test('a returning expert\'s redeem changes nothing: the stored account is byte-identical', async () => {
    const w = await world();
    const inv = await w.svc.createInvite(w.mod, { name: 'Zorblax', declaration: { countries: ['TCD'] } });
    const first = await w.svc.redeemInvite(inv.token, { level: 'anonymous', consentVersion: CONSENT_VERSION });
    const before = JSON.stringify(await w.roster.experts.get(first.expertId));
    const again = await w.svc.createReinvite(w.mod, first.expertId);
    const back = await w.svc.redeemInvite(again.token, {});
    assert.equal(back.returning, true);
    assert.equal(back.level, 'anonymous');
    assert.equal(JSON.stringify(await w.roster.experts.get(first.expertId)), before, 'the stored account is byte-identical');
  });

  // ── 4. a profile save cannot recreate an erased account ──────────────────
  /** Runs `hook` on the Nth roster read of this expert, so an erasure lands between two steps of the save. */
  async function erasedDuring(/** @type {any} */ w, /** @type {string} */ expertId, /** @type {number} */ readNumber) {
    const experts = w.roster.experts;
    const realGet = experts.get;
    let reads = 0;
    experts.get = async (/** @type {string} */ k) => {
      const v = await realGet(k);
      if (k === expertId && ++reads === readNumber) await experts.remove(k);
      return v;
    };
    return () => { experts.get = realGet; };
  }

  test('a save for an account erased between the read and the write is refused and does not recreate it', async () => {
    const w = await world();
    const e = await w.enroll('identified');
    // Read 1 is the caller check; the erasure lands right after it, so the re-read finds nothing.
    const restore = await erasedDuring(w, e.expertId, 1);
    try {
      await assert.rejects(w.svc.setProfile(e.actor, GOOD), (err) => err instanceof ConflictError && /account no longer exists/.test(err.message));
    } finally { restore(); }
    assert.ok(!(await w.roster.experts.get(e.expertId)), 'the erased account is not written back');
  });

  test('an erasure after the re-read is still refused by the compare-and-set, and the account stays erased', async () => {
    const w = await world();
    const e = await w.enroll('identified');
    // Read 2 is the re-read right before the write; the erasure lands between it and the write.
    const restore = await erasedDuring(w, e.expertId, 2);
    try {
      await assert.rejects(w.svc.setProfile(e.actor, GOOD), (err) => err instanceof ConflictError && /account no longer exists/.test(err.message));
    } finally { restore(); }
    assert.ok(!(await w.roster.experts.get(e.expertId)), 'the write did not recreate the account');
  });

  // ── 5. demo content is never offered for credit ──────────────────────────
  test('a demo card\'s objection or post cannot be offered for credit; a real card\'s can', async () => {
    const w = await world();
    const demo = await openCard(w);
    await w.answers.cards.update(demo.id, demo.version, { ...demo, demo: true, version: demo.version + 1 });
    const real = await openCard(w, { ...CARD, statement: 'A real card about Chad.' });
    const e = await w.enroll('identified', { name: 'Demo Author', countries: ['TCD'] });
    const demoDissent = await actionedDissent(w, e, demo, ACTION.RESOLVE_EARLY);
    const realDissent = await actionedDissent(w, e, real, ACTION.RESOLVE_EARLY);
    const refuse = { status: 409, message: 'demo content cannot be published' };

    await assert.rejects(w.svc.propose(w.mod, { sourceKind: 'dissent', sourceId: demoDissent.id }), refuse);
    const demoPost = `p_${crypto.randomUUID()}`;
    await w.answers.thread_posts.insert(demoPost, {
      id: demoPost, cardId: demo.id, respondentKey: `id:${e.expertId}`, status: 'approved', kind: 'claim', parentId: null,
      label: 'Ada', text: 'A demo post.', participant: null, at: Date.UTC(2026, 10, 7), note: null, version: 0,
    });
    await assert.rejects(w.svc.propose(w.mod, { sourceKind: 'post', sourceId: demoPost }), refuse);

    assert.deepEqual((await w.svc.listOfferable(w.mod)).map((x) => x.sourceId), [realDissent.id], 'the offerable list hides demo content');
    assert.deepEqual(await w.svc.listForStaff(w.mod), [], 'nothing was proposed');
    assert.equal((await w.svc.propose(w.mod, { sourceKind: 'dissent', sourceId: realDissent.id })).status, 'proposed');
  });

  // ── 6. an anonymous expert's answer is not revealed by the preview ───────
  test('a service-held anonymous expert who answered is reported outside, never answered; the others are placed as their own Pulse places them', async () => {
    const w = await world();
    const card = await openCard(w);
    const answered = await w.enroll('anonymous', { countries: ['TCD'] });
    const unanswered = await w.enroll('anonymous', { countries: ['TCD'] });
    await w.svc.submitEstimate(answered.actor, { cardId: card.id, p: 0.4 });

    const pv = await w.svc.previewDispatch(w.mod, { cardId: card.id });
    const anon = pv.rows.filter((/** @type {any} */ r) => r.level === 'anonymous');
    assert.equal(anon.length, 2);
    assert.ok(pv.rows.every((/** @type {any} */ r) => r.level !== 'anonymous' || r.decision !== 'answered'), 'never answered');
    assert.deepEqual(anon.map((/** @type {any} */ r) => r.decision).sort(), ['ask', 'outside']);
    assert.equal(pv.counts.answered, 0);
    // Same reason an out-of-declaration card gets, so the row does not single out an answer.
    assert.equal(anon.find((/** @type {any} */ r) => r.decision === 'outside').reason, 'Outside what they declared');
    // Each one's own Pulse agrees with the preview.
    assert.deepEqual(ids([...(await w.svc.pulse(answered.actor)).asks, ...(await w.svc.pulse(answered.actor)).radar]), []);
    assert.deepEqual(ids((await w.svc.pulse(unanswered.actor)).asks), [card.id]);
  });

  test('device-held experts are still placed by declaration alone: their answers are not visible to the preview', async () => {
    const w = await world();
    const card = await openCard(w);
    const inv = await w.svc.createInvite(w.mod, { declaration: { countries: ['TCD'] } });
    await w.svc.redeemInvite(inv.token, { level: 'anonymous', mode: 'device', consentVersion: CONSENT_VERSION });
    const pv = await w.svc.previewDispatch(w.mod, { cardId: card.id });
    assert.equal(pv.rows.find((/** @type {any} */ r) => r.level === 'anonymous').decision, 'ask');
  });
}
