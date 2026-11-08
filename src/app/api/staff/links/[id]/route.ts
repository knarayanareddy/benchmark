import { NextResponse } from "next/server";
import { db } from "@/db";
import * as s from "@/db/schema";
import { eq } from "drizzle-orm";
import { currentExpert } from "@/lib/session";

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { me } = await currentExpert();
  if (!me?.isModerator) {
    return NextResponse.json(
      { error: "Only moderators can remove analyst links." },
      { status: 403 }
    );
  }

  const { id } = await params;
  const key = String(id).trim();
  const deleted = await db
    .delete(s.cardLinks)
    .where(eq(s.cardLinks.id, key))
    .returning({ id: s.cardLinks.id });

  if (!deleted.length) {
    return NextResponse.json(
      { error: `link ${key} not found` },
      { status: 404 }
    );
  }

  return NextResponse.json({ removed: true, id: key });
}
