/**
 * The risk browser: the organisers' radar, read-only. An expert sees a risk's analysis only once it has a question and
 * every question on it is resolved (docs/10-pilot-experience.md, section 3). Staff always see the full view.
 */
import { loadRadar, neutralView } from '@benchmark/core/radar';
import { buildTimeline } from '@benchmark/core/timeline';
import { NotFoundError } from './errors.js';
import { ROLES } from './auth.js';

const LIST_CAP = 200;

/**
 * @param {{ radarRaw?: unknown, answers: any, need: (actor: any, permission: string) => void }} ctx
 */
export function createRadar(ctx) {
  const { risks, byId } = loadRadar(ctx.radarRaw);

  /**
   * `live`: risk ids with a card still being asked (open or closed). `resolved`: ids with at least one resolved card.
   * A `retired` card (a split or rewrite parent, or a retired question, which has no children) counts as neither live
   * nor resolved, so a risk whose only cards are retired stays neutral for experts (fails closed). One read of the
   * cards store per call.
   */
  const cardState = async () => {
    const live = new Set();
    const resolved = new Set();
    for (const c of await ctx.answers.cards.all()) {
      if (!c.riskId || c.status === 'retired') continue;
      if (c.status === 'resolved') resolved.add(c.riskId);
      else live.add(c.riskId);
    }
    return { live, resolved };
  };

  /** @param {any} actor @param {{ q?: string, region?: string, theme?: string, country?: string }} [filters] */
  async function listRisks(actor, { q, region, theme, country } = {}) {
    ctx.need(actor, 'risk.read');
    const { live } = await cardState();
    const text = String(q ?? '').trim().toLowerCase();
    const iso = String(country ?? '').trim().toUpperCase();
    const rows = [];
    for (const r of risks) {
      if (text && !r.title.toLowerCase().includes(text) && !r.country.toLowerCase().includes(text)) continue;
      if (region && r.region !== region) continue;
      if (theme && r.theme !== theme) continue;
      if (iso && !r.isos.includes(iso)) continue;
      rows.push({ id: r.id, title: r.title, country: r.country, region: r.region, theme: r.theme, riskType: r.riskType, hasQuestion: live.has(r.id) });
      if (rows.length === LIST_CAP) break;
    }
    return rows;
  }

  /** @param {any} actor @param {string} id */
  async function getRisk(actor, id) {
    ctx.need(actor, 'risk.read');
    const risk = byId.get(String(id));
    if (!risk) throw new NotFoundError(`risk ${id} not found`);
    const { live, resolved } = await cardState();
    const hasQuestion = live.has(risk.id);
    // An expert gets the analysis only after a question on the risk has been asked and every one has been resolved,
    // so an answer is never shaped by it (Round 1 is blind).
    const expertFull = resolved.has(risk.id) && !hasQuestion;
    if (actor.role === ROLES.EXPERT && !expertFull) {
      return { view: 'neutral', hasQuestion, ...neutralView(risk) };
    }
    // The computed timeline replaces the raw source data. It rides only on the full view, so it follows the same blind rule.
    return { view: 'full', hasQuestion, ...risk, timeline: buildTimeline(risk) };
  }

  return {
    listRisks,
    getRisk,
    has: (/** @type {string} */ id) => byId.has(id),
    hasLiveQuestion: async (/** @type {string} */ riskId) => (await cardState()).live.has(riskId),
  };
}
