"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { ANON_LEVELS, ROLE_TYPES, SENSITIVE_COUNTRIES, THEMES } from "@/lib/constants";

const CLAIMS = [
  "Leads or works at a local organisation in the country",
  "Publishes research on the country context",
  "Works in early warning / anticipatory action",
  "Field staff for a UN agency or INGO",
  "Journalist / conflict monitor",
  "Can be vouched for by a current circle member",
];

export function JoinFlow({ countries, returnTo }: { countries: string[]; returnTo?: string }) {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [code, setCode] = useState("");
  const [inv, setInv] = useState<{ label: string; hint: string; peer: boolean } | null>(null);
  const [name, setName] = useState("");
  const [org, setOrg] = useState("");
  const [role, setRole] = useState("local_ngo");
  const [sel, setSel] = useState<string[]>([]);
  const [themes, setThemes] = useState<string[]>(["conflict"]);
  const [claims, setClaims] = useState<string[]>([]);
  const [anon, setAnon] = useState("");
  const [stage, setStage] = useState(false);
  const [cap, setCap] = useState(2);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const risky = sel.some((c) => SENSITIVE_COUNTRIES.includes(c));
  const recommended = risky ? "sealed" : "alias";
  const level = anon || recommended;
  const toggle = (arr: string[], v: string, set: (a: string[]) => void) => set(arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);
  const L = ANON_LEVELS.find((l) => l.id === level)!;

  async function checkCode(codeToUse?: string) {
    setErr("");
    const c = (codeToUse || code || "CHAD-7QX2").trim().toUpperCase();
    setCode(c);
    const r = await fetch(`/api/join?code=${encodeURIComponent(c)}`);
    const j = await r.json();
    if (!j.ok) return setErr(j.error);
    setInv(j);
    if (j.hint && !sel.length) setSel([j.hint]);
    setStep(2);
  }

  async function finish() {
    setBusy(true);
    setErr("");
    const r = await fetch("/api/join", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        code: code || "CHAD-7QX2",
        name,
        org,
        roleType: role,
        countries: sel.length ? sel : ["Chad"],
        themes,
        claims,
        anonymity: level,
        stageOptIn: stage,
        weeklyCap: cap,
      }),
    });
    const j = await r.json();
    setBusy(false);
    if (!j.ok) return setErr(j.error);

    try {
      const stored = JSON.parse(localStorage.getItem("gt_custom_experts") || "[]");
      stored.push({ id: j.id, name, alias: j.alias, anonymity: level });
      localStorage.setItem("gt_custom_experts", JSON.stringify(stored));
    } catch {}

    const targetUrl =
      returnTo ||
      (typeof window !== "undefined" && new URLSearchParams(window.location.search).get("returnTo")) ||
      "/pulse";

    window.location.href = targetUrl;
  }

  const chip = (on: boolean) => `rounded-full border px-3 py-1 text-sm ${on ? "border-teal-700 bg-teal-700 text-white" : "border-stone-300 bg-white text-slate-700 hover:bg-stone-50"}`;

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <ol className="flex gap-2 text-xs font-semibold">
        {["Invitation", "Your expertise", "Your visibility", "Your rhythm"].map((s, i) => (
          <li key={s} className={`flex-1 rounded-full px-3 py-1.5 text-center ${step === i + 1 ? "bg-teal-700 text-white" : step > i + 1 ? "bg-teal-100 text-teal-800" : "bg-stone-200 text-stone-500"}`}>{i + 1}. {s}</li>
        ))}
      </ol>
      <div className="rounded-2xl border border-stone-200 bg-white p-6 shadow-sm">
        {step === 1 && (
          <div className="space-y-4">
            <h2 className="font-serif text-2xl font-semibold">You were invited — that&apos;s the first trust signal</h2>
            <p className="text-sm text-slate-600">Circles are small (5–10 per context) and invite-only: either an ACAPS circle code or a peer vouch from a verified member.</p>
            <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="e.g. CHAD-7QX2" className="w-full rounded-xl border border-stone-300 p-3 font-mono uppercase tracking-wider outline-none focus:border-teal-600" />
            <div className="space-y-1.5">
              <div className="text-xs font-semibold text-stone-600">Click a demo invite code to use it:</div>
              <div className="flex flex-wrap gap-1.5">
                {["CHAD-7QX2", "SAHEL-4KD9", "HORN-2MP8", "LEVANT-9TR3", "PEER-DEMO1"].map((dc) => (
                  <button
                    key={dc}
                    type="button"
                    onClick={() => checkCode(dc)}
                    className="rounded-lg border border-teal-300 bg-teal-50 px-2.5 py-1 text-xs font-mono font-medium text-teal-800 hover:bg-teal-100"
                  >
                    {dc}
                  </button>
                ))}
              </div>
            </div>
            {err && <div className="rounded-lg bg-rose-50 p-2 text-sm text-rose-800">{err}</div>}
            <div className="flex flex-wrap gap-2 pt-2">
              <button onClick={() => checkCode()} disabled={!code.trim()} className="rounded-xl bg-teal-700 px-5 py-2.5 font-semibold text-white disabled:opacity-40">Continue with code</button>
              <button onClick={() => checkCode("CHAD-7QX2")} className="rounded-xl border border-stone-300 bg-stone-50 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-stone-100">Instant Demo Access →</button>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-4">
            <h2 className="font-serif text-2xl font-semibold">What do you know deeply?</h2>
            <p className="rounded-lg bg-teal-50 p-2 text-sm text-teal-900">✓ {inv?.label}{inv?.peer ? " — vouched by a verified member (counts toward your expertise evidence)" : ""}</p>
            <p className="text-sm text-slate-600">What you declare decides <b>which questions we ask you</b>. It never decides how much weight your answers carry — that is earned from track record, verification and peer-rated usefulness.</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name (kept private)" className="rounded-xl border border-stone-300 p-3 text-sm" />
              <input value={org} onChange={(e) => setOrg(e.target.value)} placeholder="Organisation (optional)" className="rounded-xl border border-stone-300 p-3 text-sm" />
            </div>
            <div>
              <div className="mb-1 text-sm font-semibold">I am a…</div>
              <div className="flex flex-wrap gap-2">{Object.entries(ROLE_TYPES).map(([k, v]) => <button key={k} className={chip(role === k)} onClick={() => setRole(k)}>{v}</button>)}</div>
            </div>
            <div>
              <div className="mb-1 text-sm font-semibold">Countries I know (max 6)</div>
              <div className="flex max-h-40 flex-wrap gap-2 overflow-auto">{countries.map((c) => <button key={c} className={chip(sel.includes(c))} onClick={() => toggle(sel, c, setSel)}>{c}</button>)}</div>
            </div>
            <div>
              <div className="mb-1 text-sm font-semibold">Themes</div>
              <div className="flex flex-wrap gap-2">{Object.entries(THEMES).map(([k, v]) => <button key={k} className={chip(themes.includes(k))} onClick={() => toggle(themes, k, setThemes)}>{v}</button>)}</div>
            </div>
            <div>
              <div className="mb-1 text-sm font-semibold">Evidence a moderator can verify (optional)</div>
              {CLAIMS.map((c) => (
                <label key={c} className="flex items-center gap-2 py-0.5 text-sm text-slate-700"><input type="checkbox" className="accent-teal-700" checked={claims.includes(c)} onChange={() => toggle(claims, c, setClaims)} />{c}</label>
              ))}
              <p className="mt-1 text-xs text-stone-500">Verification is done once by a moderator, then the evidence is deleted. If you choose <b>Sealed</b>, ACAPS records only “verified”.</p>
            </div>
            {err && <div className="rounded-lg bg-rose-50 p-2 text-sm text-rose-800">{err}</div>}
            <div className="flex gap-3">
              <button onClick={() => setStep(1)} className="rounded-xl border border-stone-300 px-4 py-2 text-sm">Back</button>
              <button onClick={() => (name.trim() && sel.length ? (setErr(""), setStep(3)) : setErr("Add your name and at least one country."))} className="rounded-xl bg-teal-700 px-5 py-2.5 font-semibold text-white">Continue</button>
            </div>
          </div>
        )}
        {step === 3 && (
          <div className="space-y-4">
            <h2 className="font-serif text-2xl font-semibold">Choose how visible you are</h2>
            <p className="text-sm text-slate-600">You can change this any time. Retreating to a more private level re-masks everything you ever contributed.</p>
            {risky && <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">⚠ You selected a sensitive context ({sel.filter((c) => SENSITIVE_COUNTRIES.includes(c)).join(", ")}). <b>Sealed</b> is pre-selected for your safety.</div>}
            <div className="grid gap-3">
              {ANON_LEVELS.map((l) => (
                <button key={l.id} onClick={() => setAnon(l.id)} className={`rounded-xl border p-3 text-left ${level === l.id ? "border-teal-700 bg-teal-50 ring-2 ring-teal-600" : "border-stone-200 hover:bg-stone-50"}`}>
                  <div className="flex items-center justify-between"><b>{l.name}</b>{l.id === recommended && <span className="text-xs font-semibold text-teal-700">recommended for you</span>}</div>
                  <div className="text-sm text-slate-600">{l.tagline}</div>
                </button>
              ))}
            </div>
            <div className="rounded-xl bg-slate-900 p-4 text-sm text-slate-100">
              <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Live preview — what each audience sees of you</div>
              <div><b className="text-teal-300">ACAPS moderators:</b> {L.acaps}</div>
              <div className="mt-1"><b className="text-teal-300">Circle peers:</b> {L.peers}</div>
              <div className="mt-1"><b className="text-teal-300">The public:</b> {L.pub}</div>
              <div className="mt-2 text-xs text-slate-400">{L.note}</div>
            </div>
            {level === "named" && (
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="accent-teal-700" checked={stage} onChange={(e) => setStage(e.target.checked)} />List me on the Honour Roll when I earn a top-tier track record</label>
            )}
            {(level === "named" || level === "confidential") && risky && <div className="rounded-lg bg-rose-50 p-2 text-sm text-rose-800">Heads-up: naming yourself in a sensitive context carries risk. We&apos;ll ask you to confirm again in My space.</div>}
            <div className="flex gap-3">
              <button onClick={() => setStep(2)} className="rounded-xl border border-stone-300 px-4 py-2 text-sm">Back</button>
              <button onClick={() => setStep(4)} className="rounded-xl bg-teal-700 px-5 py-2.5 font-semibold text-white">Continue</button>
            </div>
          </div>
        )}
        {step === 4 && (
          <div className="space-y-4">
            <h2 className="font-serif text-2xl font-semibold">Set your rhythm</h2>
            <p className="text-sm text-slate-600">We only ask about {sel.join(", ")} and your chosen themes. Direct replies and impact receipts are the only other things we push.</p>
            <div>
              <div className="mb-1 text-sm font-semibold">Maximum asks per week</div>
              <div className="flex gap-2">{[1, 2, 3].map((n) => <button key={n} className={chip(cap === n)} onClick={() => setCap(n)}>{n} / week</button>)}</div>
            </div>
            <div className="rounded-xl bg-stone-50 p-3 text-sm text-slate-700">
              <b>Summary:</b> {name} · {sel.join(", ")} · visibility <b>{L.name}</b> · max {cap} asks/week · each ask ≈ 90 seconds.
            </div>
            {err && <div className="rounded-lg bg-rose-50 p-2 text-sm text-rose-800">{err}</div>}
            <div className="flex gap-3">
              <button onClick={() => setStep(3)} className="rounded-xl border border-stone-300 px-4 py-2 text-sm">Back</button>
              <button disabled={busy} onClick={finish} className="rounded-xl bg-teal-700 px-5 py-2.5 font-semibold text-white disabled:opacity-50">{busy ? "Joining…" : "Join the circle"}</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
