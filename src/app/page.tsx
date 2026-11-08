import Link from "next/link";
import { getWorld } from "@/lib/world";
import { Card, Pill } from "@/components/ui";
import { PersonaButtons } from "@/components/PersonaButtons";

const PILLARS = [
  [
    "Earned expertise",
    "Claims decide who is asked. Evidence — verification, vouches, resolved track record, peer-rated usefulness — decides who is heard.",
  ],
  [
    "Your visibility, your call",
    "Sealed, Alias, Known to ACAPS or On the stage. Retreat any time and your past contributions re-mask instantly.",
  ],
  [
    "Blind first, then the picture",
    "You estimate before seeing ACAPS, the circle, or the situation timeline. Big divergence? A neutral ‘second look’ shows both sides equally.",
  ],
  [
    "Situation evolution & trickle-down links",
    "Dated ACAPS trigger step-charts & rationale updates, closed-round panel series (n ≥ 5 floor), regional grid, and moderator-linked question chains with rival explanations.",
  ],
  [
    "Asked only when it matters",
    "A match score, a weekly cap and a ‘why am I seeing this’ on every ask. Silence is a feature.",
  ],
  [
    "Impact receipts & Roundtable",
    "A Roundtable unlocked by your own estimate. When your dissent moves an analyst, or a question resolves, you get a private receipt.",
  ],
];

