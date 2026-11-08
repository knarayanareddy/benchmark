/**
 * Staff regional grid: counts of radar risks and cards per region x theme.
 * Counts only: no expert or answer data.
 *
 * Placement: a card takes its own region/theme; a missing value falls back to
 * its risk's (via riskId), and a missing region falls back to its country's.
 * A cell with fewer than MIN_CELL risks is descriptive only.
 *
 * A retired card is counted in neither `cards` nor `live`: a split or rewrite's children stand in for it, and a
 * retired question has no successor. Counting it would double a split.
 *
 * Pure: no storage, no network, no clock.
 */

import { REGIONS, THEMES, regionOfIso } from './taxonomy.js';

export const MIN_CELL = 10;

const LIVE = new Set(['open', 'closed']);

/**
 * @param {Array<{ id: string, region: string | null, theme: string | null }>} risks normaliseRisk() output
 * @param {Array<{ id?: string, region?: string | null, theme?: string | null, riskId?: string | null, country?: string | null, status?: string }>} cards
 */
export function buildGrid(risks, cards) {
  const regions = [...REGIONS];
  const themes = /** @type {string[]} */ (Object.keys(THEMES));
  const riskById = new Map(risks.map((r) => [r.id, r]));

  /** @type {Map<string, { risks: number, cards: number, live: number }>} */
  const counts = new Map();
  const key = (region, theme) => `${region}\u0000${theme}`;
  for (const region of regions) {
    for (const theme of themes) counts.set(key(region, theme), { risks: 0, cards: 0, live: 0 });
  }
  const unplaced = { risks: 0, cards: 0 };

  for (const risk of risks) {
    const cell = risk.region && risk.theme ? counts.get(key(risk.region, risk.theme)) : undefined;
    if (cell) cell.risks += 1;
    else unplaced.risks += 1;
  }

  for (const card of cards) {
    if (card.status === 'retired') continue;
    const risk = card.riskId ? riskById.get(card.riskId) : undefined;
    const region = card.region || risk?.region || regionOfIso(card.country) || null;
    const theme = card.theme || risk?.theme || null;
    const cell = region && theme && counts.get(key(region, theme));
    if (!cell) {
      unplaced.cards += 1;
      continue;
    }
    cell.cards += 1;
    if (LIVE.has(card.status ?? '')) cell.live += 1;
  }

  const cells = [];
  for (const region of regions) {
    for (const theme of themes) {
      const c = /** @type {{ risks: number, cards: number, live: number }} */ (counts.get(key(region, theme)));
      cells.push({ region, theme, risks: c.risks, cards: c.cards, live: c.live, small: c.risks < MIN_CELL });
    }
  }
  return { regions, themes, cells, minCell: MIN_CELL, unplaced };
}
