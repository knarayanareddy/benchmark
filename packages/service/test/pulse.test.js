// Pulse (what is asked this week) and the dispatch preview: who would be asked, and that the preview names no one.
import baseTest from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { BACKENDS, worldFor, CARD, DAY, many } from './helpers.js';
import { CONSENT_VERSION } from '../src/consent.js';
import { createServer } from '../src/http.js';

const blindKey = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' });
// Anything that would tell an expert or a reader of Pulse what ACAPS thinks, in any spelling.
const LEAK = /acaps|"High"|acapsP|acapsBand|0\.7/i;
// No score, no points, no minimum match, and no "outside" count in a Pulse payload. (A preview's counts do name outside.)
const NUMBERS = /"(score|pts|parts|minMatch|outside)"\s*:/;
const ids = (/** @type {{ card: { id: string } }[]} */ list) => list.map((e) => e.card.id);
const decisionOf = (/** @type {any} */ p, /** @type {string} */ id) =>
  (p.asks.some((e) => e.card.id === id) ? 'ask' : p.radar.some((e) => e.card.id === id) ? 'radar' : 'outside');
const ORDER = ['ask', 'radar', 'outside', 'answered'];

for (const backend of BACKENDS) {
  const test = (/** @type {string} */ name, /** @type {() => Promise<void>} */ fn) => baseTest(`[${backend}] ${name}`, () => fn());

  test('Pulse offers exactly the inbox\'s toAnswer: a card outside the declaration is in neither list and is not counted', async () => {
    const w = await worldFor(backend);
    const health = (await w.svc.createCard(w.analyst, CARD)).card;
    const food = (await w.svc.createCard(w.analyst, { ...CARD, theme: 'food' })).card;
    const conflict = (await w.svc.createCard(w.analyst, { ...CARD, theme: 'conflict' })).card;
    await w.svc.createCard(w.analyst, { ...CARD, country: 'KEN', region: 'East & Southern Africa' });
    const e = await w.enroll('identified', { countries: ['TCD'] });
    const tcd = [health.id, food.id, conflict.id].sort();

    // No themes declared: every TCD card is in the inbox and in Pulse. The KEN card is in neither.
    await w.svc.setProfile(e.actor, { countries: ['TCD'], regions: [], themes: [], weeklyCap: 7 });
    const p = await w.svc.pulse(e.actor);
    assert.deepEqual([...ids(p.asks), ...ids(p.radar)].sort(), tcd);
    assert.deepEqual((await w.svc.inbox(e.actor)).toAnswer.map((c) => c.id).sort(), tcd);

    // Declaring a theme narrows the strict rule: the other classified cards are not offered at all.
    await w.svc.setProfile(e.actor, { countries: ['TCD'], regions: [], themes: ['health'], weeklyCap: 7 });
    const narrowed = await w.svc.pulse(e.actor);
    assert.deepEqual([...ids(narrowed.asks), ...ids(narrowed.radar)], [health.id]);
    assert.deepEqual((await w.svc.inbox(e.actor)).toAnswer.map((c) => c.id), [health.id]);
  });

  test('a card the inbox hides never appears in Pulse: answered, or no longer Round 1', async () => {
    const w = await worldFor(backend);
    const answered = (await w.svc.createCard(w.analyst, CARD)).card;
    const revised = (await w.svc.createCard(w.analyst, { ...CARD, theme: 'food' })).card;
    const open = (await w.svc.createCard(w.analyst, { ...CARD, theme: 'conflict' })).card;
    const e = await w.enroll('identified', { countries: ['TCD'] });
    await w.svc.submitEstimate(e.actor, { cardId: answered.id, p: 0.4 });
    await w.svc.submitEstimate(e.actor, { cardId: revised.id, p: 0.4 });
    await w.svc.closeRound(w.mod, revised.id);
    await w.svc.openRound2(w.mod, revised.id);

    const box = await w.svc.inbox(e.actor);
    assert.deepEqual(box.toAnswer.map((c) => c.id), [open.id]);
    assert.equal(box.openForRevision.length, 1);
    const p = await w.svc.pulse(e.actor);
    assert.deepEqual([...ids(p.asks), ...ids(p.radar)], [open.id], 'Pulse shows only what the inbox lists as toAnswer');
    assert.equal(p.waiting.revise, 1);
  });

  test('the weekly cap: 4 matching recent cards with cap 2 give 2 asks and 2 radar, the rest explained', async () => {
    const w = await worldFor(backend);
    const e = await w.enroll('identified', { countries: ['TCD'] });
    await w.svc.setProfile(e.actor, { countries: ['TCD'], regions: [], themes: [], weeklyCap: 2 });
    for (let i = 0; i < 4; i++) await w.svc.createCard(w.analyst, { ...CARD, statement: `Cholera cases in Chad, question ${i}, will exceed 10,000.` });
    const p = await w.svc.pulse(e.actor);
    assert.equal(p.weeklyCap, 2);
    assert.equal(p.asks.length, 2);
    assert.equal(p.radar.length, 2);
    assert.ok(p.radar.every((r) => /beyond this week's cap/.test(r.reason)));
  });

  test('an older card is radar, not an ask, even under the cap', async () => {
    const w = await worldFor(backend);
    const e = await w.enroll('identified', { countries: ['TCD'] });
    await w.svc.setProfile(e.actor, { countries: ['TCD'], regions: [], themes: [], weeklyCap: 3 });
    const old = (await w.svc.createCard(w.analyst, CARD)).card;
    w.clock.now += 8 * DAY;
    const fresh = (await w.svc.createCard(w.analyst, { ...CARD, statement: 'A newer question about Chad.' })).card;
    const p = await w.svc.pulse(e.actor);
    assert.deepEqual(ids(p.asks), [fresh.id]);
    assert.deepEqual(ids(p.radar), [old.id]);
    assert.match(p.radar[0].reason, /older than a week/);
    assert.deepEqual(p.week, {
      from: new Date(w.clock.now - 7 * DAY).toISOString().slice(0, 10),
      to: new Date(w.clock.now).toISOString().slice(0, 10),
    });
  });

  test('a person who never saved a profile gets the default weekly cap of 3, and no other setting', async () => {
    const w = await worldFor(backend);
    const e = await w.enroll('identified', { countries: ['TCD'] });
    for (let i = 0; i < 4; i++) await w.svc.createCard(w.analyst, { ...CARD, statement: `Default profile question ${i}, Chad.` });
    const p = await w.svc.pulse(e.actor);
    assert.equal(p.weeklyCap, 3);
    assert.equal(p.asks.length, 3);
    assert.equal(p.radar.length, 1);
    assert.equal('minMatch' in p, false);
  });

  test('thin circle first: a card with fewer than five responses is asked before a newer, fuller one', async () => {
    const w = await worldFor(backend);
    const thin = (await w.svc.createCard(w.analyst, CARD)).card;
    w.clock.now += DAY;
    const full = (await w.svc.createCard(w.analyst, { ...CARD, statement: 'A busier question about Chad.' })).card;
    for (const c of await many(5, () => w.enroll('identified', { countries: ['TCD'] }))) {
      await w.svc.submitEstimate(c.actor, { cardId: full.id, p: 0.3 });
    }
    const e = await w.enroll('identified', { countries: ['TCD'] });
    await w.svc.setProfile(e.actor, { countries: ['TCD'], regions: [], themes: [], weeklyCap: 1 });
    const p = await w.svc.pulse(e.actor);
    assert.deepEqual(ids(p.asks), [thin.id]);
    assert.deepEqual(ids(p.radar), [full.id]);
    assert.ok(p.asks[0].why.some((x) => x.label === 'The circle needs more views'));
    assert.ok(!p.radar[0].why.some((x) => x.label === 'The circle needs more views'));
  });

  test('ties go to the newer card, then by id; why is labels only', async () => {
    const w = await worldFor(backend);
    const e = await w.enroll('identified', { countries: ['TCD'] });
    await w.svc.setProfile(e.actor, { countries: ['TCD'], regions: [], themes: ['food'], weeklyCap: 7 });
    const foodA = (await w.svc.createCard(w.analyst, { ...CARD, theme: 'food' })).card;
    const foodB = (await w.svc.createCard(w.analyst, { ...CARD, theme: 'food' })).card; // same day as foodA
    w.clock.now += DAY;
    const newest = (await w.svc.createCard(w.analyst, { ...CARD, theme: 'food', statement: 'A newer food question for Chad.' })).card;
    const p = await w.svc.pulse(e.actor);
    const [first, second] = [foodA.id, foodB.id].sort();
    assert.deepEqual(ids(p.asks), [newest.id, first, second]);
    assert.deepEqual(p.asks[0].why, [{ label: 'Covers TCD' }, { label: 'Theme match' }, { label: 'The circle needs more views' }]);
  });

  test('a card with no theme reaches a person who declared a theme; a card classified under another theme does not', async () => {
    const w = await worldFor(backend);
    const untagged = (await w.svc.createCard(w.analyst, { ...CARD, theme: null })).card;
    const health = (await w.svc.createCard(w.analyst, CARD)).card;
    const e = await w.enroll('identified', { countries: ['TCD'] });
    await w.svc.setProfile(e.actor, { countries: ['TCD'], regions: [], themes: ['food'], weeklyCap: 7 });
    const p = await w.svc.pulse(e.actor);
    assert.deepEqual([...ids(p.asks), ...ids(p.radar)], [untagged.id]);
    assert.ok(!ids(p.asks).includes(health.id));

    const pvHealth = await w.svc.previewDispatch(w.mod, { cardId: health.id });
    const row = pvHealth.rows.find((r) => r.level === 'identified');
    assert.equal(row.decision, 'outside');
    assert.deepEqual(row.why, []);
    assert.equal(row.reason, 'Outside what they declared');
    const pvUntagged = await w.svc.previewDispatch(w.mod, { cardId: untagged.id });
    assert.equal(pvUntagged.rows.find((r) => r.level === 'identified').decision, 'ask');
  });

  test('no ACAPS band or probability anywhere in a Pulse payload, and no score, points, minimum or outside count', async () => {
    const w = await worldFor(backend, { blindKey });
    const { card } = await w.svc.createCard(w.analyst, CARD);
    assert.match(JSON.stringify(card), /"High"/, 'the reading is stored, so the regex has something to find');
    const named = await w.enroll('identified');
    const anon = await w.enroll('anonymous');
    const inv = await w.svc.createInvite(w.mod, { declaration: { countries: ['TCD'] } });
    const dev = await w.svc.redeemInvite(inv.token, { level: 'anonymous', mode: 'device', consentVersion: CONSENT_VERSION });
    for (const actor of [named.actor, anon.actor, await w.svc.authenticate(dev.sessionToken)]) {
      const p = await w.svc.pulse(actor);
      assert.equal(ids([...p.asks, ...p.radar]).length, 1);
      assert.doesNotMatch(JSON.stringify(p), LEAK);
      assert.doesNotMatch(JSON.stringify(p), NUMBERS);
    }
  });

  test('a device-held expert\'s Pulse entries carry deviceHeld: true, because the server cannot see their answers', async () => {
    const w = await worldFor(backend, { blindKey });
    await w.svc.createCard(w.analyst, CARD);
    await w.svc.createCard(w.analyst, { ...CARD, statement: 'A second question about Chad.' });
    const inv = await w.svc.createInvite(w.mod, { declaration: { countries: ['TCD'] } });
    const dev = await w.svc.redeemInvite(inv.token, { level: 'anonymous', mode: 'device', consentVersion: CONSENT_VERSION });
    const actor = await w.svc.authenticate(dev.sessionToken);
    const p = await w.svc.pulse(actor);
    assert.equal(p.deviceMode, true);
    const entries = [...p.asks, ...p.radar];
    assert.equal(entries.length, 2);
    assert.ok(entries.every((x) => x.card.deviceHeld === true));
  });

  test('Pulse is for experts only: staff are refused with 403', async () => {
    const w = await worldFor(backend);
    await assert.rejects(w.svc.pulse(w.mod), { status: 403 });
    await assert.rejects(w.svc.pulse(w.analyst), { status: 403 });
  });

  test('preview: a draft names no one; rows carry only label, level, why, decision and reason; sorted by decision then label', async () => {
    const w = await worldFor(backend, { blindKey });
    const { card } = await w.svc.createCard(w.analyst, CARD);
    const named = await w.enroll('identified', { name: 'Ada Named' });
    await w.svc.setProfile(named.actor, { organisation: 'Zanzibar Relief Co', roleType: 'local_ngo', countries: ['TCD'], regions: [], themes: ['health'] });
    await w.enroll('pseudonymous', { countries: ['TCD'] });
    await w.enroll('anonymous');
    const inv = await w.svc.createInvite(w.mod, { declaration: { countries: ['TCD'] } });
    await w.svc.redeemInvite(inv.token, { level: 'anonymous', mode: 'device', consentVersion: CONSENT_VERSION });

    const pv = await w.svc.previewDispatch(w.mod, { cardId: card.id });
    const json = JSON.stringify(pv);
    for (const ex of await w.roster.experts.all()) assert.ok(!json.includes(ex.id), 'no expert id');
    assert.doesNotMatch(json, /ex_|id:|bt:/, 'no expert id, respondent key or key shape');
    assert.ok(!json.includes('Zanzibar'), 'no organisation');
    assert.ok(!json.includes('local_ngo') && !json.includes('Local NGO'), 'no role type');
    assert.doesNotMatch(json, LEAK);
    assert.doesNotMatch(JSON.stringify({ ...pv, counts: undefined }), NUMBERS);
    assert.equal(pv.rows.length, 4);
    for (const r of pv.rows) assert.deepEqual(Object.keys(r).sort(), ['decision', 'label', 'level', 'reason', 'why']);
    assert.ok(pv.rows.some((r) => r.label === 'Ada Named'));
    const anonRows = pv.rows.filter((r) => r.level === 'anonymous');
    assert.equal(anonRows.length, 2);
    assert.ok(anonRows.every((r) => r.label === 'Anonymous expert'));
    const order = pv.rows.map((r) => [ORDER.indexOf(r.decision), r.label]);
    assert.deepEqual(order, [...order].sort((a, b) => (a[0] - b[0]) || (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0)));
  });

  test('preview: a draft is validated (ISO country, known region and theme) and both or neither of cardId and draft is refused', async () => {
    const w = await worldFor(backend);
    const { card } = await w.svc.createCard(w.analyst, CARD);
    await w.enroll('identified');
    await assert.rejects(w.svc.previewDispatch(w.mod, {}), { status: 400 });
    await assert.rejects(w.svc.previewDispatch(w.mod, { cardId: card.id, draft: { country: 'TCD' } }), { status: 400 });
    await assert.rejects(w.svc.previewDispatch(w.mod, { draft: { country: 'TC' } }), { status: 400 });
    await assert.rejects(w.svc.previewDispatch(w.mod, { draft: { country: 'TCD', region: 'Mars' } }), { status: 400 });
    await assert.rejects(w.svc.previewDispatch(w.mod, { draft: { country: 'TCD', theme: 'space' } }), { status: 400 });
    await assert.rejects(w.svc.previewDispatch(w.mod, { draft: { country: 'TCD', region: 5 } }), { status: 400 });
    const ok = await w.svc.previewDispatch(w.mod, { draft: { country: 'tcd', region: '', theme: '' } });
    assert.deepEqual(ok.card, { id: null, country: 'TCD', region: null, theme: null });
  });

  test('preview: staff who are not moderators are refused; a cardId must be open in Round 1', async () => {
    const w = await worldFor(backend);
    const { card } = await w.svc.createCard(w.analyst, CARD);
    const e = await w.enroll('identified');
    await assert.rejects(w.svc.previewDispatch(w.analyst, { cardId: card.id }), { status: 403 });
    await assert.rejects(w.svc.previewDispatch(e.actor, { cardId: card.id }), { status: 403 });
    await w.svc.closeRound(w.mod, card.id);
    await assert.rejects(w.svc.previewDispatch(w.mod, { cardId: card.id }), { status: 409 });
  });

  test('consistency: every keyed expert\'s preview decision equals their own Pulse placement; answered only for keyed experts', async () => {
    const w = await worldFor(backend, { blindKey });
    // The oldest card: a cap of one pushes it to radar for anyone who has newer matches.
    const main = (await w.svc.createCard(w.analyst, CARD)).card;
    w.clock.now += DAY;
    await w.svc.createCard(w.analyst, { ...CARD, theme: 'food' });
    await w.svc.createCard(w.analyst, { ...CARD, theme: 'food', statement: 'Food prices in Chad will rise.' });
    // Newest, and not in Chad: no expert declared Kenya, so it must not take a place in anyone's cap.
    await w.svc.createCard(w.analyst, { ...CARD, country: 'KEN', region: 'East & Southern Africa', statement: 'Cholera in Kenya will rise.' });
    const decl = (themes, extra = {}) => ({ countries: ['TCD'], regions: [], themes, weeklyCap: 3, ...extra });
    const golf = await w.enroll('identified', { name: 'Golf Expert', countries: ['TCD'] });
    await w.svc.setProfile(golf.actor, decl(['health'], { weeklyCap: 1 }));
    const alpha = await w.enroll('identified', { name: 'Alpha Expert', countries: ['TCD'] });
    await w.svc.setProfile(alpha.actor, decl([], { weeklyCap: 1 }));
    const bravo = await w.enroll('identified', { name: 'Bravo Expert', countries: ['TCD'] });
    await w.svc.setProfile(bravo.actor, decl(['food'], { weeklyCap: 1 }));
    const charlie = await w.enroll('identified', { name: 'Charlie Expert', countries: ['TCD'] });
    await w.svc.setProfile(charlie.actor, decl(['food']));
    const delta = await w.enroll('identified', { name: 'Delta Expert', countries: ['TCD'] });
    await w.svc.submitEstimate(delta.actor, { cardId: main.id, p: 0.4 });
    const echo = await w.enroll('pseudonymous', { countries: ['TCD'] });
    await w.svc.submitDissent(echo.actor, { cardId: main.id, kind: 'two_risks', text: 'two' });
    const echoLabel = (await w.roster.aliases.find({ expertId: echo.expertId, country: 'TCD' }))[0].alias;
    const foxtrot = await w.enroll('anonymous', { countries: ['TCD'] });
    await w.svc.submitEstimate(foxtrot.actor, { cardId: main.id, p: 0.4 });

    const pv = await w.svc.previewDispatch(w.mod, { cardId: main.id });
    const byLabel = new Map(pv.rows.map((r) => [r.label, r]));
    // `reported` is what the preview must say for someone who answered: keyed experts see "answered"; a service-held
    // anonymous expert is reported "outside", so their answer is not revealed.
    const keyed = [
      { label: 'Alpha Expert', actor: alpha.actor, answered: false },
      { label: 'Bravo Expert', actor: bravo.actor, answered: false },
      { label: 'Charlie Expert', actor: charlie.actor, answered: false },
      { label: 'Delta Expert', actor: delta.actor, answered: true, reported: 'answered' },
      { label: echoLabel, actor: echo.actor, answered: false },
      { label: 'Golf Expert', actor: golf.actor, answered: false },
      { label: 'Anonymous expert', actor: foxtrot.actor, answered: true, reported: 'outside' },
    ];
    for (const k of keyed) {
      const own = await w.svc.pulse(k.actor);
      const expected = k.answered ? k.reported : decisionOf(own, main.id);
      assert.equal(byLabel.get(k.label)?.decision, expected, k.label);
      if (k.answered) assert.equal(decisionOf(own, main.id), 'outside', `${k.label}: their own Pulse does not offer the answered card`);
    }
    // The test only means something if every decision occurs.
    const seen = new Set(pv.rows.map((r) => r.decision));
    for (const d of ['ask', 'radar', 'outside', 'answered']) assert.ok(seen.has(d), `${d} occurs`);
    // The one anonymous expert in this world answered, so the preview reports them outside, never answered.
    const anonRow = pv.rows.find((r) => r.level === 'anonymous');
    assert.equal(anonRow.label, 'Anonymous expert');
    assert.equal(anonRow.decision, 'outside');
    assert.equal(pv.counts.answered, 1);
    assert.equal(pv.counts.ask + pv.counts.radar + pv.counts.outside + pv.counts.answered, pv.rows.length);
  });

  test('preview writes nothing: no audit row, no alias created for a pseudonymous expert who would match', async () => {
    const w = await worldFor(backend);
    await w.enroll('pseudonymous', { countries: ['TCD'] });
    await w.enroll('identified', { name: 'Echo Expert', countries: ['TCD'] });
    const auditBefore = (await w.svc.readAudit(w.mod)).length;
    const aliasesBefore = (await w.roster.aliases.find({})).length;
    const pv = await w.svc.previewDispatch(w.mod, { draft: { country: 'TCD', region: '', theme: 'health' } });
    await w.svc.previewDispatch(w.mod, { draft: { country: 'KEN', region: 'East & Southern Africa', theme: '' } });
    const row = pv.rows.find((r) => r.level === 'pseudonymous');
    assert.equal(row.label, 'Pseudonymous expert', 'no alias yet, so the fallback label, and none is made');
    assert.equal(row.decision, 'ask');
    assert.equal((await w.svc.readAudit(w.mod)).length, auditBefore);
    assert.equal((await w.roster.aliases.find({})).length, aliasesBefore);
  });

  test('the dispatch preview and Pulse are wired on HTTP, with the same privacy and refusals', async () => {
    const w = await worldFor(backend);
    const server = createServer({
      service: w.svc,
      verifyStaff: async (_req, body) => (body.credential === 'mod-ok' ? { id: 'mod1', role: 'moderator' }
        : body.credential === 'an-ok' ? { id: 'an1', role: 'analyst' } : null),
      limits: { writesPerMinute: 10000, burstWrites: 10000 },
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const base = `http://127.0.0.1:${server.address().port}`;
    const call = async (/** @type {string} */ method, /** @type {string} */ path, /** @type {{ token?: string, body?: unknown }} */ { token, body } = {}) => {
      const res = await fetch(base + path, {
        method,
        headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const text = await res.text();
      return { status: res.status, json: text ? JSON.parse(text) : null };
    };
    try {
      const mod = (await call('POST', '/api/staff/session', { body: { credential: 'mod-ok' } })).json.sessionToken;
      const an = (await call('POST', '/api/staff/session', { body: { credential: 'an-ok' } })).json.sessionToken;
      const { card } = await w.svc.createCard(w.analyst, CARD);
      const e = await w.enroll('identified', { name: 'Http Expert', countries: ['TCD'] });

      const p = await call('GET', '/api/pulse', { token: e.sessionToken });
      assert.equal(p.status, 200);
      assert.deepEqual(ids([...p.json.asks, ...p.json.radar]), [card.id]);
      assert.doesNotMatch(JSON.stringify(p.json), LEAK);
      assert.doesNotMatch(JSON.stringify(p.json), NUMBERS);
      assert.equal((await call('GET', '/api/pulse')).status, 401);
      assert.equal((await call('GET', '/api/pulse', { token: mod })).status, 403);

      const pv = await call('POST', '/api/staff/dispatch/preview', { token: mod, body: { cardId: card.id } });
      assert.equal(pv.status, 200);
      assert.equal(pv.json.rows[0].label, 'Http Expert');
      assert.equal((await call('POST', '/api/staff/dispatch/preview', { token: mod, body: { draft: { country: 'TCD' } } })).status, 200);
      assert.equal((await call('POST', '/api/staff/dispatch/preview', { token: an, body: { cardId: card.id } })).status, 403);
      assert.equal((await call('POST', '/api/staff/dispatch/preview', { token: e.sessionToken, body: { cardId: card.id } })).status, 403);
      assert.equal((await call('POST', '/api/staff/dispatch/preview', { token: mod, body: {} })).status, 400);
      assert.equal((await call('POST', '/api/staff/dispatch/preview', { token: mod, body: { cardId: card.id, draft: { country: 'TCD' } } })).status, 400);
    } finally {
      await new Promise((r) => server.close(r));
    }
  });
}
