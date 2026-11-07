import Link from "next/link";
import { Card, H, Pill } from "@/components/ui";

type QA = { q: string; today: string; verdict: "gap" | "partial" | "strong"; answer: string; where: string };

const QAS: QA[] = [
  {
    q: "1 · How do you onboard an expert?",
    today: "Not designed. The auth story is explicitly missing; ‘onboarding (E2)’ is a one-time screen in a blueprint.",
    verdict: "gap",
    answer:
      "Invite-only, two doors: an ACAPS circle code or a single-use peer vouch from a verified member (3 per season, so vouching is a scarce, accountable act). Four steps, ~2 minutes: invitation → what you know (declaration decides who we ask, never your weight) → visibility with a live ‘what each audience sees’ preview → rhythm (weekly cap). Sensitive contexts pre-select Sealed. The first ask arrives immediately, so the first minute is a contribution, not a form.",
    where: "/join",
  },
  {
    q: "2 · How do you decide someone really is an expert in the field?",
    today: "‘The Declaration decides who is told, never how much weight’ — a sound rule, but nothing builds the evidence that does decide weight.",
    verdict: "partial",
    answer:
      "Expertise is earned from four independent evidence streams, never self-declared: (a) one-time moderator verification, evidence then deleted; (b) vouches from verified peers; (c) resolved track record per theme (Brier skill, shrunk toward a floor with few results); (d) peer-rated usefulness (‘added new information’, ‘changed my mind’). Tiers: Invited → Verified → Established → Proven. Weighting uses only the track record, so credentials open the door and accuracy decides the voice.",
    where: "/me → Expertise evidence",
  },
  {
    q: "3 · How do you create stickiness (and avoid the 51% drop-off)?",
    today: "‘Unspecified, and the most likely cause of failure’ — the repo's own words. No gamification, no feedback loop for the expert.",
    verdict: "gap",
    answer:
      "Stickiness comes from closing loops, not from points. (1) Impact receipts: when your dissent is routed, actioned and acted on, you hear about it — even if Sealed, via your own inbox. (2) Resolution receipts: when a question resolves you privately see you vs circle vs ACAPS. (3) A calibration mirror, a thing experts can't get anywhere else. (4) Craft badges for quality (Well calibrated, Dissent vindicated, Mind-changer, Source scout) with no streaks to lose and no public rank. (5) Give-to-get: the regional agreement map unlocks per risk only when you've contributed. (6) 6-month seasons give a natural rhythm; ≤ 2 asks/week keeps it light.",
    where: "/pulse, /me, /risks",
  },
  {
    q: "4 · How do you separate posers from real subject-matter experts?",
    today: "Brier scoring + bootstrap exists, but at n≈104 resolved items it can't discriminate individuals, and nothing handles low-effort answers.",
    verdict: "partial",
    answer:
      "You don't have to ban them — you make them irrelevant. Newcomers start at a floor weight; only resolved accuracy raises it. On top, behavioural signals flag low-information patterns: fence-sitting (always ~50%), echoing ACAPS (≤ 6 pts from the rating), speeding (< 9 s), thin reasoning. These feed a ‘signal quality’ score shown to the expert first (mirror, not accusation) and to moderators. Demo data includes each archetype so you can see them light up.",
    where: "/moderator/integrity, /me → Signal mirror",
  },
  {
    q: "5 · Anonymity for the endangered AND a stage for those who want one?",
    today: "Three-level allowlist and collision-free aliases are well built — but there's no ‘stage’, no retreat semantics, no safety logic.",
    verdict: "partial",
    answer:
      "Four levels: Sealed (nobody, not even ACAPS, unlinkable posts) · Alias (stable pseudonym, ACAPS doesn't know you either) · Known to ACAPS (peers see alias only) · On the stage (name + org inside the circle, Honour Roll opt-in). Identity leaves the database through exactly one function with a per-viewer allowlist; the public always gets ‘Anonymous expert’ and aggregates only when n ≥ 10. You can go more private per post, and retreating at profile level re-masks your whole history retroactively. Sensitive countries default to Sealed and require explicit confirmation before naming yourself. A re-identification checker warns about ‘my team in X’-style text before you post. Top sealed performers get private recognition and the heaviest weights, so privacy never costs influence.",
    where: "/join step 3, /me, /honour",
  },
  {
    q: "6 · How do you ask ‘are you sure?’ when an expert diverges from ACAPS, without steering?",
    today: "Not addressed — the card is a single slider.",
    verdict: "gap",
    answer:
      "Order matters. Round 1 is blind: no ACAPS rating, no circle. After you lock in, if you're ≥ 25 pts from ACAPS a neutral ‘second look’ appears: ACAPS' reasoning and sources, plus reasons given for higher AND for lower probabilities — same layout whichever direction you lean. ‘Keep my estimate’ and ‘Revise’ are equal buttons. The first estimate is stored immutably and scored; the revision is scored separately, so ACAPS learns whether second looks improve accuracy (‘Open mind’ badge). Peeking at ACAPS' analysis before answering is allowed but logged as ‘saw ACAPS first’ — never penalised.",
    where: "/q/[id]",
  },
  {
    q: "7 · Notifications only when it pertains to their field?",
    today: "Weekly cap and dissent bypass exist in code (dispatch.js); no relevance model, no transparency.",
    verdict: "partial",
    answer:
      "A relevance score (country 60 + region 22 + theme 25 + ‘circle needs views’ 10) against the expert's own declared domain and their own threshold, plus their own weekly cap (1–3). Below threshold or over cap → not pushed, recorded as suppressed and shown on their ‘radar’ with the reason. Every ask carries a ‘why you're seeing this’. The only other pushes: direct replies, impact receipts, resolution receipts. Moderators get a Dispatch Lab dry-run that shows exactly who would — and wouldn't — be bothered before publishing.",
    where: "/pulse, /moderator/dispatch",
  },
  {
    q: "8 · Can you identify if an answer is politically motivated?",
    today: "Not addressed.",
    verdict: "partial",
    answer:
      "Honest answer: no system can read motive — and claiming so would itself be a trust failure. What works is detecting patterns that motivation leaves behind and bounding their influence: directional bias against resolved outcomes (mean signed error), extremity without evidence, loaded/absolute language (‘regime’, ‘everyone knows’, ‘100%’), self-declared conflict-of-interest (one tap, framed as healthy and down-weighting rather than punishing), and coordinated clusters. Output is a ‘review’ signal for a human moderator, never an auto-ban. Because weight depends on track record, even an undetected motivated voice has a bounded effect on the aggregate.",
    where: "/moderator/integrity",
  },
  {
    q: "9 · A stage to debate — anonymously or by name?",
    today: "Not built. Dissent is a one-way channel to analysts.",
    verdict: "gap",
    answer:
      "The Roundtable per risk: structured posts (Claim, Evidence, Counter-view, Question, Missing risk/trigger), threaded, each with its own identity choice (profile level or more private). It unlocks only after you give your own estimate, protecting independence. Reactions reward epistemic value — ‘Added new information’, ‘Changed my mind’, ‘Needs a source’, ‘I see it differently’ — not likes. A ‘changed my mind’ sends the author an anonymous receipt. Moderators can hide posts; ‘Missing risk’ posts feed the synthesis brief.",
    where: "/risks/R1043",
  },
];

