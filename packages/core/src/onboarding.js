/**
 * Onboarding core: the pure rules behind the four-step "Join the circle" wizard
 * (docs/13-onboarding.md). No I/O: the web layer renders these and the service
 * still enforces what matters.
 *
 * The visibility cards are built from LEVEL_COPY and PUBLIC, the same source
 * consentText() uses, so what a person reads while choosing cannot disagree
 * with what they accept.
 */
import { LEVELS, LEVEL_COPY, PUBLIC } from './anonymity.js';
import { DEFAULT_SENSITIVE_COUNTRIES, isSensitiveCountry } from './sensitive.js';
import { THEMES, ROLE_TYPES } from './taxonomy.js';

export const MAX_COUNTRIES = 6;
export const CAP_OPTIONS = Object.freeze([1, 2, 3, 5]);
export const STEPS = Object.freeze(['Invitation', 'Your expertise', 'Your visibility', 'Your rhythm']);

/** ISO 3-letter -> English name. Covers every REGION_BY_ISO key and every code in data/risk-radar.json. */
export const COUNTRY_NAMES = Object.freeze({
  AFG: 'Afghanistan', ARE: 'United Arab Emirates', AUS: 'Australia', BDI: 'Burundi', BEN: 'Benin',
  BFA: 'Burkina Faso', BGD: 'Bangladesh', BRA: 'Brazil', BTN: 'Bhutan', BWA: 'Botswana',
  CAF: 'Central African Republic', CAN: 'Canada', CHN: 'China', CIV: 'Ivory Coast', CMR: 'Cameroon',
  COD: 'Democratic Republic of the Congo', COG: 'Republic of the Congo', COL: 'Colombia', COM: 'Comoros', CUB: 'Cuba',
  DEU: 'Germany', DJI: 'Djibouti', DZA: 'Algeria', EGY: 'Egypt', ERI: 'Eritrea', ESP: 'Spain', ETH: 'Ethiopia',
  FRA: 'France', GAB: 'Gabon', GBR: 'United Kingdom', GHA: 'Ghana', GIN: 'Guinea', GMB: 'Gambia',
  GNB: 'Guinea-Bissau', GNQ: 'Equatorial Guinea', GTM: 'Guatemala', HND: 'Honduras', HTI: 'Haiti', IDN: 'Indonesia',
  IND: 'India', IRN: 'Iran', IRQ: 'Iraq', ISR: 'Israel', JOR: 'Jordan', JPN: 'Japan', KAZ: 'Kazakhstan', KEN: 'Kenya',
  KGZ: 'Kyrgyzstan', KHM: 'Cambodia', KOR: 'South Korea', LBN: 'Lebanon', LBR: 'Liberia', LBY: 'Libya',
  LKA: 'Sri Lanka', MAR: 'Morocco', MDG: 'Madagascar', MDV: 'Maldives', MEX: 'Mexico', MLI: 'Mali', MMR: 'Myanmar',
  MNG: 'Mongolia', MOZ: 'Mozambique', MRT: 'Mauritania', MWI: 'Malawi', NAM: 'Namibia', NER: 'Niger', NGA: 'Nigeria',
  NIC: 'Nicaragua', NPL: 'Nepal', PAK: 'Pakistan', PAN: 'Panama', PER: 'Peru', PHL: 'Philippines',
  PNG: 'Papua New Guinea', PSE: 'Palestine', RUS: 'Russia', RWA: 'Rwanda', SAU: 'Saudi Arabia', SDN: 'Sudan',
  SEN: 'Senegal', SLE: 'Sierra Leone', SLV: 'El Salvador', SOM: 'Somalia', SSD: 'South Sudan', STP: 'São Tomé and Príncipe',
  SYR: 'Syria', TCD: 'Chad', TGO: 'Togo', THA: 'Thailand', TJK: 'Tajikistan', TKM: 'Turkmenistan', TLS: 'Timor-Leste',
  TUN: 'Tunisia', TUR: 'Turkey', TZA: 'Tanzania', UGA: 'Uganda', UKR: 'Ukraine', USA: 'United States',
  UZB: 'Uzbekistan', VEN: 'Venezuela', VNM: 'Vietnam', YEM: 'Yemen', ZAF: 'South Africa', ZMB: 'Zambia', ZWE: 'Zimbabwe',
});

