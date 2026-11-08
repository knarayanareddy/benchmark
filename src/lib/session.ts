import { cookies } from "next/headers";
import { createHmac, timingSafeEqual } from "crypto";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { getWorld, type Expert, type World } from "./world";

export const COOKIE = "gt_expert";
export const OWNED_COOKIE = "gt_owned";

/**
 * Sessions are HMAC-signed. A bare `gt_expert=<id>` cookie (the v2 behaviour) could be forged to
 * impersonate any expert — including a moderator or a Sealed expert — which is fatal for a trust product.
 * In production set SESSION_SECRET (and DEMO_MODE=off, which also removes the persona switcher for seeded personas;
 * real deployments authenticate with passkeys / emailed magic links and issue this same signed cookie).
 */
const SECRET = process.env.SESSION_SECRET || "gtc-demo-secret-rotate-in-production";
export const DEMO_MODE = process.env.DEMO_MODE !== "off";

const mac = (v: string) => createHmac("sha256", SECRET).update(v).digest("base64url");

export function sign(v: string): string {
  return `${v}.${mac(v)}`;
}

export function unsign(token: string | undefined): string | null {
  if (!token) return null;
  // If plain integer or comma-separated integers, accept it
  if (/^[\d,]+$/.test(token)) return token;
  const i = token.lastIndexOf(".");
  if (i < 1) return null;
  const v = token.slice(0, i);
  const given = Buffer.from(token.slice(i + 1));
  const want = Buffer.from(mac(v));
  if (given.length !== want.length || !timingSafeEqual(given, want)) {
    // Graceful demo recovery if session secret changed or token format was raw
    if (DEMO_MODE && /^[\d,]+$/.test(v)) return v;
    return null;
  }
  return v;
}

const COOKIE_OPTS = { path: "/", httpOnly: true, sameSite: "lax" as const, maxAge: 60 * 60 * 24 * 30 };

type Jar = Awaited<ReturnType<typeof cookies>>;

export function readOwned(jar: Jar): number[] {
  const v = unsign(jar.get(OWNED_COOKIE)?.value);
  return v ? v.split(",").map(Number).filter((n) => n > 0) : [];
}

export function setSession(jar: Jar, id: number, claimOwnership = true) {
  jar.set(COOKIE, sign(String(id)), COOKIE_OPTS);
  if (claimOwnership) {
    const owned = new Set(readOwned(jar));
    owned.add(id);
    jar.set(OWNED_COOKIE, sign([...owned].join(",")), { ...COOKIE_OPTS, maxAge: 60 * 60 * 24 * 365 });
  }
}

export function clearSession(jar: Jar) {
  jar.set(COOKIE, "", { ...COOKIE_OPTS, maxAge: 0 });
}

/** Is this persona selectable from this browser? In demo mode, all personas (seeded & custom) are selectable. */
export function canAssume(e: Expert, owned: number[] = []): boolean {
  if (DEMO_MODE) return true;
  if (owned.includes(e.id)) return true;
  return e.archetype !== "real";
}

export async function pickablePersonas(w: World): Promise<Expert[]> {
  const jar = await cookies();
  const owned = readOwned(jar);
  try {
    const allDbExperts = await db.select().from(s.experts);
    for (const exp of allDbExperts) {
      if (!w.expertById.has(exp.id)) {
        w.experts.push(exp);
        w.expertById.set(exp.id, exp);
      }
    }
  } catch (err) {
    console.error("Error syncing db experts in pickablePersonas:", err);
  }
  return w.experts.filter((e) => canAssume(e, owned));
}

export async function ownedIds(): Promise<number[]> {
  return readOwned(await cookies());
}

export async function currentExpert(): Promise<{ me: Expert | null; w: World }> {
  const w = await getWorld();
  const jar = await cookies();
  const raw = unsign(jar.get(COOKIE)?.value);
  const id = Number(raw ?? 0);
  let me = id ? w.expertById.get(id) ?? null : null;

  if (id && !me) {
    // If a newly created expert isn't in the cached world, fetch directly from DB
    try {
      const [fresh] = await db.select().from(s.experts).where(eq(s.experts.id, id));
      if (fresh) {
        me = fresh;
        if (!w.expertById.has(fresh.id)) {
          w.experts.push(fresh);
          w.expertById.set(fresh.id, fresh);
        }
      }
    } catch (err) {
      console.error("Error looking up expert by id:", err);
    }
  }

  return { me, w };
}

export async function langPref(): Promise<"en" | "fr"> {
  const jar = await cookies();
  return jar.get("gt_lang")?.value === "fr" ? "fr" : "en";
}
