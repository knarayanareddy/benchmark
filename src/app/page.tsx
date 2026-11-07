import Link from "next/link";
import { getWorld } from "@/lib/world";
import { Card } from "@/components/ui";
import { PersonaButtons } from "@/components/PersonaButtons";

const PILLARS = [
  ["Earned expertise", "Claims decide who is asked. Evidence — verification, vouches, resolved track record, peer-rated usefulness — decides who is heard."],
  ["Your visibility, your call", "Sealed, Alias, Known to ACAPS or On the stage. Retreat any time and your past contributions re-mask instantly."],
  ["Blind first, then the picture", "You estimate before seeing ACAPS or the circle. Big divergence? A neutral ‘second look’ shows both sides equally."],
  ["Asked only when it matters", "A match score, a weekly cap and a ‘why am I seeing this’ on every ask. Silence is a feature."],
  ["Debate with a spine", "A Roundtable unlocked by your own estimate. Reactions reward ‘changed my mind’, not volume."],
  ["Impact receipts", "When your dissent moves an analyst, or a question resolves, you get a private receipt. That is the loop that keeps experts."],
];

export default async function Home() {
  const w = await getWorld();
  const experts = w.experts.filter((e) => !e.isModerator);
  const open = w.questions.filter((q) => q.status === "open");
  const byName = (n: string) => w.experts.find((e) => e.realName.startsWith(n))!;
  const fat = byName("Fatimé"), idr = byName("Idriss"), cla = byName("Dr. Claire"), mod = w.experts.find((e) => e.isModerator)!;
  const dissents = w.dissents.length;
  return (
    <div className="space-y-12">
      <section className="grid items-center gap-8 lg:grid-cols-5">
        <div className="lg:col-span-3">
          <p className="mb-3 inline-block rounded-full bg-teal-100 px-3 py-1 text-xs font-semibold text-teal-800">ACAPS × Hackathon for Good #8</p>
          <h1 className="font-serif text-4xl font-semibold leading-tight tracking-tight text-slate-900 sm:text-5xl">
            The people closest to a crisis, heard — on their own terms.
          </h1>
          <p className="mt-4 max-w-2xl text-lg text-slate-600">
            Ground Truth Circle is a small, invite-only, moderated network where humanitarian experts challenge, enrich and forecast ACAPS risk analyses in
            <b> 90 seconds a week</b> — while each expert decides exactly how identifiable they are. Accuracy is earned and measured, not claimed.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link href="/join" className="rounded-xl bg-teal-700 px-5 py-3 font-semibold text-white shadow hover:bg-teal-800">Join with an invite code</Link>
            <Link href="/review" className="rounded-xl border border-stone-300 bg-white px-5 py-3 font-semibold text-slate-800 hover:bg-stone-100">Read the review &amp; design answers</Link>
          </div>
        </div>
        <Card className="lg:col-span-2">
          <div className="grid grid-cols-2 gap-4 text-center">
            {[
              [w.risks.length, "real ACAPS risks"],
              [experts.length, "synthetic experts"],
              [open.length, "open 6-month questions"],
              [dissents, "dissents in the loop"],
            ].map(([n, l]) => (
              <div key={String(l)} className="rounded-xl bg-stone-50 p-3">
                <div className="font-serif text-3xl font-semibold text-teal-800">{n}</div>
                <div className="text-xs text-stone-500">{l}</div>
              </div>
            ))}
          </div>
          <p className="mt-4 text-xs text-stone-500">
            Scoring runs on <b>real ACAPS outcomes</b> (104 resolved risks). The historic forecasters are synthetic archetypes — aces, solids, rubber-stampers, fence-sitters, speeders and a politically-leaning voice — so you can see the integrity layer work.
          </p>
        </Card>
      </section>

      <section>
        <h2 className="mb-1 font-serif text-2xl font-semibold">Try it as…</h2>
        <p className="mb-4 text-slate-600">Each persona picked a different anonymity level. Switch any time from the top bar.</p>
        <PersonaButtons
          items={[
            { id: fat.id, badge: "Alias · local NGO, Chad", title: "Fatimé — has a question waiting", sub: "Walk the 90-second card on the live Chad–Sudan border risk (R1043).", to: "/pulse" },
            { id: idr.id, badge: "Sealed · early-warning, Chad", title: "Idriss — invisible to everyone", sub: "See what ACAPS and peers see of a sealed expert (nothing).", to: "/pulse" },
            { id: cla.id, badge: "On the stage · researcher", title: "Dr. Claire — dissenter, named", sub: "Disagrees with ACAPS on Chad. Follow her dissent through the loop.", to: "/me" },
            { id: mod.id, badge: "ACAPS moderator", title: "Moderator console", sub: "Dispatch lab, dissent desk, integrity signals, resolution.", to: "/moderator" },
          ]}
        />
      </section>

      <section>
        <h2 className="mb-4 font-serif text-2xl font-semibold">Why experts stay</h2>
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
