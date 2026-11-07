import { LEVEL_PRIOR, LOADED_LEXICON } from "./constants";
import type { Expert, Forecast, Question, Risk, World } from "./world";

export const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));

/** ACAPS' own rating, expressed as a probability using the empirical materialisation rate per rating. */
export function acapsProb(risk: Risk | undefined): number | null {
  if (!risk) return null;
  if (LEVEL_PRIOR[risk.probability] !== undefined) return LEVEL_PRIOR[risk.probability];
  if (risk.level === "High") return LEVEL_PRIOR.High;
  if (risk.level === "Medium") return LEVEL_PRIOR.Medium;
  if (risk.level === "Low") return LEVEL_PRIOR.Low;
  return null;
}

/** Only risk-level questions carry a directly comparable ACAPS rating. */
export function questionAcaps(q: Question, risk: Risk | undefined): number | null {
  if (q.triggerId) return null;
  return acapsProb(risk);
}

export type Stats = {
  expertId: number;
  allN: number; // all forecasts
  n: number; // resolved & scored
  brier: number | null;
  skill: number | null; // 1 - brier/0.25 (0.25 = always-50% floor)
  bias: number | null; // mean(p - outcome); + => over-forecasts
  revisionGain: number | null; // mean brier improvement from 'second look' revisions (resolved only)
  flatRate: number; // share of forecasts within 45-55
  rubberRate: number; // share within 5pts of ACAPS
  avgSecs: number;
  avgReason: number;
  loadedRate: number;
  coiCount: number;
  speederRate: number;
  weight: number;
  superEstimator: boolean;
  byTheme: Record<string, { n: number; brier: number }>;
};

const brier1 = (p: number, o: number) => (p / 100 - o) ** 2;

export function buildStats(w: World): Map<number, Stats> {
  const byExpert = new Map<number, Forecast[]>();
  for (const f of w.forecasts) {
    const a = byExpert.get(f.expertId) ?? [];
    a.push(f);
    byExpert.set(f.expertId, a);
  }
  const out = new Map<number, Stats>();
  for (const e of w.experts) {
    const fs = byExpert.get(e.id) ?? [];
    let n = 0,
      bsum = 0,
      bias = 0,
      rg = 0,
      rgN = 0,
      flat = 0,
      rubber = 0,
      rubberDen = 0,
      secs = 0,
      reason = 0,
      loaded = 0,
      reasonN = 0,
      coi = 0,
      speed = 0;
    const byTheme: Record<string, { n: number; brier: number }> = {};
    for (const f of fs) {
      const q = w.questionById.get(f.questionId);
      if (!q) continue;
      const risk = w.riskById.get(q.riskId);
      const ac = questionAcaps(q, risk);
      if (f.probability >= 45 && f.probability <= 55) flat++;
      if (ac !== null) {
        rubberDen++;
        if (Math.abs(f.probability / 100 - ac) <= 0.06) rubber++;
      }
      secs += f.secondsSpent;
      if (f.secondsSpent < 9) speed++;
      if (f.reason) {
        reasonN++;
        reason += f.reason.length;
        const low = f.reason.toLowerCase();
        if (LOADED_LEXICON.some((t) => low.includes(t))) loaded++;
      }
      if (f.coiFlag) coi++;
      if (q.status === "resolved" && (q.outcome === "yes" || q.outcome === "no")) {
        const o = q.outcome === "yes" ? 1 : 0;
        const b = brier1(f.probability, o);
        n++;
        bsum += b;
        bias += f.probability / 100 - o;
        const t = risk?.theme ?? "x";
        byTheme[t] = byTheme[t] ?? { n: 0, brier: 0 };
        byTheme[t].n++;
        byTheme[t].brier += b;
        if (f.revised !== null && f.revised !== undefined) {
          rg += b - brier1(f.revised, o);
          rgN++;
        }
      }
    }
    for (const t of Object.keys(byTheme)) byTheme[t].brier = byTheme[t].brier / byTheme[t].n;
    const brier = n ? bsum / n : null;
    const skill = brier === null ? null : 1 - brier / 0.25;
    const weight =
      skill === null
        ? 0.5
        : 0.5 + 2.5 * (clamp(skill, 0, 0.5) / 0.5) * (n / (n + 5));
    out.set(e.id, {
      expertId: e.id,
      allN: fs.length,
      n,
      brier,
      skill,
      bias: n ? bias / n : null,
      revisionGain: rgN ? rg / rgN : null,
      flatRate: fs.length ? flat / fs.length : 0,
      rubberRate: rubberDen ? rubber / rubberDen : 0,
      avgSecs: fs.length ? secs / fs.length : 0,
      avgReason: reasonN ? reason / reasonN : 0,
      loadedRate: reasonN ? loaded / reasonN : 0,
      coiCount: coi,
      speederRate: fs.length ? speed / fs.length : 0,
      weight,
      superEstimator: n >= 10 && skill !== null && skill >= 0.35,
      byTheme,
    });
  }
  return out;
}

export type Agg = {
  n: number;
  mean: number;
  median: number;
  p10: number;
  p90: number;
  rawMean: number;
  spread: number;
  label: "Strong agreement" | "Mixed views" | "Split circle";
};

