import { cookies } from "next/headers";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { getWorld, type Expert, type World } from "./world";

export const COOKIE = "gt_expert";

export async function currentExpert(): Promise<{ me: Expert | null; w: World }> {
  const w = await getWorld();
  const jar = await cookies();
  const id = Number(jar.get(COOKIE)?.value ?? 0);
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

