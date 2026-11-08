"use client";

import { useState } from "react";
import Link from "next/link";
import { PersonaSelector, type PersonaCardInfo } from "./PersonaSelector";

export function RoundtableHeader({
  riskId,
  me,
  canRead,
  personas,
  riskQId,
}: {
  riskId: string;
  me: { id: number; name: string; alias: string; anonymity: string; isModerator: boolean } | null;
  canRead: boolean;
  personas: PersonaCardInfo[];
  riskQId?: number;
}) {
  const [showPicker, setShowPicker] = useState(false);

  const unlocked = personas.filter((p) => p.hasAnswered);

  async function handleSwitch(id: number) {
    try {
      const res = await fetch("/api/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expertId: id }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        alert(data.error || "Failed to switch persona.");
        return;
      }
      window.location.reload();
    } catch (err) {
      console.error("Failed to switch persona", err);
      alert("Network error switching persona.");
    }
  }

  return (
    <div className="space-y-3 mb-4">
      {me && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-stone-200 bg-stone-50 px-3.5 py-2 text-xs">
          <div className="flex items-center gap-1.5">
            <span className="text-stone-500">Participating as:</span>
            <b className="text-slate-900">{me.name}</b>
            <span className="text-stone-400">({me.alias})</span>
            <span className="rounded bg-teal-100 px-1.5 py-0.2 font-semibold text-teal-800">
              {me.isModerator ? "Moderator" : me.anonymity}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setShowPicker(!showPicker)}
              className="font-semibold text-teal-700 hover:underline"
            >
              {showPicker ? "Close switcher" : "Switch persona"}
            </button>
            <span>·</span>
            <Link
              href={`/join?returnTo=${encodeURIComponent(`/risks/${riskId}`)}`}
              className="text-stone-600 hover:text-slate-900"
            >
              + Create profile
            </Link>
          </div>
        </div>
      )}

      {/* If current persona is locked */}
      {me && !canRead && (
        <div className="rounded-2xl border-2 border-dashed border-amber-300 bg-amber-50/70 p-4 space-y-3">
          <div className="flex items-start gap-2">
            <span className="text-lg">🔒</span>
            <div>
              <div className="font-semibold text-slate-900">Locked until you give your own estimate</div>
              <p className="mt-0.5 text-xs text-slate-600">
                Independence first: reading others&apos; arguments before committing anchors everyone. It takes about 90 seconds.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 pt-1">
            {riskQId && (
              <Link
                href={`/q/${riskQId}`}
                className="rounded-xl bg-teal-700 px-4 py-2 text-xs font-semibold text-white shadow-sm hover:bg-teal-800"
              >
                Give my estimate (90s) →
              </Link>
            )}

            {unlocked.length > 0 && (
              <button
                type="button"
                onClick={() => handleSwitch(unlocked[0].id)}
                className="rounded-xl border border-emerald-600 bg-emerald-50 px-3.5 py-2 text-xs font-semibold text-emerald-800 hover:bg-emerald-100"
              >
                Switch to {unlocked[0].name} (Already Unlocked ✓)
              </button>
            )}

            <button
              type="button"
              onClick={() => setShowPicker(!showPicker)}
              className="rounded-xl border border-stone-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-stone-50"
            >
              Pick another persona…
            </button>
          </div>
        </div>
      )}

      {/* Inline Persona Selector when toggled */}
      {showPicker && (
        <div className="pt-1">
          <PersonaSelector
            currentId={me?.id ?? null}
            personas={personas}
            title="Switch Persona for Roundtable"
            sub="Pick an expert who has already unlocked this debate, or test how the discussion appears to different anonymity tiers."
            returnTo={`/risks/${riskId}`}
            riskId={riskId}
            compact
          />
        </div>
      )}
    </div>
  );
}
