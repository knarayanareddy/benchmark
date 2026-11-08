import { cookies } from "next/headers";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { DEMO_MODE, canAssume, clearSession, readOwned, setSession } from "@/lib/session";
import { bad, ok } from "@/lib/api";

/**
 * Switching persona is a DEMO affordance. A persona can only be assumed if
 *  (a) this browser created it (signed ownership cookie), or
 *  (b) it is a seeded demo persona AND DEMO_MODE is on.
 */
export async function POST(req: Request) {
  const { expertId } = await req.json();
  const id = Number(expertId);
  const [row] = await db.select().from(s.experts).where(eq(s.experts.id, id));
  if (!row) return bad("Unknown persona", 404);
  const jar = await cookies();
  if (!canAssume(row, readOwned(jar))) {
    if (!DEMO_MODE) {
      return bad("This profile belongs to another browser. Sign in with its own link instead.", 403);
    }
  }
  setSession(jar, id, true);
  return ok({ expertId: id });
}

export async function DELETE() {
  const jar = await cookies();
  clearSession(jar);
  jar.delete("gt_expert");
  return ok();
}
