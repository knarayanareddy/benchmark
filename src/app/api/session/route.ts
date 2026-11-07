import { cookies } from "next/headers";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { COOKIE } from "@/lib/session";
import { getWorld } from "@/lib/world";
import { bad, ok } from "@/lib/api";

export async function POST(req: Request) {
  const { expertId } = await req.json();
  const id = Number(expertId);
  const w = await getWorld();

  let exists = w.expertById.has(id);
  if (!exists) {
    const [row] = await db.select().from(s.experts).where(eq(s.experts.id, id));
    if (row) exists = true;
  }

  if (!exists) return bad("Unknown persona", 404);

  const jar = await cookies();
  jar.set(COOKIE, String(id), { path: "/", httpOnly: true, sameSite: "lax", maxAge: 60 * 60 * 24 * 30 });
  return ok({ expertId: id });
}

export async function DELETE() {
  const jar = await cookies();
  jar.set(COOKIE, "", { path: "/", httpOnly: true, sameSite: "lax", maxAge: 0 });
  jar.delete(COOKIE);
  return ok();
}

