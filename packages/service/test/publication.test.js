import baseTest from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { ACTION } from '@benchmark/domain/dissent';
import { COOLING_OFF_MS } from '@benchmark/core/publication';
import { createServer } from '../src/http.js';
import { CONSENT_VERSION } from '../src/consent.js';
import { BACKENDS, worldFor, CARD } from './helpers.js';

const blindKey = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' });

// What the author wrote. The markers let the leak checks find it in any stored or returned payload.
const TEXT = 'The rainy season will cut the road to the district before the window opens.';
const HINT = 'I am the WFP country director in Juba';
const NAME = 'Dr Amina Ali';
const ORG = 'WFP';
const FULL = { noThirdParties: true, noLocationDetail: true, riskUnderstood: true };
const NAMED = { decision: 'credited', text: TEXT, displayName: NAME, organisation: ORG, acknowledgedRisk: true };
const UNCREDITED = { decision: 'uncredited', text: TEXT };
const KEN_CARD = { ...CARD, country: 'KEN', statement: 'Cholera cases in Kenya will exceed 10,000 by 30 April 2027.' };
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const DB_KEYS = ['cardId', 'day', 'expertId', 'id', 'proposer', 'reviewer', 'sourceId', 'sourceKind', 'status', 'version'];

/** The message and status of a refusal, as the transport sees it. */
const refused = (status, re) => (e) => e.status === status && re.test(e.message);

