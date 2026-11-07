import { NextResponse } from "next/server";
import { currentExpert } from "./session";

export const bad = (message: string, status = 400) => NextResponse.json({ ok: false, error: message }, { status });
export const ok = (data: Record<string, unknown> = {}) => NextResponse.json({ ok: true, ...data });

export async function requireExpert() {
  const { me, w } = await currentExpert();
  if (!me) return { error: bad("Choose a persona or join first", 401) } as const;
  return { me, w } as const;
}

export async function requireMod() {
  const r = await requireExpert();
  if ("error" in r) return r;
  if (!r.me.isModerator) return { error: bad("Moderators only", 403) } as const;
  return r;
}
