import type { Stats } from "./scoring";

export type Signal = {
  code: string;
  label: string;
  severity: "info" | "watch" | "review";
  detail: string;
};

/**
 * Integrity signals. These NEVER auto-exclude anyone and never claim to read intent.
 * They surface patterns (low-information answers, directional bias, advocacy language,
 * declared conflicts of interest) so that weighting and moderators can handle them.
 */
export function signalsFor(st: Stats): { signals: Signal[]; quality: number } {
  const s: Signal[] = [];
  if (st.allN >= 6 && st.flatRate > 0.55)
    s.push({ code: "fence", label: "Fence-sitting", severity: "watch", detail: `${Math.round(st.flatRate * 100)}% of estimates sit at 45–55% — low information, weight stays near floor.` });
  if (st.allN >= 6 && st.rubberRate > 0.6)
    s.push({ code: "rubber", label: "Echoes ACAPS", severity: "watch", detail: `${Math.round(st.rubberRate * 100)}% of estimates are within 6 pts of ACAPS' rating — adds little independent signal.` });
  if (st.allN >= 6 && st.speederRate > 0.4)
    s.push({ code: "speed", label: "Speeding", severity: "watch", detail: `${Math.round(st.speederRate * 100)}% of answers took under 9 seconds.` });
  if (st.n >= 8 && st.bias !== null && Math.abs(st.bias) > 0.15)
    s.push({
      code: "bias",
      label: st.bias > 0 ? "Systematic over-forecasting" : "Systematic under-forecasting",
      severity: "review",
      detail: `Mean signed error ${st.bias > 0 ? "+" : ""}${(st.bias * 100).toFixed(0)} pts over ${st.n} resolved questions — a directional lean, consistent with a motivated reading of events. Could also be a genuine blind spot.`,
    });
  if (st.loadedRate >= 0.3)
    s.push({ code: "loaded", label: "Advocacy language", severity: "review", detail: `${Math.round(st.loadedRate * 100)}% of rationales use loaded or absolute language (e.g. “regime”, “everyone knows”, “100%”).` });
  if (st.coiCount > 0)
    s.push({ code: "coi", label: "Declared conflict of interest", severity: "info", detail: `${st.coiCount} answer${st.coiCount > 1 ? "s" : ""} flagged by the expert themselves as affecting their organisation. Healthy — and used to down-weight, not to punish.` });
  if (st.allN >= 6 && st.avgReason < 25 && st.avgReason > 0)
    s.push({ code: "thin", label: "Thin reasoning", severity: "info", detail: "Rationales are very short on average." });
  let quality = 78;
  for (const x of s) quality -= x.severity === "review" ? 22 : x.severity === "watch" ? 14 : 2;
  if (st.skill !== null) quality += Math.round(Math.max(-10, Math.min(20, st.skill * 30)));
  return { signals: s, quality: Math.max(5, Math.min(100, quality)) };
}

export type CoordPair = {
  a: number;
  b: number;
  shared: number;
  meanGap: number;
  medianMinutes: number;
  textOverlap: number;
  strength: "weak" | "strong";
  why: string;
};

const tokens = (t: string) => new Set(t.toLowerCase().replace(/[^a-zà-ÿ\s]/g, " ").split(/\s+/).filter((x) => x.length > 3));
const jaccard = (x: Set<string>, y: Set<string>) => {
  if (!x.size || !y.size) return 0;
  let i = 0;
  for (const v of x) if (y.has(v)) i++;
  return i / (x.size + y.size - i);
};

/**
 * Coordination / herding detector. Independent experts disagree by a few points and answer at different times.
 * Pairs that repeatedly give near-identical numbers within minutes, with overlapping wording, are surfaced to a
 * moderator as a *question* (shared source? group chat? one person, two profiles?) — never as an accusation.
 * It only uses behavioural metadata; it never reads identity, so it works for Sealed experts too.
 */
export function coordinationPairs(
  forecasts: { questionId: number; expertId: number; probability: number; reason: string; createdAt: Date }[]
): CoordPair[] {
  const byQ = new Map<number, typeof forecasts>();
  for (const f of forecasts) {
    const a = byQ.get(f.questionId) ?? [];
    a.push(f);
    byQ.set(f.questionId, a);
  }
  const acc = new Map<string, { a: number; b: number; gaps: number[]; mins: number[]; overlaps: number[] }>();
  for (const fs of byQ.values()) {
    for (let i = 0; i < fs.length; i++)
      for (let j = i + 1; j < fs.length; j++) {
        const [x, y] = fs[i].expertId < fs[j].expertId ? [fs[i], fs[j]] : [fs[j], fs[i]];
        const key = `${x.expertId}-${y.expertId}`;
        const r = acc.get(key) ?? { a: x.expertId, b: y.expertId, gaps: [], mins: [], overlaps: [] };
        r.gaps.push(Math.abs(x.probability - y.probability));
        r.mins.push(Math.abs(x.createdAt.getTime() - y.createdAt.getTime()) / 60000);
        if (x.reason && y.reason) r.overlaps.push(jaccard(tokens(x.reason), tokens(y.reason)));
        acc.set(key, r);
      }
  }
  const med = (v: number[]) => {
    const s = [...v].sort((p, q) => p - q);
    return s.length ? s[Math.floor(s.length / 2)] : 0;
  };
  const out: CoordPair[] = [];
  for (const r of acc.values()) {
    if (r.gaps.length < 3) continue;
    const meanGap = r.gaps.reduce((p, q) => p + q, 0) / r.gaps.length;
    const medianMinutes = med(r.mins);
    const textOverlap = r.overlaps.length ? r.overlaps.reduce((p, q) => p + q, 0) / r.overlaps.length : 0;
    const close = meanGap <= 3;
    const fast = medianMinutes <= 30;
    const echo = textOverlap >= 0.45;
    const hits = [close, fast, echo].filter(Boolean).length;
    if (!close || hits < 2) continue;
    out.push({
      a: r.a,
      b: r.b,
      shared: r.gaps.length,
      meanGap: Math.round(meanGap * 10) / 10,
      medianMinutes: Math.round(medianMinutes),
      textOverlap: Math.round(textOverlap * 100) / 100,
      strength: hits === 3 ? "strong" : "weak",
      why: [
        `${r.gaps.length} shared questions, answers differ by ${meanGap.toFixed(1)} pts on average`,
        fast ? `submitted a median ${Math.round(medianMinutes)} min apart` : "",
        echo ? `${Math.round(textOverlap * 100)}% wording overlap in reasons` : "",
      ]
        .filter(Boolean)
        .join(" · "),
    });
  }
  return out.sort((p, q) => (q.strength === "strong" ? 1 : 0) - (p.strength === "strong" ? 1 : 0) || q.shared - p.shared);
}
