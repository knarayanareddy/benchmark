"use client";

import { useState } from "react";
import Link from "next/link";

export type PersonaCardInfo = {
  id: number;
  name: string;
  alias: string;
  org?: string;
  role: string;
  country: string;
  anonymity: string;
  isModerator: boolean;
  isCustom?: boolean;
  hasAnswered?: boolean;
};

interface PersonaSelectorProps {
  currentId?: number | null;
  personas: PersonaCardInfo[];
  title?: string;
  sub?: string;
  returnTo?: string;
  riskId?: string;
  compact?: boolean;
  showJoinPrompt?: boolean;
}

export function PersonaSelector({
  currentId,
  personas,
  title = "Pick a Persona",
  sub = "Select any persona to explore the circle from their perspective.",
  returnTo,
  riskId,
  compact = false,
  showJoinPrompt = true,
}: PersonaSelectorProps) {
  const [busyId, setBusyId] = useState<number | null>(null);
  const [filterText, setFilterText] = useState("");
  const [roleFilter, setRoleFilter] = useState("all");

  const customPersonas = personas.filter((p) => p.isCustom);
  const answeredPersonas = personas.filter((p) => p.hasAnswered);

  // Key featured personas for quick access
  const featuredNames = ["Fatimé", "Idriss", "Dr. Claire", "Samuel", "ACAPS Moderator"];
  const featured = personas.filter((p) =>
    featuredNames.some((fn) => p.name.toLowerCase().includes(fn.toLowerCase()) || (p.isModerator && fn === "ACAPS Moderator"))
  );

  async function handleSelect(id: number) {
    setBusyId(id);
    try {
      await fetch("/api/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expertId: id }),
      });
      if (returnTo) {
        window.location.href = returnTo;
      } else {
        window.location.reload();
      }
    } catch (err) {
      console.error("Failed to set persona", err);
      setBusyId(null);
    }
  }

  const filtered = personas.filter((p) => {
    if (roleFilter === "custom" && !p.isCustom) return false;
    if (roleFilter === "unlocked" && !p.hasAnswered) return false;
    if (roleFilter === "moderator" && !p.isModerator) return false;
    if (roleFilter === "expert" && p.isModerator) return false;

    if (!filterText) return true;
    const q = filterText.toLowerCase();
    return (
      p.name.toLowerCase().includes(q) ||
      p.alias.toLowerCase().includes(q) ||
      p.country.toLowerCase().includes(q) ||
      (p.org && p.org.toLowerCase().includes(q)) ||
      p.anonymity.toLowerCase().includes(q)
    );
  });

  const joinUrl = `/join${returnTo ? `?returnTo=${encodeURIComponent(returnTo)}` : ""}`;

  return (
    <div className={`rounded-2xl border border-stone-200 bg-white shadow-sm ${compact ? "p-4" : "p-6"}`}>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-stone-100 pb-3">
        <div>
          <h3 className="font-serif text-xl font-semibold text-slate-900">{title}</h3>
          {sub && <p className="text-xs text-slate-600 sm:text-sm">{sub}</p>}
        </div>
        {showJoinPrompt && (
          <Link
            href={joinUrl}
            className="rounded-xl border border-teal-700 bg-teal-50 px-3.5 py-1.5 text-xs font-semibold text-teal-800 transition hover:bg-teal-100"
          >
            + Create / Join new profile
          </Link>
        )}
      </div>

      {/* If this is Roundtable and some personas have answered, highlight them! */}
      {riskId && answeredPersonas.length > 0 && (
        <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50/70 p-3">
          <div className="mb-1 text-xs font-bold uppercase tracking-wide text-emerald-900">
            ✓ Personas who have already unlocked this Roundtable ({answeredPersonas.length}):
          </div>
          <div className="flex flex-wrap gap-2 pt-1">
            {answeredPersonas.slice(0, 6).map((p) => {
              const active = currentId === p.id;
              return (
                <button
                  key={p.id}
                  disabled={busyId !== null}
                  onClick={() => handleSelect(p.id)}
                  className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-medium transition ${
                    active
                      ? "border-emerald-700 bg-emerald-700 text-white"
                      : "border-emerald-300 bg-white text-emerald-900 hover:bg-emerald-100"
                  }`}
                >
                  <span>{p.name}</span>
                  <span className="opacity-75">({p.alias})</span>
                  {active ? " (Active)" : " →"}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* User-created profiles section if any exist */}
      {customPersonas.length > 0 && (
        <div className="mt-4 rounded-xl border border-teal-200 bg-teal-50/60 p-3">
          <div className="mb-2 text-xs font-bold uppercase tracking-wide text-teal-900">
            🌟 Your Created Profiles:
          </div>
          <div className="grid gap-2 sm:grid-cols-2 md:grid-cols-3">
            {customPersonas.map((p) => {
              const active = currentId === p.id;
              return (
                <button
                  key={p.id}
                  disabled={busyId !== null}
                  onClick={() => handleSelect(p.id)}
                  className={`rounded-xl border p-2.5 text-left transition ${
                    active
                      ? "border-teal-700 bg-teal-700 text-white shadow"
                      : "border-teal-200 bg-white text-slate-900 hover:border-teal-500 hover:shadow-sm"
                  }`}
                >
                  <div className="flex items-center justify-between text-xs font-semibold">
                    <span>{p.name}</span>
                    <span className={`rounded px-1.5 py-0.5 text-[10px] ${active ? "bg-teal-800 text-white" : "bg-teal-100 text-teal-800"}`}>
                      {p.anonymity}
                    </span>
                  </div>
                  <div className={`mt-0.5 text-xs ${active ? "text-teal-100" : "text-stone-500"}`}>
                    Alias: {p.alias} · {p.country || "Global"}
                  </div>
                  {active && <div className="mt-1 text-[11px] font-bold text-teal-200">✓ Currently active</div>}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Quick Featured Personas */}
      <div className="mt-4">
        <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-stone-500">
          Featured Demo Personas:
        </div>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {featured.map((p) => {
            const active = currentId === p.id;
            return (
              <button
                key={p.id}
                disabled={busyId !== null}
                onClick={() => handleSelect(p.id)}
                className={`rounded-xl border p-3 text-left transition ${
                  active
                    ? "border-teal-700 bg-teal-700 text-white shadow"
                    : "border-stone-200 bg-stone-50 text-slate-800 hover:border-teal-600 hover:bg-white hover:shadow-sm"
                }`}
              >
                <div className="flex items-center justify-between text-xs">
                  <span className={`font-semibold uppercase ${active ? "text-teal-200" : "text-teal-700"}`}>
                    {p.isModerator ? "Moderator" : p.anonymity}
                  </span>
                  {active && <span className="font-bold text-teal-100">✓ Active</span>}
                </div>
                <div className="mt-1 font-semibold text-sm">{p.name}</div>
                <div className={`text-xs ${active ? "text-teal-100" : "text-stone-500"}`}>
                  {p.isModerator ? "Console & Dispatch" : `${p.alias} · ${p.country}`}
                </div>
                {!active && <div className="mt-2 text-xs font-medium text-teal-700">Select →</div>}
              </button>
            );
          })}
        </div>
      </div>

      {/* Full Persona Picker with Filter & Search */}
      <div className="mt-5 border-t border-stone-200 pt-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="text-xs font-semibold uppercase tracking-wide text-stone-500">
            All Available Personas ({personas.length}):
          </div>
          <div className="flex flex-wrap gap-1.5 text-xs">
            {["all", "custom", ...(riskId ? ["unlocked"] : []), "expert", "moderator"].map((rf) => (
              <button
                key={rf}
                onClick={() => setRoleFilter(rf)}
                className={`rounded-full px-2.5 py-0.5 capitalize transition ${
                  roleFilter === rf ? "bg-slate-800 text-white" : "bg-stone-100 text-stone-600 hover:bg-stone-200"
                }`}
              >
                {rf === "unlocked" ? "Unlocked for this risk" : rf === "custom" ? "My Profiles" : rf}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-3">
          <input
            type="text"
            value={filterText}
            onChange={(e) => setFilterText(e.target.value)}
            placeholder="Search by name, country, role, alias..."
            className="w-full rounded-xl border border-stone-300 bg-white p-2.5 text-xs outline-none focus:border-teal-600 focus:ring-1 focus:ring-teal-600"
          />
        </div>

        <div className="mt-3 max-h-56 space-y-1.5 overflow-y-auto pr-1">
          {filtered.length === 0 ? (
            <p className="py-4 text-center text-xs text-stone-500">No personas found matching your search.</p>
          ) : (
            filtered.map((p) => {
              const active = currentId === p.id;
              return (
                <div
                  key={p.id}
                  className={`flex items-center justify-between rounded-xl border p-2 text-xs transition ${
                    active ? "border-teal-600 bg-teal-50" : "border-stone-200 bg-white hover:border-stone-300"
                  }`}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 font-semibold text-slate-900">
                      <span>{p.name}</span>
                      {p.isCustom && <span className="rounded bg-teal-100 px-1 text-[10px] text-teal-800">Custom</span>}
                      {p.hasAnswered && <span className="rounded bg-emerald-100 px-1 text-[10px] text-emerald-800">Unlocked</span>}
                      <span className="font-normal text-stone-400">({p.alias})</span>
                    </div>
                    <div className="text-[11px] text-stone-500">
                      {p.country || "Global"} · {p.anonymity} {p.org ? `· ${p.org}` : ""}
                    </div>
                  </div>
                  <button
                    disabled={active || busyId !== null}
                    onClick={() => handleSelect(p.id)}
                    className={`ml-3 rounded-lg px-3 py-1 font-semibold transition ${
                      active
                        ? "bg-teal-700 text-white"
                        : "border border-stone-300 bg-white text-slate-700 hover:border-teal-600 hover:text-teal-700"
                    }`}
                  >
                    {active ? "Active ✓" : busyId === p.id ? "Loading…" : "Pick"}
                  </button>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
