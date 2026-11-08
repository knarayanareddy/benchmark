import { eq } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { bad, ok, requireExpert } from "@/lib/api";
import { redact } from "@/lib/scrub";
import { questionAcaps } from "@/lib/scoring";
import { EVIDENCE_TYPES, GAP_BASES } from "@/lib/constants";

export async function POST(req: Request) {
  const r = await requireExpert();
  if ("error" in r) return r.error;
  const { me, w } = r;
  const b = await req.json();
  const q = w.questionById.get(Number(b.questionId));
  if (!q || q.status !== "open") return bad("This question is closed.");
  if (w.forecasts.some((f) => f.questionId === q.id && f.expertId === me.id)) return bad("You've already answered — your first estimate is locked. You can revise it after the reveal.");
  const p = Math.round(Number(b.probability));
  if (!(p >= 1 && p <= 99)) return bad("Probability must be between 1 and 99.");
  const reason = redact(String(b.reason ?? "").slice(0, 600));
  const [f] = await db
    .insert(s.forecasts)
    .values({
      questionId: q.id,
      expertId: me.id,
      probability: p,
      confidence: Math.min(3, Math.max(1, Number(b.confidence) || 2)),
      reason,
      evidenceType: b.evidenceType in EVIDENCE_TYPES ? b.evidenceType : "none",
      identityMode: ["sealed", "alias", "confidential", "named"].includes(b.identityMode) ? b.identityMode : "profile",
      coiFlag: !!b.coi,
      seenAcapsFirst: !!b.peeked,
      secondsSpent: Math.min(900, Math.max(1, Number(b.secondsSpent) || 30)),
    })
    .returning({ id: s.forecasts.id });
  const risk = w.riskById.get(q.riskId);
  const ac = questionAcaps(q, risk);
  let gap = 0;
  if (ac !== null) {
    gap = Math.round(Math.abs(p - ac * 100));
    if (gap >= 25 && reason.length > 20) {
      await db.insert(s.dissents).values({ forecastId: f.id, questionId: q.id, riskId: q.riskId, gap });
    }
  }
  // mark the pushed ask as read
  await db.update(s.notifications).set({ readAt: new Date() }).where(eq(s.notifications.questionId, q.id));
  return ok({ id: f.id, gap });
}

export async function PATCH(req: Request) {
  const r = await requireExpert();
  if ("error" in r) return r.error;
  const { me, w } = r;
  const b = await req.json();
  const f = w.forecasts.find((x) => x.questionId === Number(b.questionId) && x.expertId === me.id);
  if (!f) return bad("No estimate to revise.", 404);
  const p = Math.round(Number(b.revised));
  if (!(p >= 1 && p <= 99)) return bad("Probability must be between 1 and 99.");
  await db
    .update(s.forecasts)
    .set({
      revised: p,
      seenAcapsFirst: true,
      gapBasis: String(b.gapBasis ?? "") in GAP_BASES ? String(b.gapBasis) : "",
      disconfirmer: redact(String(b.disconfirmer ?? "").slice(0, 200)),
    })
    .where(eq(s.forecasts.id, f.id));
  return ok();
}
