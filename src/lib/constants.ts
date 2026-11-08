export const THEMES: Record<string, string> = {
  conflict: "Conflict & security",
  food: "Food security & livelihoods",
  displacement: "Displacement & migration",
  health: "Health & outbreaks",
  climate: "Climate & natural hazards",
  political_economic: "Political & economic",
};

export const ROLE_TYPES: Record<string, string> = {
  local_ngo: "Local NGO leader",
  researcher: "Researcher / academic",
  conflict_analyst: "Conflict analyst",
  aa_practitioner: "Anticipatory action / early warning",
  un_ingo: "UN / INGO field staff",
  other: "Other close observer",
};

/** Contexts where default anonymity is "sealed" and a named choice triggers a safety check. */
export const SENSITIVE_COUNTRIES = [
  "Sudan",
  "Syria",
  "Yemen",
  "Afghanistan",
  "Myanmar",
  "South Sudan",
  "Palestine",
  "Somalia",
  "Mali",
  "Ethiopia",
  "Iran",
  "Venezuela",
  "Cuba",
  "Haiti",
];

export type AnonLevel = "sealed" | "alias" | "confidential" | "named";

/** Ordered from most public (0) to most private (3). */
export const ANON_ORDER: AnonLevel[] = ["named", "confidential", "alias", "sealed"];

export const ANON_LEVELS: {
  id: AnonLevel;
  name: string;
  tagline: string;
  acaps: string;
  peers: string;
  pub: string;
  note: string;
}[] = [
  {
    id: "sealed",
    name: "Sealed",
    tagline: "Nobody can identify me — not even ACAPS.",
    acaps: "“Verified expert · Region”. No name, no organisation, no stable alias.",
    peers: "“Anonymous expert · Region”. Contributions cannot be linked together.",
    pub: "Aggregates only (n ≥ 10).",
    note: "Your track record still accrues privately to you. Verification evidence is deleted after the check.",
  },
  {
    id: "alias",
    name: "Alias",
    tagline: "A stable pseudonym. ACAPS doesn't know who I am either.",
    acaps: "Your alias (e.g. “Amber Heron”) and verified status. No real identity.",
    peers: "Your alias — peers can follow your reasoning over time.",
    pub: "Aggregates only (n ≥ 10).",
    note: "Best balance for most field experts: reputation without exposure.",
  },
  {
    id: "confidential",
    name: "Known to ACAPS",
    tagline: "ACAPS knows me. Peers see only my alias.",
    acaps: "Your name and organisation (moderators only).",
    peers: "Your alias. Never your name.",
    pub: "Aggregates only (n ≥ 10).",
    note: "Lets ACAPS follow up, invite you to briefings and credit you internally.",
  },
  {
    id: "named",
    name: "On the stage",
    tagline: "My name is my badge of honour — inside the trusted circle.",
    acaps: "Your name, organisation and track record.",
    peers: "Your name and organisation, plus your Honour Roll listing.",
    pub: "Still aggregates only. Public credit needs a separate per-item consent + safety review.",
    note: "Opt-in. You can retreat to a more private level at any time — it re-masks your past contributions.",
  },
];

/** Empirical materialisation rates by ACAPS probability rating (ACAPS Risk Radar export, 99 resolved risks with a rating). */
export const LEVEL_PRIOR: Record<string, number> = {
  "Very Low": 0.25,
  Low: 0.4,
  Medium: 0.48,
  High: 0.8,
  "Very High": 0.88,
};

export const EVIDENCE_TYPES: Record<string, string> = {
  none: "Judgement only",
  direct: "I saw / heard it directly",
  local_source: "Trusted local source",
  data: "Data or monitoring",
  analysis: "Analysis / literature",
};

export const REACTION_TYPES: Record<string, { label: string; icon: string }> = {
  new_info: { label: "Added new information", icon: "✦" },
  changed_mind: { label: "Changed my mind", icon: "↻" },
  needs_source: { label: "Needs a source", icon: "?" },
  disagree: { label: "I see it differently", icon: "≠" },
};

export const POST_KINDS: Record<string, string> = {
  claim: "Claim",
  evidence: "Evidence",
  counter: "Counter-view",
  question: "Question",
  missing_risk: "Missing risk / trigger",
};

export const LOADED_LEXICON = [
  "regime",
  "puppet",
  "terrorists",
  "traitors",
  "genocidal",
  "propaganda",
  "stooges",
  "illegitimate",
  "occupiers",
  "criminal government",
  "everyone knows",
  "obviously",
  "100%",
  "definitely",
  "certainly",
];

/** Divergence interview: what the expert says drives a gap vs ACAPS. Neutral wording, no option is "better". */
export const GAP_BASES: Record<string, string> = {
  new_info: "Newer information than the analysis reflects",
  local_detail: "Local detail the analysis may lack",
  reading: "A different reading of the same facts",
  definition: "A different definition or timeframe",
  unsure: "I'm not sure — I hold this loosely",
};
