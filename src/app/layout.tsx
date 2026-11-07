import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import "./globals.css";
import { currentExpert, langPref } from "@/lib/session";
import { t } from "@/lib/i18n";
import { PersonaSwitcher, LangToggle } from "@/components/PersonaSwitcher";
import { ANON_LEVELS } from "@/lib/constants";

export const metadata: Metadata = {
  title: "Ground Truth Circle — a trusted expert network for ACAPS risk analysis",
  description:
    "Experts challenge, enrich and forecast ACAPS risk analyses in 90 seconds, choosing exactly how identifiable they are.",
};
export const dynamic = "force-dynamic";

export default async function RootLayout({ children }: { children: ReactNode }) {
  const { me, w } = await currentExpert();
  const lang = await langPref();
  const anonName = (id: string) => ANON_LEVELS.find((l) => l.id === id)?.name ?? id;
  const isCustomExpert = (e: (typeof w.experts)[number]) => e.archetype === "real" || e.id > 29;

  // Prioritize custom experts, then moderator, then seed experts
  const sortedExperts = [...w.experts].sort((a, b) => {
    const aCustom = isCustomExpert(a);
    const bCustom = isCustomExpert(b);
    if (aCustom && !bCustom) return -1;
    if (!aCustom && bCustom) return 1;
    if (a.isModerator && !b.isModerator) return -1;
    if (!a.isModerator && b.isModerator) return 1;
    return a.id - b.id;
  });

  const options = sortedExperts.map((e) => {
    const custom = isCustomExpert(e);
    let group: string;
    if (custom) {
      group = "🌟 My Created Personas";
    } else if (e.isModerator) {
      group = "ACAPS";
    } else {
      group = `${anonName(e.anonymity)} experts`;
    }

    const countryStr = e.countries[0] ? ` · ${e.countries[0]}` : "";
    const label = e.isModerator
      ? "ACAPS moderator"
      : custom
      ? `★ ${e.realName} (${e.alias})${countryStr}`
      : `${e.realName} (${e.alias})${countryStr}`;

    return {
      id: e.id,
      group,
      label,
    };
  });

  const unread = me ? w.notifications.filter((n) => n.expertId === me.id && !n.suppressed && !n.readAt).length : 0;
  const links: [string, string][] = [
    ["/pulse", t(lang, "pulse")],
    ["/risks", t(lang, "risks")],
    ["/honour", t(lang, "stage")],
    ["/me", t(lang, "me")],
  ];
  if (me?.isModerator) links.push(["/moderator", t(lang, "moderator")]);
  links.push(["/review", t(lang, "review")]);
  return (
    <html lang={lang}>
      <body className="min-h-screen bg-[#f6f3ee] text-slate-900 antialiased">
        <header className="sticky top-0 z-30 border-b border-stone-200 bg-[#f6f3ee]/95 backdrop-blur">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
            <Link href="/" className="flex items-center gap-2 font-serif text-lg font-semibold text-slate-900">
              <span className="grid h-7 w-7 place-items-center rounded-full bg-teal-700 text-sm text-white">◉</span>
              Ground Truth Circle
            </Link>
            <nav className="flex flex-1 flex-wrap items-center gap-1 text-sm">
              {links.map(([href, label]) => (
                <Link key={href} href={href} className="rounded-lg px-2.5 py-1.5 text-slate-700 hover:bg-stone-200">
                  {label}
                  {href === "/pulse" && unread > 0 && (
                    <span className="ml-1 rounded-full bg-amber-500 px-1.5 text-[10px] font-bold text-white">{unread}</span>
                  )}
                </Link>
              ))}
            </nav>
            <div className="flex items-center gap-2">
              {me && !me.isModerator && (
                <span className="hidden text-xs text-stone-500 sm:inline">
                  signed in as <b className="text-slate-700">{me.alias}</b>
                </span>
              )}
              <PersonaSwitcher current={me?.id ?? null} options={options} />
              <LangToggle lang={lang} />
            </div>
          </div>
          <div className="bg-slate-900 px-4 py-1 text-center text-[11px] text-slate-300">
            Prototype · real ACAPS Risk Radar export (139 risks) · all experts, forecasts and discussion are <b>synthetic</b> · no personal data
          </div>
        </header>
        <main className="mx-auto max-w-6xl px-4 py-8">{children}</main>
        <footer className="mx-auto max-w-6xl px-4 pb-10 text-xs text-stone-500">
          Built for Hackathon for Good #8 · ACAPS Ground Truth challenge. Individual contributions are never public — only aggregates with n ≥ 10.
        </footer>
      </body>
    </html>
  );
}