function wPercentile(vals: { v: number; w: number }[], q: number): number {
  const s = [...vals].sort((a, b) => a.v - b.v);
  const tot = s.reduce((a, b) => a + b.w, 0);
  let c = 0;
  for (const x of s) {
    c += x.w;
    if (c / tot >= q) return x.v;
  }
  return s[s.length - 1].v;
}

/** Performance-weighted pool with an interval. Never returns a naked point estimate. */
export function aggregate(w: World, stats: Map<number, Stats>, questionId: number): Agg | null {
  const fs = w.forecasts.filter((f) => f.questionId === questionId);
  if (!fs.length) return null;
  const vals = fs.map((f) => ({ v: f.revised ?? f.probability, w: stats.get(f.expertId)?.weight ?? 0.5 }));
  const tw = vals.reduce((a, b) => a + b.w, 0);
  const mean = vals.reduce((a, b) => a + b.v * b.w, 0) / tw;
  const rawMean = vals.reduce((a, b) => a + b.v, 0) / vals.length;
  const p10 = wPercentile(vals, 0.1);
  const p90 = wPercentile(vals, 0.9);
  const spread = p90 - p10;
  return {
    n: fs.length,
    mean: Math.round(mean),
    median: wPercentile(vals, 0.5),
    p10,
    p90,
    rawMean: Math.round(rawMean),
    spread,
    label: spread < 20 ? "Strong agreement" : spread < 40 ? "Mixed views" : "Split circle",
  };
}

export const MIN_PANEL = 3; // small-cell suppression for circle members + analysts
export const PUBLIC_MIN = 10; // public roll-ups

export type ExpertiseBreakdown = {
  credentials: number;
  vouches: number;
  trackRecord: number;
  usefulness: number;
  total: number;
  tier: "Invited" | "Verified" | "Established" | "Proven";
};

/** Expertise is EARNED from evidence, never self-declared. Declaration decides who is asked, not how much weight. */
export function expertiseOf(w: World, stats: Map<number, Stats>, e: Expert): ExpertiseBreakdown {
  const st = stats.get(e.id)!;
  const credentials = (e.verification === "verified" ? 22 : 0) + Math.min(e.claims.length, 3) * 1;
  const v = w.vouches.filter((x) => x.voucheeId === e.id).length;
  const vouches = Math.min(v * 6, 15);
  const trackRecord =
    st.skill !== null ? Math.round(clamp(st.skill, 0, 0.6) / 0.6 * 40 * (st.n / (st.n + 5))) : 0;
  const myPosts = new Set(w.posts.filter((p) => p.expertId === e.id).map((p) => p.id));
  const useful = w.reactions.filter(
    (r) => myPosts.has(r.postId) && (r.type === "new_info" || r.type === "changed_mind")
  ).length;
  const usefulness = Math.min(useful * 4, 20);
  const total = credentials + vouches + trackRecord + usefulness;
  const tier =
    total >= 70 && st.n >= 10 ? "Proven" : total >= 45 ? "Established" : e.verification === "verified" ? "Verified" : "Invited";
  return { credentials, vouches, trackRecord, usefulness, total, tier };
}

export type Badge = { code: string; name: string; why: string; private?: boolean };

/** Craft badges (quality, not volume). Computed — no streak to lose. */
export function badgesOf(w: World, stats: Map<number, Stats>, e: Expert): Badge[] {
  const st = stats.get(e.id)!;
  const out: Badge[] = [];
  if (st.allN >= 1) out.push({ code: "first", name: "First signal", why: "Contributed your first estimate." });
  if (st.n >= 8 && st.brier !== null && st.brier < 0.18)
    out.push({ code: "calibrated", name: "Well calibrated", why: `Brier ${st.brier.toFixed(2)} over ${st.n} resolved questions.`, private: true });
  if (st.superEstimator) out.push({ code: "super", name: "Super estimator", why: "Top-tier accuracy across 10+ resolved questions." });
  // vindicated dissent
  let vind = 0;
  for (const f of w.forecasts.filter((x) => x.expertId === e.id)) {
    const q = w.questionById.get(f.questionId);
    if (!q || q.status !== "resolved" || !q.outcome || q.outcome === "unobservable") continue;
    const ac = questionAcaps(q, w.riskById.get(q.riskId));
    if (ac === null) continue;
    const o = q.outcome === "yes" ? 1 : 0;
    if (Math.abs(f.probability / 100 - ac) >= 0.25 && Math.abs(f.probability / 100 - o) < Math.abs(ac - o)) vind++;
  }
  if (vind >= 2) out.push({ code: "vindicated", name: "Dissent vindicated", why: `${vind} times you disagreed with ACAPS and the outcome proved you closer.`, private: true });
  const mm = w.reactions.filter((r) => r.type === "changed_mind" && w.posts.find((p) => p.id === r.postId)?.expertId === e.id).length;
  if (mm >= 2) out.push({ code: "mind", name: "Mind-changer", why: `${mm} peers said your argument changed their mind.` });
  const sc = w.posts.filter((p) => p.expertId === e.id && p.sourceUrl).length;
  if (sc >= 2) out.push({ code: "scout", name: "Source scout", why: `${sc} contributions with a verifiable source.` });
  if (st.revisionGain !== null && st.revisionGain > 0.01) out.push({ code: "open", name: "Open mind", why: "Your revised estimates beat your first instinct.", private: true });
  return out;
}
