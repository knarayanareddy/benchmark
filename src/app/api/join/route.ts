import { cookies } from "next/headers";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { COOKIE } from "@/lib/session";
import { getWorld, loadWorld } from "@/lib/world";
import { makeAlias } from "@/lib/identity";
import { matchScore } from "@/lib/dispatch";
import { bad, ok } from "@/lib/api";
import { THEMES, ROLE_TYPES } from "@/lib/constants";

export async function GET(req: Request) {
  let code = new URL(req.url).searchParams.get("code")?.trim().toUpperCase() ?? "";
  if (code === "DEMO" || !code) code = "CHAD-7QX2";
  const [inv] = await db.select().from(s.invites).where(eq(s.invites.code, code));
  if (!inv) return bad("That code isn't recognised. Ground Truth is invite-only.", 404);
  const single = inv.issuedBy.startsWith("expert:");
  if (single && inv.usedBy) return bad("This peer invitation has already been used.");
  return ok({ code, label: inv.label, hint: inv.countryHint, peer: single });
}

export async function POST(req: Request) {
  const b = await req.json();
  let code = String(b.code ?? "").trim().toUpperCase();
  if (code === "DEMO" || !code) code = "CHAD-7QX2";
  const [inv] = await db.select().from(s.invites).where(eq(s.invites.code, code));
  if (!inv) return bad("That invitation code isn't recognised. Ground Truth is invite-only to keep the circle trusted.");
  const single = inv.issuedBy.startsWith("expert:");
  if (single && inv.usedBy) return bad("This peer invitation has already been used.");
  const name = String(b.name ?? "").trim();
  if (!name) return bad("Please give a name — it is stored encrypted-at-rest and shown only per your anonymity choice.");
  const w = await getWorld();
  const countries: string[] = (Array.isArray(b.countries) ? b.countries : []).filter((c: unknown) => typeof c === "string").slice(0, 6);
  const themes: string[] = (Array.isArray(b.themes) ? b.themes : []).filter((t: unknown) => typeof t === "string" && t in THEMES);
  if (!countries.length) return bad("Pick at least one country you know deeply.");
  const anon = ["sealed", "alias", "confidential", "named"].includes(b.anonymity) ? b.anonymity : "alias";
  const roleType = b.roleType in ROLE_TYPES ? b.roleType : "other";
  const used = new Set(w.experts.map((e) => e.alias));
  let n = w.experts.length * 5 + 11;
  while (used.has(makeAlias(n))) n++;
  const voucher = single ? Number(inv.issuedBy.split(":")[1]) : null;
  const [row] = await db
    .insert(s.experts)
    .values({
      alias: makeAlias(n),
      realName: name.slice(0, 80),
      org: String(b.org ?? "").slice(0, 100),
      roleType,
      anonymity: anon,
      stageOptIn: !!b.stageOptIn && anon === "named",
      countries,
      themes: themes.length ? themes : ["conflict"],
      languages: Array.isArray(b.languages) && b.languages.length ? b.languages : ["en"],
      claims: (Array.isArray(b.claims) ? b.claims : []).slice(0, 6).map((c: unknown) => String(c).slice(0, 120)),
      verification: "invited",
      vouchedBy: voucher,
      invitedVia: voucher ? "peer vouch" : "moderator circle code",
      weeklyCap: Math.min(3, Math.max(1, Number(b.weeklyCap) || 2)),
    })
    .returning({ id: s.experts.id, alias: s.experts.alias });
  if (single) {
    await db.update(s.invites).set({ usedBy: row.id }).where(eq(s.invites.code, code));
    if (voucher) await db.insert(s.vouches).values({ voucherId: voucher, voucheeId: row.id }).onConflictDoNothing();
  }
  // first asks: best-matching open questions, within the weekly cap
  const w3 = await loadWorld();
  const me = w3.expertById.get(row.id)!;
  const cands = w3.questions
    .filter((q) => q.status === "open" && !q.triggerId)
    .map((q) => ({ q, m: matchScore(w3, me, w3.riskById.get(q.riskId)!, 0) }))
    .filter((x) => x.m.score >= me.minMatch)
    .sort((a, c) => c.m.score - a.m.score)
    .slice(0, me.weeklyCap);
  for (const c of cands) {
    const risk = w3.riskById.get(c.q.riskId)!;
    await db.insert(s.notifications).values({
      expertId: row.id,
      kind: "question",
      questionId: c.q.id,
      riskId: risk.id,
      title: `${risk.country}: ${risk.title.slice(0, 110)}`,
      reason: c.m.parts.map((p) => p.label).join(" · "),
      score: c.m.score,
    });
  }
  const jar = await cookies();
  jar.set(COOKIE, String(row.id), { path: "/", httpOnly: true, sameSite: "lax", maxAge: 60 * 60 * 24 * 30 });
  return ok({ id: row.id, alias: row.alias, name, asks: cands.length });
}
