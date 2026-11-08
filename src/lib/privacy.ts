import type { Expert, World } from "./world";
import { expertRegion, regionPeers, MIN_REGION_K } from "./world";

export type AnonymitySet = {
  /** experts (incl. you) sharing a country with you */
  sameCountry: number;
  /** ...and the same role type: the most identifying pair of attributes a peer can infer */
  sameCountryRole: number;
  /** ...and the same theme focus */
  sameCountryRoleTheme: number;
  k: number;
  risk: "high" | "medium" | "low";
  regionShown: boolean;
  advice: string[];
};

/**
 * Re-identification risk = k-anonymity over the attributes a circle member can infer from your contributions
 * (country coverage, role type, thematic focus). It is computed from the circle that exists TODAY, so it is honest
 * in small circles — the exact place where pseudonyms leak.
 */
export function anonymitySetOf(w: World, e: Expert): AnonymitySet {
  const peers = w.experts.filter((x) => !x.isModerator);
  const sc = peers.filter((x) => x.countries.some((c) => e.countries.includes(c)));
  const scr = sc.filter((x) => x.roleType === e.roleType);
  const scrt = scr.filter((x) => x.themes.some((t) => e.themes.includes(t)));
  const k = Math.max(1, scrt.length);
  const risk: AnonymitySet["risk"] = k < 3 ? "high" : k < 5 ? "medium" : "low";
  const advice: string[] = [];
  if (risk === "high")
    advice.push(
      `Only ${k === 1 ? "you" : k + " experts"} in this circle share your country, role and theme. A peer who knows the context could guess who you are from the content of an answer alone — prefer Sealed, and keep free text generic.`
    );
  if (risk === "medium") advice.push(`${k} experts match your profile. Avoid place names smaller than a province and unusual details.`);
  if (e.anonymity !== "sealed" && risk !== "low") advice.push("Sealed removes your pseudonym link between answers, which is what makes small-circle fingerprinting work.");
  if (regionPeers(w, e) < MIN_REGION_K && expertRegion(w, e))
    advice.push(`Your region (${expertRegion(w, e)}) has fewer than ${MIN_REGION_K} experts, so the region label is automatically stripped from your contributions.`);
  if (!advice.length) advice.push("Your profile sits in a crowd. Keep avoiding employer, village and named-person details in free text.");
  return {
    sameCountry: sc.length,
    sameCountryRole: scr.length,
    sameCountryRoleTheme: scrt.length,
    k,
    risk,
    regionShown: regionPeers(w, e) >= MIN_REGION_K,
    advice,
  };
}