const REUSED = [
  ["Brier scoring + skill vs. the 0.25 floor", "scoring.js", "src/lib/scoring.ts"],
  ["Pooled estimate that always carries an interval", "aggregate.js", "aggregate() — mean, p10–p90, spread label"],
  ["Small-cell suppression (n ≥ 3 internal, n ≥ 10 public)", "anonymity.js", "MIN_PANEL / PUBLIC_MIN"],
  ["Allowlist attribution + collision-free aliases", "anonymity.js", "src/lib/identity.ts (single egress)"],
  ["5-state dissent lifecycle", "dissent.js", "dissents table + moderator desk + receipts"],
  ["Weekly cap + dissent bypass", "dispatch.js", "src/lib/dispatch.ts (plus relevance + transparency)"],
  ["Resolution criteria; ‘unobservable ≠ miss’", "gate.js / scoring.js", "question criteria + resolve action"],
  ["ACAPS rating as the bar to beat", "fit-baseline.mjs", "ACAPS-implied probability from empirical rates"],
];

const tone = { gap: "rose", partial: "amber", strong: "green" } as const;
const label = { gap: "Gap in current build", partial: "Partly there", strong: "Covered" } as const;

export default function Review() {
  return (
    <div className="space-y-10">
      <H sub="A review of github.com/knarayanareddy/benchmark against the ACAPS Ground Truth brief — and what this build does about it.">Review &amp; design answers</H>

      <section className="grid gap-4 md:grid-cols-3">
        <Card>
          <h2 className="font-serif text-lg font-semibold">What Benchmark is</h2>
          <p className="mt-1 text-sm text-slate-700">A rigorous, honest scaffold: pure JS core (Brier + bootstrap, interval-bearing pooling, anonymity allowlist, dispatch cap, 5-state dissent), 98 tests, scripts that reproduce ACAPS&apos; own baselines (floor 0.2425 → ACAPS 0.2168 → regression 0.2177), and a static six-screen mockup. <b>No UI, no panel ever run, no auth.</b></p>
        </Card>
        <Card>
          <h2 className="font-serif text-lg font-semibold">What is genuinely strong</h2>
          <ul className="mt-1 list-inside list-disc text-sm text-slate-700">
            <li>Intellectual honesty — it measured that its own regression loses to the analysts.</li>
            <li>Prospective trigger-level evaluation (266 triggers) instead of hindsight-contaminated history.</li>
            <li>Every number rendered with an interval; temporal differencing guards.</li>
            <li>Dissent routed back into the <i>language</i> of the risk.</li>
          </ul>
        </Card>
        <Card>
          <h2 className="font-serif text-lg font-semibold">Why it feels like ‘sea of sameness’</h2>
          <p className="mt-1 text-sm text-slate-700">Every team will ship: a probability card, a Brier score, an anonymity toggle. Benchmark's depth is in the <b>measurement</b> layer — the part judges can't see in a 3-minute pitch and the part experts don't care about. The brief's real failure mode — <i>why would a busy expert come back?</i> — is unspecified. The differentiator is the <b>expert side of the loop</b>: trust, motivation, relevance, deliberation.</p>
        </Card>
      </section>

      <section>
        <h2 className="mb-3 font-serif text-2xl font-semibold">Your nine questions</h2>
        <div className="space-y-4">
          {QAS.map((x) => (
            <Card key={x.q}>
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="font-semibold text-slate-900">{x.q}</h3>
                <Pill tone={tone[x.verdict]}>{label[x.verdict]}</Pill>
              </div>
              <div className="mt-2 grid gap-3 md:grid-cols-2">
                <div className="rounded-xl bg-stone-50 p-3 text-sm text-slate-700"><div className="mb-1 text-xs font-semibold uppercase tracking-wide text-stone-500">In Benchmark today</div>{x.today}</div>
                <div className="rounded-xl bg-teal-50 p-3 text-sm text-slate-800"><div className="mb-1 text-xs font-semibold uppercase tracking-wide text-teal-700">In Ground Truth Circle</div>{x.answer}</div>
              </div>
              <div className="mt-2 text-xs text-stone-500">See it live: <code>{x.where}</code></div>
            </Card>
          ))}
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-2">
        <Card>
          <h2 className="mb-2 font-serif text-xl font-semibold">The redesign, in one line each</h2>
          <ol className="list-inside list-decimal space-y-1 text-sm text-slate-700">
            <li><b>Invite-only circles</b> of 5–10 per context, grown by accountable vouching.</li>
            <li><b>Blind first, picture second</b> — independence is protected by sequence, not by rules.</li>
            <li><b>Evidence-weighted voice</b> — credentials open doors, resolved accuracy decides weight.</li>
            <li><b>Visibility is a dial the expert owns</b>, with retroactive retreat and safety defaults.</li>
            <li><b>Relevance-gated, capped dispatch</b> with full transparency of what was held back.</li>
            <li><b>Closed loops</b>: dissent lifecycle, impact receipts, resolution receipts.</li>
            <li><b>A Roundtable</b> that rewards changed minds.</li>
            <li><b>Moderator console</b>: dispatch lab, dissent desk, synthesis, integrity signals, resolution.</li>
          </ol>
        </Card>
        <Card>
          <h2 className="mb-2 font-serif text-xl font-semibold">What was kept from Benchmark</h2>
          <table className="w-full text-xs">
            <thead className="text-left text-stone-500"><tr><th>Idea</th><th>Benchmark</th><th>Here</th></tr></thead>
            <tbody>
              {REUSED.map(([a, b, c]) => <tr key={a} className="border-t border-stone-100 align-top"><td className="py-1 pr-2">{a}</td><td className="pr-2 text-stone-500">{b}</td><td>{c}</td></tr>)}
            </tbody>
          </table>
          <p className="mt-2 text-xs text-stone-500">Ported into a Next.js + PostgreSQL (Drizzle) full-stack app, running against the real 139-risk ACAPS export.</p>
        </Card>
      </section>

      <section className="grid gap-4 md:grid-cols-2">
        <Card>
          <h2 className="mb-2 font-serif text-xl font-semibold">Honest limits</h2>
          <ul className="list-inside list-disc space-y-1 text-sm text-slate-700">
            <li>All experts, forecasts and debates are <b>synthetic</b>. Track records run on real ACAPS outcomes but fake forecasters. No claim that the panel beats ACAPS — that needs the prospective pilot (~445 resolved statements for a 0.02 Brier gain).</li>
            <li>The ACAPS probability bar uses the empirical materialisation rate per rating (Very Low 25% · Low 40% · Medium 48% · High 80% · Very High 88%) — small samples at the tails.</li>
            <li>Political-motive detection is pattern-flagging only; it needs human judgement and an appeals path.</li>
            <li>Demo auth is a persona switcher. Production needs magic-link / Signal-style auth, encrypted identity vault, a separated custodian for Sealed verification and a DPIA.</li>
            <li>Low bandwidth: server-rendered pages, no images, minimal JS. Offline/SMS fallback and more languages than EN/FR are roadmap.</li>
          </ul>
        </Card>
        <Card>
          <h2 className="mb-2 font-serif text-xl font-semibold">Pilot &amp; business sense (Dec 2026, ~2 months)</h2>
          <ul className="list-inside list-disc space-y-1 text-sm text-slate-700">
            <li><b>Pilot:</b> 3 circles (Chad/Sahel, Sudan/Horn, Levant), 5–10 each, on the 28 active risks and their 266 triggers.</li>
            <li><b>Success is not time-in-app.</b> Measure: 8-week retention of verified experts, median seconds per answer, % answers with a reason, dissents actioned, calibration vs ACAPS, ‘changed my mind’ rate.</li>
            <li><b>Model:</b> ACAPS-hosted core; donors fund circles per crisis as an early-warning input; the same engine licenses to other analysis houses (IPC, FEWS NET, INGOs) — each brings its own question bank.</li>
            <li><b>Ethics/legal:</b> data minimisation, evidence deleted after verification, consent per visibility level, right-to-retreat, no generative model touches expert text.</li>
          </ul>
        </Card>
      </section>

      <div className="text-center">
        <Link href="/" className="inline-block rounded-xl bg-teal-700 px-6 py-3 font-semibold text-white">Try the product →</Link>
      </div>
    </div>
  );
}
