import Link from "next/link";
import { currentExpert } from "@/lib/session";
import { toRow } from "@/lib/world";
import { showExpert } from "@/lib/identity";
import { Card, H, Pill } from "@/components/ui";
import { DissentAdvance, VerifyButton } from "@/components/ModTools";
import { ModNav } from "@/components/ModNav";

export default async function Moderator() {
  const { me, w } = await currentExpert();
  if (!me?.isModerator) return <Card><p>Moderator console. Choose “ACAPS moderator” in the persona switcher (top right).</p></Card>;
  const experts = w.experts.filter((e) => !e.isModerator);
  const pending = experts.filter((e) => e.verification !== "verified");
  const openRiskQ = w.questions.filter((q) => q.status === "open" && !q.triggerId);
  const countries = Array.from(new Set(openRiskQ.flatMap((q) => w.riskById.get(q.riskId)!.countries))).sort();
  const health = countries.map((c) => {
    const circle = experts.filter((e) => e.countries.includes(c));
    const qs = openRiskQ.filter((q) => w.riskById.get(q.riskId)!.countries.includes(c));
    const resp = qs.map((q) => w.forecasts.filter((f) => f.questionId === q.id).length);
    const avg = qs.length ? resp.reduce((a, b) => a + b, 0) / qs.length : 0;
    return { c, size: circle.length, verified: circle.filter((e) => e.verification === "verified").length, sealed: circle.filter((e) => e.anonymity === "sealed").length, qs: qs.length, avg };
  });
  const dissents = [...w.dissents].sort((a, b) => b.gap - a.gap);
  const viewer = { role: "moderator" as const, id: me.id };
  const tone = (s: string) => (s === "open" ? "stone" : s === "closed" ? "green" : "teal");

  return (
    <div>
      <H sub="Light-touch moderation: ACAPS never chases experts, never sees what experts chose to hide, and every action below is one click.">Moderator console</H>
      <ModNav here="/moderator" />
      <div className="grid gap-6 lg:grid-cols-5">
        <div className="space-y-6 lg:col-span-3">
          <Card>
            <h2 className="mb-1 font-serif text-xl font-semibold">Dissent desk — where the circle challenges ACAPS</h2>
            <p className="mb-3 text-sm text-slate-600">Reasoned disagreements of ≥ 25 pts. Strict lifecycle: open → routed → actioned → notified → closed. The expert is notified through their own inbox, so even Sealed experts get closure.</p>
            <div className="space-y-3">
              {dissents.map((d) => {
                const f = w.forecasts.find((x) => x.id === d.forecastId)!;
                const risk = w.riskById.get(d.riskId)!;
                const sh = showExpert(toRow(w, w.expertById.get(f.expertId)!), f.identityMode, viewer);
                return (
                  <div key={d.id} className="rounded-xl border border-stone-200 p-3">
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <Pill tone={tone(d.state)}>{d.state}</Pill>
                      <b>{risk.country}</b>
                      <span className="text-stone-500">gap {d.gap} pts · said {f.probability}%</span>
                      <span className="ml-auto text-stone-500">{sh.label}{sh.sub ? ` · ${sh.sub}` : ""}</span>
                    </div>
                    <p className="mt-1 text-sm text-slate-800">“{f.reason}”</p>
                    {d.analystNote && <p className="mt-1 rounded bg-teal-50 p-1.5 text-xs text-teal-900">Analyst: {d.analystNote}</p>}
                    <div className="mt-2 flex items-center justify-between">
                      <Link href={`/q/${d.questionId}`} className="text-xs text-teal-700 underline">View question</Link>
                      <DissentAdvance id={d.id} state={d.state} />
                    </div>
                  </div>
                );
              })}
              {dissents.length === 0 && <p className="text-sm text-stone-500">No dissents yet.</p>}
            </div>
          </Card>
        </div>
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <h2 className="mb-1 font-serif text-xl font-semibold">Verification queue</h2>
            <p className="mb-2 text-xs text-slate-600">Check once, then the evidence is deleted. Sealed members stay unidentifiable to ACAPS.</p>
            {pending.length === 0 && <p className="text-sm text-stone-500">Everyone is verified.</p>}
            <div className="space-y-2">
              {pending.map((e) => {
                const sh = showExpert(toRow(w, e), "profile", viewer);
                return (
                  <div key={e.id} className="rounded-xl bg-stone-50 p-2 text-sm">
                    <b>{sh.label}</b> <span className="text-xs text-stone-500">{sh.sub}</span>
                    <div className="text-xs text-stone-600">{e.countries.join(", ")} · {e.invitedVia}{e.vouchedBy ? ` · vouched` : ""}</div>
                    <ul className="my-1 list-inside list-disc text-xs text-stone-600">{e.claims.map((c) => <li key={c}>{c}</li>)}</ul>
                    <VerifyButton expertId={e.id} />
                  </div>
                );
              })}
            </div>
          </Card>
          <Card>
            <h2 className="mb-1 font-serif text-xl font-semibold">Panel health by context</h2>
            <p className="mb-2 text-xs text-slate-600">Target: 5–10 per circle. Sealed counts are aggregate only.</p>
            <table className="w-full text-xs">
              <thead className="text-left text-stone-500"><tr><th>Country</th><th>Circle</th><th>Verified</th><th>Sealed</th><th>Avg views/risk</th></tr></thead>
              <tbody>
                {health.map((h) => (
                  <tr key={h.c} className="border-t border-stone-100">
                    <td className="py-1 font-medium">{h.c}</td>
                    <td className={h.size < 5 ? "font-semibold text-amber-700" : ""}>{h.size}{h.size < 5 && " ⚠"}</td>
                    <td>{h.verified}</td>
                    <td>{h.sealed}</td>
                    <td className={h.avg < 3 ? "font-semibold text-amber-700" : ""}>{h.avg.toFixed(1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-2 text-xs text-stone-500">⚠ = recruit more (small circles risk both thin signal and re-identification).</p>
          </Card>
        </div>
      </div>
    </div>
  );
}
