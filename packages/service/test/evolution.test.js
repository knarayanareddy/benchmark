import baseTest from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createService } from '../src/service.js';
import { createServer } from '../src/http.js';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../src/errors.js';
import { normaliseRisk } from '@benchmark/core/radar';
import { downstream } from '@benchmark/core/links';
import { BACKENDS, SECRETS, CARD, T0, many, worldFor, makeStores } from './helpers.js';

// Real records of the organisers' export: the same fixture radar.test.js uses.
const RAW = JSON.parse(readFileSync(new URL('../../../data/risk-radar.json', import.meta.url), 'utf8'));
const pick = (id) => {
  const r = RAW.find((x) => x.id === id);
  if (!r) throw new Error(`fixture record ${id} missing from data/risk-radar.json`);
  return structuredClone(r);
};
const FIXTURE = [pick('R1066'), pick('R0365'), pick('R1040'), pick('R0204')];

const STATEMENT_B = 'IPC Phase 4 will be declared in any Chad district by 30 April 2027.';
const STATEMENT_C = 'Malnutrition admissions in Chad will exceed 5,000 by 30 April 2027.';
const MECHANISM = 'Flooding that cuts roads raises treatment costs and delays case reporting in the district.';
const RIVAL = 'Catch-up reporting after a clinic strike explains the jump, with no real change in spread.';
// Anything a privacy leak would show: respondent keys, ballot tokens, expert ids, and the words for them.
const LEAK = /id:|bt:|ex_|respondent|ballot/i;

