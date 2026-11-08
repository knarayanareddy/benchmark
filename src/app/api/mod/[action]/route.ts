import { eq } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { bad, ok, requireMod } from "@/lib/api";
import { planDispatch } from "@/lib/dispatch";
import { aggregate, buildStats, questionAcaps } from "@/lib/scoring";
import { showExpert } from "@/lib/identity";
import { toRow } from "@/lib/world";

const NEXT: Record<string, string> = { open: "routed", routed: "actioned", actioned: "notified", notified: "closed" };

export async function POST(req: Request, ctx: { params: Promise<{ action: string }> }) {
  const r = await requireMod();
  if ("error" in r) return r.error;
  const { me, w } = r;
  const { action } = await ctx.params;
  const b = await req.json();

  if (action === "verify") {
    await db.update(s.experts).set({ verification: "verified" }).where(eq(s.experts.id, Number(b.expertId)));
    return ok();
  }

  if (action === "dissent") {
    const d = w.dissents.find((x) => x.id === Number(b.id));
    if (!d) return bad("Unknown dissent", 404);
    const nxt = NEXT[d.state];
    if (!nxt) return bad("Already closed");
    const note = String(b.note ?? "").trim() || d.analystNote;
    await db.update(s.dissents).set({ state: nxt, analystNote: note, updatedAt: new Date() }).where(eq(s.dissents.id, d.id));
    if (nxt === "notified") {
      const f = w.forecasts.find((x) => x.id === d.forecastId);
      const risk = w.riskById.get(d.riskId);
      if (f && risk)
        await db.insert(s.notifications).values({
          expertId: f.expertId,
          kind: "impact",
          riskId: d.riskId,
          questionId: d.questionId,
          title: `Your dissent on ${risk.country} led to an analyst action`,
          reason: `${note || "An ACAPS analyst reviewed your reasoning."} Delivered via your own private inbox — ACAPS does not need to know who you are.`,
          score: 100,
        });
    }
    return ok({ state: nxt });
  }

  if (action === "question") {
    const risk = w.riskById.get(String(b.riskId));
    if (!risk) return bad("Unknown risk", 404);
    const trig = b.triggerId ? w.triggers.find((t) => t.id === b.triggerId) : undefined;
    const signal = b.kind === "signal";
    const horizon = Math.min(30, Math.max(3, Number(b.days) || 14));
    const text =
      String(b.text ?? "").trim() ||
      (signal
        ? `Within the next ${horizon} days, will we see a concrete, observable sign of this risk: “${risk.title.slice(0, 120)}”?`
        : trig
        ? `Within the next 6 months, will this ACAPS trigger occur: “${trig.title}”?`
        : `Within the next 6 months, will this risk materialise: “${risk.title}”?`);
    const plan = planDispatch(w, risk, { id: -1 });
    const view = plan.map((p) => {
      const e = w.expertById.get(p.expertId)!;
      const sh = showExpert(toRow(w, e), "profile", { role: "moderator", id: me.id });
      return { ...p, who: sh.label, sub: sh.sub, level: sh.level };
    });
    if (b.dryRun) return ok({ plan: view, text });
    const [q] = await db
      .insert(s.questions)
      .values({
        riskId: risk.id,
        triggerId: trig?.id ?? null,
        text,
        criteria: signal
          ? "Resolved by an ACAPS analyst on the close date against the observable stated in the question, using public reporting. ‘Unobservable’ is never counted as a miss."
          : "Resolved by an ACAPS analyst on the close date using the Risk Radar evidence standard. ‘Unobservable’ is never counted as a miss.",
        kind: signal ? "signal" : "forecast",
        closesAt: new Date(Date.now() + (signal ? horizon : 183) * 86400000),
      })
      .returning({ id: s.questions.id });
    const real = planDispatch(w, risk, { id: q.id });
    const rows = real
      .filter((p) => p.decision !== "answered")
      .map((p) => ({
        expertId: p.expertId,
        kind: "question",
        questionId: q.id,
        riskId: risk.id,
        title: `${risk.country}: ${text.slice(0, 110)}`,
        reason: p.reason,
        score: p.score,
        suppressed: p.decision === "suppress",
      }));
    if (rows.length) await db.insert(s.notifications).values(rows);
    return ok({ id: q.id, sent: rows.filter((x) => !x.suppressed).length, suppressed: rows.filter((x) => x.suppressed).length });
  }

  if (action === "resolve") {
    const q = w.questionById.get(Number(b.questionId));
    if (!q) return bad("Unknown question", 404);
    const outcome = ["yes", "no", "unobservable"].includes(b.outcome) ? (b.outcome as string) : null;
    if (!outcome) return bad("Outcome must be yes, no or unobservable");
    await db.update(s.questions).set({ status: "resolved", outcome }).where(eq(s.questions.id, q.id));
    if (outcome !== "unobservable") {
      const o = outcome === "yes" ? 1 : 0;
      const stats = buildStats(w);
      const agg = aggregate(w, stats, q.id);
      const ac = questionAcaps(q, w.riskById.get(q.riskId));
      const rows = w.forecasts
        .filter((f) => f.questionId === q.id)
        .map((f) => {
          const you = (f.probability / 100 - o) ** 2;
          const crowd = agg ? (agg.mean / 100 - o) ** 2 : null;
          return {
            expertId: f.expertId,
            kind: "receipt",
            questionId: q.id,
            riskId: q.riskId,
            title: `Resolved: ${outcome.toUpperCase()} — here's how you did`,
            reason: `You said ${f.probability}%${agg ? `, the circle said ${agg.mean}%` : ""}${ac !== null ? `, ACAPS' rating implied ~${Math.round(ac * 100)}%` : ""}. Your Brier score: ${you.toFixed(2)}${crowd !== null ? ` (circle ${crowd.toFixed(2)})` : ""} — lower is better. Private to you.`,
            score: 100,
          };
        });
      if (rows.length) await db.insert(s.notifications).values(rows);
    }
    return ok();
  }

  if (action === "hide") {
    await db.update(s.posts).set({ hidden: true }).where(eq(s.posts.id, Number(b.postId)));
    return ok();
  }

  return bad("Unknown action", 404);
}
