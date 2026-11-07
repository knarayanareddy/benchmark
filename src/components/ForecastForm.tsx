"use client";
import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { detectLeaks } from "@/lib/scrub";
import { EVIDENCE_TYPES } from "@/lib/constants";
import { t, type Lang } from "@/lib/i18n";

type Props = {
  questionId: number;
  lang: Lang;
  text: string;
  criteria: string;
  closes: string;
  profileLevel: string;
  levelOptions: { id: string; name: string; sees: string }[];
  context: { rationale: string; sources: string[] };
};

function verbal(p: number) {
  if (p < 8) return "Almost certainly not";
  if (p < 25) return "Unlikely";
  if (p < 45) return "Somewhat unlikely";
  if (p < 56) return "A toss-up";
  if (p < 75) return "Somewhat likely";
  if (p < 92) return "Likely";
  return "Almost certain";
}

export function ForecastForm(props: Props) {
  const { lang } = props;
  const router = useRouter();
  const start = useRef(Date.now());
  const [p, setP] = useState(50);
  const [touched, setTouched] = useState(false);
  const [conf, setConf] = useState(2);
  const [reason, setReason] = useState("");
  const [ev, setEv] = useState("none");
  const [coi, setCoi] = useState(false);
  const [mode, setMode] = useState("profile");
  const [peeked, setPeeked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const leaks = useMemo(() => detectLeaks(reason), [reason]);
  const shown = props.levelOptions.find((l) => l.id === (mode === "profile" ? props.profileLevel : mode));

  async function submit() {
    setBusy(true);
    setErr("");
    const res = await fetch("/api/forecast", {
      method: "POST",
      body: JSON.stringify({
        questionId: props.questionId,
        probability: p,
        confidence: conf,
        reason,
        evidenceType: ev,
        coi,
        identityMode: mode,
        peeked,
        secondsSpent: Math.round((Date.now() - start.current) / 1000),
      }),
    });
    const j = await res.json();
    setBusy(false);
    if (!j.ok) return setErr(j.error);
    router.refresh();
  }

  return (
    <div className="space-y-6">
      <div className="rounded-xl bg-indigo-50 px-4 py-2 text-sm text-indigo-900">🔒 {t(lang, "blind")}</div>

      <div>
        <div className="mb-1 flex items-end justify-between">
          <label className="font-semibold text-slate-900">{t(lang, "yourEstimate")}</label>
          <div className="text-right">
            <div className={`font-serif text-4xl font-semibold ${touched ? "text-teal-800" : "text-stone-300"}`}>{touched ? `${p}%` : "—"}</div>
            <div className="text-xs text-stone-500">{touched ? verbal(p) : "Move the slider to answer"}</div>
          </div>
        </div>
        <input
          type="range"
          min={1}
          max={99}
          value={p}
          onChange={(e) => {
            setP(Number(e.target.value));
            setTouched(true);
          }}
          className="h-3 w-full cursor-pointer accent-teal-700"
          aria-label="Probability"
        />
        <div className="flex justify-between text-xs text-stone-500">
          <span>{t(lang, "unlikely")}</span>
          <span>{t(lang, "toss")}</span>
          <span>{t(lang, "likely")}</span>
        </div>
      </div>

      <div>
        <div className="mb-2 font-semibold text-slate-900">{t(lang, "howSure")}</div>
        <div className="flex gap-2">
          {[1, 2, 3].map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setConf(c)}
              className={`flex-1 rounded-xl border px-3 py-2 text-sm font-medium ${conf === c ? "border-teal-700 bg-teal-700 text-white" : "border-stone-300 bg-white text-slate-700 hover:bg-stone-50"}`}
            >
              {t(lang, `sure${c}`)}
            </button>
          ))}
        </div>
      </div>

      <div>
        <label className="mb-1 block font-semibold text-slate-900">{t(lang, "why")}</label>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={3}
          maxLength={600}
          placeholder="What are you seeing that a report may not?"
          className="w-full rounded-xl border border-stone-300 bg-white p-3 text-sm outline-none focus:border-teal-600"
        />
        {leaks.length > 0 && (
          <div className="mt-2 space-y-1 rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
            <b>Re-identification check</b> — this could point to you in a small circle:
            {leaks.map((l, i) => (
              <div key={i}>
                • “{l.snippet}” — {l.tip}
              </div>
            ))}
          </div>
        )}
        <div className="mt-3">
          <div className="mb-1 text-sm font-medium text-slate-700">{t(lang, "evidence")}</div>
          <div className="flex flex-wrap gap-2">
            {Object.entries(EVIDENCE_TYPES).map(([k, v]) => (
              <button
                key={k}
                type="button"
                onClick={() => setEv(k)}
                className={`rounded-full border px-3 py-1 text-xs ${ev === k ? "border-teal-700 bg-teal-50 font-semibold text-teal-800" : "border-stone-300 bg-white text-slate-600"}`}
              >
                {v}
              </button>
            ))}
          </div>
        </div>
      </div>

      <label className="flex cursor-pointer items-start gap-2 text-sm text-slate-700">
        <input type="checkbox" checked={coi} onChange={(e) => setCoi(e.target.checked)} className="mt-1 accent-teal-700" />
        <span>
          {t(lang, "coi")} <span className="text-stone-400">— declaring is healthy; it lowers weight, never penalises.</span>
        </span>
      </label>

      <details
        className="rounded-xl border border-stone-200 bg-stone-50 p-3 text-sm"
        onToggle={(e) => {
          if ((e.target as HTMLDetailsElement).open) setPeeked(true);
        }}
      >
        <summary className="cursor-pointer font-medium text-slate-700">Need context? Read ACAPS&apos; analysis (rating hidden)</summary>
        <p className="mt-2 text-xs text-amber-800">Opening this is logged as “saw ACAPS first” — it never penalises you, it only helps ACAPS interpret independence.</p>
        <p className="mt-2 text-slate-700">{props.context.rationale}</p>
        <ul className="mt-2 list-inside list-disc break-all text-xs text-indigo-700">
          {props.context.sources.map((s) => (
            <li key={s}>
              <a href={s} target="_blank" rel="noreferrer">{s}</a>
            </li>
          ))}
        </ul>
      </details>

      <div className="rounded-xl border border-stone-200 bg-white p-3 text-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <span className="text-stone-500">{t(lang, "shownAs")}: </span>
            <b className="text-slate-800">{shown?.name ?? props.profileLevel}</b>
            <div className="text-xs text-stone-500">{shown?.sees}</div>
          </div>
          <select value={mode} onChange={(e) => setMode(e.target.value)} className="rounded-lg border border-stone-300 bg-white px-2 py-1 text-xs">
            <option value="profile">As my profile ({props.levelOptions.find((l) => l.id === props.profileLevel)?.name})</option>
            {props.levelOptions
              .filter((l) => l.id !== props.profileLevel)
              .map((l) => (
                <option key={l.id} value={l.id}>Just this once: {l.name}</option>
              ))}
          </select>
        </div>
      </div>

      {err && <div className="rounded-xl bg-rose-50 p-3 text-sm text-rose-800">{err}</div>}
      <button
        disabled={!touched || busy}
        onClick={submit}
        className="w-full rounded-xl bg-teal-700 px-5 py-3 text-base font-semibold text-white shadow transition enabled:hover:bg-teal-800 disabled:opacity-40"
      >
        {busy ? "Saving…" : t(lang, "submit")}
      </button>
      <p className="text-center text-xs text-stone-500">Resolves {props.closes}. Your first estimate is locked; you may revise after the reveal.</p>
    </div>
  );
}
