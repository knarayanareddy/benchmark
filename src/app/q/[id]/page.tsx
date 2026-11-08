import Link from "next/link";
import { notFound } from "next/navigation";
import { currentExpert, langPref, pickablePersonas } from "@/lib/session";
import { toRow } from "@/lib/world";
import { aggregate, buildStats, questionAcaps, MIN_PANEL, PUBLIC_MIN } from "@/lib/scoring";
import { showExpert } from "@/lib/identity";
import { ANON_LEVELS, ANON_ORDER, EVIDENCE_TYPES, THEMES } from "@/lib/constants";
import { Card, Pill, ProbBar, fmtDate, levelTone } from "@/components/ui";
import { ForecastForm } from "@/components/ForecastForm";
import { SecondLook } from "@/components/SecondLook";
import { PersonaSelector, type PersonaCardInfo } from "@/components/PersonaSelector";

const STEPS = ["open", "routed", "actioned", "notified", "closed"];

export default async function QuestionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { me, w } = await currentExpert();
  const q = w.questionById.get(Number(id));
  if (!q) notFound();
  const risk = w.riskById.get(q.riskId)!;
  const lang = await langPref();

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

  if (!me) {
    const cards = (await pickablePersonas(w)).map(toPersonaCard);
    return (
      <div className="mx-auto max-w-3xl space-y-5">
        <div className="flex flex-wrap items-center gap-2 text-sm text-stone-500">
          <Link href="/pulse" className="hover:underline">← Pulse</Link>
          <span>·</span>
          <Pill tone="teal">{risk.country}</Pill>
          <Pill>{THEMES[risk.theme]}</Pill>
        </div>
        <Card>
          <h1 className="font-serif text-2xl font-semibold leading-snug text-slate-900">{q.text}</h1>
        </Card>
        <PersonaSelector
          currentId={null}
          personas={cards}
          title="Pick a persona to answer this question"
          sub="Estimating requires an expert persona identity to record evidence, track calibration, and protect anonymity."
          returnTo={`/q/${id}`}
        />
      </div>
    );
  }

  const stats = buildStats(w);
  const mine = w.forecasts.find((f) => f.questionId === q.id && f.expertId === me.id);
  const acaps = questionAcaps(q, risk);
  const acapsPct = acaps === null ? null : Math.round(acaps * 100);
  const canSee = !!mine || me.isModerator;
  const levelOptions = ANON_LEVELS.map((l) => ({ id: l.id, name: l.name, sees: `Peers: ${l.peers}` }));
  const allowed = levelOptions.filter((l) => ANON_ORDER.indexOf(l.id as never) >= ANON_ORDER.indexOf(me.anonymity as never));
  const viewer = { role: "peer" as const, id: me.id };
  const agg = canSee ? aggregate(w, stats, q.id) : null;
  const gap = mine && acapsPct !== null ? Math.abs(mine.probability - acapsPct) : 0;
  const mineDissent = mine ? w.dissents.find((d) => d.forecastId === mine.id) : undefined;

  const others = w.forecasts
    .filter((f) => f.questionId === q.id && f.reason && f.expertId !== me.id)
    .map((f) => {
      const e = w.expertById.get(f.expertId)!;
      const sh = showExpert(toRow(w, e), f.identityMode, viewer);
      return { who: sh.label, sub: sh.sub, text: f.reason, p: f.revised ?? f.probability };
    });
  const ref = acapsPct ?? (agg ? agg.mean : 50);
  const higher = others.filter((o) => o.p > ref).slice(0, 3);
  const lower = others.filter((o) => o.p <= ref).slice(0, 3);

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div className="flex flex-wrap items-center gap-2 text-sm text-stone-500">
        <Link href="/pulse" className="hover:underline">← Pulse</Link>
        <span>·</span>
        <Pill tone="teal">{risk.country}</Pill>
        <Pill>{THEMES[risk.theme]}</Pill>
        <Pill tone="indigo">{q.kind === "signal" ? "Signal check" : q.triggerId ? "Trigger question" : "Risk question"}</Pill>
          {q.kind === "signal" && <Pill tone="amber">⚡ Fast loop · closes {fmtDate(q.closesAt)}</Pill>}
        <span>closes {fmtDate(q.closesAt)}</span>
      </div>
      <Card>
        <h1 className="font-serif text-2xl font-semibold leading-snug text-slate-900">{q.text}</h1>
        <details className="mt-3 text-sm text-slate-600">
          <summary className="cursor-pointer font-medium text-slate-700">How this will be resolved</summary>
          <p className="mt-1">{q.criteria}</p>
        </details>
      </Card>

      {!mine && !me.isModerator && (
        <Card>
          <ForecastForm
            questionId={q.id}
            lang={lang}
            text={q.text}
            criteria={q.criteria}
            closes={fmtDate(q.closesAt)}
            profileLevel={me.anonymity}
            levelOptions={allowed}
            context={{ rationale: risk.rationale.slice(0, 900), sources: risk.sources.slice(0, 4) }}
          />
        </Card>
      )}

      {canSee && (
        <>
          <Card>
            <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-serif text-xl font-semibold">The picture</h2>
              <div className="flex gap-2">
                {risk.level && q.kind !== "signal" && <Pill tone={levelTone(risk.level)}>ACAPS: {risk.probability || risk.level} probability</Pill>}
                {agg && <Pill tone={agg.label === "Strong agreement" ? "green" : agg.label === "Mixed views" ? "amber" : "rose"}>{agg.label}</Pill>}
              </div>
            </div>
            <ProbBar acaps={acapsPct} agg={agg && agg.n >= MIN_PANEL ? agg : null} mine={mine?.probability} revised={mine?.revised} />
            <div className="grid gap-3 text-sm sm:grid-cols-3">
              <div className="rounded-xl bg-indigo-50 p-3">
                <div className="text-xs font-semibold text-indigo-700">ACAPS</div>
                {acapsPct !== null ? (
                  <>
                    <div className="font-serif text-2xl font-semibold">~{acapsPct}%</div>
                    <div className="text-xs text-stone-500">implied by its “{risk.probability || risk.level}” rating (empirical materialisation rate)</div>
                  </>
                ) : (
                  <div className="text-xs text-stone-500">{q.kind === "signal" ? "Signal checks are short-horizon observations ACAPS does not rate. They exist so you get feedback in days, and so your track record starts to exist." : q.triggerId ? "ACAPS rates the parent risk, not this trigger separately." : "Unrated risk."}</div>
                )}
              </div>
              <div className="rounded-xl bg-teal-50 p-3">
                <div className="text-xs font-semibold text-teal-700">Circle (performance-weighted)</div>
                {agg && agg.n >= MIN_PANEL ? (
                  <>
                    <div className="font-serif text-2xl font-semibold">{agg.mean}%</div>
                    <div className="text-xs text-stone-500">80% of views between {agg.p10}–{agg.p90}% · n={agg.n}</div>
                  </>
                ) : (
                  <div className="text-xs text-stone-500">Hidden until ≥ {MIN_PANEL} members have answered (small-cell protection). n={agg?.n ?? 0}</div>
                )}
              </div>
              <div className="rounded-xl bg-stone-100 p-3">
                <div className="text-xs font-semibold text-stone-600">Public view</div>
                <div className="font-semibold">{agg && agg.n >= PUBLIC_MIN ? `${agg.mean}%` : "Suppressed"}</div>
                <div className="text-xs text-stone-500">Public sees aggregates only, and only when n ≥ {PUBLIC_MIN}. Currently n={agg?.n ?? 0}.</div>
              </div>
            </div>
            {mine && (
              <div className="mt-3 text-sm text-slate-600">
                Your locked first estimate: <b>{mine.probability}%</b>
                {mine.revised !== null && <> · revised to <b>{mine.revised}%</b></>} · evidence: {EVIDENCE_TYPES[mine.evidenceType]}
              </div>
            )}
          </Card>

          {mine && acapsPct !== null && gap >= 25 && mine.revised === null && (
            <SecondLook
              questionId={q.id}
              mine={mine.probability}
              acapsPct={acapsPct}
              gap={gap}
              acapsRationale={risk.rationale.slice(0, 700)}
              sources={risk.sources}
              higher={higher}
              lower={lower}
            />
          )}

          {mineDissent && (
            <Card>
              <h3 className="font-semibold">Your dissent is being tracked — not lost</h3>
              <p className="mb-3 text-sm text-slate-600">Because you reasoned a {mineDissent.gap}-point gap from ACAPS, it entered the dissent loop. Identity is never attached.</p>
              <ol className="flex flex-wrap gap-2 text-xs">
                {STEPS.map((s, i) => (
                  <li key={s} className={`rounded-full px-3 py-1 font-semibold ${i <= STEPS.indexOf(mineDissent.state) ? "bg-teal-700 text-white" : "bg-stone-200 text-stone-500"}`}>
                    {i + 1}. {s}
                  </li>
                ))}
              </ol>
              {mineDissent.analystNote && <p className="mt-3 rounded-lg bg-teal-50 p-3 text-sm text-teal-900">Analyst note: {mineDissent.analystNote}</p>}
            </Card>
          )}

          {others.length > 0 && (!mine || mine.revised !== null || gap < 25 || me.isModerator) && (
            <Card>
              <h3 className="mb-2 font-semibold">What others reasoned</h3>
              <div className="space-y-3">
                {others.slice(0, 6).map((o, i) => (
                  <div key={i} className="text-sm">
                    <span className="font-semibold">{o.who}</span> <span className="text-xs text-stone-500">{o.sub} · {o.p}%</span>
                    <div className="text-slate-700">{o.text}</div>
                  </div>
                ))}
              </div>
            </Card>
          )}

          <Link href={`/risks/${risk.id}`} className="block rounded-2xl bg-slate-900 p-4 text-center font-semibold text-white hover:bg-slate-800">
            Continue to Full Risk View → inspect Situation Evolution timeline &amp; join the Roundtable
          </Link>
        </>
      )}
    </div>
  );
}
