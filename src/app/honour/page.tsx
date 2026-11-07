import { currentExpert } from "@/lib/session";
import { toRow } from "@/lib/world";
import { buildStats, expertiseOf } from "@/lib/scoring";
import { showExpert } from "@/lib/identity";
import { Card, H, Pill } from "@/components/ui";
import { THEMES } from "@/lib/constants";

export default async function Honour() {
  const { me, w } = await currentExpert();
  const stats = buildStats(w);
  const viewer = me ? (me.isModerator ? ({ role: "moderator", id: me.id } as const) : ({ role: "peer", id: me.id } as const)) : ({ role: "public" } as const);
  const rows = w.experts
    .filter((e) => !e.isModerator)
    .map((e) => ({ e, st: stats.get(e.id)!, ex: expertiseOf(w, stats, e) }))
    .filter(({ e, st }) => st.superEstimator && e.anonymity === "named" && e.stageOptIn)
    .sort((a, b) => (b.st.skill ?? 0) - (a.st.skill ?? 0));
  const quiet = w.experts.filter((e) => !e.isModerator && stats.get(e.id)!.superEstimator && !(e.anonymity === "named" && e.stageOptIn)).length;
  return (
    <div className="space-y-6">
      <H sub="Recognition is opt-in. If you want the stage, you get it — by name, inside the trusted circle. If you don't, your accuracy still counts, just quietly.">Honour Roll</H>
      <div className="grid gap-4 md:grid-cols-2">
        {rows.length === 0 && <Card>Nobody on the stage yet.</Card>}
        {rows.map(({ e, st, ex }) => {
          const sh = showExpert(toRow(w, e), "profile", viewer);
          const best = Object.entries(st.byTheme).filter(([, v]) => v.n >= 3).sort((a, b) => a[1].brier - b[1].brier)[0];
          return (
            <Card key={e.id} className="border-amber-200">
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-serif text-xl font-semibold">{sh.label}</div>
                  <div className="text-sm text-stone-500">{sh.sub}</div>
                </div>
                <Pill tone="amber">Super estimator</Pill>
              </div>
              <div className="mt-3 flex flex-wrap gap-2 text-xs">
                <Pill tone="teal">{e.countries.join(", ")}</Pill>
                {best && <Pill>Strongest: {THEMES[best[0]]}</Pill>}
                <Pill tone="green">{ex.tier}</Pill>
                <Pill>{st.n} resolved questions</Pill>
              </div>
              <p className="mt-2 text-xs text-stone-500">Exact scores stay private; only the tier is shown.</p>
            </Card>
          );
        })}
      </div>
      <Card className="bg-slate-900 text-slate-100">
        <h2 className="font-serif text-xl font-semibold">And the quiet ones</h2>
        <p className="mt-1 text-sm text-slate-300">
          {quiet} further top-tier estimators chose Sealed, Alias or Known-to-ACAPS. They are not listed — here or anywhere — but their accuracy carries the most weight in every circle aggregate, they receive private recognition, and ACAPS can invite them to briefings (without ever learning who Sealed experts are, via the vouch chain).
        </p>
      </Card>
      <p className="text-xs text-stone-500">Why no ranked scoreboard? Public rank turns calibration into performance and makes experts shade estimates to protect position. Tier + opt-in recognition keeps the signal clean.</p>
    </div>
  );
}
