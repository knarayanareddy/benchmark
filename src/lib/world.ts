import { cache } from "react";
import { db } from "@/db";
import * as s from "@/db/schema";
import { ensureSeeded } from "./seed";
import type { ExpertRow } from "./identity";

export type Risk = typeof s.risks.$inferSelect;
export type Trigger = typeof s.triggers.$inferSelect;
export type Expert = typeof s.experts.$inferSelect;
export type Question = typeof s.questions.$inferSelect;
export type Forecast = typeof s.forecasts.$inferSelect;
export type Post = typeof s.posts.$inferSelect;
export type Reaction = typeof s.reactions.$inferSelect;
export type Notification = typeof s.notifications.$inferSelect;
export type Dissent = typeof s.dissents.$inferSelect;

export type World = {
  risks: Risk[];
  riskById: Map<string, Risk>;
  triggers: Trigger[];
  experts: Expert[];
  expertById: Map<number, Expert>;
  questions: Question[];
  questionById: Map<number, Question>;
  forecasts: Forecast[];
  posts: Post[];
  reactions: Reaction[];
  notifications: Notification[];
  dissents: Dissent[];
  vouches: { voucherId: number; voucheeId: number }[];
  regionByCountry: Map<string, string>;
};

export const getWorld = cache(async (): Promise<World> => {
  await ensureSeeded();
  return loadWorld();
});

export async function loadWorld(): Promise<World> {
  const [risks, triggers, experts, questions, forecasts, posts, reactions, notifications, dissents, vouches] =
    await Promise.all([
      db.select().from(s.risks),
      db.select().from(s.triggers),
      db.select().from(s.experts),
      db.select().from(s.questions),
      db.select().from(s.forecasts),
      db.select().from(s.posts),
      db.select().from(s.reactions),
      db.select().from(s.notifications),
      db.select().from(s.dissents),
      db.select().from(s.vouches),
    ]);
  const regionByCountry = new Map<string, string>();
  for (const r of risks) for (const c of r.countries) if (!regionByCountry.has(c)) regionByCountry.set(c, r.region);
  return {
    risks,
    riskById: new Map(risks.map((r) => [r.id, r])),
    triggers,
    experts,
    expertById: new Map(experts.map((e) => [e.id, e])),
    questions,
    questionById: new Map(questions.map((q) => [q.id, q])),
    forecasts,
    posts,
    reactions,
    notifications,
    dissents,
    vouches,
    regionByCountry,
  };
}

export function expertRegion(w: World, e: Expert): string {
  for (const c of e.countries) {
    const r = w.regionByCountry.get(c);
    if (r) return r;
  }
  return "";
}

export function toRow(w: World, e: Expert): ExpertRow {
  return {
    id: e.id,
    alias: e.alias,
    realName: e.realName,
    org: e.org,
    anonymity: e.anonymity,
    retroactive: e.retroactive,
    verification: e.verification,
    region: expertRegion(w, e),
    isModerator: e.isModerator,
  };
}
