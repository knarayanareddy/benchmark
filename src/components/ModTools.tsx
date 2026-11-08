"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Timeline } from "./Timeline";
import type { Timeline as TimelineData } from "@/lib/timeline";

async function call(action: string, body: object) {
  const r = await fetch(`/api/mod/${action}`, { method: "POST", body: JSON.stringify(body) });
  return r.json();
}

export function VerifyButton({ expertId }: { expertId: number }) {
  const router = useRouter();
  return (
    <button onClick={async () => { await call("verify", { expertId }); router.refresh(); }} className="rounded-lg bg-teal-700 px-3 py-1 text-xs font-semibold text-white">
      Verify &amp; delete evidence
    </button>
  );
}

export function DissentAdvance({ id, state }: { id: number; state: string }) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const next: Record<string, string> = { open: "Route to analyst", routed: "Mark actioned", actioned: "Notify expert", notified: "Close" };
  if (!next[state]) return <span className="text-xs text-emerald-700">Closed ✓</span>;
  return (
    <div className="flex items-center gap-2">
      {(state === "routed" || state === "actioned") && (
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Analyst note" className="w-44 rounded-md border border-stone-300 px-2 py-1 text-xs" />
      )}
      <button onClick={async () => { await call("dissent", { id, note }); router.refresh(); }} className="whitespace-nowrap rounded-lg bg-slate-900 px-3 py-1 text-xs font-semibold text-white">{next[state]}</button>
    </div>
  );
}

export function ResolveButtons({ questionId }: { questionId: number }) {
  const router = useRouter();
  const go = async (outcome: string) => {
    if (!window.confirm(`Resolve as ${outcome.toUpperCase()}? Receipts go to every forecaster.`)) return;
    await call("resolve", { questionId, outcome });
    router.refresh();
  };
  return (
    <div className="flex gap-1.5">
      {["yes", "no", "unobservable"].map((o) => (
        <button key={o} onClick={() => go(o)} className="rounded-lg border border-stone-300 bg-white px-2.5 py-1 text-xs font-semibold hover:bg-stone-100">{o === "unobservable" ? "unobservable" : `Resolve ${o}`}</button>
      ))}
    </div>
  );
}

type Plan = { expertId: number; score: number; decision: string; reason: string; who: string; sub: string; level: string; parts: { label: string; pts: number }[] };

export function DispatchLab({
  risks,
}: {
  risks: {
    id: string;
    label: string;
    triggers: { id: string; title: string }[];
    timeline?: TimelineData;
  }[];
}) {
  const router = useRouter();
  const [riskId, setRiskId] = useState(
    risks.find((r) => r.id === "R1043")?.id ?? risks[0]?.id ?? ""
  );
  const [triggerId, setTriggerId] = useState("");
  const [plan, setPlan] = useState<Plan[] | null>(null);
  const [text, setText] = useState("");
  const [fast, setFast] = useState(false);
  const [days, setDays] = useState(14);
  const [done, setDone] = useState("");
  const [busy, setBusy] = useState(false);
  const risk = risks.find((r) => r.id === riskId);

  async function preview() {
    setBusy(true);
    setDone("");
    const j = await call("question", { riskId, triggerId: triggerId || undefined, text, dryRun: true, kind: fast ? "signal" : "forecast", days });
    setBusy(false);
    setPlan(j.plan);
    if (!text) setText(j.text);
  }
  async function publish() {
    setBusy(true);
    const j = await call("question", { riskId, triggerId: triggerId || undefined, text, kind: fast ? "signal" : "forecast", days });
    setBusy(false);
    setDone(`Published. ${j.sent} experts notified, ${j.suppressed} deliberately not bothered.`);
    setPlan(null);
    router.refresh();
  }
  const notify = plan?.filter((p) => p.decision === "notify") ?? [];
  const supp = plan?.filter((p) => p.decision === "suppress") ?? [];
  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-2">
        <select value={riskId} onChange={(e) => { setRiskId(e.target.value); setTriggerId(""); setPlan(null); setText(""); }} className="rounded-xl border border-stone-300 bg-white p-2 text-sm">
          {risks.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
        </select>
        <select value={triggerId} onChange={(e) => { setTriggerId(e.target.value); setPlan(null); setText(""); }} className="rounded-xl border border-stone-300 bg-white p-2 text-sm">
          <option value="">Whole risk (will it materialise?)</option>
          {risk?.triggers.map((t) => <option key={t.id} value={t.id}>Trigger: {t.title.slice(0, 80)}</option>)}
        </select>
      </div>
      <textarea value={text} onChange={(e) => setText(e.target.value)} rows={2} placeholder="Question wording (auto-generated if empty)" className="w-full rounded-xl border border-stone-300 bg-white p-2 text-sm" />
      <label className="flex flex-wrap items-center gap-2 text-sm text-slate-700">
        <input type="checkbox" checked={fast} onChange={(e) => { setFast(e.target.checked); setPlan(null); }} />
        <b>⚡ Fast-loop signal check</b>
        <span className="text-xs text-stone-500">short horizon, observable, resolves in days — builds early track records and gives experts quick feedback</span>
        {fast && (
          <span className="flex items-center gap-1 text-xs">closes in <input type="number" min={3} max={30} value={days} onChange={(e) => setDays(Number(e.target.value))} className="w-14 rounded border border-stone-300 px-1 py-0.5" /> days</span>
        )}
      </label>
      <div className="flex gap-2">
        <button disabled={busy} onClick={preview} className="rounded-xl border border-slate-900 px-4 py-2 text-sm font-semibold hover:bg-stone-100">Dry-run dispatch</button>
        {plan && <button disabled={busy} onClick={publish} className="rounded-xl bg-teal-700 px-4 py-2 text-sm font-semibold text-white">Publish &amp; notify {notify.length}</button>}
      </div>
      {done && <div className="rounded-xl bg-teal-50 p-3 text-sm text-teal-900">{done}</div>}
      {plan && (
        <div className="grid gap-4 lg:grid-cols-2">
          <div>
            <div className="mb-1 text-sm font-semibold text-teal-800">Will be notified ({notify.length})</div>
            <div className="space-y-1">{notify.map((p) => <div key={p.expertId} className="rounded-lg bg-teal-50 p-2 text-xs"><b>{p.who}</b> <span className="text-stone-500">{p.sub}</span> · match {p.score}<div className="text-stone-600">{p.reason}</div></div>)}</div>
          </div>
          <div>
            <div className="mb-1 text-sm font-semibold text-stone-600">Deliberately NOT bothered ({supp.length})</div>
            <div className="max-h-96 space-y-1 overflow-auto">{supp.map((p) => <div key={p.expertId} className="rounded-lg bg-stone-100 p-2 text-xs"><b>{p.who}</b> · match {p.score}<div className="text-stone-500">{p.reason}</div></div>)}</div>
          </div>
        </div>
      )}
      {risk?.timeline && (
        <div className="pt-2">
          <Timeline timeline={risk.timeline} />
        </div>
      )}
    </div>
  );
}
