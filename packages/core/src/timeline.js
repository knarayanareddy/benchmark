/**
 * The dated history of one risk, as ACAPS recorded it (see scripts/ingest.py). Pure: no storage, no clock.
 *
 * Dates and values are "as recorded". Nothing here computes a duration or a lag from them. Completion rate is an
 * analyst-recorded reading whose meaning is not standardised, so `movement` only says which way the recorded series
 * went; it is not a rate of change or a probability. Trend movement reads Deteriorated < Stable < Improved, so 'up'
 * means the recorded trend moved towards Improved.
 */
/** @typedef {{ date: string, value: number | string, conflict: boolean }} Point */
/** @typedef {'up' | 'down' | 'flat' | 'none'} Movement */
/**
 * @typedef {object} TimelineTrigger
 * @property {string} id
 * @property {string | null} title
 * @property {Point[]} completion
 * @property {Point[]} trend
 * @property {string | null} dateEntered
 * @property {string | null} lastUpdate
 * @property {{ completion: Movement, trend: Movement }} movement
 */
/**
 * @typedef {object} Timeline
 * @property {string | null} riskTrend
 * @property {{ date: string | null, text: string }[]} rationaleUpdates
 * @property {TimelineTrigger[]} triggers only triggers with at least one dated completion or trend point
 * @property {{ from: string, to: string } | null} span earliest and latest dated point, ISO dates
 * @property {number} points dated completion and trend points plus dated rationale updates
 */

const TREND_RANK = /** @type {Record<string, number>} */ ({ Deteriorated: 0, Stable: 1, Improved: 2 });
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** @param {unknown} v @returns {v is Record<string, unknown>} */
const isObject = (v) => v !== null && typeof v === 'object';

/** A real calendar date in ISO form, or null. */
/** @param {unknown} v @returns {string | null} */
function isoOrNull(v) {
  if (typeof v !== 'string') return null;
  const m = ISO_DATE.exec(v);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d ? v : null;
}

/**
 * Valid entries in file order, each marked when another entry on the same day carries a different value.
 * A completion value must be an integer percent; a trend value is the recorded word.
 * @param {unknown} entries
 * @param {(value: unknown) => boolean} acceptValue
 * @returns {Point[]}
 */
function pointsOf(entries, acceptValue) {
  if (!Array.isArray(entries)) return [];
  const valid = [];
  for (const e of entries) {
    if (!isObject(e)) continue;
    const date = isoOrNull(e.date);
    if (date && acceptValue(e.value)) valid.push({ date, value: /** @type {number | string} */ (e.value) });
  }
  return valid.map((p) => ({
    ...p,
    conflict: valid.some((q) => q.date === p.date && q.value !== p.value),
  }));
}

/**
 * The movement between the first and last distinct dates. Each date is represented by its last entry in file order,
 * so a same-day correction counts as that day's reading. Values that cannot be ranked are ignored.
 * @param {Point[]} points
 * @param {(value: number | string) => number | null} rank
 * @returns {Movement}
 */
function movementOf(points, rank) {
  /** @type {Map<string, number>} */
  const byDate = new Map();
  for (const p of points) {
    const r = rank(p.value);
    if (r !== null) byDate.set(p.date, r);
  }
  const dates = [...byDate.keys()].sort();
  if (dates.length < 2) return 'none';
  const first = /** @type {number} */ (byDate.get(dates[0]));
  const last = /** @type {number} */ (byDate.get(dates[dates.length - 1]));
  return last > first ? 'up' : last < first ? 'down' : 'flat';
}

/** @param {number | string} v */
const completionRank = (v) => (typeof v === 'number' ? v : null);
/** @param {number | string} v */
const trendRank = (v) => (typeof v === 'string' && Object.hasOwn(TREND_RANK, v) ? TREND_RANK[v] : null);

/**
 * The timeline of a normalised risk (see normaliseRisk in radar.js). A risk with no timeline source data, such as a
 * record from the older export, gives an empty timeline.
 * @param {unknown} risk
 * @returns {Timeline}
 */
export function buildTimeline(risk) {
  const src = isObject(risk) && isObject(risk.timeline) ? risk.timeline : {};
  const rationaleUpdates = Array.isArray(src.rationaleUpdates)
    ? src.rationaleUpdates.filter(isObject).map((u) => ({
        date: isoOrNull(u.date),
        text: typeof u.text === 'string' ? u.text : '',
      }))
    : [];

  /** @type {TimelineTrigger[]} */
  const triggers = [];
  for (const t of Array.isArray(src.triggers) ? src.triggers : []) {
    if (!isObject(t) || typeof t.id !== 'string') continue;
    const completion = pointsOf(t.completionHistory, (v) => Number.isInteger(v));
    const trend = pointsOf(t.trendHistory, (v) => typeof v === 'string' && v !== '');
    if (completion.length === 0 && trend.length === 0) continue;
    triggers.push({
      id: t.id,
      title: typeof t.title === 'string' ? t.title : null,
      completion,
      trend,
      dateEntered: isoOrNull(t.dateEnteredISO),
      lastUpdate: isoOrNull(t.lastUpdateISO),
      movement: { completion: movementOf(completion, completionRank), trend: movementOf(trend, trendRank) },
    });
  }

  const dates = [
    ...triggers.flatMap((t) => [...t.completion, ...t.trend].map((p) => p.date)),
    ...rationaleUpdates.flatMap((u) => (u.date ? [u.date] : [])),
  ].sort();

  return {
    riskTrend: typeof src.riskTrend === 'string' && src.riskTrend !== '' ? src.riskTrend : null,
    rationaleUpdates,
    triggers,
    span: dates.length ? { from: dates[0], to: dates[dates.length - 1] } : null,
    points: dates.length,
  };
}

/**
 * True when the risk has at least one dated point to show.
 * @param {unknown} risk
 * @returns {boolean}
 */
export function hasHistory(risk) {
  return buildTimeline(risk).points > 0;
}
