/**
 * Panel series for one card: one point per released round, from the ledger
 * documents `releases`.
 *
 * Privacy: a release below the floor, or without a usable published snapshot,
 * is WITHHELD as `{ round }` only. The floor can be raised but never lowered
 * below MIN_RELEASE_PANEL_SIZE (5).
 *
 * Pure: no storage, no network, no clock.
 */

export const MIN_RELEASE_PANEL_SIZE = 5;

const finite = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v);

export type ReleaseSnapshot = {
  estimate?: number | null;
  lo?: number | null;
  hi?: number | null;
  suppressed?: boolean;
  releaseHeld?: boolean;
};

export type ReleaseLedgerDoc = {
  cardId: string;
  round: number;
  n: number;
  closed: boolean;
  visibility?: string;
  at: string | number | Date;
  snapshot: ReleaseSnapshot | null;
};

export type SeriesPoint = {
  round: number;
  day: string;
  n: number;
  estimate: number;
  lo: number;
  hi: number;
};

export type SeriesResult = {
  points: SeriesPoint[];
  withheld: Array<{ round: number }>;
};

export function coarsenToDay(at: unknown): { day: string } {
  if (typeof at === "string" && /^\d{4}-\d{2}-\d{2}$/.test(at)) {
    return { day: at };
  }
  const d =
    at instanceof Date
      ? at
      : typeof at === "string" || typeof at === "number"
      ? new Date(at)
      : null;
  if (!d || Number.isNaN(d.getTime())) {
    throw new TypeError("invalid timestamp for day coarsening");
  }
  return { day: d.toISOString().slice(0, 10) };
}

export function buildSeries(
  releases: unknown[],
  { floor = MIN_RELEASE_PANEL_SIZE }: { floor?: number } = {}
): SeriesResult {
  if (!Array.isArray(releases)) {
    throw new TypeError("releases must be an array");
  }
  const effectiveFloor = Math.max(MIN_RELEASE_PANEL_SIZE, floor);

  const docs = releases
    .filter(
      (doc): doc is Record<string, unknown> & { round: number } =>
        Boolean(doc) &&
        typeof doc === "object" &&
        finite((doc as Record<string, unknown>).round)
    )
    .sort((a, b) => a.round - b.round);

  const points: SeriesPoint[] = [];
  const withheld: Array<{ round: number }> = [];

  for (const d of docs) {
    const snap = d.snapshot as ReleaseSnapshot | null | undefined;
    const usable =
      snap &&
      typeof snap === "object" &&
      snap.suppressed !== true &&
      snap.releaseHeld !== true &&
      finite(snap.estimate) &&
      finite(snap.lo) &&
      finite(snap.hi);

    if (!finite(d.n) || d.n < effectiveFloor || !usable) {
      withheld.push({ round: d.round });
      continue;
    }

    let day: string;
    try {
      day = coarsenToDay(d.at).day;
    } catch {
      withheld.push({ round: d.round });
      continue;
    }

    points.push({
      round: d.round,
      day,
      n: d.n,
      estimate: snap.estimate as number,
      lo: snap.lo as number,
      hi: snap.hi as number,
    });
  }

  return { points, withheld };
}
