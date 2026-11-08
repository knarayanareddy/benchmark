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
export type Release = typeof s.releases.$inferSelect;
export type CardLink = typeof s.cardLinks.$inferSelect;

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
  releases: Release[];
  cardLinks: CardLink[];
  vouches: { voucherId: number; voucheeId: number }[];
  regionByCountry: Map<string, string>;
};

export const getWorld = cache(async (): Promise<World> => {
  await ensureSeeded();
  return loadWorld();
});

export function cardIdOf(qId: number | string): string {
  const s = String(qId).trim();
  return s.startsWith("Q") ? s : `Q${s}`;
}

export function questionIdFromCardId(cardId: string): number | null {
  const m = /^Q?(\d+)$/i.exec(cardId.trim());
  return m ? Number(m[1]) : null;
}

export async function loadWorld(): Promise<World> {
  const [
    risks,
    triggers,
    experts,
    questions,
    forecasts,
    posts,
    reactions,
    notifications,
    dissents,
    releases,
    cardLinks,
    vouches,
  ] = await Promise.all([
    db.select().from(s.risks),
    db.select().from(s.triggers),
    db.select().from(s.experts),
    db.select().from(s.questions),
    db.select().from(s.forecasts),
    db.select().from(s.posts),
    db.select().from(s.reactions),
    db.select().from(s.notifications),
    db.select().from(s.dissents),
    db.select().from(s.releases),
    db.select().from(s.cardLinks),
    db.select().from(s.vouches),
  ]);
  const regionByCountry = new Map<string, string>();
  for (const r of risks) {
    for (const c of r.countries) {
      if (!regionByCountry.has(c)) regionByCountry.set(c, r.region);
    }
  }
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
    releases,
    cardLinks,
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

/**
 * Does a risk/question match an expert's declared domain (country, region, or theme)?
 * Per the radar rule (docs/10 section 3 & docs/12 Principle 1):
 * An expert is held back on a risk's analysis & timeline ONLY while a live question on the risk
 * that is put to them (matches their declaration) is unanswered by them.
 * An expert never asked a question on the risk sees the full analysis and timeline.
 */
export function matchesDeclaration(w: World, e: Expert, risk: Risk): boolean {
  if (e.isModerator) return false;
  const countryMatch = risk.countries.some((c) => e.countries.includes(c));
  const themeMatch = e.themes.includes(risk.theme);
  const expReg = expertRegion(w, e);
  const regionMatch = Boolean(expReg && risk.region === expReg);
  return (countryMatch || regionMatch) && (themeMatch || countryMatch);
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
    // Small-cell guard: a region label is only attached to a contribution if enough OTHER experts share it,
    // otherwise "Anonymous expert · Eastern Africa" could single out one person.
    region: regionSafe(w, e),
    isModerator: e.isModerator,
  };
}

/** Number of non-moderator experts whose primary region matches this expert's. */
export function regionPeers(w: World, e: Expert): number {
  const r = expertRegion(w, e);
  if (!r) return 0;
  return w.experts.filter((x) => !x.isModerator && expertRegion(w, x) === r).length;
}

export const MIN_REGION_K = 5;
export function regionSafe(w: World, e: Expert): string {
  return regionPeers(w, e) >= MIN_REGION_K ? expertRegion(w, e) : "";
}