/** Case-, accent- and surrounding-space-insensitive form used for search. */
const fold = (s) => String(s).normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();

/** @param {unknown} iso */
export function countryName(iso) {
  if (typeof iso !== 'string') return '';
  const code = iso.trim().toUpperCase();
  return Object.hasOwn(COUNTRY_NAMES, code) ? COUNTRY_NAMES[code] : code;
}

/**
 * Countries whose name contains the query (accent-insensitive), or whose ISO code
 * equals it exactly. An empty query returns every country. Sorted by name.
 * @param {unknown} q
 * @returns {{ iso: string, name: string }[]}
 */
export function searchCountries(q) {
  const text = typeof q === 'string' ? q : '';
  const needle = fold(text);
  const code = text.trim().toUpperCase();
  return Object.entries(COUNTRY_NAMES)
    .filter(([iso, name]) => !needle || fold(name).includes(needle) || iso === code)
    .map(([iso, name]) => ({ iso, name }))
    .sort((a, b) => a.name.localeCompare(b.name, 'en'));
}

/**
 * @typedef {'ACAPS moderators' | 'Circle peers' | 'The public' | 'If there is a safety concern'} Audience
 * @typedef {{ level: string, label: string, tagline: string, audiences: readonly { who: Audience, text: string }[], warn: string }} LevelCard
 */

const TAGLINE = Object.freeze({
  [LEVELS.IDENTIFIED]: 'My name is attached to what I say.',
  [LEVELS.PSEUDONYMOUS]: 'ACAPS knows me. My colleagues see a stable alias.',
  [LEVELS.ANONYMOUS]: 'ACAPS cannot see who I am in normal use.',
});

// Must agree with residualRisk() in packages/service/src/consent.js, which says the override only when a
// break-glass key is configured. The deployment's answer arrives as GET /api/config (breakGlass).
const SAFETY_OVERRIDE = Object.freeze({
  [LEVELS.IDENTIFIED]: 'Nothing extra: your name is already visible.',
  [LEVELS.PSEUDONYMOUS]: 'ACAPS already knows who you are.',
  [LEVELS.ANONYMOUS]:
    'If a serious safety or legal concern is raised about an anonymous objection you send, two moderators together can open the sealed note; you would be told afterwards. Anonymous estimates are never opened. With a device-held key nothing can be opened.',
});
const SAFETY_NO_OVERRIDE = Object.freeze({
  ...SAFETY_OVERRIDE,
  [LEVELS.ANONYMOUS]: 'Nobody at ACAPS can open an anonymous objection back to you. With a device-held key nothing can be opened either.',
});

/** @param {Record<string, string>} safety */
const buildCards = (safety) => Object.freeze(
  [LEVELS.IDENTIFIED, LEVELS.PSEUDONYMOUS, LEVELS.ANONYMOUS].map((level) => {
    const c = LEVEL_COPY[level];
    return /** @type {LevelCard} */ (Object.freeze({
      level,
      label: c.label,
      tagline: TAGLINE[level],
      audiences: Object.freeze([
        { who: 'ACAPS moderators', text: c.toAcaps },
        { who: 'Circle peers', text: c.toPeers },
        { who: 'The public', text: `Aggregates only, and only when at least ${PUBLIC.minCount} people are in a group.` },
        { who: 'If there is a safety concern', text: safety[level] },
      ]),
      warn: c.warn,
    }));
  }),
);

const CARDS_OVERRIDE = buildCards(SAFETY_OVERRIDE);
const CARDS_NO_OVERRIDE = buildCards(SAFETY_NO_OVERRIDE);

/**
 * @param {{ breakGlass?: boolean }} [opts] breakGlass: the deployment has a safety-override key. The default
 * true is only for older callers; the wizard always passes the real flag.
 * @returns {readonly LevelCard[]}
 */
export function levelCards({ breakGlass = true } = {}) {
  return breakGlass ? CARDS_OVERRIDE : CARDS_NO_OVERRIDE;
}

