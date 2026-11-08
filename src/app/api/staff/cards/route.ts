import { NextResponse } from "next/server";
import { getWorld, cardIdOf } from "@/lib/world";

export async function GET() {
  const w = await getWorld();
  const cards = w.questions
    .filter((q) => q.season === "current" || q.season === "S2")
    .map((q) => {
      const risk = w.riskById.get(q.riskId);
      const count = w.forecasts.filter((f) => f.questionId === q.id).length;
      return {
        id: cardIdOf(q.id),
        questionId: q.id,
        riskId: q.riskId,
        country: risk?.country ?? "",
        region: risk?.region ?? null,
        theme: risk?.theme ?? null,
        statement: `${risk ? `[${risk.country}] ` : ""}${q.text}`,
        rawStatement: q.text,
        status: q.status,
        round: q.round,
        closedRounds: q.closedRounds,
        kind: q.kind,
        respondents: count,
      };
    });
  return NextResponse.json(cards);
}