for (const backend of BACKENDS) {
  const test = (name, fn) => baseTest(`[${backend}] ${name}`, () => fn());
  const world = (o = {}) => worldFor(backend, { radar: FIXTURE, ...o });

  const openCard = async (w, input = CARD) => (await w.svc.createCard(w.analyst, input)).card;

  /** `n` keyed experts answer the card's current round, with values spread across 0.2..0.7. */
  async function answer(w, card, n, { names = false } = {}) {
    const experts = await many(n, (i) => w.enroll(i % 2 ? 'pseudonymous' : 'identified', { name: names ? `Expert ${i} Surname` : undefined }));
    for (const [i, e] of experts.entries()) await w.svc.submitEstimate(e.actor, { cardId: card.id, p: 0.2 + i * 0.1 });
    return experts;
  }

  test('series: one closed round with 6 respondents gives one point with n=6 and numeric fractions in [0,1]', async () => {
    const w = await world();
    const card = await openCard(w);
    await answer(w, card, 6);
    await w.svc.closeRound(w.mod, card.id);
    for (const actor of [w.analyst, w.mod]) {
      const s = await w.svc.cardSeries(actor, card.id);
      assert.equal(s.cardId, card.id);
      assert.equal(s.statement, CARD.statement);
      assert.equal(s.status, 'closed');
      assert.equal(s.points.length, 1);
      const [p] = s.points;
      assert.deepEqual(Object.keys(p).sort(), ['day', 'estimate', 'hi', 'lo', 'n', 'round']);
      assert.equal(p.round, 1);
      assert.equal(p.n, 6);
      assert.match(p.day, /^\d{4}-\d{2}-\d{2}$/);
      for (const k of ['estimate', 'lo', 'hi']) assert.ok(typeof p[k] === 'number' && p[k] >= 0 && p[k] <= 1, `${k} is a fraction`);
      assert.ok(p.lo <= p.estimate && p.estimate <= p.hi, 'the interval brackets the estimate');
      assert.deepEqual(s.withheld, []);
    }
  });

  test('series: a closed round with 4 respondents is WITHHELD, and the entry carries no number', async () => {
    const w = await world();
    const card = await openCard(w);
    await answer(w, card, 4);
    await w.svc.closeRound(w.mod, card.id);
    const s = await w.svc.cardSeries(w.analyst, card.id);
    assert.deepEqual(s.points, []);
    assert.deepEqual(s.withheld, [{ round: 1 }]);
    assert.deepEqual(Object.keys(s.withheld[0]), ['round']);
    assert.doesNotMatch(JSON.stringify(s), /"(estimate|lo|hi|n|q25|q75)":/);
  });

  const EVIDENCE = 'https://example.org/evidence';

  test('series: a closed round below the floor stays WITHHELD after the card is resolved', async () => {
    const w = await world();
    const card = await openCard(w);
    await answer(w, card, 4);
    await w.svc.closeRound(w.mod, card.id);
    await w.svc.resolveCard(w.mod, { cardId: card.id, outcome: 1, evidenceUrl: EVIDENCE });
    const s = await w.svc.cardSeries(w.analyst, card.id);
    assert.equal(s.status, 'resolved');
    assert.deepEqual(s.points, []);
    assert.deepEqual(s.withheld, [{ round: 1 }]);
  });

  test('series: a round-2 card resolved straight from open shows no round-2 entry, and nothing from the open round is ledgered', async () => {
    const w = await world();
    const card = await openCard(w);
    const experts = await answer(w, card, 6);
    await w.svc.closeRound(w.mod, card.id);
    await w.svc.openRound2(w.mod, card.id);
    for (const [i, e] of experts.entries()) await w.svc.submitEstimate(e.actor, { cardId: card.id, p: 0.3 + i * 0.05 });
    await w.svc.resolveCard(w.mod, { cardId: card.id, outcome: 0, evidenceUrl: EVIDENCE });
    await w.svc.cardRelease(card.id);
    const s = await w.svc.cardSeries(w.analyst, card.id);
    assert.deepEqual(s.points.map((p) => p.round), [1]);
    assert.deepEqual(s.withheld, [], 'no phantom Round 2 entry');
    assert.ok(!(await w.answers.releases.all()).some((d) => d.round === 2 && d.closed === true), 'round 2 never ledgered as closed');
  });

  test('series: a legacy card with no closedRounds still infers a closed round from its status', async () => {
    const w = await world();
    const card = await openCard(w);
    await answer(w, card, 4);
    await w.svc.closeRound(w.mod, card.id);
    // A card written before closedRounds existed: strip the field the new close wrote.
    const stored = await w.answers.cards.get(card.id);
    const { closedRounds, ...legacy } = stored;
    assert.deepEqual(closedRounds, [1]);
    await w.answers.cards.update(card.id, stored.version, { ...legacy, version: stored.version + 1 });
    const s = await w.svc.cardSeries(w.analyst, card.id);
    assert.equal(s.status, 'closed');
    assert.deepEqual(s.withheld, [{ round: 1 }]);
  });

  test('series: an OPEN round yields no point, even after cardRelease was called on it', async () => {
    const w = await world();
    const card = await openCard(w);
    await answer(w, card, 6);
    const interim = await w.svc.cardRelease(card.id);
    assert.equal(interim.suppressed, true, 'the interim release is withheld by the release policy');
    const s = await w.svc.cardSeries(w.analyst, card.id);
    assert.deepEqual(s.points, []);
    assert.deepEqual(s.withheld, [], 'an open round is not withheld either: it is simply not shown yet');
    assert.equal(s.status, 'open');
    assert.match(s.note, /still open/);
  });

  test('series: an open round is excluded even if an open snapshot reached the ledger (the closed filter has teeth)', async () => {
    const w = await world();
    const card = await openCard(w);
    await answer(w, card, 6);
    // Stands in for a regression that ledgers an interim snapshot with the largest n. The service must still ignore it.
    await w.answers.releases.append({
      cardId: card.id, round: 1, visibility: 'panel', n: 7, closed: false, at: T0,
      snapshot: { estimate: 0.99, lo: 0.98, hi: 0.999, suppressed: false, releaseHeld: false, n: 7 },
    });
    const s = await w.svc.cardSeries(w.analyst, card.id);
    assert.deepEqual(s.points, []);
    assert.doesNotMatch(JSON.stringify(s), /0\.99/);
  });

  test('series: a public-visibility ledger document is never a panel point', async () => {
    const w = await world();
    const card = await openCard(w);
    await answer(w, card, 6);
    await w.svc.closeRound(w.mod, card.id);
    const before = (await w.svc.cardSeries(w.analyst, card.id)).points;
    await w.answers.releases.append({
      cardId: card.id, round: 1, visibility: 'public', n: 9, closed: true, at: T0,
      snapshot: { estimate: 0.11, lo: 0.1, hi: 0.12, suppressed: false, releaseHeld: false, n: 9 },
    });
    assert.deepEqual((await w.svc.cardSeries(w.analyst, card.id)).points, before);
  });

  test('series: open round 2 adds nothing until it closes, then a second point appears', async () => {
    const w = await world();
    const card = await openCard(w);
    const experts = await answer(w, card, 6);
    await w.svc.closeRound(w.mod, card.id);
    await w.svc.openRound2(w.mod, card.id);
    for (const [i, e] of experts.entries()) await w.svc.submitEstimate(e.actor, { cardId: card.id, p: 0.3 + i * 0.05 });
    const mid = await w.svc.cardSeries(w.analyst, card.id);
    assert.deepEqual(mid.points.map((p) => p.round), [1], 'round 2 is still open');
    assert.match(mid.note, /Round 2 is still open/);
    await w.svc.closeRound(w.mod, card.id);
    const s = await w.svc.cardSeries(w.analyst, card.id);
    assert.deepEqual(s.points.map((p) => [p.round, p.n]), [[1, 6], [2, 6]]);
    assert.deepEqual(s.withheld, []);
  });

  test('series: a re-asked cardRelease adds no duplicate point, and a smaller n for the same round never replaces the largest', async () => {
    const w = await world();
    const card = await openCard(w);
    await answer(w, card, 6);
    await w.svc.closeRound(w.mod, card.id);
    const [real] = (await w.svc.cardSeries(w.analyst, card.id)).points;
    const ledgered = await w.answers.releases.all();
    await w.svc.cardRelease(card.id);
    await w.svc.cardRelease(card.id);
    assert.equal((await w.answers.releases.all()).length, ledgered.length, 'the re-ask writes nothing');
    await w.answers.releases.append({
      cardId: card.id, round: 1, visibility: 'panel', n: 5, closed: true, at: T0,
      snapshot: { estimate: 0.9, lo: 0.85, hi: 0.95, suppressed: false, releaseHeld: false, n: 5 },
    });
    const s = await w.svc.cardSeries(w.analyst, card.id);
    assert.equal(s.points.length, 1, 'one point for round 1');
    assert.equal(s.points[0].n, 6, 'the largest n wins');
    assert.equal(s.points[0].estimate, real.estimate);
  });

  test('series: no respondent key, expert id, ballot token or per-person value appears anywhere in the payload', async () => {
    const w = await world();
    const card = await openCard(w);
    const experts = await answer(w, card, 6, { names: true });
    await w.svc.closeRound(w.mod, card.id);
    await w.svc.openRound2(w.mod, card.id);
    for (const e of experts) await w.svc.submitEstimate(e.actor, { cardId: card.id, p: 0.5 });
    const dump = JSON.stringify(await w.svc.cardSeries(w.analyst, card.id));
    assert.doesNotMatch(dump, LEAK);
    for (const e of experts) {
      assert.ok(!dump.includes(e.expertId), 'no expert id');
      assert.ok(!dump.includes('Surname'), 'no name');
    }
    assert.doesNotMatch(JSON.stringify(await w.svc.evolutionGrid(w.analyst)), LEAK);
  });

  test('series: reading never releases anything (the releases store is unchanged by cardSeries)', async () => {
    const w = await world();
    const closed = await openCard(w);
    await answer(w, closed, 6);
    await w.svc.closeRound(w.mod, closed.id);
    const open = await openCard(w, { ...CARD, statement: STATEMENT_B });
    await answer(w, open, 6);
    const before = JSON.stringify(await w.answers.releases.all());
    await w.svc.cardSeries(w.analyst, closed.id);
    await w.svc.cardSeries(w.analyst, open.id);
    assert.equal(JSON.stringify(await w.answers.releases.all()), before);
  });

  test('series: staff only, and an unknown card is a 404', async () => {
    const w = await world();
    const card = await openCard(w);
    const e = await w.enroll('identified');
    await assert.rejects(() => w.svc.cardSeries(e.actor, card.id), ForbiddenError);
    await assert.rejects(() => w.svc.cardSeries(null, card.id), /authentication/);
    await assert.rejects(() => w.svc.cardSeries(w.analyst, 'nope'), NotFoundError);
  });

  test('grid: the shape, one real placement of a fixture risk, and a card placed by its risk', async () => {
    const w = await world();
    const risk = normaliseRisk(pick('R1066'));
    assert.ok(risk.region && risk.theme, 'the fixture risk has a region and a theme');
    // No region or theme on the card: it takes its risk's placement.
    await openCard(w, { ...CARD, region: undefined, theme: undefined, riskId: 'R1066' });
    const g = await w.svc.evolutionGrid(w.analyst);
    assert.deepEqual(Object.keys(g).sort(), ['cells', 'minCell', 'regions', 'themes', 'unplaced']);
    assert.equal(g.minCell, 10);
    assert.equal(g.cells.length, g.regions.length * g.themes.length);
    for (const c of g.cells) assert.deepEqual(Object.keys(c).sort(), ['cards', 'live', 'region', 'risks', 'small', 'theme']);
    const cell = g.cells.find((c) => c.region === risk.region && c.theme === risk.theme);
    assert.equal(cell.risks, 1, 'one fixture risk sits in this cell');
    assert.equal(cell.cards, 1);
    assert.equal(cell.live, 1, 'the card is open');
    assert.equal(cell.small, true, 'fewer than 10 risks: descriptive only');
    assert.equal(g.unplaced.cards, 0);
    assert.doesNotMatch(JSON.stringify(g), LEAK);
    assert.equal((await w.svc.evolutionGrid(w.mod)).cells.length, g.cells.length, 'moderators read it too');
    const e = await w.enroll('identified');
    await assert.rejects(() => w.svc.evolutionGrid(e.actor), ForbiddenError);
  });

  test('links: create, list and remove round trip, with statements joined and the actor attributed', async () => {
    const w = await world();
    const a = await openCard(w);
    const b = await openCard(w, { ...CARD, statement: STATEMENT_B });
    const row = await w.svc.createLink(w.mod, { fromCardId: a.id, toCardId: b.id, mechanism: MECHANISM, rival: RIVAL });
    assert.deepEqual(Object.keys(row).sort(), ['by', 'day', 'fromCardId', 'fromStatement', 'id', 'mechanism', 'rival', 'toCardId', 'toStatement']);
    assert.match(row.id, /^lk_[0-9a-f-]{36}$/);
    assert.equal(row.fromStatement, CARD.statement);
    assert.equal(row.toStatement, STATEMENT_B);
    assert.equal(row.by, 'mod1', 'the staff actor, never an expert id');
    assert.match(row.day, /^\d{4}-\d{2}-\d{2}$/);
    assert.deepEqual(await w.svc.listLinks(w.analyst), [row]);
    assert.deepEqual(await w.svc.removeLink(w.mod, row.id), { removed: true });
    assert.deepEqual(await w.svc.listLinks(w.mod), []);
    await assert.rejects(() => w.svc.removeLink(w.mod, row.id), (err) => err instanceof NotFoundError);
  });

  test('links: validation names every problem at once; the rival explanation is required', async () => {
    const w = await world();
    const a = await openCard(w);
    const b = await openCard(w, { ...CARD, statement: STATEMENT_B });
    await assert.rejects(() => w.svc.createLink(w.mod, { fromCardId: a.id, toCardId: b.id, mechanism: 'too short', rival: RIVAL }), (err) => (
      err instanceof ValidationError && err.status === 400 && /^link cannot be saved:/.test(err.message)
      && err.problems.length === 1 && /mechanism must be/.test(err.problems[0])
    ));
    await assert.rejects(() => w.svc.createLink(w.mod, { fromCardId: a.id, toCardId: b.id, mechanism: MECHANISM }), (err) => (
      err instanceof ValidationError && err.problems.some((p) => /rival explanation is required/.test(p))
    ));
    await assert.rejects(() => w.svc.createLink(w.mod, { fromCardId: a.id, toCardId: a.id, mechanism: MECHANISM, rival: RIVAL }), (err) => (
      err instanceof ValidationError && err.problems.some((p) => /two different cards/.test(p))
    ));
    await assert.rejects(() => w.svc.createLink(w.mod, { toCardId: b.id, mechanism: MECHANISM, rival: RIVAL }), (err) => (
      err instanceof ValidationError && err.problems.some((p) => /fromCardId is required/.test(p))
    ));
    await assert.rejects(() => w.svc.createLink(w.mod, { fromCardId: a.id, toCardId: 'C_missing', mechanism: MECHANISM, rival: RIVAL }), NotFoundError);
    assert.deepEqual(await w.svc.listLinks(w.mod), [], 'nothing was stored');
  });

  test('links: a duplicate ordered pair conflicts; the reverse pair is a different link and is allowed', async () => {
    const w = await world();
    const a = await openCard(w);
    const b = await openCard(w, { ...CARD, statement: STATEMENT_B });
    await w.svc.createLink(w.mod, { fromCardId: a.id, toCardId: b.id, mechanism: MECHANISM, rival: RIVAL });
    await assert.rejects(() => w.svc.createLink(w.mod, { fromCardId: a.id, toCardId: b.id, mechanism: MECHANISM, rival: RIVAL }), (err) => (
      err instanceof ConflictError && err.message === 'this link already exists'
    ));
    await w.svc.createLink(w.mod, { fromCardId: b.id, toCardId: a.id, mechanism: MECHANISM, rival: RIVAL });
    assert.equal((await w.svc.listLinks(w.mod)).length, 2);
  });

  test('links: the store unique constraint is the authority, even when the pre-check sees nothing', async () => {
    const { roster, answers } = await makeStores(backend);
    // A pre-check that always sees an empty table, so only the store can refuse the duplicate.
    const blindToLinks = { ...answers, card_links: { ...answers.card_links, all: async () => [] } };
    const svc = createService({ roster, answers: blindToLinks, secrets: SECRETS, now: () => T0, radar: FIXTURE });
    const mod = await svc.authenticate(await svc.createStaffSession({ id: 'mod1', role: 'moderator' }));
    const analyst = await svc.authenticate(await svc.createStaffSession({ id: 'an1', role: 'analyst' }));
    const a = (await svc.createCard(analyst, CARD)).card;
    const b = (await svc.createCard(analyst, { ...CARD, statement: STATEMENT_B })).card;
    await svc.createLink(mod, { fromCardId: a.id, toCardId: b.id, mechanism: MECHANISM, rival: RIVAL });
    await assert.rejects(() => svc.createLink(mod, { fromCardId: a.id, toCardId: b.id, mechanism: MECHANISM, rival: RIVAL }), (err) => (
      err instanceof ConflictError && err.message === 'this link already exists'
    ));
    assert.equal((await answers.card_links.all()).length, 1);
  });

  test('links: the audit log names the link id and never the mechanism, the rival or a statement', async () => {
    const w = await world();
    const a = await openCard(w);
    const b = await openCard(w, { ...CARD, statement: STATEMENT_B });
    const row = await w.svc.createLink(w.mod, { fromCardId: a.id, toCardId: b.id, mechanism: MECHANISM, rival: RIVAL });
    await w.svc.removeLink(w.mod, row.id);
    const log = (await w.svc.readAudit(w.mod)).filter((x) => x.action === 'link.create' || x.action === 'link.remove');
    assert.deepEqual(log.map((x) => [x.action, x.target]), [['link.create', row.id], ['link.remove', row.id]]);
    const dump = JSON.stringify(log);
    for (const secret of [MECHANISM, RIVAL, CARD.statement, STATEMENT_B]) assert.ok(!dump.includes(secret), 'no link text in the log');
  });

  test('links: an analyst can read but not create or remove; an expert is refused everything', async () => {
    const w = await world();
    const a = await openCard(w);
    const b = await openCard(w, { ...CARD, statement: STATEMENT_B });
    const row = await w.svc.createLink(w.mod, { fromCardId: a.id, toCardId: b.id, mechanism: MECHANISM, rival: RIVAL });
    assert.equal((await w.svc.listLinks(w.analyst)).length, 1);
    await assert.rejects(() => w.svc.createLink(w.analyst, { fromCardId: b.id, toCardId: a.id, mechanism: MECHANISM, rival: RIVAL }), (err) => (
      err instanceof ForbiddenError && /may not evolution\.link/.test(err.message)
    ));
    await assert.rejects(() => w.svc.removeLink(w.analyst, row.id), ForbiddenError);
    const e = await w.enroll('identified');
    await assert.rejects(() => w.svc.listLinks(e.actor), ForbiddenError);
    await assert.rejects(() => w.svc.createLink(e.actor, { fromCardId: a.id, toCardId: b.id, mechanism: MECHANISM, rival: RIVAL }), ForbiddenError);
    await assert.rejects(() => w.svc.removeLink(e.actor, row.id), ForbiddenError);
    await assert.rejects(() => w.svc.listLinks(null), /authentication/);
  });

  test('links: downstream through listLinks matches the core walk on a three-card chain', async () => {
    const w = await world();
    const a = await openCard(w);
    const b = await openCard(w, { ...CARD, statement: STATEMENT_B });
    const c = await openCard(w, { ...CARD, statement: STATEMENT_C });
    const ab = await w.svc.createLink(w.mod, { fromCardId: a.id, toCardId: b.id, mechanism: MECHANISM, rival: RIVAL });
    const bc = await w.svc.createLink(w.mod, { fromCardId: b.id, toCardId: c.id, mechanism: MECHANISM, rival: RIVAL });
    const rows = await w.svc.listLinks(w.analyst);
    assert.deepEqual(downstream(rows, a.id), [
      { cardId: b.id, depth: 1, via: ab.id },
      { cardId: c.id, depth: 2, via: bc.id },
    ]);
    assert.deepEqual(downstream(rows, c.id), []);
  });

  test('links: a card whose row is gone does not break the list (memory); Postgres keeps the referenced card', async () => {
    const w = await world();
    const a = await openCard(w);
    const b = await openCard(w, { ...CARD, statement: STATEMENT_B });
    await w.svc.createLink(w.mod, { fromCardId: a.id, toCardId: b.id, mechanism: MECHANISM, rival: RIVAL });
    // Cards are normally retired, never deleted. The schema also forbids deleting a card a link names.
    const deleted = await w.answers.cards.remove(a.id).then(() => true, () => false);
    assert.equal(deleted, backend === 'memory');
    const [row] = await w.svc.listLinks(w.mod);
    assert.equal(row.toStatement, STATEMENT_B);
    assert.equal(row.fromStatement, deleted ? null : CARD.statement);
  });

  test('links: a retired card keeps its statement in the list', async () => {
    const w = await world();
    const a = await openCard(w);
    const b = await openCard(w, { ...CARD, statement: STATEMENT_B });
    await w.svc.createLink(w.mod, { fromCardId: a.id, toCardId: b.id, mechanism: MECHANISM, rival: RIVAL });
    await w.answers.cards.update(a.id, a.version, { ...a, status: 'retired', version: a.version + 1 });
    assert.equal((await w.svc.listLinks(w.mod))[0].fromStatement, CARD.statement);
  });

  // ── over HTTP: every route, with the same refusals the service makes ───────────────────────────
  test('over HTTP: every evolution route refuses without a token, refuses by role, and answers for moderators', async () => {
    const w = await world();
    const a = await openCard(w);
    const b = await openCard(w, { ...CARD, statement: STATEMENT_B });
    const e = await w.enroll('identified');
    const analyst = await w.svc.createStaffSession({ id: 'an1', role: 'analyst' });
    const moderator = await w.svc.createStaffSession({ id: 'mod1', role: 'moderator' });
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
    const linkBody = { fromCardId: a.id, toCardId: b.id, mechanism: MECHANISM, rival: RIVAL };
    try {
      for (const path of [`/api/staff/cards/${a.id}/series`, '/api/staff/evolution/grid', '/api/staff/links']) {
        assert.equal((await call('GET', path)).status, 401, `${path} without a token`);
        assert.equal((await call('GET', path, { token: e.sessionToken })).status, 403, `${path} for an expert`);
        assert.equal((await call('GET', path, { token: analyst })).status, 200, `${path} for an analyst`);
        assert.equal((await call('GET', path, { token: moderator })).status, 200, `${path} for a moderator`);
      }
      const series = await call('GET', `/api/staff/cards/${a.id}/series`, { token: moderator });
      assert.equal(series.json.cardId, a.id);
      assert.equal((await call('GET', '/api/staff/cards/nope/series', { token: moderator })).status, 404);

      assert.equal((await call('POST', '/api/staff/links', { body: linkBody })).status, 401);
      assert.equal((await call('POST', '/api/staff/links', { token: e.sessionToken, body: linkBody })).status, 403);
      assert.equal((await call('POST', '/api/staff/links', { token: analyst, body: linkBody })).status, 403);
      const short = await call('POST', '/api/staff/links', { token: moderator, body: { ...linkBody, mechanism: 'short' } });
      assert.equal(short.status, 400);
      assert.ok(short.json.problems.length >= 1);
      const created = await call('POST', '/api/staff/links', { token: moderator, body: linkBody });
      assert.equal(created.status, 200);
      assert.equal(created.json.fromStatement, CARD.statement);
      assert.equal(created.json.by, 'mod1');
      assert.equal((await call('POST', '/api/staff/links', { token: moderator, body: linkBody })).status, 409);

      assert.equal((await call('DELETE', `/api/staff/links/${created.json.id}`)).status, 401);
      assert.equal((await call('DELETE', `/api/staff/links/${created.json.id}`, { token: e.sessionToken })).status, 403);
      assert.equal((await call('DELETE', `/api/staff/links/${created.json.id}`, { token: analyst })).status, 403);
      assert.deepEqual((await call('DELETE', `/api/staff/links/${created.json.id}`, { token: moderator })).json, { removed: true });
      assert.equal((await call('DELETE', `/api/staff/links/${created.json.id}`, { token: moderator })).status, 404);
      assert.deepEqual((await call('GET', '/api/staff/links', { token: analyst })).json, []);
    } finally {
      await new Promise((r) => server.close(r));
    }
  });
}
