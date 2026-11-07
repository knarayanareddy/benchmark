import Link from "next/link";
import { currentExpert } from "@/lib/session";
import { buildStats, MIN_PANEL } from "@/lib/scoring";
import { brief } from "@/lib/synthesis";
import { Card, H, Pill, fmtDate } from "@/components/ui";
import { ResolveButtons } from "@/components/ModTools";
import { ModNav } from "@/components/ModNav";

export default async function Synthesis() {
  const { me, w } = await currentExpert();
  if (!me?.isModerator) return <Card><p>Moderators only.</p></Card>;
  const stats = buildStats(w);
  const qs = w.questions
    .filter((q) => q.season === "current")
    .sort((a, b) => w.forecasts.filter((f) => f.questionId === b.id).length - w.forecasts.filter((f) => f.questionId === a.id).length);
  return (
    <div>
      <H sub="A deterministic, auditable brief per question — consensus, divergence from ACAPS, themes, dissent and suggested analyst actions. Experts never talk to a chatbot; AI could draft these briefs behind the scenes, but a human moderator signs off.">Synthesis &amp; resolution</H>
      <ModNav here="/moderator/synthesis" />
      <div className="space-y-4">
        {qs.slice(0, 14).map((q) => {
          const risk = w.riskById.get(q.riskId)!;
          const b = brief(w, stats, q, risk, me.id);
          const n = w.forecasts.filter((f) => f.questionId === q.id).length;
          return (
            <Card key={q.id}>
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <Pill tone="teal">{risk.country}</Pill>
                <Pill tone={q.triggerId ? "indigo" : "stone"}>{q.triggerId ? "trigger" : "risk"}</Pill>
                <Pill tone={q.status === "open" ? "amber" : "green"}>{q.status}{q.outcome ? `: ${q.outcome}` : ""}</Pill>
                <span className="text-stone-500">n={n} · closes {fmtDate(q.closesAt)}</span>
              </div>
              <Link href={`/q/${q.id}`} className="mt-1 block font-medium text-slate-900 hover:underline">{q.text}</Link>
              <ul className="mt-2 list-inside list-disc text-sm text-slate-700">
                {b.lines.map((l, i) => <li key={i}>{l}</li>)}
              </ul>
              {b.actions.length > 0 && (
                <div className="mt-2 rounded-lg bg-indigo-50 p-2 text-sm text-indigo-900">
                  <b>Suggested analyst actions</b>
                  <ul className="list-inside list-disc">{b.actions.map((a, i) => <li key={i}>{a}</li>)}</ul>
                </div>
              )}
              {b.dissent.length > 0 && (
                <div className="mt-2 text-xs text-stone-600">
                  {b.dissent.map((d, i) => <div key={i}>↳ <b>{d.who}</b> ({d.p}%): “{d.text.slice(0, 160)}”</div>)}
                </div>
              )}
              {n < MIN_PANEL && <div className="mt-2 text-xs text-amber-700">Below the small-cell threshold — no aggregate is released to anyone.</div>}
              {q.status === "open" && <div className="mt-3"><ResolveButtons questionId={q.id} /></div>}
            </Card>
          );
        })}
      </div>
    </div>
  );
}
