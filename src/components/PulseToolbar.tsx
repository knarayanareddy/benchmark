"use client";

import { useState } from "react";
import Link from "next/link";
import { PersonaSelector, type PersonaCardInfo } from "./PersonaSelector";

export function PulseToolbar({
  me,
  personas,
}: {
  me: { id: number; realName: string; alias: string; anonymity: string };
  personas: PersonaCardInfo[];
}) {
  const [showPicker, setShowPicker] = useState(false);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-stone-200 bg-stone-50 px-3.5 py-2 text-xs">
        <div className="flex items-center gap-1.5">
          <span className="text-stone-500">Active persona:</span>
          <b className="text-slate-900">{me.realName}</b>
          <span className="text-stone-400">({me.alias})</span>
          <span className="rounded bg-teal-100 px-1.5 py-0.5 font-semibold text-teal-800">{me.anonymity}</span>
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
          <Link href="/me" className="text-stone-600 hover:text-slate-900">
            My space →
          </Link>
          <span>·</span>
          <Link href="/join?returnTo=/pulse" className="text-stone-600 hover:text-slate-900">
            + Create profile
          </Link>
        </div>
      </div>

      {showPicker && (
        <div className="pt-1">
          <PersonaSelector
            currentId={me.id}
            personas={personas}
            title="Switch Persona for Pulse"
            sub="Pick another persona or switch to your created profile to see their personalized feed."
            returnTo="/pulse"
            compact
          />
        </div>
      )}
    </div>
  );
}