export default async function Home() {
  const w = await getWorld();
  const experts = w.experts.filter((e) => !e.isModerator);
  const open = w.questions.filter((q) => q.status === "open");
  const byName = (n: string) =>
    w.experts.find((e) => e.realName.startsWith(n))!;
  const fat = byName("Fatimé"),
    idr = byName("Idriss"),
    cla = byName("Dr. Claire"),
    mod = w.experts.find((e) => e.isModerator)!;
  const dissents = w.dissents.length;
  const linksCount = w.cardLinks.length;
  return (
    <div className="space-y-12">
      <section className="grid items-center gap-8 lg:grid-cols-5">
        <div className="lg:col-span-3">
          <p className="mb-3 inline-block rounded-full bg-teal-100 px-3 py-1 text-xs font-semibold text-teal-800">
            ACAPS × Hackathon for Good #8 · Integrated Situation Evolution Build
          </p>
          <h1 className="font-serif text-4xl font-semibold leading-tight tracking-tight text-slate-900 sm:text-5xl">
            The people closest to a crisis, heard — on their own terms.
          </h1>
          <p className="mt-4 max-w-2xl text-lg text-slate-600">
            Ground Truth Circle is a small, invite-only, moderated network where
            humanitarian experts challenge, enrich and forecast ACAPS risk
            analyses in <b>90 seconds a week</b> — while each expert decides
            exactly how identifiable they are, and analysts map how situations
            evolve over time.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link
              href="/moderator/evolution"
              className="rounded-xl bg-teal-700 px-5 py-3 font-semibold text-white shadow hover:bg-teal-800"
            >
              Explore Situation Evolution →
            </Link>
            <Link
              href="/risks/R1043"
              className="rounded-xl border border-teal-700 bg-teal-50/70 px-5 py-3 font-semibold text-teal-900 hover:bg-teal-100"
            >
              Inspect Chad R1043 Timeline →
            </Link>

          </div>
        </div>
        <Card className="lg:col-span-2">
          <div className="grid grid-cols-2 gap-4 text-center">
            {[
              [w.risks.length, "real ACAPS risks (63 with dated updates)"],
              [experts.length, "synthetic experts across 4 privacy tiers"],
              [open.length, "open 6-month & fast-loop questions"],
              [
                `${dissents} / ${linksCount}`,
                "dissents & analyst trickle-down links",
              ],
            ].map(([n, l]) => (
              <div key={String(l)} className="rounded-xl bg-stone-50 p-3">
                <div className="font-serif text-3xl font-semibold text-teal-800">
                  {n}
                </div>
                <div className="text-xs text-stone-500">{l}</div>
              </div>
            ))}
          </div>
          <p className="mt-4 text-xs text-stone-500">
            Scoring and timelines run on <b>real ACAPS export records</b> (139
            risks, 266 triggers, 141 with dated completion/trend history).
            Forecasters are synthetic archetypes so you can test the anonymity,
            dissent, and situation evolution layers end-to-end.
          </p>
        </Card>
      </section>

      <Card className="border-teal-200 bg-teal-50/50">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <Pill tone="teal">New · Expert Integration Request</Pill>
              <span className="text-xs font-semibold text-teal-900">
                Wired from knarayanareddy/benchmark (docs/11 &amp; docs/12)
              </span>
            </div>
            <h2 className="font-serif text-xl font-semibold text-slate-900">
              Situation Evolution: Timelines, Panel Series, Regional Grid &amp;
              Analyst Trickle-Down Links
            </h2>
            <p className="max-w-3xl text-sm text-slate-700">
              Answers the ACAPS expert&apos;s request to map how a situation has
              evolved over time, track panel consensus across rounds (`n ≥ 5`
              release floor), inspect regional risk × theme density (`&lt; 10`
              marked descriptive only), and trace downstream trickle-down effects
              between questions with a required mechanism and rival explanation.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link
              href="/moderator/evolution"
              className="rounded-xl bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800"
            >
              Staff Evolution Tab →
            </Link>
            <Link
              href="/moderator/dispatch"
              className="rounded-xl border border-stone-300 bg-white px-4 py-2 text-xs font-semibold text-slate-800 hover:bg-stone-100"
            >
              Dispatch Timeline →
            </Link>
            <Link
              href="/risks/R1043"
              className="rounded-xl border border-stone-300 bg-white px-4 py-2 text-xs font-semibold text-slate-800 hover:bg-stone-100"
            >
              Risk Detail Timeline (R1043) →
            </Link>
          </div>
        </div>
      </Card>

      <section>
        <h2 className="mb-1 font-serif text-2xl font-semibold">Try it as…</h2>
        <p className="mb-4 text-slate-600">
          Each persona picked a different anonymity level. Switch any time from
          the top bar.
        </p>
        <PersonaButtons
          items={[
            {
              id: fat.id,
              badge: "Alias · local NGO, Chad",
              title: "Fatimé — has a question waiting",
              sub: "Walk the 90-second card on the live Chad–Sudan border risk (R1043); see Blind Round 1 hold back the timeline until answered.",
              to: "/risks/R1043",
            },
            {
              id: idr.id,
              badge: "Sealed · early-warning, Chad",
              title: "Idriss — already answered R1043",
              sub: "Has answered R1043, so the full ACAPS analysis, trigger step-charts, rationale updates, and Roundtable are unlocked.",
              to: "/risks/R1043",
            },
            {
              id: cla.id,
              badge: "On the stage · researcher",
              title: "Dr. Claire — dissenter, named",
              sub: "Disagrees with ACAPS on Chad. Follow her dissent through the loop and inspect linked regional questions.",
              to: "/me",
            },
            {
              id: mod.id,
              badge: "ACAPS moderator",
              title: "Moderator & Evolution console",
              sub: "Panel series over rounds, regional grid, analyst trickle-down links, dispatch lab timeline, and dissent desk.",
              to: "/moderator/evolution",
            },
          ]}
        />
      </section>

      <section>
        <h2 className="mb-4 font-serif text-2xl font-semibold">
          Why experts stay &amp; why analysts trust the signal
        </h2>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {PILLARS.map(([h, p]) => (
            <Card key={h}>
              <h3 className="font-semibold text-slate-900">{h}</h3>
              <p className="mt-1 text-sm text-slate-600">{p}</p>
            </Card>
          ))}
        </div>
      </section>
    </div>
  );
}
