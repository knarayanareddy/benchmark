"use client";
import { useState } from "react";
import { ANON_LEVELS, ROLE_TYPES, THEMES } from "@/lib/constants";

export type ProfileData = {
  name: string;
  org: string;
  roleType: string;
  countries: string[];
  themes: string[];
  anonymity: string;
  stageOptIn: boolean;
  retroactive: boolean;
  weeklyCap: number;
  minMatch: number;
};

export function ProfileForm({
  initial,
  countriesList = [],
}: {
  initial: ProfileData;
  countriesList?: string[];
}) {
  const [s, setS] = useState<ProfileData>(initial);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const L = ANON_LEVELS.find((l) => l.id === s.anonymity)!;
  const dirty = JSON.stringify(s) !== JSON.stringify(initial);

  const toggle = (arr: string[], v: string, key: "countries" | "themes") => {
    const next = arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v];
    setS({ ...s, [key]: next });
  };

  async function save(confirmSafety = false) {
    setBusy(true);
    setMsg("");
    try {
      const r = await fetch("/api/profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...s, confirmSafety }),
      });
      const j = await r.json();
      setBusy(false);
      if (!j.ok && j.error === "SAFETY_CONFIRM") {
        if (
          window.confirm(
            "Safety check: you cover a sensitive context. Being identifiable to ACAPS or peers can put you or your contacts at risk, even if everyone is trustworthy. Continue anyway?"
          )
        )
          return save(true);
        return;
      }
      if (!j.ok) return setMsg(j.error || "Failed to save profile");
      setMsg("Saved successfully. Updating view…");
      setTimeout(() => {
        window.location.reload();
      }, 500);
    } catch (e) {
      setBusy(false);
      setMsg("Network error saving profile");
    }
  }

  const chip = (on: boolean) =>
    `rounded-full border px-2.5 py-0.5 text-xs font-medium transition ${
      on
        ? "border-teal-700 bg-teal-700 text-white"
        : "border-stone-300 bg-white text-slate-700 hover:bg-stone-50"
    }`;

  return (
    <div className="space-y-4">
      {/* Persona Profile Details (Name, Org, Role, Country) */}
      <div className="rounded-xl border border-stone-200 bg-stone-50/50 p-3.5 space-y-3">
        <div className="flex items-center justify-between">
          <div className="text-xs font-bold uppercase tracking-wide text-slate-700">
            Profile Details &amp; Domain Expertise
          </div>
          <button
            type="button"
            onClick={() => setExpanded(!expanded)}
            className="text-xs font-semibold text-teal-700 hover:underline"
          >
            {expanded ? "Collapse fields" : "Edit Name, Org & Countries"}
          </button>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Name</label>
            <input
              value={s.name}
              onChange={(e) => setS({ ...s, name: e.target.value })}
              placeholder="Your name"
              className="w-full rounded-xl border border-stone-300 bg-white p-2.5 text-xs outline-none focus:border-teal-600"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Organisation</label>
            <input
              value={s.org}
              onChange={(e) => setS({ ...s, org: e.target.value })}
              placeholder="Organisation (optional)"
              className="w-full rounded-xl border border-stone-300 bg-white p-2.5 text-xs outline-none focus:border-teal-600"
            />
          </div>
        </div>

        {expanded && (
          <>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Role Type</label>
              <div className="flex flex-wrap gap-1.5">
                {Object.entries(ROLE_TYPES).map(([k, v]) => (
                  <button
                    key={k}
                    type="button"
                    className={chip(s.roleType === k)}
                    onClick={() => setS({ ...s, roleType: k })}
                  >
                    {v}
                  </button>
                ))}
              </div>
            </div>

            {countriesList.length > 0 && (
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Countries Covered ({s.countries.join(", ") || "None"})
                </label>
                <div className="flex max-h-32 flex-wrap gap-1.5 overflow-y-auto p-1 border rounded-lg bg-white">
                  {countriesList.map((c) => (
                    <button
                      key={c}
                      type="button"
                      className={chip(s.countries.includes(c))}
                      onClick={() => toggle(s.countries, c, "countries")}
                    >
                      {c}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Themes</label>
              <div className="flex flex-wrap gap-1.5">
                {Object.entries(THEMES).map(([k, v]) => (
                  <button
                    key={k}
                    type="button"
                    className={chip(s.themes.includes(k))}
                    onClick={() => toggle(s.themes, k, "themes")}
                  >
                    {v}
                  </button>
                ))}
              </div>
            </div>
          </>
        )}
      </div>

      {/* Visibility Level */}
      <div>
        <div className="mb-1.5 text-xs font-bold uppercase tracking-wide text-slate-700">
          Visibility &amp; Anonymity Setting
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          {ANON_LEVELS.map((l) => (
            <button
              key={l.id}
              type="button"
              onClick={() => setS({ ...s, anonymity: l.id })}
              className={`rounded-xl border p-3 text-left transition ${
                s.anonymity === l.id
                  ? "border-teal-700 bg-teal-50 ring-2 ring-teal-600"
                  : "border-stone-200 hover:bg-stone-50"
              }`}
            >
              <b>{l.name}</b>
              <div className="text-xs text-slate-600">{l.tagline}</div>
            </button>
          ))}
        </div>
      </div>

      <div className="rounded-xl bg-slate-900 p-3 text-sm text-slate-100">
        <div><b className="text-teal-300">ACAPS:</b> {L.acaps}</div>
        <div className="mt-1"><b className="text-teal-300">Peers:</b> {L.peers}</div>
        <div className="mt-1"><b className="text-teal-300">Public:</b> {L.pub}</div>
      </div>

      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          className="mt-1 accent-teal-700"
          checked={s.retroactive}
          onChange={(e) => setS({ ...s, retroactive: e.target.checked })}
        />
        <span><b>Retroactive privacy</b> — if I move to a more private level, re-mask everything I contributed before.</span>
      </label>

      {s.anonymity === "named" && (
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            className="mt-1 accent-teal-700"
            checked={s.stageOptIn}
            onChange={(e) => setS({ ...s, stageOptIn: e.target.checked })}
          />
          <span><b>Honour Roll</b> — list me by name when I reach a top-tier track record.</span>
        </label>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="text-sm">
          Max asks per week: <b>{s.weeklyCap}</b>
          <input
            type="range"
            min={1}
            max={3}
            value={s.weeklyCap}
            onChange={(e) => setS({ ...s, weeklyCap: Number(e.target.value) })}
            className="w-full accent-teal-700"
          />
        </label>
        <label className="text-sm">
          Relevance threshold: <b>{s.minMatch}</b> <span className="text-xs text-stone-500">(higher = only closest matches)</span>
          <input
            type="range"
            min={30}
            max={90}
            step={5}
            value={s.minMatch}
            onChange={(e) => setS({ ...s, minMatch: Number(e.target.value) })}
            className="w-full accent-teal-700"
          />
        </label>
      </div>

      <div className="flex items-center gap-3 pt-2">
        <button
          disabled={!dirty || busy}
          onClick={() => save()}
          className="rounded-xl bg-teal-700 px-5 py-2.5 font-semibold text-white shadow-sm transition hover:bg-teal-800 disabled:opacity-40"
        >
          {busy ? "Saving…" : "Save profile & settings"}
        </button>
        {msg && <span className="text-sm font-medium text-teal-800">{msg}</span>}
      </div>
    </div>
  );
}


export function InviteButton() {
  const [code, setCode] = useState("");
  const [err, setErr] = useState("");
  return (
    <div>
      <button
        onClick={async () => {
          const r = await fetch("/api/invite", { method: "POST" });
          const j = await r.json();
          if (j.ok) { setCode(j.code); setErr(""); } else setErr(j.error);
        }}
        className="rounded-xl border border-teal-700 px-4 py-2 text-sm font-semibold text-teal-800 hover:bg-teal-50"
      >
        Vouch for a peer (3 per season)
      </button>
      {code && <div className="mt-2 rounded-lg bg-teal-50 p-2 text-sm">Send this single-use code privately: <b className="font-mono">{code}</b>. Their quality becomes part of your own standing.</div>}
      {err && <div className="mt-2 text-sm text-rose-700">{err}</div>}
    </div>
  );
}
