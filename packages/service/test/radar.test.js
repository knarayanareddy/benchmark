import baseTest from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createService } from '../src/service.js';
import { createServer } from '../src/http.js';
import { ValidationError, NotFoundError } from '../src/errors.js';
import { CONSENT_VERSION } from '../src/consent.js';
import { BACKENDS, SECRETS, CARD, worldFor, makeStores, T0 } from './helpers.js';

// Four real records of the organisers' export. R1066 is the one that carries the restricted fields.
const RAW = JSON.parse(readFileSync(new URL('../../../data/risk-radar.json', import.meta.url), 'utf8'));
const pick = (id) => {
  const r = RAW.find((x) => x.id === id);
  if (!r) throw new Error(`fixture record ${id} missing from data/risk-radar.json`);
  return structuredClone(r);
};
const FIXTURE = [pick('R1066'), pick('R0365'), pick('R1040'), pick('R0204')];
const HIDDEN = pick('R1066');
const HIDDEN_SENTENCE = HIDDEN.rationale.split('. ')[0] + '.';
const HIDDEN_TRIGGER = HIDDEN.triggerList[0].title;
const enc = (s) => JSON.stringify(s).slice(1, -1);
// The words a neutral response must never carry, as JSON keys and as values.
const RESTRICTED_KEY = /"(timeline|rationaleUpdates|completionHistory|trendHistory|riskTrend|status|outcome|level|riskLevel|probability|impact|intensity|rationale|triggers|triggerList|triggerCount)"\s*:/;
const RESTRICTED_VALUES = [enc(HIDDEN_SENTENCE), enc(HIDDEN_TRIGGER), 'Very High', '"Active"'];
const assertNeutralPayload = (payload, label) => {
  const json = JSON.stringify(payload);
  assert.doesNotMatch(json, RESTRICTED_KEY, `${label}: restricted key in payload`);
  for (const v of RESTRICTED_VALUES) assert.ok(!json.includes(v), `${label}: restricted value ${v} in payload`);
};
const BLIND_KEY = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' });
const NEUTRAL_KEYS = ['view', 'hasQuestion', 'id', 'title', 'country', 'isos', 'region', 'theme', 'riskType'];
const ROW_KEYS = ['country', 'hasQuestion', 'id', 'region', 'riskType', 'theme', 'title'];

