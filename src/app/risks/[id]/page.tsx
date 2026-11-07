import Link from "next/link";
import { notFound } from "next/navigation";
import { currentExpert } from "@/lib/session";
import { toRow } from "@/lib/world";
import { aggregate, buildStats, MIN_PANEL } from "@/lib/scoring";
import { showExpert } from "@/lib/identity";
import { ANON_LEVELS, ANON_ORDER, THEMES } from "@/lib/constants";
import { Card, Pill, ago, levelTone } from "@/components/ui";
import { Roundtable, type PostView } from "@/components/Roundtable";
import { PersonaSelector, type PersonaCardInfo } from "@/components/PersonaSelector";
import { RoundtableHeader } from "@/components/RoundtableHeader";

export default async function RiskPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { me, w } = await currentExpert();
  const risk = w.riskById.get(id);
  if (!risk) notFound();
  const stats = buildStats(w);
  const qs = w.questions.filter((q) => q.riskId === id && q.season === "current");
  const riskQ = qs.find((q) => !q.triggerId);
  const triggers = w.triggers.filter((t) => t.riskId === id);
  const answeredQ = me ? new Set(w.forecasts.filter((f) => f.expertId === me.id).map((f) => f.questionId)) : new Set<number>();
  const answeredAny = qs.some((q) => answeredQ.has(q.id));
  const isMod = !!me?.isModerator;
  const canRead = answeredAny || isMod;
  const agg = riskQ && canRead ? aggregate(w, stats, riskQ.id) : null;
  const viewer = me ? (isMod ? ({ role: "moderator", id: me.id } as const) : ({ role: "peer", id: me.id } as const)) : ({ role: "public" } as const);

  const answeredExpertIds = new Set(
    w.forecasts.filter((f) => qs.some((q) => q.id === f.questionId)).map((f) => f.expertId)
  );

  const cards: PersonaCardInfo[] = w.experts.map((e) => ({
    id: e.id,
    name: e.realName,
    alias: e.alias,
    org: e.org,
    role: e.roleType,
    country: e.countries[0] ?? "",
    anonymity: e.anonymity,
    isModerator: e.isModerator,
    isCustom: e.archetype === "real" || e.id > 29,
    hasAnswered: answeredExpertIds.has(e.id),
  }));

  const posts: PostView[] = canRead
    ? w.posts
        .filter((p) => p.riskId === id && !p.hidden)
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
        .map((p) => {
          const e = w.expertById.get(p.expertId)!;
          const sh = showExpert(toRow(w, e), p.identityMode, viewer);
          const rx: PostView["reactions"] = {};
          for (const r of w.reactions.filter((x) => x.postId === p.id)) {
            rx[r.type] = rx[r.type] ?? { count: 0, mine: false };
            rx[r.type].count++;
            if (me && r.expertId === me.id) rx[r.type].mine = true;
          }
          return { id: p.id, parentId: p.parentId, who: sh.label, sub: sh.sub, level: sh.level, self: sh.self, kind: p.kind, body: p.body, sourceUrl: p.sourceUrl, when: ago(p.createdAt), reactions: rx };
        })
    : [];
  const levelOptions = ANON_LEVELS.map((l) => ({ id: l.id, name: l.name }));
  const allowed = me ? levelOptions.filter((l) => ANON_ORDER.indexOf(l.id as never) >= ANON_ORDER.indexOf(me.anonymity as never)) : [];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Link href="/risks" className="text-stone-500 hover:underline">← Risks</Link>
        <Pill tone="teal">{risk.country}</Pill>
        <Pill>{THEMES[risk.theme]}</Pill>
        <Pill>{risk.id}</Pill>
        {risk.level && <Pill tone={levelTone(risk.level)}>{risk.level} risk</Pill>}
        {risk.trend && <Pill>{risk.trend}</Pill>}
        <Pill tone={risk.status === "Active" ? "indigo" : risk.status === "Materialised" ? "rose" : "stone"}>{risk.status}</Pill>
      </div>
      <h1 className="font-serif text-3xl font-semibold leading-tight">{risk.title}</h1>

      <div className="grid gap-6 lg:grid-cols-5">
        <div className="space-y-4 lg:col-span-2">
          <Card>
            <h2 className="mb-1 font-semibold">ACAPS analysis</h2>
            <p className="text-sm text-slate-700">{risk.rationale}</p>
            <div className="mt-2 text-xs text-stone-500">
              Probability: <b>{risk.probability || "—"}</b> · Impact: <b>{risk.impact || "—"}</b> · Exposure: <b>{risk.exposure || "—"}</b>
            </div>
            <ul className="mt-2 list-inside list-disc break-all text-xs text-indigo-700">
              {risk.sources.map((s) => <li key={s}><a href={s} target="_blank" rel="noreferrer">{s}</a></li>)}
            </ul>
          </Card>
          {triggers.length > 0 && (
            <Card>
              <h2 className="mb-2 font-semibold">Triggers for deterioration</h2>
              <div className="space-y-2">
                {triggers.map((t) => {
                  const tq = qs.find((q) => q.triggerId === t.id);
                  return (
                    <div key={t.id} className="rounded-lg bg-stone-50 p-2 text-sm">
                      <div className="font-medium">{t.title}</div>
                      <div className="text-xs text-stone-600">{t.description.slice(0, 220)}…</div>
                      {tq && <Link className="text-xs font-semibold text-teal-700 underline" href={`/q/${tq.id}`}>{answeredQ.has(tq.id) ? "View question" : "Forecast this trigger"}</Link>}
                    </div>
                  );
                })}
              </div>
            </Card>
          )}
          {riskQ && (
            <Card>
              <h2 className="mb-1 font-semibold">Circle view</h2>
              {agg && agg.n >= MIN_PANEL ? (
                <p className="text-sm text-slate-700"><b className="font-serif text-2xl text-teal-800">{agg.mean}%</b> (80%: {agg.p10}–{agg.p90}%) · {agg.label} · n={agg.n}</p>
              ) : canRead ? (
                <p className="text-sm text-stone-500">Hidden until ≥ {MIN_PANEL} members answer.</p>
              ) : (
                <p className="text-sm text-stone-500">Revealed after you give your own estimate.</p>
              )}
              <Link href={`/q/${riskQ.id}`} className="mt-2 inline-block rounded-lg bg-teal-700 px-3 py-1.5 text-sm font-semibold text-white">{answeredQ.has(riskQ.id) ? "Open my estimate" : "Give my estimate (90s)"}</Link>
            </Card>
          )}
        </div>

        <div className="lg:col-span-3">
          <h2 className="mb-1 font-serif text-2xl font-semibold">The Roundtable</h2>
          <p className="mb-3 text-sm text-slate-600">Structured debate among verified circle members — by name, alias or fully anonymous. Reactions reward <b>new information</b> and <b>changed minds</b>, not volume.</p>

          {!me ? (
            <PersonaSelector
              currentId={null}
              personas={cards}
              title="Pick a persona to view and join this Roundtable"
              sub="Independent debate is visible only to circle members. Pick an expert to enter or unlock."
              returnTo={`/risks/${id}`}
              riskId={id}
              compact
            />
          ) : (
            <>
              <RoundtableHeader
                riskId={id}
                me={{
                  id: me.id,
                  name: me.realName,
                  alias: me.alias,
                  anonymity: me.anonymity,
                  isModerator: !!me.isModerator,
                }}
                canRead={canRead}
                personas={cards}
                riskQId={riskQ?.id}
              />
              {canRead && (
                <Roundtable riskId={id} posts={posts} canPost levelOptions={allowed} profileLevel={me.anonymity} isMod={isMod} />
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

