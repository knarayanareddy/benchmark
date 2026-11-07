/**
 * Pulse: what is asked of an expert this week, and where a dispatch would land for each person. Both are ranked by
 * the pure core (`rankAsks`) over candidates the inbox already allows, so Pulse never shows a card the inbox would
 * not, and the preview places a card exactly as that person's own Pulse would. Docs: docs/10-pilot-experience.md, section 4.
 */
import { LEVELS, coarsenToDay } from '@benchmark/core/anonymity';
import { MIN_RELEASE_PANEL_SIZE } from '@benchmark/core/aggregate';
import { matches } from '@benchmark/core/dispatch';
import { rankAsks, WEEK_MS } from '@benchmark/core/pulse';
import { REGIONS, THEMES } from '@benchmark/core/taxonomy';
import { ValidationError, ConflictError } from './errors.js';

const DEFAULT_WEEKLY_CAP = 3;
const ISO3 = /^[A-Z]{3}$/;
const DECISION_ORDER = ['ask', 'radar', 'outside', 'answered'];
const iso = (/** @type {number} */ ms) => new Date(ms).toISOString().slice(0, 10);
const nonEmpty = (/** @type {unknown} */ v) => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);

/** @param {any} ctx */
export function createPulse(ctx) {
  const { roster, answers, t, need, expertOf, respondentKey, estimateKey, getCard, self } = ctx;

  /** The person's own cap; the default when they never saved a profile. @param {any} expert */
  const capOf = (expert) => expert.profile?.weeklyCap ?? DEFAULT_WEEKLY_CAP;

  /** Round-1 response counts, read once for a set of cards. @param {{ id: string }[]} cards */
  async function responsesFor(cards) {
    const out = new Map();
    for (const c of cards) out.set(c.id, (await answers.estimates.find({ cardId: c.id, round: 1 })).length);
    return (/** @type {{ id: string }} */ card) => out.get(card.id) ?? 0;
  }

  /**
   * The person's first declared country: how many consented people are in that circle (null under the release floor,
   * shown as "forming"), its open or closed cards, and how many of those already have a closed panel release.
   * @param {any} expert
   */
  async function circleOf(expert) {
    const country = expert.declaration?.countries?.[0];
    if (!country) return null;
    const people = (await roster.experts.all()).filter((/** @type {any} */ e) => e.consent && e.declaration?.countries?.includes(country));
    const cards = (await answers.cards.find({ country })).filter((/** @type {any} */ c) => c.status === 'open' || c.status === 'closed');
    let withView = 0;
    for (const c of cards) {
      if ((await answers.releases.find({ cardId: c.id, visibility: 'panel', closed: true })).some((/** @type {any} */ r) => r.n >= MIN_RELEASE_PANEL_SIZE)) withView++;
    }
    return {
      country,
      members: people.length >= MIN_RELEASE_PANEL_SIZE ? people.length : null,
      openCards: cards.length,
      withView,
    };
  }

  /**
   * The person's own counts. Device-held answers sit under a key only the device holds, so there is no record to give.
   * Anonymous objections carry no expert id, so a service-held anonymous expert's objections count as 0.
   * @param {any} expert
   */
  async function recordOf(expert) {
    if (expert.tokenMode === 'device') return null;
    let answered = 0;
    let revised = 0;
    for (const c of await answers.cards.all()) {
      const key = respondentKey(c, expert);
      if (await answers.estimates.get(estimateKey(c.id, key, 1))) answered++;
      if (await answers.estimates.get(estimateKey(c.id, key, 2))) revised++;
    }
    const objections = (await answers.dissents.find({ expert: expert.id })).length;
    return { answered, revised, objections };
  }

  /** @param {any} actor */
  async function pulse(actor) {
    need(actor, 'inbox.read');
    const expert = await expertOf(actor);
    const box = await self().inbox(actor);
    const views = new Map(box.toAnswer.map((/** @type {any} */ v) => [v.id, v]));
    const cards = [];
    for (const v of box.toAnswer) cards.push(await getCard(v.id));
    const now = t();
    const ranked = rankAsks(cards, { weeklyCap: capOf(expert), declaration: expert.declaration }, {
      now, responsesOf: await responsesFor(cards),
    });
    /** The inbox's own view object, so `deviceHeld` and every other inbox field carry through. */
    const entry = (/** @type {any} */ e) => ({ card: views.get(e.card.id), why: e.why, reason: e.reason });
    return {
      week: { from: iso(now - WEEK_MS), to: iso(now) },
      weeklyCap: capOf(expert),
      asks: ranked.asks.map(entry),
      radar: ranked.radar.map(entry),
      waiting: {
        revise: box.openForRevision.length,
        discussion: box.discussion.length,
        offers: box.publications.filter((/** @type {any} */ p) => p.status === 'proposed').length,
      },
      deviceMode: box.deviceMode,
      circle: await circleOf(expert),
      record: await recordOf(expert),
    };
  }

  /** @param {unknown} v @param {readonly string[] | Readonly<Record<string, string>>} vocab */
  const vocabValue = (v, vocab) => {
    if (v === undefined || v === null) return null;
    if (typeof v !== 'string') return undefined;
    const s = v.trim();
    if (s === '') return null;
    return Array.isArray(vocab) ? (vocab.includes(s) ? s : undefined) : (Object.hasOwn(vocab, s) ? s : undefined);
  };

  /**
   * A dispatch preview names no one. Every server-held expert is placed as their own Pulse would place the card:
   * an answered card is out of their pool, found with the same key the inbox uses. Only keyed experts are reported
   * as `answered`; an anonymous expert who answered is reported as `outside`, so the preview never shows what an
   * anonymous expert said. Device-held experts are placed by declaration alone: the server cannot see their answers.
   * @param {any} actor
   * @param {{ cardId?: unknown, draft?: any }} [input]
   */
  async function previewDispatch(actor, { cardId, draft } = {}) {
    need(actor, 'dispatch.read');
    const hasCard = cardId !== undefined && cardId !== null;
    const hasDraft = draft !== undefined && draft !== null;
    if (hasCard === hasDraft) throw new ValidationError('give exactly one of cardId or draft');

    const openRound1 = await answers.cards.find({ status: 'open', round: 1 });
    /** @type {any} the card under preview. For a stored card it is the same object the pool holds (identity is checked below). */
    let target;
    if (hasCard) {
      if (typeof cardId !== 'string' || cardId.trim() === '') throw new ValidationError('cardId must be a card id');
      const card = await getCard(cardId.trim());
      if (card.status !== 'open' || card.round !== 1) throw new ConflictError(`card ${card.id} is not an open round-1 card`);
      target = openRound1.find((c) => c.id === card.id);
      if (!target) throw new ConflictError(`card ${card.id} is not an open round-1 card`);
    } else {
      if (typeof draft !== 'object' || Array.isArray(draft)) throw new ValidationError('draft must be an object with country, region and theme');
      const country = typeof draft.country === 'string' ? draft.country.trim().toUpperCase() : '';
      if (!ISO3.test(country)) throw new ValidationError('draft country must be an ISO 3-letter code (like TCD)');
      const region = vocabValue(draft.region, REGIONS);
      if (region === undefined) throw new ValidationError('draft region must be one of the known regions, or empty');
      const theme = vocabValue(draft.theme, THEMES);
      if (theme === undefined) throw new ValidationError('draft theme must be one of the known themes, or empty');
      // Treated as created now. The empty id sorts first on a tie; it is never shown.
      target = { id: '', country, region, theme, createdAt: coarsenToDay(t()).ms, status: 'open', round: 1 };
    }

    const responsesOf = await responsesFor(openRound1);
    const now = t();
    const rows = [];
    for (const e of (await roster.experts.all()).filter((x) => x.consent)) {
      const keyedLevel = e.level === LEVELS.IDENTIFIED || e.level === LEVELS.PSEUDONYMOUS;
      const serverHeld = e.tokenMode !== 'device';
      const declaration = e.declaration;
      /** @type {any[]} the cards this person could be offered now: the inbox's toAnswer, plus the draft */
      const pool = [];
      let answered = false;
      for (const c of openRound1) {
        if (!matches(c, declaration)) continue;
        if (serverHeld && (await answers.estimates.get(estimateKey(c.id, respondentKey(c, e), 1)))) {
          if (c === target) answered = true;
          continue;
        }
        pool.push(c);
      }
      if (!hasCard && matches(target, declaration)) pool.push(target);

      let decision;
      let why = [];
      let reason;
      if (answered && keyedLevel) {
        decision = 'answered';
        reason = 'Already answered this question';
      } else if (answered || !matches(target, declaration)) {
        // An anonymous expert's answer is not revealed: their answered card is reported like one outside their declaration.
        decision = 'outside';
        reason = 'Outside what they declared';
      } else {
        const ranked = rankAsks(pool, { weeklyCap: capOf(e), declaration }, { now, responsesOf });
        const asked = ranked.asks.find((x) => x.card === target);
        const hit = asked ?? ranked.radar.find((x) => x.card === target);
        // A matching target is always in the pool, and rankAsks places every candidate in asks or radar.
        if (!hit) throw new Error('dispatch preview: a matching card was not placed');
        decision = asked ? 'ask' : 'radar';
        why = hit.why;
        reason = hit.reason;
      }

      let label = 'Anonymous expert';
      if (e.level === LEVELS.IDENTIFIED) label = nonEmpty(e.name) ?? 'Identified expert';
      else if (e.level === LEVELS.PSEUDONYMOUS) {
        // Read only: a preview never creates an alias.
        const alias = (await roster.aliases.find({ expertId: e.id, country: target.country }))[0];
        label = alias?.alias ?? 'Pseudonymous expert';
      }
      rows.push({ label, level: e.level, why, decision, reason });
    }

    // Sorted on the whole row, so the order never depends on roster (invite) order: anonymous rows share a label.
    const sortKey = (/** @type {any} */ r) => [DECISION_ORDER.indexOf(r.decision), r.label, r.level, r.reason, JSON.stringify(r.why)];
    rows.sort((a, b) => {
      const ka = sortKey(a);
      const kb = sortKey(b);
      for (let i = 0; i < ka.length; i++) {
        if (ka[i] < kb[i]) return -1;
        if (ka[i] > kb[i]) return 1;
      }
      return 0;
    });
    const counts = { ask: 0, radar: 0, outside: 0, answered: 0 };
    for (const r of rows) counts[/** @type {keyof typeof counts} */ (r.decision)] += 1;
    return {
      card: {
        id: hasCard ? target.id : null,
        country: target.country,
        region: target.region ?? null,
        theme: target.theme ?? null,
      },
      counts,
      rows,
    };
  }

  return { pulse, previewDispatch };
}
