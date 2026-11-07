import { currentExpert } from "@/lib/session";
import { toRow } from "@/lib/world";
import { buildStats, expertiseOf } from "@/lib/scoring";
import { signalsFor } from "@/lib/integrity";
import { showExpert } from "@/lib/identity";
import { Card, H, Pill } from "@/components/ui";
import { ModNav } from "@/components/ModNav";

export default async function Integrity() {
  const { me, w } = await currentExpert();
  if (!me?.isModerator) return <Card><p>Moderators only.</p></Card>;
  const stats = buildStats(w);
  const rows = w.experts
    .filter((e) => !e.isModerator)
    .map((e) => {
      const st = stats.get(e.id)!;
      return { e, st, ex: expertiseOf(w, stats, e), sig: signalsFor(st) };
    })
    .sort((a, b) => a.sig.quality - b.sig.quality);
  return (
    <div>
      <H sub="Nobody can read intent. What we can do is surface patterns — and make sure that low-information, over-confident or motivated answers cannot move the aggregate.">Integrity signals</H>
      <ModNav here="/moderator/integrity" />
      <Card className="mb-6 bg-amber-50 text-sm text-amber-900">
        Signals are prompts for a human conversation, <b>never automatic penalties</b>. Weight in the circle aggregate comes only from resolved track record (shrunk toward a floor for newcomers), so a poser or a motivated voice has a bounded effect — whether or not anybody notices.
      </Card>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[820px] text-sm">
          <thead className="text-left text-xs uppercase text-stone-500">
            <tr><th className="py-2">Expert (as you see them)</th><th>Tier</th><th>Resolved</th><th>Brier</th><th>Weight</th><th>Signal quality</th><th>Signals</th></tr>
          </thead>
          <tbody>
            {rows.map(({ e, st, ex, sig }) => {
              const sh = showExpert(toRow(w, e), "profile", { role: "moderator", id: me.id });
              return (
                <tr key={e.id} className="border-t border-stone-200 align-top">
                  <td className="py-2"><b>{sh.label}</b><div className="text-xs text-stone-500">{sh.sub}</div></td>
                  <td><Pill tone={ex.tier === "Proven" ? "green" : ex.tier === "Established" ? "teal" : "stone"}>{ex.tier}</Pill></td>
                  <td>{st.n}</td>
                  <td>{st.brier !== null ? st.brier.toFixed(2) : "—"}</td>
                  <td>×{st.weight.toFixed(1)}</td>
                  <td>
                    <div className="h-2 w-24 rounded-full bg-stone-200"><div className={`h-2 rounded-full ${sig.quality > 65 ? "bg-teal-600" : sig.quality > 40 ? "bg-amber-500" : "bg-rose-500"}`} style={{ width: `${sig.quality}%` }} /></div>
                    <span className="text-xs text-stone-500">{sig.quality}</span>
                  </td>
                  <td className="space-y-1">
                    {sig.signals.length === 0 && <span className="text-xs text-stone-400">—</span>}
                    {sig.signals.map((s) => (
                      <div key={s.code} title={s.detail}>
                        <Pill tone={s.severity === "review" ? "rose" : s.severity === "watch" ? "amber" : "stone"}>{s.label}</Pill>
                        <div className="max-w-md text-[11px] text-stone-500">{s.detail}</div>
                      </div>
                    ))}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
