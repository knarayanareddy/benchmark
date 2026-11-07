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
