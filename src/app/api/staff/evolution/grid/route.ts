import { NextResponse } from "next/server";
import { getWorld, cardIdOf } from "@/lib/world";
import { buildGrid } from "@/lib/grid";

export async function GET() {
  const w = await getWorld();
  const cards = w.questions
    .filter((q) => q.season === "current" || q.season === "S2")
    .map((q) => {
      const risk = w.riskById.get(q.riskId);
      return {
        id: cardIdOf(q.id),
        riskId: q.riskId,
        region: risk?.region ?? null,
        theme: risk?.theme ?? null,
        country: risk?.country ?? null,
        status: q.status,
      };
    });

  const grid = buildGrid(w.risks, cards);
  return NextResponse.json(grid);
}
