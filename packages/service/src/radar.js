/**
 * The risk browser: the organisers' radar, read-only. An expert sees a risk's analysis unless it has a live question
 * (an open or closed card, not retired) that they have not answered: Round 1 is blind to ACAPS's reading, so that
 * question holds the analysis back until they answer it or it is resolved (docs/10-pilot-experience.md, section 3).
 * Device-held experts' answers are not on the server, so any live question holds the analysis back for them.
 * Staff always see the full view.
 */
import { loadRadar, neutralView } from '@benchmark/core/radar';
import { buildTimeline } from '@benchmark/core/timeline';
import { NotFoundError, ValidationError } from './errors.js';
import { ROLES } from './auth.js';

const LIST_CAP = 200;
const VIEWS = ['active', 'history'];
const HISTORY_STATUS = ['Materialised', 'Not materialised'];
const byId = (a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** @param {any} ctx */
export function createRadar(ctx) {
  const { risks, byId: radarById } = loadRadar(ctx.radarRaw);

  /**
   * Cards by risk id. `live`: open or closed cards (anything that is not resolved). `resolved`: resolved cards. A
   * `retired` card (a split or rewrite parent) counts as neither, so it neither holds a risk shut nor opens it. One read
   * of the cards store per call.
   */
  const cardsByRisk = async () => {
    const live = new Map();
    const resolved = new Map();
    for (const c of await ctx.answers.cards.all()) {
      if (!c.riskId || c.status === 'retired') continue;
      const into = c.status === 'resolved' ? resolved : live;
      into.set(c.riskId, [...(into.get(c.riskId) ?? []), c]);
    }
    return { live, resolved };
  };

  /** Whether this expert gave a Round-1 estimate on the card. Device-held answers are not on the server: null. */
  const answeredBy = async (/** @type {any} */ expert, /** @type {any} */ card) => {
    if (expert.tokenMode === 'device') return null;
    return Boolean(await ctx.answers.estimates.get(ctx.estimateKey(card.id, ctx.respondentKey(card, expert), 1)));
  };

  /**
   * The expert's gate for one risk. `locked` when a live card is not answered by them (a device-held expert has no
   * answer the server can see, so every live card locks). `card` is the card the lock is about: open before closed.
   */
  const gateFor = async (/** @type {any} */ expert, /** @type {any[]} */ liveCards) => {
    const ordered = [...liveCards].sort((a, b) => (a.status === 'open' ? 0 : 1) - (b.status === 'open' ? 0 : 1) || byId(a, b));
    const pending = [];
    for (const c of ordered) if ((await answeredBy(expert, c)) !== true) pending.push(c);
    return { locked: pending.length > 0, card: pending[0] ?? null };
  };

  /** Why the analysis is held: the person answers an open question, or the question closed before they answered it. */
  const lockReason = (/** @type {any} */ card, /** @type {any} */ expert) => {
    if (card.status !== 'open') return 'closed';
    return expert.tokenMode === 'device' ? 'device' : 'answer';
  };

  /** @param {any} actor @param {{ q?: string, region?: string, theme?: string, country?: string, view?: string }} [filters] */
  async function listRisks(actor, { q, region, theme, country, view } = {}) {
    ctx.need(actor, 'risk.read');
    if (view !== undefined && !VIEWS.includes(view)) throw new ValidationError(`view must be one of ${VIEWS.join(', ')}`);
    const expert = actor.role === ROLES.EXPERT ? await ctx.expertOf(actor) : null;
    const { live } = await cardsByRisk();
    const text = String(q ?? '').trim().toLowerCase();
    const iso = String(country ?? '').trim().toUpperCase();
    const rows = [];
    for (const r of risks) {
      if (text && !r.title.toLowerCase().includes(text) && !r.country.toLowerCase().includes(text)) continue;
      if (region && r.region !== region) continue;
      if (theme && r.theme !== theme) continue;
      if (iso && !r.isos.includes(iso)) continue;
      const liveCards = live.get(r.id) ?? [];
      // Locked for this viewer: the analysis is not in the row, so the row cannot be sorted by its status either.
      const locked = expert ? (await gateFor(expert, liveCards)).locked : false;
      if (view === 'active' && !locked && r.status !== 'Active') continue;
      if (view === 'history' && (locked || !HISTORY_STATUS.includes(r.status ?? ''))) continue;
      const row = {
        id: r.id, title: r.title, country: r.country, region: r.region, theme: r.theme, riskType: r.riskType,
        hasQuestion: liveCards.length > 0, liveQuestions: liveCards.length,
        answered: expert && liveCards.length > 0 && expert.tokenMode !== 'device' ? !locked : null,
      };
      if (!locked) Object.assign(row, { level: r.level, probability: r.probability, status: r.status });
      rows.push(row);
      if (rows.length === LIST_CAP) break;
    }
    return rows;
  }

  /** @param {any} actor @param {string} id */
  async function getRisk(actor, id) {
    ctx.need(actor, 'risk.read');
    const risk = radarById.get(String(id));
    if (!risk) throw new NotFoundError(`risk ${id} not found`);
    const { live, resolved } = await cardsByRisk();
    const liveCards = live.get(risk.id) ?? [];
    const hasQuestion = liveCards.length > 0;
    if (actor.role !== ROLES.EXPERT) {
      // The computed timeline replaces the raw source data. It rides only on the full view.
      return { view: 'full', hasQuestion, ...risk, timeline: buildTimeline(risk) };
    }
    const expert = await ctx.expertOf(actor);
    const gate = await gateFor(expert, liveCards);
    if (gate.locked) {
      const question = { id: gate.card.id, open: gate.card.status === 'open', answered: await answeredBy(expert, gate.card) };
      return { view: 'neutral', hasQuestion, lock: lockReason(gate.card, expert), question, ...neutralView(risk) };
    }
    // The card the Circle view is about: a live one (answered, so the viewer may see the panel), else a resolved one.
    const shown = [...(liveCards.length ? liveCards : (resolved.get(risk.id) ?? []))].sort(byId)[0];
    const question = shown ? { id: shown.id, open: shown.status === 'open', answered: await answeredBy(expert, shown) } : null;
    return { view: 'full', hasQuestion, question, ...risk, timeline: buildTimeline(risk) };
  }

  return {
    listRisks,
    getRisk,
    has: (/** @type {string} */ id) => radarById.has(id),
    hasLiveQuestion: async (/** @type {string} */ riskId) => (await cardsByRisk()).live.has(riskId),
  };
}
