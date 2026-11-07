import type { Expert, Question, Risk, World } from "./world";
import { expertRegion } from "./world";

export type DispatchRow = {
  expertId: number;
  score: number;
  parts: { label: string; pts: number }[];
  decision: "notify" | "suppress" | "answered";
  reason: string;
};

const WEEK = 7 * 24 * 3600 * 1000;

/** Topic-relevance score 0-100 between an expert's declared domain and a risk. */
export function matchScore(w: World, e: Expert, risk: Risk, responses: number) {
  const parts: { label: string; pts: number }[] = [];
  const exactCountry = risk.countries.some((c) => e.countries.includes(c));
  const sameRegion = !exactCountry && expertRegion(w, e) === risk.region;
  if (exactCountry) parts.push({ label: `Covers ${risk.country}`, pts: 60 });
  else if (sameRegion) parts.push({ label: `Same region (${risk.region})`, pts: 22 });
  if (e.themes.includes(risk.theme)) parts.push({ label: "Theme match", pts: 25 });
  if (responses < 5 && (exactCountry || sameRegion)) parts.push({ label: "Circle needs more views", pts: 10 });
  const score = Math.min(100, parts.reduce((a, b) => a + b.pts, 0));
  return { score, parts };
}

export function planDispatch(w: World, risk: Risk, q: { id?: number }, now = Date.now()): DispatchRow[] {
  const responded = new Set(w.forecasts.filter((f) => f.questionId === q.id).map((f) => f.expertId));
  const rows: DispatchRow[] = [];
  for (const e of w.experts) {
    if (e.isModerator) continue;
    const { score, parts } = matchScore(w, e, risk, responded.size);
    if (responded.has(e.id)) {
      rows.push({ expertId: e.id, score, parts, decision: "answered", reason: "Already answered" });
      continue;
    }
    if (score < e.minMatch) {
      rows.push({ expertId: e.id, score, parts, decision: "suppress", reason: `Outside declared expertise (match ${score} < your threshold ${e.minMatch})` });
      continue;
    }
    const sent = w.notifications.filter(
      (n) => n.expertId === e.id && n.kind === "question" && !n.suppressed && now - n.createdAt.getTime() < WEEK
    ).length;
    if (sent >= e.weeklyCap) {
      rows.push({ expertId: e.id, score, parts, decision: "suppress", reason: `Weekly cap reached (${sent}/${e.weeklyCap}) — available on your radar, not pushed` });
      continue;
    }
    rows.push({ expertId: e.id, score, parts, decision: "notify", reason: parts.map((p) => p.label).join(" · ") });
  }
  return rows.sort((a, b) => b.score - a.score);
}