const REASON_PSEUDONYMOUS = 'A stable alias lets colleagues follow your reasoning while keeping your name from them.';
const REASON_ANONYMOUS = 'You cover a context where being named can put people at risk.';

/**
 * Advice only: a hint the person may override, with the reason shown.
 * @param {unknown} countries ISO 3-letter codes
 * @param {readonly string[]} [sensitive]
 * @returns {{ level: string, reason: string }}
 */
export function recommendedLevel(countries, sensitive = DEFAULT_SENSITIVE_COUNTRIES) {
  const list = Array.isArray(countries) ? countries : [];
  const pool = Array.isArray(sensitive) ? sensitive : DEFAULT_SENSITIVE_COUNTRIES;
  if (list.some((c) => isSensitiveCountry(c, pool))) {
    return { level: LEVELS.ANONYMOUS, reason: REASON_ANONYMOUS };
  }
  return { level: LEVELS.PSEUDONYMOUS, reason: REASON_PSEUDONYMOUS };
}

/**
 * Plain-sentence problems for one wizard step. Returns every problem at once.
 * @param {number} n step 1..4
 * @param {Record<string, any>} [state]
 * @returns {{ ok: boolean, problems: string[] }}
 */
export function validateStep(n, state = {}) {
  const s = state && typeof state === 'object' ? state : {};
  /** @type {string[]} */
  const problems = [];

  if (n === 1) {
    const hasToken = typeof s.token === 'string' && s.token.trim() !== '';
    if (!hasToken && !s.demo) problems.push('Paste your invitation link or code to continue.');
  } else if (n === 2) {
    if (s.demo) {
      const name = typeof s.name === 'string' ? s.name.trim() : '';
      if (name.length < 1 || name.length > 80) problems.push('Enter your name, up to 80 characters.');
    }
    const countries = Array.isArray(s.countries) ? s.countries : [];
    if (countries.length < 1) problems.push('Choose at least one country.');
    if (countries.length > MAX_COUNTRIES) {
      problems.push(`Choose at most ${MAX_COUNTRIES} countries; you have chosen ${countries.length}.`);
    }
    for (const c of countries) {
      if (!Object.hasOwn(COUNTRY_NAMES, c)) problems.push(`${String(c)} is not a country on the list.`);
    }
    const themes = s.themes === undefined || s.themes === null ? [] : s.themes;
    if (!Array.isArray(themes)) {
      problems.push('Themes must be chosen from the list.');
    } else {
      for (const t of themes) {
        if (!Object.hasOwn(THEMES, t)) problems.push(`${String(t)} is not a theme on the list.`);
      }
    }
    const role = s.roleType;
    if (role !== undefined && role !== null && role !== '' && !Object.hasOwn(ROLE_TYPES, role)) {
      problems.push('Choose a role from the list, or leave it empty.');
    }
    const org = s.organisation;
    if (org !== undefined && org !== null && (typeof org !== 'string' || org.length > 120)) {
      problems.push('Organisation must be text of 120 characters or fewer.');
    }
  } else if (n === 3) {
    if (!Object.values(LEVELS).includes(s.level)) {
      problems.push('Choose how you are shown: Known, Pseudonymous or Anonymous.');
    }
  } else if (n === 4) {
    if (!CAP_OPTIONS.includes(s.weeklyCap)) problems.push('Choose a weekly limit of 1, 2, 3 or 5.');
    if (s.consentAccepted !== true) problems.push('Tick the box to confirm you have read this and choose this level.');
    if (s.device && !s.recoverySaved) problems.push('Save your recovery code before using a device-held key.');
  } else {
    throw new RangeError(`no onboarding step ${JSON.stringify(n)}; steps run 1 to ${STEPS.length}`);
  }

  return { ok: problems.length === 0, problems };
}

/**
 * The invitation token from a raw token, or from a link carrying `invite=<token>`
 * in the hash or query. Null when there is no usable token.
 * @param {unknown} input
 * @returns {string | null}
 */
export function parseInvite(input) {
  if (typeof input !== 'string') return null;
  const text = input.trim();
  if (text === '') return null;
  const match = /(?:^|[?#&])invite=([^&#]*)/.exec(text);
  const token = match ? match[1] : text;
  if (token === '' || /\s/.test(token)) return null;
  return token;
}
