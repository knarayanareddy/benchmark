/**
 * Situation evolution, staff side (docs/12-situation-evolution.md, sections 2 to 4): panel series per card,
 * the regional grid, and analyst links between cards. Nothing here is visible to experts.
 *
 * Series are READ-ONLY: they never call cardRelease(), which writes the ledger. They only read the rounds
 * that cardRelease() already published at close.
 */
import { buildSeries } from '@benchmark/core/series';
import { buildGrid } from '@benchmark/core/grid';
import { validateLink, wouldDuplicate } from '@benchmark/core/links';
import { loadRadar } from '@benchmark/core/radar';
import { coarsenToDay } from '@benchmark/core/anonymity';
import { ConflictError, NotFoundError, ValidationError } from './errors.js';

const SERIES_NOTE = 'At most two rounds exist per card. A later window is a new card, not a third round.';
const DUPLICATE = 'this link already exists';

/** @param {any} row @param {string | null} fromStatement @param {string | null} toStatement */
const linkRow = (row, fromStatement, toStatement) => ({
  id: row.id, fromCardId: row.fromCardId, toCardId: row.toCardId, fromStatement, toStatement,
  mechanism: row.mechanism, rival: row.rival, by: row.by, day: row.day,
});

/** @param {any} ctx the service's shared context (see service.js `modules`) */
export function createEvolution(ctx) {
  const { risks } = loadRadar(ctx.radarRaw);

  /** @param {any} actor @param {string} cardId */
  async function cardSeries(actor, cardId) {
    ctx.need(actor, 'evolution.read');
    const card = await ctx.getCard(String(cardId));
    // Only closed, panel-visible ledger documents: an open round's snapshot would allow sequential differencing.
    const docs = (await ctx.answers.releases.find({ cardId: card.id })).filter((d) => d.closed === true && d.visibility === 'panel');
    /** @type {Map<number, any>} */
    const latest = new Map();
    for (const d of docs) {
      const cur = latest.get(d.round);
      if (!cur || d.n > cur.n) latest.set(d.round, d);
    }
    const series = buildSeries([...latest.values()]);
    // A round closed below the floor is never ledgered, so a closed round with no document is withheld. Cards from
    // before closedRounds existed are inferred from status.
    const closedRounds = card.closedRounds ?? [1, 2].filter((r) => r <= card.round && (r < card.round || card.status === 'closed'));
    const missing = closedRounds.filter((r) => !latest.has(r)).map((round) => ({ round }));
    const withheld = [...series.withheld, ...missing].sort((a, b) => a.round - b.round);
    const open = card.status === 'open' ? `Round ${card.round} is still open, so nothing from it is shown until it closes. ` : '';
    return {
      cardId: card.id, statement: card.statement, status: card.status,
      points: series.points, withheld, note: `${open}${SERIES_NOTE}`,
    };
  }

  /** @param {any} actor */
  async function evolutionGrid(actor) {
    ctx.need(actor, 'evolution.read');
    return buildGrid(risks, await ctx.answers.cards.all());
  }

  /** @param {any} actor */
  async function listLinks(actor) {
    ctx.need(actor, 'evolution.read');
    const statements = new Map((await ctx.answers.cards.all()).map((c) => [c.id, c.statement]));
    // A card retired or removed later leaves its link in place, with no statement.
    return (await ctx.answers.card_links.all()).map((l) =>
      linkRow(l, statements.get(l.fromCardId) ?? null, statements.get(l.toCardId) ?? null));
  }

  /** @param {any} actor @param {unknown} input */
  async function createLink(actor, input) {
    ctx.need(actor, 'evolution.link');
    const v = validateLink(input);
    if (!v.ok || !v.link) throw new ValidationError(`link cannot be saved: ${v.problems.join('; ')}`, { problems: v.problems });
    const { fromCardId, toCardId, mechanism, rival } = v.link;
    const from = await ctx.getCard(fromCardId);
    const to = await ctx.getCard(toCardId);
    if (wouldDuplicate(await ctx.answers.card_links.all(), fromCardId, toCardId)) throw new ConflictError(DUPLICATE);
    const doc = {
      id: ctx.newId('lk'), fromCardId, toCardId, mechanism, rival, by: actor.id, day: coarsenToDay(ctx.t()).day, version: 0,
    };
    // The unique (fromCardId, toCardId) constraint is the authority; the pre-check above is only a fast path.
    try {
      await ctx.answers.card_links.insert(doc.id, doc);
    } catch (e) {
      if (e instanceof ConflictError) throw new ConflictError(DUPLICATE);
      throw e;
    }
    await ctx.audit(actor, 'link.create', doc.id);
    return linkRow(doc, from.statement, to.statement);
  }

  /** @param {any} actor @param {string} id */
  async function removeLink(actor, id) {
    ctx.need(actor, 'evolution.link');
    const key = String(id);
    if (!(await ctx.answers.card_links.remove(key))) throw new NotFoundError(`link ${key} not found`);
    await ctx.audit(actor, 'link.remove', key);
    return { removed: true };
  }

  return { cardSeries, evolutionGrid, listLinks, createLink, removeLink };
}
