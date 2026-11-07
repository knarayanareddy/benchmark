import { db } from "@/db";
import * as s from "@/db/schema";
import { bad, ok, requireExpert } from "@/lib/api";
import { redact } from "@/lib/scrub";
import { ANON_ORDER, POST_KINDS } from "@/lib/constants";

export async function POST(req: Request) {
  const r = await requireExpert();
  if ("error" in r) return r.error;
  const { me, w } = r;
  const b = await req.json();
  const riskId = String(b.riskId ?? "");
  const risk = w.riskById.get(riskId);
  if (!risk) return bad("Unknown risk", 404);
  if (!me.isModerator) {
    const qids = new Set(w.questions.filter((q) => q.riskId === riskId).map((q) => q.id));
    if (!w.forecasts.some((f) => f.expertId === me.id && qids.has(f.questionId)))
      return bad("Give your own estimate first — it keeps the Roundtable independent of anchoring.", 403);
  }
  const body = redact(String(b.body ?? "").trim().slice(0, 1200));
  if (body.length < 8) return bad("Say a little more (8+ characters).");
  const kind = b.kind in POST_KINDS ? b.kind : "claim";
  let mode = ["sealed", "alias", "confidential", "named"].includes(b.identityMode) ? (b.identityMode as string) : "profile";
  // you can only ever go MORE private than your profile level on a single post
  if (mode !== "profile" && ANON_ORDER.indexOf(mode as never) < ANON_ORDER.indexOf(me.anonymity as never)) mode = "profile";
  const parent = b.parentId ? w.posts.find((p) => p.id === Number(b.parentId)) : undefined;
  const src = String(b.sourceUrl ?? "").trim().slice(0, 300);
  const [row] = await db
    .insert(s.posts)
    .values({ riskId, parentId: parent?.id ?? null, expertId: me.id, identityMode: mode, kind, body, sourceUrl: /^https?:\/\//.test(src) ? src : "" })
    .returning({ id: s.posts.id });
  if (parent && parent.expertId !== me.id) {
    await db.insert(s.notifications).values({
      expertId: parent.expertId,
      kind: "roundtable",
      riskId,
      title: `A peer replied to your point on ${risk.country}`,
      reason: "Direct replies are the only Roundtable activity we push to you.",
      score: 100,
    });
  }
  return ok({ id: row.id });
}
