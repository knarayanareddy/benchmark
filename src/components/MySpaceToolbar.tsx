"use client";

import { useState } from "react";
import Link from "next/link";
import { PersonaSelector, type PersonaCardInfo } from "./PersonaSelector";

export function MySpaceToolbar({
  me,
  personas,
}: {
  me: { id: number; realName: string; alias: string; org: string; roleType: string; countries: string[]; anonymity: string };
  personas: PersonaCardInfo[];
}) {
  const [showPicker, setShowPicker] = useState(false);

  async function signOut() {
    await fetch("/api/session", { method: "DELETE" });
    window.location.reload();
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-stone-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center gap-2">
          <span className="grid h-8 w-8 place-items-center rounded-full bg-teal-100 font-serif font-bold text-teal-800">
            {me.realName.charAt(0)}
          </span>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-semibold text-slate-900">{me.realName}</span>
              <span className="rounded bg-stone-100 px-2 py-0.5 text-xs text-stone-600">
                Alias: <b className="text-teal-800">{me.alias}</b>
              </span>
              <span className="rounded-full bg-teal-50 px-2.5 py-0.5 text-xs font-semibold text-teal-800">
                {me.anonymity}
              </span>
            </div>
            <div className="text-xs text-stone-500">
              {me.roleType} {me.org ? `· ${me.org}` : ""} · {me.countries.join(", ") || "Global"}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setShowPicker(!showPicker)}
            className="rounded-xl border border-stone-300 bg-stone-50 px-3.5 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-stone-100"
          >
            {showPicker ? "Close switcher" : "Switch persona"}
          </button>
          <Link
            href="/join?returnTo=/me"
            className="rounded-xl border border-teal-700 bg-teal-50 px-3.5 py-1.5 text-xs font-semibold text-teal-800 transition hover:bg-teal-100"
          >
            + New profile
          </Link>
          <button
            type="button"
            onClick={signOut}
            className="rounded-xl border border-stone-200 px-3 py-1.5 text-xs font-medium text-stone-500 transition hover:bg-rose-50 hover:text-rose-700"
          >
            Sign out
          </button>
        </div>
      </div>

      {showPicker && (
        <div className="pt-1">
          <PersonaSelector
            currentId={me.id}
            personas={personas}
            title="Switch Active Persona"
            sub="Pick another synthetic persona or choose one of your custom profiles."
            returnTo="/me"
            compact
          />
        </div>
      )}
    </div>
  );
}
