import type { ReactNode } from "react";

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-2xl border border-stone-200 bg-white p-5 shadow-sm ${className}`}>{children}</div>;
}

const TONES: Record<string, string> = {
  teal: "bg-teal-50 text-teal-800 ring-teal-200",
  amber: "bg-amber-50 text-amber-800 ring-amber-200",
  rose: "bg-rose-50 text-rose-800 ring-rose-200",
  stone: "bg-stone-100 text-stone-700 ring-stone-200",
  indigo: "bg-indigo-50 text-indigo-800 ring-indigo-200",
  green: "bg-emerald-50 text-emerald-800 ring-emerald-200",
};
export function Pill({ children, tone = "stone" }: { children: ReactNode; tone?: keyof typeof TONES }) {
  return <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${TONES[tone]}`}>{children}</span>;
}

export function H({ children, sub }: { children: ReactNode; sub?: ReactNode }) {
  return (
    <div className="mb-5">
      <h1 className="font-serif text-3xl font-semibold tracking-tight text-slate-900">{children}</h1>
      {sub && <p className="mt-1 max-w-3xl text-slate-600">{sub}</p>}
    </div>
  );
}

/** 0-100 track with ACAPS marker, circle interval + mean, and the viewer's own estimate. */
export function ProbBar({
  acaps,
  agg,
  mine,
  revised,
}: {
  acaps?: number | null;
  agg?: { mean: number; p10: number; p90: number } | null;
  mine?: number | null;
  revised?: number | null;
}) {
  return (
    <div className="pt-6 pb-7">
      <div className="relative h-3 rounded-full bg-stone-200">
        {agg && (
          <div
            className="absolute top-0 h-3 rounded-full bg-teal-300/70"
            style={{ left: `${agg.p10}%`, width: `${Math.max(2, agg.p90 - agg.p10)}%` }}
            title={`Circle 80% interval ${agg.p10}–${agg.p90}%`}
          />
        )}
        {agg && <div className="absolute -top-1 h-5 w-1.5 -translate-x-1/2 rounded bg-teal-700" style={{ left: `${agg.mean}%` }} />}
        {acaps !== null && acaps !== undefined && (
          <div className="absolute -top-6 -translate-x-1/2 text-center text-[11px] font-semibold text-indigo-700" style={{ left: `${acaps}%` }}>
            ACAPS<div className="mx-auto h-0 w-0 border-x-4 border-t-[6px] border-x-transparent border-t-indigo-700" />
          </div>
        )}
        {mine !== null && mine !== undefined && (
          <div className="absolute top-4 -translate-x-1/2 text-center text-[11px] font-semibold text-amber-700" style={{ left: `${mine}%` }}>
            ▲<div>you {mine}%</div>
          </div>
        )}
        {revised !== null && revised !== undefined && (
          <div className="absolute top-4 -translate-x-1/2 text-center text-[11px] font-semibold text-amber-900" style={{ left: `${revised}%` }}>
            ▲<div>revised {revised}%</div>
          </div>
        )}
      </div>
      <div className="mt-8 flex justify-between text-[10px] uppercase tracking-wide text-stone-400">
        <span>0%</span>
        <span>50%</span>
        <span>100%</span>
      </div>
    </div>
  );
}

export function levelTone(l: string): keyof typeof TONES {
  return l === "High" || l === "Very High" ? "rose" : l === "Medium" ? "amber" : "stone";
}

export function fmtDate(d: Date | string) {
  return new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}
export function ago(d: Date | string) {
  const h = Math.round((Date.now() - new Date(d).getTime()) / 3600000);
  return h < 1 ? "just now" : h < 48 ? `${h}h ago` : `${Math.round(h / 24)}d ago`;
}
