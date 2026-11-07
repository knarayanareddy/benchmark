"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

type Arg = { who: string; sub: string; text: string; p: number };

export function SecondLook({
  questionId,
  mine,
  acapsPct,
  gap,
  acapsRationale,
  sources,
  higher,
  lower,
}: {
  questionId: number;
  mine: number;
  acapsPct: number;
  gap: number;
  acapsRationale: string;
  sources: string[];
  higher: Arg[];
  lower: Arg[];
}) {
  const router = useRouter();
  const [revising, setRevising] = useState(false);
  const [v, setV] = useState(mine);
  const [busy, setBusy] = useState(false);

  async function save(val: number) {
    setBusy(true);
    await fetch("/api/forecast", { method: "PATCH", body: JSON.stringify({ questionId, revised: val }) });
    setBusy(false);
    router.refresh();
  }
  const col = (title: string, items: Arg[]) => (
    <div className="rounded-xl border border-stone-200 bg-white p-3">
      <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-stone-500">{title}</div>
      {items.length === 0 && <div className="text-sm text-stone-400">No reasoning shared yet.</div>}
      <div className="space-y-2">
        {items.map((a, i) => (
          <div key={i} className="text-sm">
            <span className="font-semibold text-slate-800">{a.who}</span>{" "}
            <span className="text-xs text-stone-500">({a.p}%)</span>
            <div className="text-slate-700">{a.text}</div>
          </div>
        ))}
      </div>
    </div>
  );
  return (
    <div className="rounded-2xl border-2 border-dashed border-amber-400 bg-amber-50/60 p-5">
      <h3 className="font-serif text-xl font-semibold text-slate-900">A second look — only if you want one</h3>
      <p className="mt-1 text-sm text-slate-700">
        Your estimate ({mine}%) is {gap} points {mine > acapsPct ? "above" : "below"} ACAPS&apos; rating (~{acapsPct}%). That is exactly the kind of signal ACAPS wants if you see
        something the analysis doesn&apos;t. Below is the reasoning on <b>both</b> sides, shown the same way whichever direction you lean. No answer is “right”.
      </p>
      <div className="mt-4 rounded-xl border border-indigo-200 bg-white p-3">
        <div className="text-xs font-semibold uppercase tracking-wide text-indigo-700">ACAPS&apos; reasoning &amp; sources</div>
        <p className="mt-1 text-sm text-slate-700">{acapsRationale}</p>
        <ul className="mt-1 list-inside list-disc break-all text-xs text-indigo-700">
          {sources.slice(0, 4).map((s) => (
            <li key={s}><a href={s} target="_blank" rel="noreferrer">{s}</a></li>
          ))}
        </ul>
      </div>
      <div className="mt-3 grid gap-3 md:grid-cols-2">
        {col("Reasons given for a higher probability", higher)}
        {col("Reasons given for a lower probability", lower)}
      </div>
      {!revising ? (
        <div className="mt-4 flex flex-wrap gap-3">
          <button disabled={busy} onClick={() => save(mine)} className="rounded-xl border border-stone-300 bg-white px-4 py-2 text-sm font-semibold text-slate-800 hover:bg-stone-100">
            Keep my estimate ({mine}%)
          </button>
          <button onClick={() => setRevising(true)} className="rounded-xl border border-stone-300 bg-white px-4 py-2 text-sm font-semibold text-slate-800 hover:bg-stone-100">
            Revise it
          </button>
          <span className="self-center text-xs text-stone-500">Both options are equal. Your first estimate stays on record either way.</span>
        </div>
      ) : (
        <div className="mt-4 space-y-2">
          <div className="font-semibold">Revised estimate: <span className="text-teal-800">{v}%</span></div>
          <input type="range" min={1} max={99} value={v} onChange={(e) => setV(Number(e.target.value))} className="w-full accent-teal-700" />
          <button disabled={busy} onClick={() => save(v)} className="rounded-xl bg-teal-700 px-4 py-2 text-sm font-semibold text-white">Save revision</button>
        </div>
      )}
    </div>
  );
}