for (const backend of BACKENDS) {
  const test = (name, fn) => baseTest(`[${backend}] ${name}`, () => fn());
  // Only the Postgres backends have the database CHECK, so only they can prove it.
  const dbTest = (name, fn) => (backend === 'memory' ? null : baseTest(`[${backend}] ${name}`, () => fn()));

  const world = async () => {
    const w = await worldFor(backend, { blindKey });
    w.mod2 = await w.svc.authenticate(await w.svc.createStaffSession({ id: 'mod2', role: 'moderator' }));
    return w;
  };
  const openCard = async (w, input = CARD) => (await w.svc.createCard(w.analyst, input)).card;

  /** An objection routed and actioned by an analyst, whatever the author's level. */
  async function actionedDissent(w, expert, card, text = TEXT) {
    const { id, version } = await w.svc.submitDissent(expert.actor, { cardId: card.id, kind: 'window', text });
    await w.svc.routeDissent(w.analyst, id, { expectedVersion: version });
    await w.svc.actDissent(w.analyst, id, { expectedVersion: version + 1, action: ACTION.RESOLVE_EARLY, note: 'n' });
    return id;
  }

  /** A keyed post, written straight into the answers store in the documented shape. */
  async function postRow(w, card, respondentKey, { status = 'approved', text = TEXT } = {}) {
    const id = `p_${crypto.randomUUID()}`;
    await w.answers.thread_posts.insert(id, {
      id, cardId: card.id, respondentKey, status, kind: 'claim', parentId: null, label: 'Participant 1',
      text, participant: null, at: Date.UTC(2026, 10, 7), note: null, version: 0,
    });
    return id;
  }

  /** Proposed from an actioned objection by the proposing moderator. */
  async function offer(w, expert, card, text = TEXT) {
    const dissentId = await actionedDissent(w, expert, card, text);
    return (await w.svc.propose(w.mod, { sourceKind: 'dissent', sourceId: dissentId })).id;
  }

  const approve = (w, id) => w.svc.review(w.mod2, id, { approve: true, checked: FULL });

  /** Through every stage to published, with the cooling-off period run out on the injected clock. */
  async function publishedItem(w, expert, card, credit = NAMED) {
    const id = await offer(w, expert, card);
    await w.svc.respond(expert.actor, id, credit);
    await approve(w, id);
    w.clock.now += COOLING_OFF_MS;
    await w.svc.publish(w.mod, id);
    return id;
  }

  // ── rule 1: no consent, no publication ──────────────────────────────────
  test('rule 1: only an actioned objection, or an approved post by a keyed expert, can be offered', async () => {
    const w = await world();
    const card = await openCard(w);
    const named = await w.enroll('identified', { name: NAME });

    const open = await w.svc.submitDissent(named.actor, { cardId: card.id, kind: 'window', text: TEXT });
    await assert.rejects(w.svc.propose(w.mod, { sourceKind: 'dissent', sourceId: open.id }), refused(409, /only an actioned objection/));

    const routed = await w.svc.submitDissent(named.actor, { cardId: card.id, kind: 'window', text: TEXT });
    await w.svc.routeDissent(w.analyst, routed.id, { expectedVersion: routed.version });
    await assert.rejects(w.svc.propose(w.mod, { sourceKind: 'dissent', sourceId: routed.id }), refused(409, /only an actioned objection/));

    const pending = await postRow(w, card, `id:${named.expertId}`, { status: 'pending' });
    await assert.rejects(w.svc.propose(w.mod, { sourceKind: 'post', sourceId: pending }), refused(409, /only an approved discussion post/));
    const rejected = await postRow(w, card, `id:${named.expertId}`, { status: 'rejected' });
    await assert.rejects(w.svc.propose(w.mod, { sourceKind: 'post', sourceId: rejected }), refused(409, /only an approved discussion post/));

    // Both live states of an actioned objection are offerable, not only the first.
    const acted = await actionedDissent(w, named, card);
    await w.svc.notifyDissent(w.analyst, acted, { expectedVersion: 2 });
    assert.equal((await w.svc.propose(w.mod, { sourceKind: 'dissent', sourceId: acted })).status, 'proposed');
    const ok = await postRow(w, card, `id:${named.expertId}`);
    assert.equal((await w.svc.propose(w.mod, { sourceKind: 'post', sourceId: ok })).status, 'proposed');
  });

  test('rule 1: an anonymous or device-held author cannot be offered credit, whatever the source', async () => {
    const w = await world();
    const card = await openCard(w);
    const anon = await w.enroll('anonymous');
    const anonDissent = await actionedDissent(w, anon, card);
    await assert.rejects(w.svc.propose(w.mod, { sourceKind: 'dissent', sourceId: anonDissent }), refused(409, /anonymous objection/));

    const serviceHeld = await postRow(w, card, `bt:${crypto.randomBytes(32).toString('hex')}`);
    await assert.rejects(w.svc.propose(w.mod, { sourceKind: 'post', sourceId: serviceHeld }), refused(409, /anonymous or device-held/));
    const bare = await postRow(w, card, crypto.randomBytes(32).toString('hex'));
    await assert.rejects(w.svc.propose(w.mod, { sourceKind: 'post', sourceId: bare }), refused(409, /anonymous or device-held/));

    const inv = await w.svc.createInvite(w.mod, { declaration: { countries: ['TCD'] } });
    const device = await w.svc.redeemInvite(inv.token, { level: 'anonymous', mode: 'device', consentVersion: CONSENT_VERSION });
    const deviceKey = await postRow(w, card, `id:${device.expertId}`);
    await assert.rejects(w.svc.propose(w.mod, { sourceKind: 'post', sourceId: deviceKey }), refused(409, /cannot consent/));
  });

  test('one publication per source: a second proposal of the same objection or post is refused', async () => {
    const w = await world();
    const card = await openCard(w);
    const named = await w.enroll('identified', { name: NAME });
    const dissentId = await actionedDissent(w, named, card);
    await w.svc.propose(w.mod, { sourceKind: 'dissent', sourceId: dissentId });
    await assert.rejects(w.svc.propose(w.mod, { sourceKind: 'dissent', sourceId: dissentId }), refused(409, /already been offered/));
    const post = await postRow(w, card, `id:${named.expertId}`);
    await w.svc.propose(w.mod, { sourceKind: 'post', sourceId: post });
    await assert.rejects(w.svc.propose(w.mod, { sourceKind: 'post', sourceId: post }), refused(409, /already been offered/));
  });

  test('propose creates a proposed item holding the original text, and nothing is public yet', async () => {
    const w = await world();
    const card = await openCard(w);
    const named = await w.enroll('identified', { name: NAME });
    const id = await offer(w, named, card);
    const [row] = (await w.svc.listForStaff(w.mod)).filter((p) => p.id === id);
    assert.equal(row.status, 'proposed');
    assert.equal(row.text, TEXT);
    assert.equal(row.creditMode, null);
    assert.equal(row.displayName, null);
    assert.deepEqual(await w.svc.listPublic(), []);
  });

  test('proposing needs publication.propose: an analyst and an expert are refused', async () => {
    const w = await world();
    const card = await openCard(w);
    const named = await w.enroll('identified', { name: NAME });
    const dissentId = await actionedDissent(w, named, card);
    await assert.rejects(w.svc.propose(w.analyst, { sourceKind: 'dissent', sourceId: dissentId }), refused(403, /may not publication\.propose/));
    await assert.rejects(w.svc.propose(named.actor, { sourceKind: 'dissent', sourceId: dissentId }), refused(403, /may not publication\.propose/));
  });

  // ── rule 2 and 3: the author's choice ───────────────────────────────────
  test('only the author can respond, and only from proposed', async () => {
    const w = await world();
    const card = await openCard(w);
    const author = await w.enroll('identified', { name: NAME });
    const other = await w.enroll('pseudonymous', { name: 'Other' });
    const id = await offer(w, author, card);
    await assert.rejects(w.svc.respond(other.actor, id, UNCREDITED), refused(403, /only the author/));
    await assert.rejects(w.svc.respond(w.analyst, id, UNCREDITED), refused(403, /may not publication\.respond/));
    await assert.rejects(w.svc.respond(w.mod, id, UNCREDITED), refused(403, /may not publication\.respond/));
    assert.deepEqual(await w.svc.respond(author.actor, id, NAMED), { id, status: 'consented' });
    await assert.rejects(w.svc.respond(author.actor, id, UNCREDITED), refused(409, /not proposed/));
  });

  test('uncredited text with an identifying hint is refused; credited text may name a role', async () => {
    const w = await world();
    const card = await openCard(w, KEN_CARD);
    const author = await w.enroll('identified', { name: NAME });
    const id = await offer(w, author, card, HINT);
    await assert.rejects(w.svc.respond(author.actor, id, { decision: 'uncredited', text: HINT }), refused(400, /identify you/));
    assert.deepEqual(await w.svc.respond(author.actor, id, { decision: 'credited', text: HINT, displayName: NAME, organisation: ORG }), { id, status: 'consented' });
    const [row] = (await w.svc.listForStaff(w.mod)).filter((p) => p.id === id);
    assert.equal(row.text, HINT);
    assert.equal(row.creditMode, 'credited');
    assert.equal(row.displayName, NAME);
  });

  test('display name and organisation limits are enforced, and the problems come back in one error', async () => {
    const w = await world();
    const card = await openCard(w, KEN_CARD);
    const author = await w.enroll('identified', { name: NAME });
    const id = await offer(w, author, card);
    await assert.rejects(w.svc.respond(author.actor, id, { decision: 'credited', text: TEXT, displayName: 'A' }), (e) => (
      e.status === 400 && /^cannot save:/.test(e.message) && e.problems.some((p) => /displayName/.test(p))
    ));
    await assert.rejects(w.svc.respond(author.actor, id, { decision: 'credited', text: TEXT, displayName: 'Ab', organisation: 'o'.repeat(121) }), refused(400, /organisation/));
  });

  test('a credited choice in a sensitive country (TCD) needs acknowledgedRisk; a non-listed country (KEN) does not', async () => {
    const w = await world();
    const tcd = await openCard(w);
    const ken = await openCard(w, KEN_CARD);
    const author = await w.enroll('identified', { name: NAME });
    const inTcd = await offer(w, author, tcd);
    await assert.rejects(w.svc.respond(author.actor, inTcd, { decision: 'credited', text: TEXT, displayName: NAME }), refused(400, /acknowledgedRisk/));
    assert.equal((await w.svc.respond(author.actor, inTcd, { ...NAMED, acknowledgedRisk: true })).status, 'consented');
    const inKen = await offer(w, author, ken);
    assert.equal((await w.svc.respond(author.actor, inKen, { decision: 'credited', text: TEXT, displayName: NAME })).status, 'consented');
  });

  test('declining erases the text and the credit at once', async () => {
    const w = await world();
    const card = await openCard(w);
    const author = await w.enroll('identified', { name: NAME });
    const id = await offer(w, author, card);
    assert.deepEqual(await w.svc.respond(author.actor, id, { decision: 'decline' }), { id, status: 'declined' });
    const raw = await w.roster.publications.get(id);
    assert.equal(raw.status, 'declined');
    assert.doesNotMatch(JSON.stringify(raw), /rainy season|Amina|WFP/);
    assert.equal(raw.text, undefined);
    assert.equal(raw.credit, undefined);
  });

  // ── rule 5: a different moderator reviews ───────────────────────────────
  test('the proposer cannot review; a different moderator can; analysts cannot review', async () => {
    const w = await world();
    const card = await openCard(w);
    const author = await w.enroll('identified', { name: NAME });
    const id = await offer(w, author, card);
    await w.svc.respond(author.actor, id, UNCREDITED);
    await assert.rejects(w.svc.review(w.mod, id, { approve: true, checked: FULL }), refused(403, /second moderator must/));
    await assert.rejects(w.svc.review(w.analyst, id, { approve: true, checked: FULL }), refused(403, /may not publication\.review/));
    assert.deepEqual(await w.svc.review(w.mod2, id, { approve: true, checked: FULL }), { id, status: 'approved' });
  });

  dbTest('the database refuses a row whose reviewer is its proposer, even if the service check is bypassed', async () => {
    const w = await world();
    const card = await openCard(w);
    const author = await w.enroll('identified', { name: NAME });
    const id = await offer(w, author, card);
    await w.svc.respond(author.actor, id, UNCREDITED);
    const row = await w.roster.publications.get(id);
    await assert.rejects(w.roster.publications.update(id, row.version, { ...row, reviewer: row.proposer, version: row.version + 1 }), (e) => e.code === '23514');
    assert.equal((await w.roster.publications.get(id)).reviewer, null);
  });

  test('approval needs all three checklist items; rejection needs a note; the rejection is final', async () => {
    const w = await world();
    const card = await openCard(w);
    const author = await w.enroll('identified', { name: NAME });
    const id = await offer(w, author, card);
    await w.svc.respond(author.actor, id, UNCREDITED);
    await assert.rejects(w.svc.review(w.mod2, id, { approve: true, checked: { ...FULL, riskUnderstood: false } }), refused(400, /riskUnderstood/));
    await assert.rejects(w.svc.review(w.mod2, id, { approve: false, note: '' }), refused(400, /needs a note/));
    assert.deepEqual(await w.svc.review(w.mod2, id, { approve: false, note: 'names the district' }), { id, status: 'rejected' });
    await assert.rejects(approve(w, id), refused(409, /not consented/));
    assert.deepEqual((await w.svc.listForStaff(w.mod)).find((p) => p.id === id).status, 'rejected');
    // Rejected means never published: the author's words are not kept, but they can still read why.
    const dump = JSON.stringify(await w.roster.publications.get(id));
    for (const kept of [TEXT, NAME]) assert.ok(!dump.includes(kept), `${kept} must be erased on rejection`);
    assert.equal((await w.svc.inbox(author.actor)).publications.find((p) => p.id === id).note, 'names the district');
  });

  // ── rule 6: cooling-off and publish ─────────────────────────────────────
  test('cooling-off: publish is refused before the 48 hours end and allowed after', async () => {
    const w = await world();
    const card = await openCard(w);
    const author = await w.enroll('identified', { name: NAME });
    const id = await offer(w, author, card);
    await w.svc.respond(author.actor, id, NAMED);
    await approve(w, id);
    await assert.rejects(w.svc.publish(w.mod, id), refused(409, /cooling-off/));
    w.clock.now += COOLING_OFF_MS - 1;
    await assert.rejects(w.svc.publish(w.mod, id), refused(409, /cooling-off/));
    w.clock.now += 1;
    assert.deepEqual(await w.svc.publish(w.mod, id), { id, status: 'published' });
    assert.equal((await w.roster.publications.get(id)).day, new Date(w.clock.now).toISOString().slice(0, 10));
  });

  test('publish needs publication.publish, and needs the item approved first', async () => {
    const w = await world();
    const card = await openCard(w);
    const author = await w.enroll('identified', { name: NAME });
    const id = await offer(w, author, card);
    await assert.rejects(w.svc.publish(w.mod, id), refused(409, /not approved/));
    await w.svc.respond(author.actor, id, UNCREDITED);
    await approve(w, id);
    w.clock.now += COOLING_OFF_MS;
    await assert.rejects(w.svc.publish(w.analyst, id), refused(403, /may not publication\.publish/));
  });

  // ── rule 7: withdrawal erases ───────────────────────────────────────────
  test('withdrawal from every live state erases the text, the credit and the statement, leaving only the keys the database needs', async () => {
    const w = await world();
    const card = await openCard(w);
    const author = await w.enroll('identified', { name: NAME });
    const proposed = await offer(w, author, card);
    const consented = await offer(w, author, card);
    await w.svc.respond(author.actor, consented, NAMED);
    const approved = await offer(w, author, card);
    await w.svc.respond(author.actor, approved, NAMED);
    await approve(w, approved);
    const published = await offer(w, author, card);
    await w.svc.respond(author.actor, published, NAMED);
    await approve(w, published);
    w.clock.now += COOLING_OFF_MS;
    await w.svc.publish(w.mod, published);
    assert.equal((await w.svc.listPublic()).length, 1);

    for (const id of [proposed, consented, approved, published]) {
      assert.deepEqual(await w.svc.withdraw(author.actor, id), { id, status: 'withdrawn' });
    }
    assert.deepEqual(await w.svc.listPublic(), [], 'a withdrawn item leaves the public list at once');

    for (const id of [proposed, consented, approved, published]) {
      const raw = await w.roster.publications.get(id);
      assert.equal(raw.status, 'withdrawn');
      assert.match(raw.day, DATE);
      assert.deepEqual(Object.keys(raw).sort(), DB_KEYS);
    }
    // The whole table, every row: none of the author's words, name or organisation survives.
    const dump = JSON.stringify(await w.roster.publications.all());
    for (const secret of [TEXT, NAME, 'Amina', ORG, card.statement]) assert.ok(!dump.includes(secret), `${secret} must be erased`);
  });

  // ── rule 9: the public view ─────────────────────────────────────────────
  test('listPublic returns exactly { id, text, creditLine, cardStatement, country, day }, day-coarse, and nothing that identifies the process', async () => {
    const w = await world();
    const card = await openCard(w);
    const author = await w.enroll('identified', { name: NAME });
    const other = await w.enroll('pseudonymous', { name: 'Second' });
    await publishedItem(w, author, card, NAMED);
    await publishedItem(w, other, card, UNCREDITED);
    const list = await w.svc.listPublic();
    assert.equal(list.length, 2);
    for (const item of list) {
      assert.deepEqual(Object.keys(item).sort(), ['cardStatement', 'country', 'creditLine', 'day', 'id', 'text']);
      assert.match(item.day, DATE);
    }
    // Published on the days the clock stood at 48 and 96 hours after the start: day-coarse, nothing finer.
    assert.deepEqual(list.map((p) => p.day).sort(), ['2026-11-09', '2026-11-11']);
    const credited = list.find((p) => p.text === TEXT && p.creditLine !== null);
    assert.equal(credited.creditLine, `${NAME}, ${ORG}`);
    assert.equal(list.filter((p) => p.creditLine === null).length, 1, 'an uncredited item has no credit line');
    const dump = JSON.stringify(list);
    for (const forbidden of [author.expertId, other.expertId, 'mod1', 'mod2', 'proposer', 'reviewer', 'round', 'status', 'version', 'sourceId', 'expertId']) {
      assert.ok(!dump.includes(forbidden), `public list must not contain ${forbidden}`);
    }
  });

  test('a credit line without an organisation is the name alone', async () => {
    const w = await world();
    const card = await openCard(w);
    const author = await w.enroll('identified', { name: NAME });
    await publishedItem(w, author, card, { ...NAMED, organisation: '' });
    assert.deepEqual((await w.svc.listPublic()).map((p) => p.creditLine), [NAME]);
  });

  // ── staff and expert views ──────────────────────────────────────────────
  test('listForStaff never exposes an expert id, and shows a display name only for credited items', async () => {
    const w = await world();
    const card = await openCard(w);
    const author = await w.enroll('identified', { name: NAME });
    const credited = await offer(w, author, card);
    await w.svc.respond(author.actor, credited, NAMED);
    const uncredited = await offer(w, author, card);
    await w.svc.respond(author.actor, uncredited, UNCREDITED);
    const rows = await w.svc.listForStaff(w.mod);
    assert.equal(rows.length, 2);
    assert.ok(!JSON.stringify(rows).includes(author.expertId), 'no expert id on the staff list');
    assert.equal(rows.find((r) => r.id === credited).displayName, NAME);
    const quiet = rows.find((r) => r.id === uncredited);
    assert.equal(quiet.displayName, null);
    assert.equal(quiet.creditMode, 'uncredited');
    assert.deepEqual(Object.keys(quiet).sort(), ['cardId', 'country', 'creditMode', 'displayName', 'id', 'proposer', 'publishAfter', 'reviewer', 'sourceKind', 'status', 'text', 'version']);
  });

  test('the author sees only their own live items through the inbox; declined and withdrawn items are gone', async () => {
    const w = await world();
    const card = await openCard(w);
    const a = await w.enroll('identified', { name: NAME });
    const b = await w.enroll('pseudonymous', { name: 'Second' });
    const live = await offer(w, a, card);
    const declined = await offer(w, a, card);
    await w.svc.respond(a.actor, declined, { decision: 'decline' });
    const withdrawn = await offer(w, a, card);
    await w.svc.respond(a.actor, withdrawn, UNCREDITED);
    await w.svc.withdraw(a.actor, withdrawn);
    const theirs = await offer(w, b, card);

    const mine = (await w.svc.inbox(a.actor)).publications;
    assert.deepEqual(mine.map((p) => p.id), [live]);
    assert.deepEqual(Object.keys(mine[0]).sort(), ['cardStatement', 'credit', 'id', 'note', 'originalText', 'publishAfter', 'sensitive', 'status', 'text']);
    assert.equal(mine[0].status, 'proposed');
    assert.deepEqual((await w.svc.inbox(b.actor)).publications.map((p) => p.id), [theirs]);
  });

  test('the author can see the reviewer\'s rejection note; nobody else can', async () => {
    const w = await world();
    const card = await openCard(w);
    const a = await w.enroll('identified', { name: NAME });
    const id = await offer(w, a, card);
    await w.svc.respond(a.actor, id, UNCREDITED);
    await w.svc.review(w.mod2, id, { approve: false, note: 'mentions a named district' });
    const [mine] = (await w.svc.inbox(a.actor)).publications;
    assert.equal(mine.status, 'rejected');
    assert.equal(mine.note, 'mentions a named district');
    assert.doesNotMatch(JSON.stringify(await w.svc.listPublic()), /mentions a named district/);
  });

  // ── rule 8: erase and export ────────────────────────────────────────────
  test('exportMe includes the publications; eraseMe removes all of them and no one else\'s', async () => {
    const w = await world();
    const card = await openCard(w);
    const a = await w.enroll('identified', { name: NAME });
    const b = await w.enroll('pseudonymous', { name: 'Second' });
    const aPub = await offer(w, a, card);
    await w.svc.respond(a.actor, aPub, NAMED);
    const bPub = await offer(w, b, card);

    const exported = await w.svc.exportMe(a.actor);
    assert.deepEqual(exported.publications.map((p) => p.id), [aPub]);
    assert.equal(exported.publications[0].text, TEXT);
    assert.equal(exported.publications[0].credit.displayName, NAME);

    await w.svc.eraseMe(a.actor);
    assert.equal(await w.roster.publications.get(aPub), undefined);
    assert.ok(await w.roster.publications.get(bPub), 'another expert\'s item is untouched');
  });

  // ── rule 10: audit ──────────────────────────────────────────────────────
  test('every transition writes an audit row naming the publication and no text, name or expert', async () => {
    const w = await world();
    const card = await openCard(w);
    const author = await w.enroll('identified', { name: NAME });
    const id = await offer(w, author, card);
    await w.svc.respond(author.actor, id, NAMED);
    await approve(w, id);
    w.clock.now += COOLING_OFF_MS;
    await w.svc.publish(w.mod, id);
    await w.svc.withdraw(author.actor, id);

    const rows = (await w.svc.readAudit(w.mod)).filter((r) => r.target === id);
    assert.deepEqual(rows.map((r) => r.action), ['publication.propose', 'publication.consent', 'publication.approve', 'publication.publish', 'publication.withdraw']);
    const dump = JSON.stringify(rows);
    for (const secret of [TEXT, 'Amina', ORG, author.expertId]) assert.ok(!dump.includes(secret), `the audit log must not contain ${secret}`);
    assert.ok(rows.every((r) => r.reason === ''), 'no reason text either');
    assert.notEqual(rows[1].actorId, author.expertId, 'the expert is named in the log only by a hash');
  });

  // ── concurrency ─────────────────────────────────────────────────────────
  test('compare-and-set: two transitions racing from the same version, exactly one wins and the other is a conflict', async () => {
    const w = await world();
    const card = await openCard(w);
    const author = await w.enroll('identified', { name: NAME });
    const id = await offer(w, author, card);
    const outcomes = await Promise.allSettled([
      w.svc.respond(author.actor, id, UNCREDITED),
      w.svc.withdraw(author.actor, id),
    ]);
    assert.equal(outcomes.filter((o) => o.status === 'fulfilled').length, 1);
    const loser = outcomes.find((o) => o.status === 'rejected');
    assert.equal(loser.reason.status, 409);
    // Whatever won, the record holds one coherent state.
    const raw = await w.roster.publications.get(id);
    assert.ok(['consented', 'withdrawn'].includes(raw.status));
  });

  // ── the moderator and analyst boundary ─────────────────────────────────
  test('an analyst cannot read the staff publication list', async () => {
    const w = await world();
    await assert.rejects(w.svc.listForStaff(w.analyst), refused(403, /may not publication\.read/));
  });

  test('the offerable list holds only what can be offered, leaks no author, and drops what was already offered', async () => {
    const w = await world();
    const card = await openCard(w);
    const named = await w.enroll('identified', { name: NAME });
    const anon = await w.enroll('anonymous');
    const keyedDissent = await actionedDissent(w, named, card, 'KEYED-DISSENT-TEXT about the window.');
    await actionedDissent(w, anon, card, 'ANON-DISSENT-TEXT about the window.');
    const keyedPost = await postRow(w, card, `id:${named.expertId}`, { text: 'KEYED-POST-TEXT about the road.' });
    await postRow(w, card, `bt:${crypto.randomBytes(32).toString('hex')}`, { text: 'ANON-POST-TEXT about the road.' });
    await postRow(w, card, `id:${named.expertId}`, { status: 'pending', text: 'PENDING-POST-TEXT about the road.' });
    const list = await w.svc.listOfferable(w.mod);
    assert.deepEqual(list.map((i) => `${i.sourceKind}:${i.sourceId}`).sort(), [`dissent:${keyedDissent}`, `post:${keyedPost}`].sort());
    const dump = JSON.stringify(list);
    for (const leak of ['ANON-', 'PENDING-', named.expertId, 'id:ex_', 'bt:', 'respondentKey', 'expertId']) assert.ok(!dump.includes(leak), `${leak} must not appear`);
    await w.svc.propose(w.mod, { sourceKind: 'post', sourceId: keyedPost });
    assert.deepEqual((await w.svc.listOfferable(w.mod)).map((i) => i.sourceId), [keyedDissent]);
    await assert.rejects(w.svc.listOfferable(w.analyst), refused(403, /may not publication\.propose/));
  });

  // ── HTTP: every route through the real transport ───────────────────────
  test('over HTTP: the seven routes, the public list with no login, and the authors\' own routes', async () => {
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
    const modTok = await w.svc.createStaffSession({ id: 'mod1', role: 'moderator' });
    const mod2Tok = await w.svc.createStaffSession({ id: 'mod2', role: 'moderator' });
    const anTok = await w.svc.createStaffSession({ id: 'an1', role: 'analyst' });
    try {
      assert.deepEqual((await call('GET', '/api/public/credits')).json, [], 'empty when nothing is published, with no login');
      assert.equal((await call('GET', '/api/staff/publications')).status, 401);
      assert.equal((await call('GET', '/api/staff/publications', { token: anTok })).status, 403);

      const author = await w.enroll('identified', { name: NAME });
      const dissentId = await actionedDissent(w, author, card);
      const proposed = await call('POST', '/api/staff/publications', { token: modTok, body: { sourceKind: 'dissent', sourceId: dissentId } });
      assert.equal(proposed.status, 200);
      const id = proposed.json.id;
      assert.equal((await call('POST', '/api/staff/publications', { token: anTok, body: { sourceKind: 'dissent', sourceId: dissentId } })).status, 403);

      assert.equal((await call('GET', '/api/staff/publications', { token: modTok })).json[0].id, id);
      assert.equal((await call('POST', `/api/publications/${id}/respond`, { body: NAMED })).status, 401);
      assert.equal((await call('POST', `/api/publications/${id}/respond`, { token: author.sessionToken, body: NAMED })).status, 200);

      assert.equal((await call('POST', `/api/staff/publications/${id}/review`, { token: modTok, body: { approve: true, checked: FULL } })).status, 403);
      assert.equal((await call('POST', `/api/staff/publications/${id}/review`, { token: mod2Tok, body: { approve: true, checked: FULL } })).json.status, 'approved');
      assert.equal((await call('POST', `/api/staff/publications/${id}/publish`, { token: modTok })).status, 409, 'cooling-off');
      w.clock.now += COOLING_OFF_MS;
      // Staff sessions last 12 hours on the same clock, so the moderator signs in again.
      const modNow = await w.svc.createStaffSession({ id: 'mod1', role: 'moderator' });
      assert.equal((await call('POST', `/api/staff/publications/${id}/publish`, { token: modNow })).json.status, 'published');
      assert.deepEqual((await call('GET', '/api/public/credits')).json.map((p) => p.creditLine), [`${NAME}, ${ORG}`]);

      assert.equal((await call('POST', `/api/publications/${id}/withdraw`, { token: modNow })).status, 403, 'a moderator cannot withdraw for the author');
      assert.equal((await call('POST', `/api/publications/${id}/withdraw`, { token: author.sessionToken })).json.status, 'withdrawn');
      assert.deepEqual((await call('GET', '/api/public/credits')).json, []);
    } finally {
      await new Promise((r) => server.close(r));
    }
  });
}
