import baseTest from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../src/http.js';
import { BACKENDS, worldFor, CARD, many } from './helpers.js';

const refused = async (p) => { try { await p; return null; } catch (e) { return e; } };

for (const backend of BACKENDS) {
  const test = (name, fn) => baseTest(`[${backend}] ${name}`, () => fn());

  /** A closed card with six answers, so a panel result exists. */
  async function closedCard(w) {
    const card = (await w.svc.createCard(w.analyst, CARD)).card;
    const panel = await many(6, () => w.enroll('identified'));
    for (const [i, e] of panel.entries()) await w.svc.submitEstimate(e.actor, { cardId: card.id, p: 0.3 + i * 0.05 });
    await w.svc.closeRound(w.mod, card.id);
    return { card, panel };
  }

  test('an expert who has not answered cannot read the circle result; one who has can; staff always can', async () => {
    const w = await worldFor(backend);
    const { card, panel } = await closedCard(w);
    const late = await w.enroll('identified');
    const err = await refused(w.svc.cardReleaseFor(late.actor, card.id));
    assert.ok(err && err.status === 403, 'the person who never answered is refused');
    assert.match(err.message, /answer this question first/);
    const seen = await w.svc.cardReleaseFor(panel[0].actor, card.id);
    assert.equal(seen.suppressed ?? false, false);
    assert.equal(typeof seen.estimate, 'number');
    assert.equal(typeof (await w.svc.cardReleaseFor(w.analyst, card.id)).estimate, 'number');
  });

  test('while Round 1 is open no expert reads the panel, even one who answered; staff always can', async () => {
    const w = await worldFor(backend);
    const card = (await w.svc.createCard(w.analyst, CARD)).card;
    const panel = await many(6, () => w.enroll('identified'));
    for (const [i, e] of panel.entries()) await w.svc.submitEstimate(e.actor, { cardId: card.id, p: 0.3 + i * 0.05 });
    const err = await refused(w.svc.cardReleaseFor(panel[0].actor, card.id));
    assert.ok(err && err.status === 403, 'an answered expert is refused while Round 1 is open');
    assert.match(err.message, /not published yet/);
    assert.ok(await w.svc.cardReleaseFor(w.analyst, card.id), 'staff are not refused');
  });

  test('in Round 2 an expert reads the Round-1 result, never the live Round-2 aggregate', async () => {
    const w = await worldFor(backend);
    const { card, panel } = await closedCard(w);
    await w.svc.openRound2(w.mod, card.id);
    for (const e of panel) await w.svc.submitEstimate(e.actor, { cardId: card.id, p: 0.9 });
    const round1 = await w.svc.cardRelease(card.id, { round: 1 });
    const seen = await w.svc.cardReleaseFor(panel[0].actor, card.id);
    assert.deepEqual(seen, round1);
    assert.notDeepEqual(await w.svc.cardReleaseFor(w.analyst, card.id), seen, 'staff see the live Round 2, so the test can tell them apart');
  });

  test('a resolved card returns the panel to an expert who answered, even one whose round was open', async () => {
    const w = await worldFor(backend);
    const card = (await w.svc.createCard(w.analyst, CARD)).card;
    const panel = await many(6, () => w.enroll('identified'));
    for (const [i, e] of panel.entries()) await w.svc.submitEstimate(e.actor, { cardId: card.id, p: 0.3 + i * 0.05 });
    await w.svc.resolveCard(w.mod, { cardId: card.id, outcome: 1, evidenceUrl: 'https://example.org/bulletin' });
    assert.equal(typeof (await w.svc.cardReleaseFor(panel[0].actor, card.id)).estimate, 'number');
  });

  test('a device-held expert is refused until the card is resolved; once resolved everyone may read it', async () => {
    const w = await worldFor(backend);
    const { card } = await closedCard(w);
    const inv = await w.svc.createInvite(w.mod, { declaration: { countries: ['TCD'] } });
    const dev = await w.svc.redeemInvite(inv.token, { level: 'anonymous', mode: 'device', consentVersion: (await w.svc.consentFor('anonymous', { device: true })).version }).catch(() => null);
    const stranger = dev ? await w.svc.authenticate(dev.sessionToken) : (await w.enroll('anonymous')).actor;
    assert.ok((await refused(w.svc.cardReleaseFor(stranger, card.id)))?.status === 403, 'refused before resolution');
    await w.svc.resolveCard(w.mod, { cardId: card.id, outcome: 1, evidenceUrl: 'https://example.org/bulletin' });
    assert.equal(typeof (await w.svc.cardReleaseFor(stranger, card.id)).estimate, 'number');
  });

  test('over HTTP the release route enforces the same rule', async () => {
    const w = await worldFor(backend);
    const { card, panel } = await closedCard(w);
    const late = await w.enroll('identified');
    const server = createServer({ service: w.svc, verifyStaff: async () => null, limits: { writesPerMinute: 10000, burstWrites: 10000 } });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    try {
      const base = `http://127.0.0.1:${server.address().port}`;
      const get = (token) => fetch(`${base}/api/cards/${card.id}/release`, { headers: token ? { authorization: `Bearer ${token}` } : {} });
      assert.equal((await get(null)).status, 401);
      assert.equal((await get(late.sessionToken)).status, 403);
      assert.equal((await get(panel[0].sessionToken)).status, 200);
    } finally {
      await new Promise((r) => server.close(r));
    }
  });
}
