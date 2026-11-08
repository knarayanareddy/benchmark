import Link from "next/link";
import { redirect } from "next/navigation";
import { currentExpert, pickablePersonas } from "@/lib/session";
import { buildStats, expertiseOf, badgesOf, aggregate, type Stats } from "@/lib/scoring";
import { matchScore } from "@/lib/dispatch";
import { Card, H, Pill, ago, fmtDate } from "@/components/ui";
import { PersonaSelector, type PersonaCardInfo } from "@/components/PersonaSelector";
import { PulseToolbar } from "@/components/PulseToolbar";

export default async function Pulse() {
  const { me, w } = await currentExpert();

  const toPersonaCard = (e: (typeof w.experts)[number]): PersonaCardInfo => ({
    id: e.id,
    name: e.realName,
    alias: e.alias,
    org: e.org,
    role: e.roleType,
    country: e.countries[0] ?? "",
    anonymity: e.anonymity,
    isModerator: e.isModerator,
    isCustom: e.archetype === "real" || e.id > 29,
  });

  const cards = (await pickablePersonas(w)).map(toPersonaCard);

  if (!me) {
    return (
      <div className="space-y-6">
        <H sub="Pick a demo persona from below or join with an invite code to access your customized feed.">
          Your Pulse
        </H>
        <PersonaSelector
          currentId={null}
          personas={cards}
          title="Pick a persona to view your Pulse"
          sub="Each persona receives a personalized, weekly-capped stream of risk questions tailored to their declared country and thematic expertise."
          returnTo="/pulse"
        />
      </div>
    );
  }

  if (me.isModerator) redirect("/moderator");

  const stats = buildStats(w);
  const defaultStat: Stats = {
    expertId: me.id,
    allN: 0,
    n: 0,
    brier: null,
    skill: null,
    bias: null,
    revisionGain: null,
    flatRate: 0,
    rubberRate: 0,
    avgSecs: 60,
    avgReason: 0,
    loadedRate: 0,
    coiCount: 0,
    speederRate: 0,
    weight: 1,
    superEstimator: false,
    byTheme: {},
  };
  const st = stats.get(me.id) ?? defaultStat;
  const ex = expertiseOf(w, stats, me);
  const answered = new Set(w.forecasts.filter((f) => f.expertId === me.id).map((f) => f.questionId));
  const open = new Map(w.questions.filter((q) => q.status === "open").map((q) => [q.id, q]));
  const mine = w.notifications.filter((n) => n.expertId === me.id).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  const asks = mine.filter((n) => n.kind === "question" && !n.suppressed && n.questionId && open.has(n.questionId) && !answered.has(n.questionId));
  const updates = mine.filter((n) => n.kind !== "question" && !n.suppressed).slice(0, 6);
  const suppressed = mine.filter((n) => n.kind === "question" && n.suppressed);
  const pushed = new Set(asks.map((a) => a.questionId));
  const radar = w.questions
    .filter((q) => q.status === "open" && !answered.has(q.id) && !pushed.has(q.id) && !q.triggerId)
    .map((q) => ({ q, m: matchScore(w, me, w.riskById.get(q.riskId)!, 0) }))
    .filter((x) => x.m.score >= me.minMatch)
    .sort((a, b) => b.m.score - a.m.score)
    .slice(0, 5);
  const badges = badgesOf(w, stats, me);
  // circle health
  const country = me.countries[0];
  const circle = w.experts.filter((e) => !e.isModerator && e.countries.includes(country));
  const circleQ = w.questions.filter((q) => q.status === "open" && !q.triggerId && w.riskById.get(q.riskId)?.countries.includes(country));
  const circleAnswered = circleQ.filter((q) => aggregate(w, stats, q.id) && w.forecasts.filter((f) => f.questionId === q.id).length >= 3).length;

  return (
    <div className="space-y-6">
      <PulseToolbar me={me} personas={cards} />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <H sub={`Hello ${me.alias}. We only ask when your declared expertise matches — ${me.weeklyCap}/week at most. Nothing here is urgent unless it says so.`}>Your Pulse</H>

        {asks.length === 0 && (
          <Card>
            <div className="text-lg font-semibold text-slate-900">You&apos;re all caught up ✓</div>
            <p className="text-sm text-slate-600">No new asks this week. That&apos;s the system respecting your time — you&apos;ll be pinged when ACAPS publishes or changes a risk in your domain.</p>
          </Card>
        )}
        {asks.map((n) => {
          const q = open.get(n.questionId!)!;
          const risk = w.riskById.get(q.riskId)!;
          return (
            <Card key={n.id} className="border-teal-200">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <Pill tone="teal">Asked of you</Pill>
                {q.kind === "signal" && <Pill tone="amber">⚡ Fast loop · resolves in days</Pill>}
                <Pill>{risk.country}</Pill>
                <span className="text-xs text-stone-500">{ago(n.createdAt)} · closes {fmtDate(q.closesAt)}</span>
              </div>
              <h3 className="font-serif text-lg font-semibold leading-snug">{q.kind === "signal" ? q.text : risk.title}</h3>
              <div className="mt-2 rounded-lg bg-stone-50 px-3 py-2 text-xs text-stone-600">
                <b>Why you&apos;re seeing this:</b> {n.reason} · match {n.score}/100
              </div>
              <Link href={`/q/${q.id}`} className="mt-3 inline-block rounded-xl bg-teal-700 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-800">
                Answer in ~90 seconds →
              </Link>
            </Card>
          );
        })}

        {updates.length > 0 && (
          <div>
            <h2 className="mb-2 font-serif text-xl font-semibold">What your input did</h2>
            <div className="space-y-2">
              {updates.map((n) => (
                <Card key={n.id} className="!p-4">
                  <div className="flex items-center gap-2 text-xs text-stone-500">
                    <Pill tone={n.kind === "impact" ? "green" : n.kind === "receipt" ? "indigo" : "stone"}>
                      {n.kind === "impact" ? "Impact receipt" : n.kind === "receipt" ? "Resolution receipt" : "Reply"}
                    </Pill>
                    {ago(n.createdAt)}
                  </div>
                  <div className="mt-1 font-semibold text-slate-900">{n.title}</div>
                  <div className="text-sm text-slate-600">{n.reason}</div>
                  {n.questionId && <Link className="text-sm text-teal-700 underline" href={`/q/${n.questionId}`}>Open</Link>}
                </Card>
              ))}
            </div>
          </div>
        )}

        <div>
          <h2 className="mb-1 font-serif text-xl font-semibold">On your radar — not pushed</h2>
          <p className="mb-2 text-sm text-slate-600">In your domain, but we held them back (weekly cap or already enough views). Pull if you feel like it.</p>
          {radar.length === 0 && <p className="text-sm text-stone-500">Nothing waiting.</p>}
          <div className="space-y-2">
            {radar.map(({ q, m }) => (
              <Link key={q.id} href={`/q/${q.id}`} className="block rounded-xl border border-stone-200 bg-white p-3 text-sm hover:border-teal-500">
                <b>{w.riskById.get(q.riskId)!.country}</b> — {q.kind === "signal" ? `⚡ ${q.text}` : w.riskById.get(q.riskId)!.title.slice(0, 120)}
                <div className="text-xs text-stone-500">match {m.score} · {m.parts.map((p) => p.label).join(" · ")}</div>
              </Link>
            ))}
          </div>
          <details className="mt-3 text-sm text-stone-600">
            <summary className="cursor-pointer">Transparency: {suppressed.length} asks suppressed for you recently</summary>
            <ul className="mt-2 space-y-1 text-xs">
              {suppressed.slice(0, 8).map((n) => (
                <li key={n.id}>• {n.title.slice(0, 70)}… — <i>{n.reason}</i></li>
              ))}
            </ul>
          </details>
        </div>
      </div>

      <aside className="space-y-4">
        <Card>
          <div className="text-xs font-semibold uppercase tracking-wide text-stone-500">Your circle · {country}</div>
          <div className="mt-1 font-serif text-3xl font-semibold text-teal-800">{circle.length} <span className="text-base text-stone-500">members</span></div>
          <p className="text-sm text-slate-600">{circleAnswered} of {circleQ.length} open {country} risks have a circle view. Coverage is a shared goal — there is no public leaderboard.</p>
        </Card>
        <Card>
          <div className="text-xs font-semibold uppercase tracking-wide text-stone-500">Your standing (private)</div>
          <div className="mt-1 flex items-baseline gap-2">
            <Pill tone={ex.tier === "Proven" ? "green" : ex.tier === "Established" ? "teal" : "stone"}>{ex.tier}</Pill>
            <span className="text-sm text-slate-600">expertise evidence {ex.total}/100</span>
          </div>
          <p className="mt-2 text-sm text-slate-600">
            {st.n > 0 ? `Brier ${st.brier!.toFixed(2)} over ${st.n} resolved questions (lower is better).` : "Your first resolved question unlocks your calibration mirror."}
          </p>
          <Link href="/me" className="mt-2 inline-block text-sm text-teal-700 underline">Open my space</Link>
        </Card>
        <Card>
          <div className="text-xs font-semibold uppercase tracking-wide text-stone-500">Craft badges</div>
          <div className="mt-2 flex flex-wrap gap-2">
            {badges.length === 0 && <span className="text-sm text-stone-500">Earned for quality, never volume.</span>}
            {badges.map((b) => (
              <span key={b.code} title={b.why} className="rounded-full bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-800 ring-1 ring-amber-200">
                {b.name}{b.private ? " 🔒" : ""}
              </span>
            ))}
          </div>
        </Card>
      </aside>
    </div>
  </div>
  );
}
