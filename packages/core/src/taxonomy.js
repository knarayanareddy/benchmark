/**
 * The shared vocabulary for matching people to questions: themes, regions and role types.
 *
 * Regions and themes of the ACAPS radar are NOT in the organisers' export, so the radar loader derives them
 * (see radar.js): a region from the country code, a theme from the wording. Both are HEURISTICS to be checked by
 * ACAPS; a moderator can change them on a card.
 */

/** key -> label. A card's `theme` and a person's `declaration.themes` use these keys. */
export const THEMES = Object.freeze({
  conflict: 'Conflict & security',
  food: 'Food security & livelihoods',
  displacement: 'Displacement & migration',
  health: 'Health & outbreaks',
  climate: 'Climate & natural hazards',
  political_economic: 'Political & economic',
});

export const REGIONS = Object.freeze([
  'East & Southern Africa',
  'Middle East & North Africa',
  'Sahel & West/Central Africa',
  'Americas & Europe',
  'South-East Asia & Pacific',
  'South & Central Asia',
]);

/** key -> label. Asked once, never shown to anyone but the person. */
export const ROLE_TYPES = Object.freeze({
  local_ngo: 'Local NGO leader',
  researcher: 'Researcher / academic',
  conflict_analyst: 'Conflict analyst',
  aa_practitioner: 'Anticipatory action / early warning',
  un_ingo: 'UN / INGO field staff',
  other: 'Other close observer',
});

/** Countries a humanitarian radar plausibly covers, ISO 3-letter -> region. A HEURISTIC for ACAPS to confirm. Regions follow the
 * organisers' export (data/risk-radar.json) and the prototype's risks.json; where a code is listed in both, the first is used.
 * A country outside this map gets no region, so it matches only by country (`regionOfIso` returns null). @type {Readonly<Record<string, string>>} */
export const REGION_BY_ISO = Object.freeze({
  // East & Southern Africa
  BDI: 'East & Southern Africa', BWA: 'East & Southern Africa', COM: 'East & Southern Africa', DJI: 'East & Southern Africa', ERI: 'East & Southern Africa', ETH: 'East & Southern Africa', KEN: 'East & Southern Africa',
  MDG: 'East & Southern Africa', MOZ: 'East & Southern Africa', MWI: 'East & Southern Africa', NAM: 'East & Southern Africa', RWA: 'East & Southern Africa', SDN: 'East & Southern Africa',
  SOM: 'East & Southern Africa', SSD: 'East & Southern Africa', TZA: 'East & Southern Africa', UGA: 'East & Southern Africa', ZAF: 'East & Southern Africa', ZMB: 'East & Southern Africa',
  ZWE: 'East & Southern Africa',
  // Sahel & West/Central Africa
  BEN: 'Sahel & West/Central Africa', BFA: 'Sahel & West/Central Africa', CAF: 'Sahel & West/Central Africa', CIV: 'Sahel & West/Central Africa', CMR: 'Sahel & West/Central Africa', COD: 'Sahel & West/Central Africa', COG: 'Sahel & West/Central Africa', GAB: 'Sahel & West/Central Africa',
  GHA: 'Sahel & West/Central Africa', GIN: 'Sahel & West/Central Africa', GMB: 'Sahel & West/Central Africa', GNB: 'Sahel & West/Central Africa', GNQ: 'Sahel & West/Central Africa', LBR: 'Sahel & West/Central Africa', MLI: 'Sahel & West/Central Africa', MRT: 'Sahel & West/Central Africa',
  NER: 'Sahel & West/Central Africa', NGA: 'Sahel & West/Central Africa', SEN: 'Sahel & West/Central Africa', SLE: 'Sahel & West/Central Africa', STP: 'Sahel & West/Central Africa', TCD: 'Sahel & West/Central Africa', TGO: 'Sahel & West/Central Africa',
  // Middle East & North Africa
  ARE: 'Middle East & North Africa', DZA: 'Middle East & North Africa', EGY: 'Middle East & North Africa', IRN: 'Middle East & North Africa', IRQ: 'Middle East & North Africa', ISR: 'Middle East & North Africa', JOR: 'Middle East & North Africa',
  LBN: 'Middle East & North Africa', LBY: 'Middle East & North Africa', MAR: 'Middle East & North Africa', PSE: 'Middle East & North Africa', SAU: 'Middle East & North Africa',
  SYR: 'Middle East & North Africa', TUN: 'Middle East & North Africa', TUR: 'Middle East & North Africa', YEM: 'Middle East & North Africa',
  // Americas & Europe
  BRA: 'Americas & Europe', CAN: 'Americas & Europe', COL: 'Americas & Europe',
  CUB: 'Americas & Europe', DEU: 'Americas & Europe', ESP: 'Americas & Europe', FRA: 'Americas & Europe', GBR: 'Americas & Europe', GTM: 'Americas & Europe',
  HND: 'Americas & Europe', HTI: 'Americas & Europe', MEX: 'Americas & Europe', NIC: 'Americas & Europe', PAN: 'Americas & Europe',
  PER: 'Americas & Europe', RUS: 'Americas & Europe', SLV: 'Americas & Europe', UKR: 'Americas & Europe',
  USA: 'Americas & Europe', VEN: 'Americas & Europe',
  // South & Central Asia
  AFG: 'South & Central Asia', BGD: 'South & Central Asia', BTN: 'South & Central Asia', IND: 'South & Central Asia', KAZ: 'South & Central Asia', KGZ: 'South & Central Asia', LKA: 'South & Central Asia', MDV: 'South & Central Asia',
  NPL: 'South & Central Asia', PAK: 'South & Central Asia', TJK: 'South & Central Asia', TKM: 'South & Central Asia', UZB: 'South & Central Asia',
  // South-East Asia & Pacific
  AUS: 'South-East Asia & Pacific', CHN: 'South-East Asia & Pacific', IDN: 'South-East Asia & Pacific', JPN: 'South-East Asia & Pacific', KHM: 'South-East Asia & Pacific', KOR: 'South-East Asia & Pacific',
  MMR: 'South-East Asia & Pacific', MNG: 'South-East Asia & Pacific', PHL: 'South-East Asia & Pacific', PNG: 'South-East Asia & Pacific',
  THA: 'South-East Asia & Pacific', TLS: 'South-East Asia & Pacific', VNM: 'South-East Asia & Pacific',
});

