import { NextResponse } from "next/server";
import { db } from "@/db";
import * as s from "@/db/schema";
import { getWorld, loadWorld, cardIdOf, questionIdFromCardId } from "@/lib/world";
import { validateLink, wouldDuplicate } from "@/lib/links";
import { coarsenToDay } from "@/lib/series";
import { currentExpert } from "@/lib/session";

function statementMap(w: Awaited<ReturnType<typeof getWorld>>): Map<string, string> {
  const m = new Map<string, string>();
  for (const q of w.questions) {
    const risk = w.riskById.get(q.riskId);
    m.set(cardIdOf(q.id), `${risk ? `[${risk.country}] ` : ""}${q.text}`);
  }
  return m;
}

export async function GET() {
  const w = await getWorld();
  const statements = statementMap(w);
  const rows = w.cardLinks.map((l) => ({
    id: l.id,
    fromCardId: l.fromCardId,
    toCardId: l.toCardId,
    fromStatement: statements.get(l.fromCardId) ?? null,
    toStatement: statements.get(l.toCardId) ?? null,
    mechanism: l.mechanism,
    rival: l.rival,
    by: l.by,
    day: l.day,
  }));
  return NextResponse.json(rows);
}

export async function POST(req: Request) {
  const { me } = await currentExpert();
  if (!me?.isModerator) {
    return NextResponse.json(
      { error: "Only moderators can record analyst links." },
      { status: 403 }
    );
  }

  const body = await req.json().catch(() => ({}));
  const v = validateLink(body);
  if (!v.ok || !v.link) {
    return NextResponse.json(
      {
        error: `link cannot be saved: ${v.problems.join("; ")}`,
        problems: v.problems,
      },
      { status: 400 }
    );
  }

  const w = await loadWorld();
  const fromQid = questionIdFromCardId(v.link.fromCardId);
  const toQid = questionIdFromCardId(v.link.toCardId);
  const fromQ = fromQid !== null ? w.questionById.get(fromQid) : undefined;
  const toQ = toQid !== null ? w.questionById.get(toQid) : undefined;

  if (!fromQ || !toQ) {
    return NextResponse.json(
      { error: "Both fromCardId and toCardId must exist." },
      { status: 404 }
    );
  }

  const fromCardId = cardIdOf(fromQ.id);
  const toCardId = cardIdOf(toQ.id);

  if (wouldDuplicate(w.cardLinks, fromCardId, toCardId)) {
    return NextResponse.json(
      { error: "this link already exists" },
      { status: 409 }
    );
  }

  const id = `lk-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const day = coarsenToDay(new Date()).day;
  const by = me.alias || "ACAPS moderator";

  await db.insert(s.cardLinks).values({
    id,
    fromCardId,
    toCardId,
    mechanism: v.link.mechanism,
    rival: v.link.rival,
    by,
    day,
    version: 0,
  });

  const statements = statementMap(w);
  return NextResponse.json(
    {
      id,
      fromCardId,
      toCardId,
      fromStatement: statements.get(fromCardId) ?? null,
      toStatement: statements.get(toCardId) ?? null,
      mechanism: v.link.mechanism,
      rival: v.link.rival,
      by,
      day,
    },
    { status: 201 }
  );
}