for (const backend of BACKENDS) {
  const test = (name, fn) => baseTest(`[${backend}] ${name}`, () => fn());
  const world = (o = {}) => worldFor(backend, { radar: FIXTURE, blindKey: BLIND_KEY, ...o });

  /** An open Round-1 card on a risk, written by an analyst. */
  const openCardOn = async (w, riskId = 'R1066') => (await w.svc.createCard(w.analyst, { ...CARD, riskId })).card;

  test('an expert sees only the neutral view of a risk with a live question, and nothing restricted anywhere', async () => {
    const w = await world();
    await openCardOn(w);
    const e = await w.enroll('identified');
    const view = await w.svc.getRisk(e.actor, 'R1066');
    assert.equal(view.view, 'neutral');
    assert.equal(view.hasQuestion, true);
    assert.deepEqual(Object.keys(view).sort(), [...NEUTRAL_KEYS].sort());
    assert.equal(view.id, 'R1066');
    assert.equal(view.title, HIDDEN.title);
    assertNeutralPayload(view, 'service getRisk');
  });

  test('the gating holds for device-held and pseudonymous experts too', async () => {
    const w = await world();
    await openCardOn(w);
    const pseudo = await w.enroll('pseudonymous');
    const inv = await w.svc.createInvite(w.mod, { declaration: { countries: ['TCD'] } });
    const device = await w.svc.redeemInvite(inv.token, { level: 'anonymous', mode: 'device', consentVersion: CONSENT_VERSION });
    const deviceActor = await w.svc.authenticate(device.sessionToken);
    for (const [label, actor] of [['pseudonymous', pseudo.actor], ['device-held', deviceActor]]) {
      const view = await w.svc.getRisk(actor, 'R1066');
      assert.equal(view.view, 'neutral', label);
      assertNeutralPayload(view, label);
    }
  });

  test('an expert who has already answered the live card still gets the neutral view', async () => {
    const w = await world();
    const card = await openCardOn(w);
    const e = await w.enroll('pseudonymous');
    await w.svc.submitEstimate(e.actor, { cardId: card.id, p: 0.4 });
    const view = await w.svc.getRisk(e.actor, 'R1066');
    assert.equal(view.view, 'neutral');
    assertNeutralPayload(view, 'after answering');
  });

  test('once the card is resolved the same expert gets the full view', async () => {
    const w = await world();
    const card = await openCardOn(w);
    const e = await w.enroll('identified');
    assert.equal((await w.svc.getRisk(e.actor, 'R1066')).view, 'neutral');
    await w.svc.resolveCard(w.mod, { cardId: card.id, outcome: 1, evidenceUrl: 'https://example.org/bulletin' });
    const full = await w.svc.getRisk(e.actor, 'R1066');
    assert.equal(full.view, 'full');
    assert.equal(full.hasQuestion, false);
    assert.equal(full.rationale, HIDDEN.rationale.trim());
    assert.deepEqual(full.triggers.map((t) => t.title), HIDDEN.triggerList.map((t) => t.title));
    assert.ok(JSON.stringify(full).includes(enc(HIDDEN_SENTENCE)), 'the full view carries the analysis');
  });

  test('an expert gets the neutral view of a risk with no card, and nothing restricted anywhere', async () => {
    const w = await world();
    const e = await w.enroll('identified');
    const view = await w.svc.getRisk(e.actor, 'R1066');
    assert.equal(view.view, 'neutral');
    assert.equal(view.hasQuestion, false, 'no question is live, but the analysis is still held back');
    assert.deepEqual(Object.keys(view).sort(), [...NEUTRAL_KEYS].sort());
    assertNeutralPayload(view, 'no card');
  });

  test('an expert gets the neutral view of a risk with one open and one resolved card', async () => {
    const w = await world();
    const first = await openCardOn(w);
    await w.svc.resolveCard(w.mod, { cardId: first.id, outcome: 0, evidenceUrl: 'https://example.org/bulletin' });
    await openCardOn(w);
    const e = await w.enroll('identified');
    const view = await w.svc.getRisk(e.actor, 'R1066');
    assert.equal(view.view, 'neutral');
    assert.equal(view.hasQuestion, true);
    assert.deepEqual(Object.keys(view).sort(), [...NEUTRAL_KEYS].sort());
    assertNeutralPayload(view, 'one open, one resolved');
  });

  test('an expert gets the full view of a risk only when every card on it is resolved', async () => {
    const w = await world();
    const a = await openCardOn(w);
    const b = await openCardOn(w);
    await w.svc.resolveCard(w.mod, { cardId: a.id, outcome: 1, evidenceUrl: 'https://example.org/bulletin' });
    const e = await w.enroll('identified');
    assert.equal((await w.svc.getRisk(e.actor, 'R1066')).view, 'neutral', 'one card still open');
    await w.svc.resolveCard(w.mod, { cardId: b.id, outcome: 0, evidenceUrl: 'https://example.org/bulletin' });
    const full = await w.svc.getRisk(e.actor, 'R1066');
    assert.equal(full.view, 'full');
    assert.equal(full.hasQuestion, false);
    assert.equal(full.rationale, HIDDEN.rationale.trim());
  });

  test('the full view carries the computed timeline; no neutral view or list row ever does', async () => {
    const w = await world();
    const staffFull = await w.svc.getRisk(w.mod, 'R1066');
    assert.equal(staffFull.view, 'full');
    assert.deepEqual(Object.keys(staffFull.timeline).sort(), ['points', 'rationaleUpdates', 'riskTrend', 'span', 'triggers']);
    assert.ok(Array.isArray(staffFull.timeline.triggers) && staffFull.timeline.triggers.every((t) => 'completion' in t && 'trend' in t && !('completionHistory' in t)), 'the computed shape, not the raw source fields');
    const e = await w.enroll('identified');
    const neutral = await w.svc.getRisk(e.actor, 'R1066');
    assert.equal(neutral.view, 'neutral');
    assert.ok(!('timeline' in neutral));
    assertNeutralPayload(neutral, 'neutral with timeline data in the radar');
    assert.ok(!JSON.stringify(await w.svc.listRisks(e.actor)).match(/timeline|rationaleUpdates|completionHistory/), 'list rows');
    assert.ok(!JSON.stringify(await w.svc.listRisks(w.mod)).match(/timeline|rationaleUpdates|completionHistory/), 'list rows for staff too');
  });

  test('a retired card (replaced by its children) neither unlocks nor blocks a risk: only a resolved card unlocks, only a live one blocks', async () => {
    const w = await world();
    const parent = await openCardOn(w);
    await w.answers.cards.update(parent.id, parent.version, { ...parent, status: 'retired', version: parent.version + 1 });
    const e = await w.enroll('identified');
    const alone = await w.svc.getRisk(e.actor, 'R1066');
    assert.equal(alone.view, 'neutral', 'a retired card alone has not been resolved, so nothing unlocks');
    assert.equal(alone.hasQuestion, false, 'and a retired card is not a live question');
    const child = await openCardOn(w);
    assert.equal((await w.svc.getRisk(e.actor, 'R1066')).hasQuestion, true);
    await w.svc.resolveCard(w.mod, { cardId: child.id, outcome: 1, evidenceUrl: 'https://example.org/bulletin' });
    assert.equal((await w.svc.getRisk(e.actor, 'R1066')).view, 'full', 'the retired parent does not hold the risk shut once its child resolved');
  });

  test('staff get the full view of a risk in all three states: no card, a live card, all resolved', async () => {
    const w = await world();
    for (const staff of [w.analyst, w.mod]) {
      assert.equal((await w.svc.getRisk(staff, 'R1066')).view, 'full', 'no card');
    }
    const card = await openCardOn(w);
    for (const staff of [w.analyst, w.mod]) {
      const v = await w.svc.getRisk(staff, 'R1066');
      assert.equal(v.view, 'full', 'live card');
      assert.equal(v.hasQuestion, true, 'staff are told a question is live');
      assert.ok(JSON.stringify(v).includes(enc(HIDDEN_SENTENCE)), 'staff see the analysis');
    }
    await w.svc.resolveCard(w.mod, { cardId: card.id, outcome: 1, evidenceUrl: 'https://example.org/bulletin' });
    for (const staff of [w.analyst, w.mod]) {
      assert.equal((await w.svc.getRisk(staff, 'R1066')).view, 'full', 'resolved');
    }
  });

  test('a live card hides only its own risk; a card with no riskId changes nothing', async () => {
    const w = await world();
    await w.svc.createCard(w.analyst, CARD);
    const e = await w.enroll('identified');
    assert.equal((await w.svc.getRisk(e.actor, 'R1066')).view, 'neutral', 'no card on R1066: still held back');
    await openCardOn(w, 'R1040');
    assert.equal((await w.svc.getRisk(e.actor, 'R1040')).view, 'neutral');
    assert.equal((await w.svc.getRisk(e.actor, 'R0365')).view, 'neutral');
    assert.equal((await w.svc.getRisk(w.analyst, 'R0365')).view, 'full', 'staff are never held back');
  });

  test('listRisks never carries restricted fields, for experts or staff, and flags live questions', async () => {
    const w = await world();
    await openCardOn(w);
    const e = await w.enroll('identified');
    for (const actor of [e.actor, w.analyst, w.mod]) {
      const rows = await w.svc.listRisks(actor, {});
      assertNeutralPayload(rows, 'listRisks');
      assert.deepEqual(rows.map((r) => r.id), ['R0204', 'R0365', 'R1040', 'R1066']);
      for (const r of rows) assert.deepEqual(Object.keys(r).sort(), ROW_KEYS);
      assert.equal(rows.find((r) => r.id === 'R1066').hasQuestion, true);
      assert.equal(rows.find((r) => r.id === 'R0365').hasQuestion, false);
    }
  });

  test('listRisks reads the cards store once per call, not once per risk', async () => {
    const { roster, answers } = await makeStores(backend);
    let reads = 0;
    const counted = Object.assign(Object.create(answers), {
      cards: Object.assign(Object.create(answers.cards), { all: async () => { reads += 1; return answers.cards.all(); } }),
    });
    const svc = createService({ roster, answers: counted, secrets: SECRETS, now: () => T0, radar: FIXTURE });
    const mod = await svc.authenticate(await svc.createStaffSession({ id: 'mod1', role: 'moderator' }));
    await svc.listRisks(mod, {});
    assert.equal(reads, 1);
  });

  test('createCard refuses an unknown riskId, stores a known one, and works without one', async () => {
    const w = await world();
    await assert.rejects(() => w.svc.createCard(w.analyst, { ...CARD, riskId: 'R9999' }), (err) => err instanceof ValidationError && /not a risk on the radar/.test(err.message));
    await w.svc.createCard(w.analyst, { ...CARD, riskId: 'R1066' });
    await w.svc.createCard(w.analyst, { ...CARD, statement: 'Cholera cases in Chad will exceed 20,000 by 30 April 2027.' });
    const cards = await w.svc.listCards(w.mod);
    assert.deepEqual(cards.map((c) => c.riskId).sort((a, b) => String(a).localeCompare(String(b))), [null, 'R1066']);
  });

  test('filters: q (title or country, case-insensitive), region, theme and country (ISO) are exact', async () => {
    const w = await world();
    const ids = async (f) => (await w.svc.listRisks(w.analyst, f)).map((r) => r.id);
    assert.deepEqual(await ids({ q: 'HONDURAS' }), ['R1040']);
    assert.deepEqual(await ids({ q: 'lake chad' }), ['R1066']);
    assert.deepEqual(await ids({ q: 'rwanda' }), ['R0204', 'R0365']);
    assert.deepEqual(await ids({ q: 'no such words here' }), []);
    assert.deepEqual(await ids({ region: 'Sahel & West/Central Africa' }), ['R0365', 'R1066']);
    assert.deepEqual(await ids({ region: 'Nowhere' }), []);
    assert.deepEqual(await ids({ country: 'tcd' }), ['R1066']);
    assert.deepEqual(await ids({ country: 'RWA' }), ['R0204', 'R0365']);
    assert.deepEqual(await ids({ country: 'TC' }), [], 'an ISO code is matched whole');
    const theme = (await w.svc.listRisks(w.analyst, { q: 'honduras' }))[0].theme;
    const byTheme = await w.svc.listRisks(w.analyst, { theme });
    assert.ok(byTheme.some((r) => r.id === 'R1040'));
    assert.ok(byTheme.every((r) => r.theme === theme));
    assert.deepEqual(await ids({ q: 'rwanda', country: 'COD', region: 'East & Southern Africa' }), ['R0204'], 'filters combine');
  });

  test('listRisks is capped at 200 rows, sorted by id', async () => {
    const big = Array.from({ length: 250 }, (_, i) => ({
      id: `S${String(i).padStart(4, '0')}`, title: `Synthetic risk ${i}`, country: 'Chad', iso: 'TCD', rationale: 'Synthetic rationale.', triggerList: [],
    }));
    const w = await world({ radar: big });
    const rows = await w.svc.listRisks(w.analyst, {});
    assert.equal(rows.length, 200);
    assert.equal(rows[0].id, 'S0000');
    assert.equal(rows[199].id, 'S0199');
    assert.equal((await w.svc.listRisks(w.analyst, { q: 'synthetic' })).length, 200);
  });

  test('an unknown risk id is a 404 for staff and experts alike', async () => {
    const w = await world();
    const e = await w.enroll('identified');
    await assert.rejects(() => w.svc.getRisk(e.actor, 'R9999'), NotFoundError);
    await assert.rejects(() => w.svc.getRisk(w.mod, 'R9999'), NotFoundError);
  });

  test('a service with no radar lists nothing, 404s on get and refuses riskId, without crashing', async () => {
    const w = await worldFor(backend);
    const e = await w.enroll('identified');
    assert.deepEqual(await w.svc.listRisks(e.actor, {}), []);
    await assert.rejects(() => w.svc.getRisk(e.actor, 'R1066'), NotFoundError);
    await assert.rejects(() => w.svc.createCard(w.analyst, { ...CARD, riskId: 'R1066' }), ValidationError);
  });

  test('over HTTP: 401 without a token, the neutral view for an expert, full for staff', async () => {
    const w = await world();
    await openCardOn(w);
    const e = await w.enroll('pseudonymous');
    const server = createServer({
      service: w.svc,
      verifyStaff: async () => null,
      limits: { writesPerMinute: 10000, burstWrites: 10000 },
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    try {
      const base = `http://127.0.0.1:${server.address().port}`;
      const get = async (path, token) => {
        const res = await fetch(base + path, { headers: token ? { authorization: `Bearer ${token}` } : {} });
        return { status: res.status, text: await res.text() };
      };
      assert.equal((await get('/api/risks')).status, 401);
      assert.equal((await get('/api/risks/R1066')).status, 401);

      const list = await get('/api/risks?q=chad', e.sessionToken);
      assert.equal(list.status, 200);
      assert.equal(JSON.parse(list.text)[0].hasQuestion, true);
      assertNeutralPayload(JSON.parse(list.text), 'HTTP list');

      const detail = await get('/api/risks/R1066', e.sessionToken);
      assert.equal(detail.status, 200);
      assert.equal(JSON.parse(detail.text).view, 'neutral');
      assertNeutralPayload(JSON.parse(detail.text), 'HTTP detail');
      assert.equal((await get('/api/risks/R9999', e.sessionToken)).status, 404);

      const staff = await w.svc.createStaffSession({ id: 'an1', role: 'analyst' });
      const full = await get('/api/risks/R1066', staff);
      assert.equal(full.status, 200);
      assert.equal(JSON.parse(full.text).view, 'full');
      assert.ok(full.text.includes(enc(HIDDEN_SENTENCE)));
    } finally {
      await new Promise((r) => server.close(r));
    }
  });

  test('over HTTP: an expert with no card, or one open and one resolved, gets the clean neutral view; all resolved gets full', async () => {
    const w = await world();
    const e = await w.enroll('pseudonymous');
    const server = createServer({
      service: w.svc,
      verifyStaff: async () => null,
      limits: { writesPerMinute: 10000, burstWrites: 10000 },
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    try {
      const base = `http://127.0.0.1:${server.address().port}`;
      const detail = async () => {
        const res = await fetch(`${base}/api/risks/R1066`, { headers: { authorization: `Bearer ${e.sessionToken}` } });
        assert.equal(res.status, 200);
        return JSON.parse(await res.text());
      };
      const none = await detail();
      assert.equal(none.view, 'neutral', 'no card');
      assert.equal(none.hasQuestion, false);
      assertNeutralPayload(none, 'HTTP no card');

      const first = await openCardOn(w);
      await w.svc.resolveCard(w.mod, { cardId: first.id, outcome: 0, evidenceUrl: 'https://example.org/bulletin' });
      await openCardOn(w);
      const mixed = await detail();
      assert.equal(mixed.view, 'neutral', 'one open, one resolved');
      assert.equal(mixed.hasQuestion, true);
      assertNeutralPayload(mixed, 'HTTP one open, one resolved');

      const second = (await w.svc.listCards(w.mod)).find((c) => c.riskId === 'R1066' && c.status === 'open');
      await w.svc.resolveCard(w.mod, { cardId: second.id, outcome: 1, evidenceUrl: 'https://example.org/bulletin' });
      const full = await detail();
      assert.equal(full.view, 'full', 'all resolved');
      assert.ok(JSON.stringify(full).includes(enc(HIDDEN_SENTENCE)));
    } finally {
      await new Promise((r) => server.close(r));
    }
  });
}
