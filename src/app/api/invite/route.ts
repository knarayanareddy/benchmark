import { db } from "@/db";
import * as s from "@/db/schema";
import { bad, ok, requireExpert } from "@/lib/api";

export async function POST() {
  const r = await requireExpert();
  if ("error" in r) return r.error;
  const { me, w } = r;
  if (me.verification !== "verified") return bad("Only verified members can vouch for a peer.", 403);
  const mine = w.experts.filter((e) => e.vouchedBy === me.id).length;
  if (mine >= 3) return bad("You've used your 3 vouches for this season — vouching is a scarce, accountable act.");
  const code = `PEER-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
  await db.insert(s.invites).values({ code, label: "Peer invitation (vouched)", countryHint: me.countries[0] ?? "", issuedBy: `expert:${me.id}` });
  return ok({ code });
}
