import { NextResponse } from "next/server";
import { db } from "@/db";
import * as s from "@/db/schema";
import { eq } from "drizzle-orm";
import {
  getWorld,
  loadWorld,
  cardIdOf,
  questionIdFromCardId,
} from "@/lib/world";
import { buildSeries, MIN_RELEASE_PANEL_SIZE } from "@/lib/series";
import { aggregate, buildStats } from "@/lib/scoring";
import { currentExpert } from "@/lib/session";

const SERIES_NOTE =
  "At most two rounds exist per card. A later window is a new card, not a third round.";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const w = await getWorld();
  const qid = questionIdFromCardId(id);
  const q = qid !== null ? w.questionById.get(qid) : undefined;
  if (!q) {
    return NextResponse.json({ error: `card ${id} not found` }, { status: 404 });
  }

  const cid = cardIdOf(q.id);
  const risk = w.riskById.get(q.riskId);
  const statement = `${risk ? `[${risk.country}] ` : ""}${q.text}`;

  // Only closed, panel-visible ledger documents: an open round's snapshot would allow sequential differencing.
  const docs = w.releases.filter(
    (d) =>
      (d.cardId === cid || d.questionId === q.id) &&
      d.closed === true &&
      d.visibility === "panel"
  );

  const latest = new Map<number, (typeof docs)[number]>();
  for (const d of docs) {
    const cur = latest.get(d.round);
    if (!cur || d.n > cur.n) latest.set(d.round, d);
  }

  const series = buildSeries([...latest.values()], {
    floor: MIN_RELEASE_PANEL_SIZE,
  });

  const closedRounds = Array.isArray(q.closedRounds)
    ? q.closedRounds
    : [1, 2].filter(
        (r) => r <= q.round && (r < q.round || q.status !== "open")
      );
  const missing = closedRounds
    .filter(
      (r) =>
        !latest.has(r) && !series.withheld.some((wItem) => wItem.round === r)
    )
    .map((round) => ({ round }));

  const withheld = [...series.withheld, ...missing].sort(
    (a, b) => a.round - b.round
  );
  const openPrefix =
    q.status === "open" && !closedRounds.includes(q.round)
      ? `Round ${q.round} is still open, so nothing from it is shown until it closes. `
      : "";

  return NextResponse.json({
    cardId: cid,
    questionId: q.id,
    statement,
    status: q.status,
    round: q.round,
    closedRounds,
    points: series.points,
    withheld,
    note: `${openPrefix}${SERIES_NOTE}`,
  });
}

/** Moderator action: close the active round on this card and write a closed ledger snapshot. */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const { me } = await currentExpert();
  if (!me?.isModerator) {
    return NextResponse.json({ error: "Moderators only" }, { status: 403 });
  }
  const w = await loadWorld();
  const qid = questionIdFromCardId(id);
  const q = qid !== null ? w.questionById.get(qid) : undefined;
  if (!q) {
    return NextResponse.json({ error: `card ${id} not found` }, { status: 404 });
  }

  const cid = cardIdOf(q.id);
  const closedRounds = Array.isArray(q.closedRounds) ? [...q.closedRounds] : [];
  const roundToClose = !closedRounds.includes(1) ? 1 : !closedRounds.includes(2) ? 2 : null;
  if (roundToClose === null) {
    return NextResponse.json(
      { error: "Both Round 1 and Round 2 are already closed on this card." },
      { status: 409 }
    );
  }

  const stats = buildStats(w);
  const agg = aggregate(w, stats, q.id);
  const n = agg?.n ?? 0;
  const suppressed = n < MIN_RELEASE_PANEL_SIZE || !agg;

  await db.insert(s.releases).values({
    cardId: cid,
    questionId: q.id,
    round: roundToClose,
    n,
    closed: true,
    visibility: "panel",
    at: new Date(),
    snapshot: suppressed
      ? {
          estimate: null,
          lo: null,
          hi: null,
          suppressed: true,
          releaseHeld: true,
        }
      : {
          estimate: Number(Math.min(0.98, Math.max(0.02, agg.mean / 100)).toFixed(3)),
          lo: Number(Math.min(0.98, Math.max(0.02, agg.p10 / 100)).toFixed(3)),
          hi: Number(Math.min(0.98, Math.max(0.02, agg.p90 / 100)).toFixed(3)),
          suppressed: false,
        },
  });

  const nextClosed = [...new Set([...closedRounds, roundToClose])].sort();
  const nextRound = roundToClose === 1 ? 2 : 2;
  const nextStatus = roundToClose === 2 && q.status === "open" ? "closed" : q.status;

  await db
    .update(s.questions)
    .set({
      round: nextRound,
      closedRounds: nextClosed,
      status: nextStatus,
    })
    .where(eq(s.questions.id, q.id));

  return GET(_req, { params: Promise.resolve({ id }) });
}
