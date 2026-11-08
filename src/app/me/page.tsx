import Link from "next/link";
import { currentExpert, pickablePersonas } from "@/lib/session";
import { toRow } from "@/lib/world";
import { badgesOf, buildStats, expertiseOf, questionAcaps, type Stats } from "@/lib/scoring";
import { signalsFor } from "@/lib/integrity";
import { anonymitySetOf } from "@/lib/privacy";
import { showExpert } from "@/lib/identity";
import { Card, H, Pill } from "@/components/ui";
import { ProfileForm, InviteButton } from "@/components/ProfileForm";
import { PersonaSelector, type PersonaCardInfo } from "@/components/PersonaSelector";
import { MySpaceToolbar } from "@/components/MySpaceToolbar";
import { THEMES } from "@/lib/constants";

function Bar({ label, v, max, hint }: { label: string; v: number; max: number; hint: string }) {
  return (
    <div>
      <div className="flex justify-between text-sm"><span>{label}</span><span className="text-stone-500">{v}/{max}</span></div>
      <div className="h-2 rounded-full bg-stone-200"><div className="h-2 rounded-full bg-teal-600" style={{ width: `${(v / max) * 100}%` }} /></div>
      <div className="text-xs text-stone-500">{hint}</div>
    </div>
  );
}

export default async function Me() {
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
  const countriesList = Array.from(new Set(w.risks.flatMap((r) => r.countries))).sort();

  if (!me) {
    return (
      <div className="space-y-6">
        <H sub="Choose a persona to explore your visibility, evidence, and calibration — or create your own profile.">
          My space
        </H>
        <PersonaSelector
          currentId={null}
          personas={cards}
          title="Pick a persona to enter My Space"
          sub="Select any persona to view their personal calibration mirror, privacy settings, and receipts."
          returnTo="/me"
        />
      </div>
    );
  }

  if (me.isModerator) {
    return (
      <div className="space-y-6">
        <H sub="Moderator view">My space</H>
        <Card className="border-amber-200 bg-amber-50/60">
          <h2 className="text-lg font-semibold text-slate-900">Moderators don&apos;t have a personal space</h2>
          <p className="mt-1 text-sm text-slate-600">
            You are currently signed in as the ACAPS Moderator. Open the{" "}
            <Link className="font-semibold text-teal-700 underline" href="/moderator">
              Moderator Console
            </Link>{" "}
            or switch to an expert persona below to test My Space.
          </p>
        </Card>
        <PersonaSelector
          currentId={me.id}
          personas={cards}
          title="Switch to an Expert Persona"
          sub="Pick an expert below to explore their personal settings and history."
          returnTo="/me"
        />
      </div>
    );
  }

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
  const badges = badgesOf(w, stats, me);
  const { signals, quality } = signalsFor(st);
  const row = toRow(w, me);

  // calibration mirror
  const bins = [[1, 20], [21, 40], [41, 60], [61, 80], [81, 99]].map(([lo, hi]) => {
    const fs = w.forecasts.filter((f) => f.expertId === me.id && f.probability >= lo && f.probability <= hi).flatMap((f) => {
      const q = w.questionById.get(f.questionId);
      return q && q.status === "resolved" && q.outcome && q.outcome !== "unobservable" ? [{ p: f.probability, o: q.outcome === "yes" ? 1 : 0 }] : [];
    });
    return { lo, hi, n: fs.length, said: fs.length ? fs.reduce((a, b) => a + b.p, 0) / fs.length : 0, got: fs.length ? (fs.reduce((a, b) => a + b.o, 0) / fs.length) * 100 : 0 };
  });

  const lastF = w.forecasts.filter((f) => f.expertId === me.id).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
  const asView = (role: "public" | "peer" | "moderator") => showExpert(row, lastF?.identityMode ?? "profile", role === "public" ? { role } : { role, id: -1 });
  const dissents = w.dissents.filter((d) => w.forecasts.find((f) => f.id === d.forecastId)?.expertId === me.id);
  const dissentQs = dissents.map((d) => ({ d, q: w.questionById.get(d.questionId)!, r: w.riskById.get(d.riskId)! }));
  void questionAcaps;
  const vouchedByMe = w.experts.filter((e) => e.vouchedBy === me.id);

  return (
    <div className="space-y-6">
      <H sub="Your visibility, your evidence, your calibration — all private to you.">My space</H>

      {/* Interactive Active Persona Toolbar */}
      <MySpaceToolbar
        me={{
          id: me.id,
          realName: me.realName,
          alias: me.alias,
          org: me.org,
          roleType: me.roleType,
          countries: me.countries,
          anonymity: me.anonymity,
        }}
        personas={cards}
      />

      <div className="grid gap-6 lg:grid-cols-5">
        <div className="space-y-6 lg:col-span-3">
          {(() => {
            const a = anonymitySetOf(w, me);
            const tone = a.risk === "high" ? "border-rose-300 bg-rose-50" : a.risk === "medium" ? "border-amber-300 bg-amber-50" : "border-teal-200 bg-teal-50/60";
            return (
              <Card className={tone}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="font-serif text-xl font-semibold">Re-identification risk</h2>
                  <Pill tone={a.risk === "high" ? "rose" : a.risk === "medium" ? "amber" : "green"}>
                    {a.risk === "high" ? "High — small crowd" : a.risk === "medium" ? "Medium" : "Low — you are in a crowd"}
                  </Pill>
                </div>
                <p className="mt-1 text-sm text-slate-700">
                  A pseudonym is only as safe as the crowd behind it. Counting the people a circle member could confuse you with today:
                </p>
                <div className="mt-3 grid gap-2 text-center text-sm sm:grid-cols-3">
                  <div className="rounded-xl bg-white/80 p-2"><div className="font-serif text-2xl font-semibold">{a.sameCountry}</div><div className="text-[11px] text-stone-500">share a country with you</div></div>
                  <div className="rounded-xl bg-white/80 p-2"><div className="font-serif text-2xl font-semibold">{a.sameCountryRole}</div><div className="text-[11px] text-stone-500">…and your role type</div></div>
                  <div className="rounded-xl bg-white/80 p-2"><div className="font-serif text-2xl font-semibold">{a.k}</div><div className="text-[11px] text-stone-500">…and your theme focus (k)</div></div>
                </div>
                <ul className="mt-3 list-inside list-disc space-y-1 text-xs text-slate-700">
                  {a.advice.map((x) => <li key={x}>{x}</li>)}
                </ul>
              </Card>
            );
          })()}
          <Card>
            <h2 className="mb-1 font-serif text-xl font-semibold">How visible am I?</h2>
            <p className="mb-3 text-sm text-slate-600">Live proof from your own latest contribution — this is exactly what each audience sees of you right now.</p>
            <div className="mb-4 grid gap-2 text-sm sm:grid-cols-3">
              {([["ACAPS moderators", "moderator"], ["Circle peers", "peer"], ["The public", "public"]] as const).map(([lbl, role]) => {
                const v = asView(role);
                return (
                  <div key={role} className="rounded-xl bg-stone-50 p-3">
                    <div className="text-xs font-semibold uppercase tracking-wide text-stone-500">{lbl}</div>
                    <div className="mt-1 font-semibold">{v.label}</div>
                    <div className="text-xs text-stone-500">{v.sub || "—"}</div>
                  </div>
                );
              })}
            </div>
            <ProfileForm
              initial={{
                name: me.realName,
                org: me.org,
                roleType: me.roleType,
                countries: me.countries,
                themes: me.themes,
                anonymity: me.anonymity,
                stageOptIn: me.stageOptIn,
                retroactive: me.retroactive,
                weeklyCap: me.weeklyCap,
                minMatch: me.minMatch,
              }}
              countriesList={countriesList}
            />
          </Card>


          <Card>
            <h2 className="mb-1 font-serif text-xl font-semibold">My dissents &amp; impact</h2>
            {dissentQs.length === 0 && <p className="text-sm text-stone-500">When you reason a big gap from ACAPS, it appears here and moves through open → routed → actioned → notified → closed.</p>}
            <div className="space-y-2">
              {dissentQs.map(({ d, q, r }) => (
                <Link key={d.id} href={`/q/${q.id}`} className="block rounded-xl border border-stone-200 p-3 text-sm hover:border-teal-600">
                  <b>{r.country}</b> — {r.title.slice(0, 90)}… <Pill tone={d.state === "open" ? "stone" : d.state === "closed" ? "green" : "teal"}>{d.state}</Pill>
                  <div className="text-xs text-stone-500">gap {d.gap} pts{d.analystNote ? ` · ${d.analystNote}` : ""}</div>
                </Link>
              ))}
            </div>
          </Card>

          <Card>
            <h2 className="mb-1 font-serif text-xl font-semibold">Calibration mirror</h2>
            {st.n === 0 ? (
              <p className="text-sm text-stone-500">Answer a few questions. When ACAPS resolves them, you&apos;ll see here how your confidence matched reality. Private to you.</p>
            ) : (
              <>
                <p className="text-sm text-slate-600">{st.n} resolved questions · Brier <b>{st.brier!.toFixed(3)}</b> (always-50% scores 0.250; lower is better) · skill <b>{Math.round(st.skill! * 100)}%</b>{st.bias !== null && <> · lean <b>{st.bias > 0 ? "+" : ""}{Math.round(st.bias * 100)} pts</b></>}</p>
                <div className="mt-3 space-y-2">
                  {bins.map((b) => (
                    <div key={b.lo} className="text-xs">
                      <div className="flex justify-between"><span>You said ~{b.n ? Math.round(b.said) : `${b.lo}–${b.hi}`}%</span><span className="text-stone-500">{b.n ? `happened ${Math.round(b.got)}% of the time (n=${b.n})` : "no data"}</span></div>
                      <div className="relative h-2 rounded-full bg-stone-200">
                        {b.n > 0 && <div className="absolute h-2 rounded-full bg-teal-600" style={{ width: `${b.got}%` }} />}
                        {b.n > 0 && <div className="absolute -top-0.5 h-3 w-1 bg-amber-500" style={{ left: `${b.said}%` }} />}
                      </div>
                    </div>
                  ))}
                  <div className="text-[11px] text-stone-400">Teal bar = how often it happened. Amber tick = what you said. Aligned = well calibrated.</div>
                </div>
                {Object.keys(st.byTheme).length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-2 text-xs">
                    {Object.entries(st.byTheme).filter(([, v]) => v.n >= 3).map(([t, v]) => <Pill key={t} tone={v.brier < 0.18 ? "green" : "stone"}>{THEMES[t]}: Brier {v.brier.toFixed(2)} (n={v.n})</Pill>)}
                  </div>
                )}
              </>
            )}
          </Card>
        </div>

        <div className="space-y-6 lg:col-span-2">
          <Card>
            <div className="flex items-center justify-between">
              <h2 className="font-serif text-xl font-semibold">Expertise evidence</h2>
              <Pill tone={ex.tier === "Proven" ? "green" : ex.tier === "Established" ? "teal" : "stone"}>{ex.tier}</Pill>
            </div>
            <p className="mb-3 text-sm text-slate-600">Earned, not declared. Total <b>{ex.total}/100</b>.</p>
            <div className="space-y-3">
              <Bar label="Verified credentials" v={ex.credentials} max={25} hint={me.verification === "verified" ? "Verified once by a moderator; evidence deleted." : "Pending moderator verification."} />
              <Bar label="Peer vouches" v={ex.vouches} max={15} hint="Verified members who staked their reputation on you." />
              <Bar label="Track record" v={ex.trackRecord} max={40} hint={st.n ? `${st.n} resolved, skill ${Math.round((st.skill ?? 0) * 100)}%` : "Starts when your first question resolves — fast-loop signal checks resolve in days."} />
              <Bar label="Peer-rated usefulness" v={ex.usefulness} max={20} hint="‘Added new information’ and ‘changed my mind’ reactions." />
            </div>
          </Card>
          <Card>
            <h2 className="mb-2 font-serif text-xl font-semibold">Craft badges</h2>
            {badges.length === 0 && <p className="text-sm text-stone-500">None yet. Badges are for quality, never volume — and there are no streaks to lose.</p>}
            <div className="space-y-2">
              {badges.map((b) => (
                <div key={b.code} className="rounded-xl bg-amber-50 p-2 text-sm ring-1 ring-amber-200"><b className="text-amber-900">{b.name}</b>{b.private && " 🔒"}<div className="text-xs text-amber-800">{b.why}</div></div>
              ))}
            </div>
            <p className="mt-2 text-xs text-stone-500">🔒 = private recognition — shown only to you, even if you are Sealed.</p>
          </Card>
          <Card>
            <h2 className="mb-1 font-serif text-xl font-semibold">Signal mirror</h2>
            <p className="mb-2 text-sm text-slate-600">What the integrity layer sees in your patterns — shown to you first, with no accusations. Signal quality <b>{quality}</b>/100.</p>
            {signals.length === 0 && <p className="text-sm text-teal-800">No flags. Your answers look independent, specific and well-reasoned.</p>}
            {signals.map((s) => <div key={s.code} className="mb-2 rounded-lg bg-stone-50 p-2 text-sm"><b>{s.label}</b><div className="text-xs text-stone-600">{s.detail}</div></div>)}
          </Card>
          <Card>
            <h2 className="mb-1 font-serif text-xl font-semibold">Grow the circle, carefully</h2>
            <p className="mb-3 text-sm text-slate-600">Vouched {vouchedByMe.length}/3 this season. Vouching is accountable: your standing is linked to the quality of those you bring in.</p>
            <InviteButton />
          </Card>
        </div>
      </div>
    </div>
  );
}
