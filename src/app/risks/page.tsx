import Link from "next/link";
import { currentExpert } from "@/lib/session";
import { aggregate, buildStats, MIN_PANEL, questionAcaps } from "@/lib/scoring";
import { Card, H, Pill, levelTone } from "@/components/ui";
import { THEMES } from "@/lib/constants";

export default async function Risks({ searchParams }: { searchParams: Promise<{ view?: string; country?: string }> }) {
  const sp = await searchParams;
  const { me, w } = await currentExpert();
  const stats = buildStats(w);
  const view = sp.view === "history" ? "history" : "active";
  const answered = me ? new Set(w.forecasts.filter((f) => f.expertId === me.id).map((f) => f.questionId)) : new Set<number>();
  const openQ = w.questions.filter((q) => q.status === "open" && !q.triggerId);

  // Agreement map by geography (only revealable to those who answered; moderators see all)
  const regions = new Map<string, { n: number; gap: number; spread: number; k: number }>();
  for (const q of openQ) {
    const r = w.riskById.get(q.riskId)!;
    if (me && !me.isModerator && !answered.has(q.id)) continue;
    if (!me) continue;
    const a = aggregate(w, stats, q.id);
    const ac = questionAcaps(q, r);
    if (!a || a.n < MIN_PANEL || ac === null) continue;
    const g = regions.get(r.region) ?? { n: 0, gap: 0, spread: 0, k: 0 };
    g.n += a.n; g.gap += a.mean - ac * 100; g.spread += a.spread; g.k++;
    regions.set(r.region, g);
  }

  let list = w.risks.filter((r) => (view === "active" ? r.status === "Active" : r.status === "Materialised" || r.status === "Not materialised"));
  if (sp.country) list = list.filter((r) => r.countries.includes(sp.country!));
  const countries = Array.from(new Set(w.risks.filter((r) => (view === "active" ? r.status === "Active" : r.status !== "Active")).flatMap((r) => r.countries))).sort();
  list = list.slice(0, 60);

  return (
    <div className="space-y-6">
      <H sub="Every card is a real ACAPS Risk Radar entry. Circle numbers appear only after you've answered — and only when at least three members have.">Risks &amp; the Roundtable</H>

      <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-teal-200 bg-teal-50/80 p-4 shadow-sm">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="rounded-full bg-teal-700 px-2.5 py-0.5 text-xs font-semibold text-white">Featured Roundtable</span>
            <span className="text-xs font-semibold text-teal-800">Chad / Sudan Border Insecurity (R1043)</span>
          </div>
          <p className="text-xs text-slate-700">
            Active structured debate with 6 contributions from verified experts &amp; ACAPS moderators.
          </p>
        </div>
        <Link
          href="/risks/R1043"
          className="rounded-xl bg-teal-700 px-3.5 py-2 text-xs font-semibold text-white transition hover:bg-teal-800 shadow-sm"
        >
          Enter Roundtable →
        </Link>
      </div>

      {regions.size > 0 && (
        <Card>
          <h2 className="mb-2 font-semibold">Where the circle agrees — and disagrees — with ACAPS, by geography</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {[...regions.entries()].map(([name, g]) => {
              const gap = Math.round(g.gap / g.k);
              const sp2 = Math.round(g.spread / g.k);
              return (
                <div key={name} className="rounded-xl bg-stone-50 p-3">
                  <div className="text-sm font-semibold">{name}</div>
                  <div className="mt-1 text-sm">
                    Circle vs ACAPS: <b className={gap > 8 ? "text-rose-700" : gap < -8 ? "text-indigo-700" : "text-slate-700"}>{gap > 0 ? "+" : ""}{gap} pts</b>
                  </div>
                  <div className="text-xs text-stone-500">internal spread ~{sp2} pts · {g.k} risks · {g.n} views</div>
                </div>
              );
            })}
          </div>
          <p className="mt-2 text-xs text-stone-500">Only risks you&apos;ve answered (n ≥ {MIN_PANEL}) are included — the map grows as you contribute.</p>
        </Card>
      )}

      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Link href="/risks" className={`rounded-full px-3 py-1 ${view === "active" ? "bg-slate-900 text-white" : "bg-white ring-1 ring-stone-300"}`}>Active (28)</Link>
        <Link href="/risks?view=history" className={`rounded-full px-3 py-1 ${view === "history" ? "bg-slate-900 text-white" : "bg-white ring-1 ring-stone-300"}`}>History · how ACAPS did (104)</Link>
        <form className="ml-auto">
          <input type="hidden" name="view" value={view} />
          <select name="country" defaultValue={sp.country ?? ""} className="rounded-lg border border-stone-300 bg-white px-2 py-1 text-sm">
            <option value="">All countries</option>
            {countries.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <button className="ml-2 rounded-lg bg-white px-3 py-1 text-sm ring-1 ring-stone-300">Filter</button>
        </form>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        {list.map((r) => {
          const rq = w.questions.find((q) => q.riskId === r.id && !q.triggerId && q.season === "current");
          const done = rq && answered.has(rq.id);
          const a = rq && (done || me?.isModerator) ? aggregate(w, stats, rq.id) : null;
          const nResp = rq ? w.forecasts.filter((f) => f.questionId === rq.id).length : 0;
          const postCount = w.posts.filter((p) => p.riskId === r.id && !p.hidden).length;
          return (
            <Link key={r.id} href={`/risks/${r.id}`} className="block rounded-2xl border border-stone-200 bg-white p-4 shadow-sm hover:border-teal-600">
              <div className="mb-1 flex flex-wrap items-center gap-1.5">
                <Pill tone="teal">{r.country}</Pill>
                {r.level && <Pill tone={levelTone(r.level)}>{r.level}</Pill>}
                <Pill>{THEMES[r.theme]}</Pill>
                {postCount > 0 && <Pill tone="emerald">💬 {postCount} debate posts</Pill>}
                {view === "history" && <Pill tone={r.status === "Materialised" ? "rose" : "green"}>{r.status}</Pill>}
              </div>
              <div className="font-medium leading-snug text-slate-900">{r.title}</div>
              {view === "active" && (
                <div className="mt-2 text-xs text-stone-500">
                  {nResp} circle views · {done ? (a && a.n >= MIN_PANEL ? `circle ${a.mean}% · ${a.label}` : "you answered") : "answer to reveal"}
                </div>
              )}
              {view === "history" && <div className="mt-2 text-xs text-stone-500">ACAPS rated probability: {r.probability || "unrated"}</div>}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