/** Keyword stems per theme for `themeOfText`. Each entry is a regex source matched at a word start, case-insensitively
 * (`war\\b` matches the word "war" only). HEURISTIC: ACAPS should review and extend these lists. */
export const THEME_KEYWORDS = Object.freeze({
  conflict: ['war\\b', 'violen', 'attack', 'armed', 'conflict', 'clash', 'fighting', 'insurgen', 'militi', 'offensive', 'shelling', 'massacre', 'ceasefire', 'hostilit'],
  food: ['food', 'hunger', 'famine', 'malnutrition', 'harvest', 'crop', 'livelihood', 'grain', 'wheat', 'livestock', 'ipc\\b'],
  displacement: ['displac', 'refugee', 'migrant', 'migration', 'returnee', 'idp\\b', 'asylum', 'flee', 'fled\\b'],
  health: ['health', 'disease', 'outbreak', 'epidemic', 'pandemic', 'cholera', 'measles', 'malaria', 'mpox', 'ebola', 'vaccin', 'hospital', 'medical', 'dengue'],
  climate: ['flood', 'drought', 'cyclone', 'hurricane', 'typhoon', 'earthquake', 'climate', 'hazard', 'storm', 'monsoon', 'heatwave', 'wildfire', 'landslide', 'rainfall', 'tsunami'],
  political_economic: ['election', 'government', 'currency', 'inflation', 'econom', 'fiscal', 'sanction', 'budget', 'debt\\b', 'politic', 'coup\\b', 'protest', 'unrest', 'governance', 'funds?\\b', 'funding', 'donor', 'aid\\b'],
});

/**
 * The theme of a risk's wording, by counting how many keyword stems each theme matches. The theme with the most
 * matched stems wins; a tie goes to the theme listed first in THEMES; no match at all gives `political_economic`.
 * HEURISTIC: it reads words, not meaning. "Attacks on health facilities" is conflict (tie, listed first).
 * @param {unknown} text
 * @returns {keyof typeof THEMES}
 */
export function themeOfText(text) {
  const haystack = typeof text === 'string' ? text : '';
  /** @type {keyof typeof THEMES} */
  let best = 'political_economic';
  let bestHits = 0;
  for (const theme of /** @type {(keyof typeof THEMES)[]} */ (Object.keys(THEMES))) {
    const hits = THEME_KEYWORDS[theme].filter((stem) => new RegExp(`\\b${stem}`, 'i').test(haystack)).length;
    if (hits > bestHits) {
      best = theme;
      bestHits = hits;
    }
  }
  return best;
}

/**
 * Region of one ISO 3-letter code. Tolerates case and surrounding spaces. Null when unknown.
 * @param {unknown} iso
 * @returns {string | null}
 */
export function regionOfIso(iso) {
  if (typeof iso !== 'string') return null;
  const code = iso.trim().toUpperCase();
  return Object.hasOwn(REGION_BY_ISO, code) ? REGION_BY_ISO[code] : null;
}

/**
 * Region of the first code in the list that has a mapping. Null when none does.
 * @param {unknown} isos
 * @returns {string | null}
 */
export function regionOfIsos(isos) {
  if (!Array.isArray(isos)) return null;
  for (const iso of isos) {
    const region = regionOfIso(iso);
    if (region) return region;
  }
  return null;
}
