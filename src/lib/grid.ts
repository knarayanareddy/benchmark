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

import { THEMES } from "./constants";

export const REGIONS = [
  "East & Southern Africa",
  "Middle East & North Africa",
  "Sahel & West/Central Africa",
  "Americas & Europe",
  "South-East Asia & Pacific",
  "South & Central Asia",
] as const;

export const MIN_CELL = 10;

const LIVE = new Set(["open", "closed"]);

export type GridCell = {
  region: string;
  theme: string;
  risks: number;
  cards: number;
  live: number;
  small: boolean;
};

export type GridResult = {
  regions: string[];
  themes: string[];
  cells: GridCell[];
  minCell: number;
  unplaced: { risks: number; cards: number };
};

export function buildGrid(
  risks: Array<{ id: string; region: string | null; theme: string | null }>,
  cards: Array<{
    id?: string | number;
    region?: string | null;
    theme?: string | null;
    riskId?: string | null;
    country?: string | null;
    status?: string;
  }>
): GridResult {
  const regions = [...REGIONS];
  const themes = Object.keys(THEMES);
  const riskById = new Map(risks.map((r) => [r.id, r]));

  const counts = new Map<string, { risks: number; cards: number; live: number }>();
  const key = (region: string, theme: string) => `${region}\u0000${theme}`;
  for (const region of regions) {
    for (const theme of themes) {
      counts.set(key(region, theme), { risks: 0, cards: 0, live: 0 });
    }
  }
  const unplaced = { risks: 0, cards: 0 };

  for (const risk of risks) {
    const cell =
      risk.region && risk.theme ? counts.get(key(risk.region, risk.theme)) : undefined;
    if (cell) cell.risks += 1;
    else unplaced.risks += 1;
  }

  for (const card of cards) {
    if (card.status === "retired") continue;
    const risk = card.riskId ? riskById.get(card.riskId) : undefined;
    const region = card.region || risk?.region || null;
    const theme = card.theme || risk?.theme || null;
    const cell = region && theme ? counts.get(key(region, theme)) : undefined;
    if (!cell) {
      unplaced.cards += 1;
      continue;
    }
    cell.cards += 1;
    if (LIVE.has(card.status ?? "")) cell.live += 1;
  }

  const cells: GridCell[] = [];
  for (const region of regions) {
    for (const theme of themes) {
      const c = counts.get(key(region, theme))!;
      cells.push({
        region,
        theme,
        risks: c.risks,
        cards: c.cards,
        live: c.live,
        small: c.risks < MIN_CELL,
      });
    }
  }
  return { regions, themes, cells, minCell: MIN_CELL, unplaced };
}
