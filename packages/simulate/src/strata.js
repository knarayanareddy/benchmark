/**
 * Strata for the cross-question analysis: region x theme cells of the risk radar, counted from the organisers' export
 * through the repo's own normaliser, and the multiple-comparison adjustments (Bonferroni and Holm) used when several
 * cells or pairs are tested together. Pure.
 */
import { loadRadar } from '@benchmark/core/radar';
import { REGIONS, THEMES } from '@benchmark/core/taxonomy';
import { MIN_CELL } from '@benchmark/core/grid';

/**
 * Counts of the radar by region and by region x theme. Active risks are the ones still open to forecasting; their
 * triggers are the statements a panel would be asked about. Risks with no region (none in the current export) are
 * counted in `totals.unplaced` and in no cell.
 * @param {unknown} radarArray the parsed data/risk-radar.json array
 */
export function strataSupply(radarArray) {
  const { risks } = loadRadar(radarArray);
  const regions = [...REGIONS];
  const themes = /** @type {string[]} */ (Object.keys(THEMES));

  /** @param {{ risks: number, active: number, activeTriggers: number, outcomes: number }} c */
  const blank = () => ({ risks: 0, active: 0, activeTriggers: 0, outcomes: 0 });
  /** @param {{ risks: number, active: number, activeTriggers: number, outcomes: number }} c @param {any} r */
  const add = (c, r) => {
    c.risks += 1;
    if (r.status === 'Active') {
      c.active += 1;
      c.activeTriggers += r.triggers.length;
    }
    if (r.outcome !== null) c.outcomes += 1;
  };

  /** @type {Map<string, ReturnType<typeof blank>>} */
  const byRegionMap = new Map(regions.map((g) => [g, blank()]));
  /** @type {Map<string, ReturnType<typeof blank>>} */
  const byCellMap = new Map();
  for (const g of regions) for (const t of themes) byCellMap.set(`${g}\u0000${t}`, blank());

  let unplaced = 0;
  for (const r of risks) {
    const region = r.region;
    const regionCounts = region ? byRegionMap.get(region) : undefined;
    const cell = region ? byCellMap.get(`${region}\u0000${r.theme}`) : undefined;
    if (!regionCounts || !cell) {
      unplaced += 1;
      continue;
    }
    add(regionCounts, r);
    add(cell, r);
  }

  const byRegion = regions.map((region) => ({ region, ...byRegionMap.get(region) }));
  const byRegionTheme = [];
  for (const region of regions) {
    for (const theme of themes) {
      const c = /** @type {ReturnType<typeof blank>} */ (byCellMap.get(`${region}\u0000${theme}`));
      byRegionTheme.push({ region, theme, ...c, small: c.risks < MIN_CELL });
    }
  }

  const activeRisks = risks.filter((r) => r.status === 'Active').length;
  const activeTriggers = risks.reduce((s, r) => s + (r.status === 'Active' ? r.triggers.length : 0), 0);

  return {
    minCell: MIN_CELL,
    byRegion,
    byRegionTheme,
    totals: {
      risks: risks.length,
      active: activeRisks,
      activeTriggers,
      statements: activeRisks + activeTriggers,
      outcomes: risks.filter((r) => r.outcome !== null).length,
      unplaced,
    },
    maxRisks: {
      activeRegion: Math.max(...byRegion.map((c) => c.active)),
      activeCell: Math.max(...byRegionTheme.map((c) => c.active)),
      allRegion: Math.max(...byRegion.map((c) => c.risks)),
      allCell: Math.max(...byRegionTheme.map((c) => c.risks)),
    },
  };
}

/**
 * Per-comparison alpha under Bonferroni: alpha split evenly across m comparisons.
 * @param {number} alpha
 * @param {number} m positive integer
 * @returns {number}
 */
export function bonferroniAlpha(alpha, m) {
  if (!(alpha > 0 && alpha < 1)) throw new RangeError(`alpha must be in (0, 1), got ${alpha}`);
  if (!Number.isInteger(m) || m < 1) throw new RangeError(`m must be a positive integer, got ${m}`);
  return alpha / m;
}

/**
 * Bonferroni-adjusted p-values: each multiplied by the number of tests, capped at 1.
 * @param {number[]} pvalues
 * @returns {number[]}
 */
export function bonferroniAdjust(pvalues) {
  const m = pvalues.length;
  return pvalues.map((p) => Math.min(1, p * m));
}

/**
 * Holm step-down adjusted p-values, in the input order. Never larger than Bonferroni, never smaller than the raw p.
 * @param {number[]} pvalues
 * @returns {number[]}
 */
export function holmAdjust(pvalues) {
  const m = pvalues.length;
  const order = pvalues.map((_, i) => i).sort((a, b) => pvalues[a] - pvalues[b]);
  const out = new Array(m);
  let running = 0;
  for (let rank = 0; rank < m; rank++) {
    const i = order[rank];
    running = Math.max(running, Math.min(1, (m - rank) * pvalues[i]));
    out[i] = running;
  }
  return out;
}
