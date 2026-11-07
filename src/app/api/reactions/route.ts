import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { bad, ok, requireExpert } from "@/lib/api";
import { REACTION_TYPES } from "@/lib/constants";

export async function POST(req: Request) {
  const r = await requireExpert();
  if ("error" in r) return r.error;
  const { me, w } = r;
  const b = await req.json();
  const post = w.posts.find((p) => p.id === Number(b.postId));
  if (!post) return bad("Unknown post", 404);
  if (post.expertId === me.id) return bad("You can't react to your own post.");
  if (!(b.type in REACTION_TYPES)) return bad("Unknown reaction");
  const where = and(eq(s.reactions.postId, post.id), eq(s.reactions.expertId, me.id), eq(s.reactions.type, b.type));
  const existing = await db.select().from(s.reactions).where(where);
  if (existing.length) {
    await db.delete(s.reactions).where(where);
    return ok({ on: false });
  }
  await db.insert(s.reactions).values({ postId: post.id, expertId: me.id, type: b.type });
  if (b.type === "changed_mind") {
    await db.insert(s.notifications).values({
      expertId: post.expertId,
      kind: "impact",
      riskId: post.riskId,
      title: "A peer says your argument changed their mind",
      reason: "Anonymous recognition: you won't be told who, and they won't be told who you are.",
      score: 100,
    });
  }
  return ok({ on: true });
}
