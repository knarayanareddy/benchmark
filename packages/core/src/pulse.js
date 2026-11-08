/**
 * Pulse: which questions are asked of a person this week, and why. Pure: no storage, no clock. The caller decides
 * eligibility (the strict rule in dispatch.js `matches`, plus the inbox's own checks) and supplies `now` and the
 * response counts. There is no score, no minimum match and no region rule here: who may answer what is strict and
 * lives in dispatch.js.
 */

export const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
export const NEEDS_VIEWS_BELOW = 5;

/**
 * @typedef {object} Declaration
 * @property {string[]} [countries]
 * @property {string[]} [regions]
 * @property {string[]} [themes]
 */
/**
 * @typedef {object} PulseCard
 * @property {string} id
 * @property {string} country ISO 3-letter code
 * @property {string | null} [theme]
 * @property {number | null} [createdAt] ms, day-coarse
 */
/** @typedef {{ card: PulseCard, why: { label: string }[], reason: string }} Entry */

/**
 * Why a card is put to a person: the labels, no numbers.
 * @param {PulseCard} card
 * @param {Declaration | null | undefined} declaration
 * @param {{ responses?: number }} [opts]
 * @returns {{ label: string }[]}
 */
export function whyAsked(card, declaration, { responses = 0 } = {}) {
  const countries = Array.isArray(declaration?.countries) ? declaration.countries : [];
  const themes = Array.isArray(declaration?.themes) ? declaration.themes : [];
  /** @type {{ label: string }[]} */
  const why = [];
  if (countries.includes(card.country)) why.push({ label: `Covers ${card.country}` });
  if (typeof card.theme === 'string' && themes.includes(card.theme)) why.push({ label: 'Theme match' });
  if ((Number(responses) || 0) < NEEDS_VIEWS_BELOW) why.push({ label: 'The circle needs more views' });
  return why;
}

/**
 * Split the eligible candidates into this week's asks and the radar.
 *
 * Order: thin circle first (fewer than NEEDS_VIEWS_BELOW responses), then the newer card, then id. Asks are the first
 * `weeklyCap` cards created within WEEK_MS of `now`, in that order. Every other candidate is on the radar. A card with
 * no `createdAt` counts as old. A declaration with no countries, regions or themes matches nothing (as `matches` in
 * dispatch.js), so it gets no asks and no radar.
 * @param {PulseCard[]} cards
 * @param {{ weeklyCap: number, declaration?: Declaration | null }} profile
 * @param {{ now: number, responsesOf: (card: PulseCard) => number }} opts
 * @returns {{ asks: Entry[], radar: Entry[] }}
 */
export function rankAsks(cards, profile, { now, responsesOf }) {
  const d = profile.declaration;
  const declared = [d?.countries, d?.regions, d?.themes].some((list) => Array.isArray(list) && list.length > 0);
  if (!declared) return { asks: [], radar: [] };

  const ranked = (Array.isArray(cards) ? cards : [])
    .map((card) => ({ card, responses: Number(responsesOf(card)) || 0 }))
    .sort((a, b) => {
      const thinA = a.responses < NEEDS_VIEWS_BELOW ? 0 : 1;
      const thinB = b.responses < NEEDS_VIEWS_BELOW ? 0 : 1;
      if (thinA !== thinB) return thinA - thinB;
      const newer = (b.card.createdAt ?? 0) - (a.card.createdAt ?? 0);
      if (newer !== 0) return newer;
      return a.card.id < b.card.id ? -1 : a.card.id > b.card.id ? 1 : 0;
    });

  const isRecent = (/** @type {PulseCard} */ card) =>
    typeof card.createdAt === 'number' && now - card.createdAt <= WEEK_MS;
  const cap = Math.max(0, Math.floor(profile.weeklyCap));

  /** @type {Entry[]} */
  const asks = [];
  /** @type {Entry[]} */
  const radar = [];
  for (const { card, responses } of ranked) {
    const why = whyAsked(card, d, { responses });
    const labels = why.map((w) => w.label).join(' · ');
    if (asks.length < cap && isRecent(card)) {
      asks.push({ card, why, reason: labels });
    } else {
      const suffix = isRecent(card) ? "(beyond this week's cap)" : '(older than a week)';
      radar.push({ card, why, reason: [labels, suffix].filter((s) => s !== '').join(' ') });
    }
  }
  return { asks, radar };
}
