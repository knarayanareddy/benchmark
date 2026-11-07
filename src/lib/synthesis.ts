import type { World, Risk, Question } from "./world";
import { aggregate, questionAcaps, type Stats } from "./scoring";
import { showExpert } from "./identity";
import { toRow } from "./world";

const CLUSTERS: [string, RegExp][] = [
  ["escalation / military dynamics", /escalat|clash|strike|drone|incursion|deploy|retaliat|confront|attack/i],
  ["humanitarian access", /access|checkpoint|siege|blockade|constraint/i],
  ["displacement & returns", /displac|return|arriv|refugee|movement|flows?/i],
  ["food & prices", /food|price|harvest|market|ipc|cash/i],
  ["actor incentives / politics", /incentive|government|elite|political|negotiat|bargain/i],
];

/** Deterministic, auditable moderator brief. No generative model touches expert text — experts' experience stays human. */
export function brief(w: World, stats: Map<number, Stats>, q: Question, risk: Risk, modId: number) {
  const agg = aggregate(w, stats, q.id);
  const ac = questionAcaps(q, risk);
  const fs = w.forecasts.filter((f) => f.questionId === q.id);
  const reasons = fs.filter((f) => f.reason.length > 10);
  const themes = CLUSTERS.map(([name, re]) => ({ name, k: reasons.filter((f) => re.test(f.reason)).length })).filter((x) => x.k > 0).sort((a, b) => b.k - a.k);
  const lines: string[] = [];
  const actions: string[] = [];
  if (agg && agg.n >= 3) {
    lines.push(`Circle (performance-weighted, n=${agg.n}): ${agg.mean}% with 80% of views in ${agg.p10}–${agg.p90}% — ${agg.label.toLowerCase()}.`);
    if (ac !== null) {
      const d = Math.round(agg.mean - ac * 100);
      lines.push(`ACAPS' rating implies ~${Math.round(ac * 100)}%: the circle sits ${Math.abs(d)} pts ${d >= 0 ? "above" : "below"}.`);
      if (Math.abs(d) >= 10) actions.push(`Review the probability rating: the circle is ${Math.abs(d)} pts ${d > 0 ? "higher" : "lower"} than ACAPS.`);
    }
    if (agg.spread >= 40) actions.push("Views are split — convene the Roundtable and ask both camps for the one piece of evidence that would change their mind.");
  } else lines.push("Fewer than 3 answers: nothing is released yet (small-cell protection).");
  if (themes.length) lines.push(`What the reasoning talks about most: ${themes.slice(0, 3).map((t) => `${t.name} (${t.k})`).join(", ")}.`);
  const dissent = fs
    .filter((f) => ac !== null && Math.abs(f.probability - ac * 100) >= 25 && f.reason.length > 20)
    .map((f) => {
      const sh = showExpert(toRow(w, w.expertById.get(f.expertId)!), f.identityMode, { role: "moderator", id: modId });
      return { who: sh.label, sub: sh.sub, p: f.probability, text: f.reason };
    });
  if (dissent.length) actions.push(`${dissent.length} reasoned dissent${dissent.length > 1 ? "s" : ""}: route to the analyst and ask for the underlying evidence.`);
  const missing = w.posts.filter((p) => p.riskId === risk.id && p.kind === "missing_risk" && !p.hidden);
  if (missing.length) actions.push(`${missing.length} expert-proposed missing risk/trigger on the Roundtable: consider adding to the next rationale update.`);
  const coi = fs.filter((f) => f.coiFlag).length;
  if (coi) lines.push(`${coi} answer(s) carry a self-declared conflict of interest and are down-weighted in sensitivity checks.`);
  return { agg, ac, lines, actions, dissent, missing: missing.map((m) => m.body) };
}
