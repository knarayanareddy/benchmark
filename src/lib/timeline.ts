/**
 * The dated history of one risk, as ACAPS recorded it (see scripts/ingest.py). Pure: no storage, no clock.
 *
 * Dates and values are "as recorded". Nothing here computes a duration or a lag from them. Completion rate is an
 * analyst-recorded reading whose meaning is not standardised, so `movement` only says which way the recorded series
 * went; it is not a rate of change or a probability. Trend movement reads Deteriorated < Stable < Improved, so 'up'
 * means the recorded trend moved towards Improved.
 */

export type Point<T extends number | string = number | string> = {
  date: string;
  value: T;
  conflict: boolean;
};

export type Movement = "up" | "down" | "flat" | "none";

export type TimelineTrigger = {
  id: string;
  title: string | null;
  completion: Point<number>[];
  trend: Point<string>[];
  dateEntered: string | null;
  lastUpdate: string | null;
  movement: { completion: Movement; trend: Movement };
};

export type RationaleUpdate = {
  date: string | null;
  text: string;
};

export type Timeline = {
  riskTrend: string | null;
  rationaleUpdates: RationaleUpdate[];
  triggers: TimelineTrigger[];
  span: { from: string; to: string } | null;
  points: number;
};

const TREND_RANK: Record<string, number> = {
  Deteriorated: 0,
  Stable: 1,
  Improved: 2,
};

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

const isObject = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object";

/** A real calendar date in ISO form, or null. */
export function isoOrNull(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const m = ISO_DATE.exec(v);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y &&
    dt.getUTCMonth() === mo - 1 &&
    dt.getUTCDate() === d
    ? v
    : null;
}

/**
 * Valid entries in file order, each marked when another entry on the same day carries a different value.
 * A completion value must be an integer percent; a trend value is the recorded word.
 */
function pointsOf<T extends number | string>(
  entries: unknown,
  acceptValue: (value: unknown) => value is T
): Point<T>[] {
  if (!Array.isArray(entries)) return [];
  const valid: Array<{ date: string; value: T }> = [];
  for (const e of entries) {
    if (!isObject(e)) continue;
    const date = isoOrNull(e.date);
    if (date && acceptValue(e.value)) {
      valid.push({ date, value: e.value });
    }
  }
  return valid.map((p) => ({
    ...p,
    conflict: valid.some((q) => q.date === p.date && q.value !== p.value),
  }));
}

/**
 * The movement between the first and last distinct dates. Each date is represented by its last entry in file order,
 * so a same-day correction counts as that day's reading. Values that cannot be ranked are ignored.
 */
function movementOf<T extends number | string>(
  points: Point<T>[],
  rank: (value: T) => number | null
): Movement {
  const byDate = new Map<string, number>();
  for (const p of points) {
    const r = rank(p.value);
    if (r !== null) byDate.set(p.date, r);
  }
  const dates = [...byDate.keys()].sort();
  if (dates.length < 2) return "none";
  const first = byDate.get(dates[0])!;
  const last = byDate.get(dates[dates.length - 1])!;
  return last > first ? "up" : last < first ? "down" : "flat";
}

const completionRank = (v: number): number | null =>
  typeof v === "number" ? v : null;

const trendRank = (v: string): number | null =>
  typeof v === "string" && Object.prototype.hasOwnProperty.call(TREND_RANK, v)
    ? TREND_RANK[v]
    : null;

export type RawTimelineSource = {
  riskTrend?: string | null;
  trend?: string | null;
  rationaleUpdates?: Array<{ date: string | null; text: string }>;
  triggers?: Array<{
    id: string;
    title?: string | null;
    completionHistory?: Array<{ date: string; value: number }>;
    trendHistory?: Array<{ date: string; value: string }>;
    dateEnteredISO?: string | null;
    lastUpdateISO?: string | null;
  }>;
  timeline?: RawTimelineSource;
};

/**
 * The timeline of a normalised risk. A risk with no timeline source data gives an empty timeline.
 */
export function buildTimeline(risk: unknown): Timeline {
  const obj = isObject(risk) ? risk : {};
  const src = isObject(obj.timeline) ? obj.timeline : obj;
  const rationaleUpdates: RationaleUpdate[] = Array.isArray(src.rationaleUpdates)
    ? src.rationaleUpdates.filter(isObject).map((u) => ({
        date: isoOrNull(u.date),
        text: typeof u.text === "string" ? u.text : "",
      }))
    : [];

  const triggers: TimelineTrigger[] = [];
  const rawTriggers = Array.isArray(src.triggers) ? src.triggers : [];
  for (const t of rawTriggers) {
    if (!isObject(t) || typeof t.id !== "string") continue;
    const completion = pointsOf<number>(
      t.completionHistory,
      (v): v is number => typeof v === "number" && Number.isInteger(v)
    );
    const trend = pointsOf<string>(
      t.trendHistory,
      (v): v is string => typeof v === "string" && v !== ""
    );
    if (completion.length === 0 && trend.length === 0) continue;
    triggers.push({
      id: t.id,
      title: typeof t.title === "string" ? t.title : null,
      completion,
      trend,
      dateEntered: isoOrNull(t.dateEnteredISO),
      lastUpdate: isoOrNull(t.lastUpdateISO),
      movement: {
        completion: movementOf(completion, completionRank),
        trend: movementOf(trend, trendRank),
      },
    });
  }

  const dates = [
    ...triggers.flatMap((t) => [...t.completion, ...t.trend].map((p) => p.date)),
    ...rationaleUpdates.flatMap((u) => (u.date ? [u.date] : [])),
  ].sort();

  const rawTrend =
    typeof src.riskTrend === "string" && src.riskTrend !== ""
      ? src.riskTrend
      : typeof src.trend === "string" && src.trend !== ""
      ? src.trend
      : null;

  return {
    riskTrend: rawTrend,
    rationaleUpdates,
    triggers,
    span: dates.length ? { from: dates[0], to: dates[dates.length - 1] } : null,
    points: dates.length,
  };
}

/**
 * True when the risk has at least one dated point to show.
 */
export function hasHistory(risk: unknown): boolean {
  return buildTimeline(risk).points > 0;
}
