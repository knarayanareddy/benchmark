import { eq } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { bad, ok, requireExpert } from "@/lib/api";
import { SENSITIVE_COUNTRIES, THEMES, ROLE_TYPES } from "@/lib/constants";

export async function POST(req: Request) {
  const r = await requireExpert();
  if ("error" in r) return r.error;
  const { me } = r;
  const b = await req.json();
  const anon = ["sealed", "alias", "confidential", "named"].includes(b.anonymity) ? b.anonymity : me.anonymity;
  const countries: string[] = Array.isArray(b.countries) && b.countries.length ? b.countries.slice(0, 6) : me.countries;
  const risky = countries.some((c) => SENSITIVE_COUNTRIES.includes(c));
  if ((anon === "named" || anon === "confidential") && risky && !b.confirmSafety)
    return bad("SAFETY_CONFIRM");
  const themes: string[] = (Array.isArray(b.themes) ? b.themes : me.themes).filter((t: string) => t in THEMES);
  const realName = typeof b.realName === "string" && b.realName.trim()
    ? b.realName.trim().slice(0, 80)
    : typeof b.name === "string" && b.name.trim()
    ? b.name.trim().slice(0, 80)
    : me.realName;
  const org = typeof b.org === "string" ? b.org.trim().slice(0, 100) : me.org;
  const roleType = typeof b.roleType === "string" && b.roleType in ROLE_TYPES ? b.roleType : me.roleType;

  await db
    .update(s.experts)
    .set({
      realName,
      org,
      roleType,
      anonymity: anon,
      stageOptIn: anon === "named" ? !!b.stageOptIn : false,
      retroactive: b.retroactive === undefined ? me.retroactive : !!b.retroactive,
      weeklyCap: Math.min(3, Math.max(1, Number(b.weeklyCap) || me.weeklyCap)),
      minMatch: Math.min(90, Math.max(30, Number(b.minMatch) || me.minMatch)),
      countries,
      themes: themes.length ? themes : me.themes,
    })
    .where(eq(s.experts.id, me.id));

  return ok({ id: me.id, realName, org, anonymity: anon });
}

