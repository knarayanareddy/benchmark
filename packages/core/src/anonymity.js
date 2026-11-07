/**
 * Anonymity — the clause ACAPS calls a Must Have, implemented.
 *
 * ACAPS' evaluation criteria list exactly three Must Haves:
 *   1. easy to use
 *   2. expert-controlled anonymity — "each expert chooses their own level
 *      (known to ACAPS, pseudonymous to peers, or fully anonymous)"
 *   3. public anonymity
 *
 * This module is the mechanism. It decides what OTHER EXPERTS may learn about
 * who said a thing. It never decides whether ACAPS can trace a contribution
 * back — that capability is what makes the panel moderated and defensible, and
 * it is disclosed to the expert at the moment they choose.
 *
 * The three levels are not cosmetic. Each one is a different promise, and the
 * promise has to survive the panel being small: with 5–10 experts per country,
 * "pseudonymous to peers" is only meaningful if the pseudonym does not leak
 * through the content. See `leaksBy()`.
 *
 * Pure: no storage, no network, no clock. Everything is passed in.
 */
import { hmacSha256, hmacSha256Hex } from './hmac.js';

/** The three levels, in the order the expert sees them. */
export const LEVELS = Object.freeze({
  IDENTIFIED: 'identified',      // known to ACAPS, named to peers
  PSEUDONYMOUS: 'pseudonymous',  // known to ACAPS, stable alias to peers
  ANONYMOUS: 'anonymous',        // ACAPS holds a sealed record, peers see nothing
});

export const DEFAULT_LEVEL = LEVELS.PSEUDONYMOUS;

/**
 * What each level promises. Rendered verbatim next to the choice, because an
 * anonymity setting the expert cannot understand is not expert-controlled.
 */
export const LEVEL_COPY = Object.freeze({
  [LEVELS.IDENTIFIED]: Object.freeze({
    label: 'Known',
    toAcaps: 'Your name, alongside your contribution.',
    toPeers: 'Your name, alongside your contribution.',
    warn: 'Choose this only if you are content for colleagues to know what you said.',
  }),
  [LEVELS.PSEUDONYMOUS]: Object.freeze({
    label: 'Pseudonymous',
    toAcaps: 'Your name, so this can be followed up.',
    toPeers: 'A stable alias, e.g. "Analyst 4". The same alias each time, so the group can see that one person has consistently disagreed.',
    warn: 'Your alias stays the same across questions within a country. Writing style can still identify you to people who know you.',
  }),
  [LEVELS.ANONYMOUS]: Object.freeze({
    label: 'Anonymous',
    toAcaps: 'A sealed record that only the moderator can open, and only to act on a safety concern. Not visible in analysis.',
    toPeers: 'Nothing. Your contribution appears as "anonymous".',
    warn: 'You cannot be contacted to clarify or to credit. Some follow-ups will not reach you.',
  }),
});

/**
 * Validate a level. Returns the level to use, plus whether the requested one
 * was honoured — callers must never silently upgrade or downgrade.
 */
export function resolveLevel(requested) {
  const key = String(requested ?? '').trim().toUpperCase();
  if (Object.prototype.hasOwnProperty.call(LEVELS, key)) {
    return { level: LEVELS[key], honoured: true, why: null };
  }
  return {
    level: DEFAULT_LEVEL,
    honoured: false,
    why: `unknown level ${JSON.stringify(requested)} — fell back to ${DEFAULT_LEVEL}`,
  };
}

export const ALIAS_SPACE = 9000;
export const DEFAULT_DEV_SALT = 'dev-unsalted';

/**
 * An alias derived from a public constant can be recomputed by anyone holding
 * a roster, which de-pseudonymises the whole panel. Every path that derives an
 * alias must go through this check; there is no default salt.
 */
function assertDeploymentSalt(salt, who) {
  if (
    typeof salt !== 'string' ||
    salt.trim().length < 8 ||
    salt === 'v1' ||
    salt === DEFAULT_DEV_SALT
  ) {
    throw new Error(`${who} requires a non-public deployment salt of at least 8 characters`);
  }
}

/**
 * Map a keyed hash to the 9,000-slot display space. The slot is only a label;
 * the unforgeable part is the HMAC, keyed by a deployment secret that must
 * never be in the repository or in the same store as the roster.
 */
function hashSlot(secret, input) {
  const d = hmacSha256(secret, `alias:v2:${input}`);
  const n = ((d[0] << 24) | (d[1] << 16) | (d[2] << 8) | d[3]) >>> 0;
  return (n % ALIAS_SPACE) + 1000;
}

/**
 * Deterministic alias, stable per (expert, country, salt).
 *
 * Uses a 9,000-slot space (Analyst 1000..9999) rather than 90 slots so
 * uncoordinated panels of 10 collide ~0.5% of the time instead of 40.5%.
 * Production panels should pass a deployment secret to `panelAliases()`, which
 * guarantees zero collisions across the panel and rejects public default salts.
 */
export function aliasFor(expertId, country, salt) {
  assertDeploymentSalt(salt, 'aliasFor()');
  return `Analyst ${hashSlot(salt, `${country}:${expertId}`)}`;
}

/**
 * Assign guaranteed collision-free aliases across a country panel, using a
 * deployment-specific secret salt so an attacker with the roster cannot
 * precompute aliases from a public repository constant.
 */
export function panelAliases(expertIds = [], country = '', { salt } = {}) {
  assertDeploymentSalt(salt, 'panelAliases()');
  const unique = [...new Set(expertIds.filter((id) => id !== undefined && id !== null && String(id).trim() !== '').map(String))].sort();
  if (unique.length > ALIAS_SPACE) {
    throw new RangeError(`panel size ${unique.length} exceeds alias space ${ALIAS_SPACE}`);
  }
  const taken = new Set();
  const map = {};
  for (const id of unique) {
    let attempt = 0;
    let candidate = aliasFor(id, country, salt);
    while (taken.has(candidate)) {
      attempt++;
      candidate = `Analyst ${hashSlot(salt, `${country}:${id}#${attempt}`)}`;
    }
    taken.add(candidate);
    map[id] = candidate;
  }
  return Object.freeze(map);
}

/**
 * Extend a persisted alias table without ever renaming anyone.
 *
 * `existing` is the stored { expertId: alias } map for ONE country. Entries
 * already in it are returned unchanged, so rotating the salt (or changing the
 * hash) cannot silently re-label a person mid-panel. New experts get a fresh
 * alias that avoids every alias already taken. The caller persists `added`
 * (one row per expert x country).
 */
export function assignAliases(existing = {}, expertIds = [], country = '', { salt } = {}) {
  assertDeploymentSalt(salt, 'assignAliases()');
  const aliases = { ...existing };
  const taken = new Set(Object.values(aliases));
  const added = {};
  const fresh = [...new Set(expertIds.filter((id) => id !== undefined && id !== null && String(id).trim() !== '').map(String))]
    .filter((id) => !Object.prototype.hasOwnProperty.call(aliases, id))
    .sort();
  if (taken.size + fresh.length > ALIAS_SPACE) {
    throw new RangeError(`panel would exceed alias space ${ALIAS_SPACE}`);
  }
  for (const id of fresh) {
    let attempt = 0;
    let candidate = aliasFor(id, country, salt);
    while (taken.has(candidate)) {
      attempt++;
      candidate = `Analyst ${hashSlot(salt, `${country}:${id}#${attempt}`)}`;
    }
    taken.add(candidate);
    aliases[id] = candidate;
    added[id] = candidate;
  }
  return { aliases: Object.freeze(aliases), added: Object.freeze(added) };
}

/**
 * Per-card, per-expert ballot token: HMAC(secret, card, expert).
 *
 * It lets the server de-duplicate and revise an anonymous answer without
 * storing who gave it. That only holds while `secret` lives OUTSIDE the
 * database that holds the roster (environment or KMS) — otherwise a database
 * reader can recompute every token and re-link every answer. See
 * docs/04-privacy-residual-risk.md.
 */
export function ballotToken(secret, cardId, expertId) {
  assertDeploymentSalt(secret, 'ballotToken()');
  if (!cardId || !expertId) throw new TypeError('ballotToken() needs a cardId and an expertId');
  return hmacSha256Hex(secret, `ballot:v1:${cardId}:${expertId}`);
}

/**
 * Coarsen a timestamp to the UTC day. In a panel of 5-10, a millisecond
 * timestamp on an anonymous row is a name. Accepts ms, Date or ISO string and
 * returns { day: 'YYYY-MM-DD', ms: <midnight UTC> }.
 */
export function coarsenToDay(at) {
  const t = at instanceof Date ? at.getTime() : typeof at === 'number' ? at : Date.parse(String(at));
  if (!Number.isFinite(t)) throw new TypeError('coarsenToDay() needs a valid timestamp');
  const d = new Date(t);
  const ms = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  return { day: new Date(ms).toISOString().slice(0, 10), ms };
}

/**
 * Explicit allowlists for `attribute()`.
 *
 * Never use a blacklist on privacy boundaries: any field added to a profile or
 * request context later (email, ip, role, organisation, session token) would
 * otherwise survive into `ANONYMOUS` output by default.
 */
const CONTENT_FIELDS = Object.freeze([
  'id',
  'cardId',
  'statementId',
  'round',
  'p',
  'estimate',
  'text',
  'kind',
  'dissentKind',
]);

const CONTEXT_FIELDS = Object.freeze(['country', 'region', 'theme', 'at']);

function pickAllowed(source, keys) {
  const out = {};
  for (const k of keys) {
    if (Object.prototype.hasOwnProperty.call(source, k) && source[k] !== undefined) {
      out[k] = source[k];
    }
  }
  return out;
}

/**
 * Strip a contribution down to ONLY what the chosen level explicitly permits.
 *
 * `contribution` is { expertId, name, country, text, at, ... }.
 * Unlisted attributes (email, ip, role, organisation, etc.) are dropped at
 * every level; omitted attributes stay absent rather than blanked.
 */
export function attribute(contribution, level = DEFAULT_LEVEL, opts = {}) {
  if (!contribution || typeof contribution !== 'object') {
    throw new TypeError('contribution must be an object');
  }
  const { expertId, name, country } = contribution;

  // Fail closed. An unrecognised level must never resolve to a level that
  // keeps context metadata — that is how a privacy setting becomes a leak.
  const known = Object.values(LEVELS).includes(level);
  if (!known) {
    const kept = pickAllowed(contribution, CONTENT_FIELDS);
    kept.by = 'anonymous';
    kept.level = LEVELS.ANONYMOUS;
    kept.fellBack = true;
    return kept;
  }

  if (level === LEVELS.ANONYMOUS) {
    // Country + timestamp or role in a panel of 5–10 is an identity.
    const kept = pickAllowed(contribution, CONTENT_FIELDS);
    kept.by = 'anonymous';
    kept.level = LEVELS.ANONYMOUS;
    return kept;
  }

  const kept = pickAllowed(contribution, [...CONTENT_FIELDS, ...CONTEXT_FIELDS]);
  if (level === LEVELS.IDENTIFIED) {
    kept.by = name || expertId || 'unknown';
    kept.level = LEVELS.IDENTIFIED;
    return kept;
  }

  const preassigned =
    opts.panelAliases instanceof Map
      ? opts.panelAliases.get(expertId)
      : opts.panelAliases?.[expertId];
  // Fail closed: no persisted alias and no deployment salt means no pseudonym.
  kept.by = preassigned || aliasFor(expertId, country, opts.salt);
  kept.level = LEVELS.PSEUDONYMOUS;
  return kept;
}

const ORG_ACRONYMS = [
  'WFP', 'UNHCR', 'OCHA', 'UNICEF', 'WHO', 'FAO', 'IOM', 'UNDP', 'UNFPA', 'MSF', 'IRC', 'NRC', 'ICRC', 'IFRC',
  'CARE', 'OXFAM', 'ACF', 'DRC', 'ACTED', 'CRS', 'MERCY CORPS', 'SAVE THE CHILDREN', 'WORLD VISION', 'ACLED',
  'FEWS NET', 'USAID', 'FCDO', 'ECHO', 'UNMISS', 'MONUSCO', 'UNAMA', 'AU', 'ECOWAS', 'IGAD',
];
const ORG_RE = new RegExp(`\\b(?:${ORG_ACRONYMS.map((o) => o.replace(/ /g, '\\s+')).join('|')})\\b`, 'i');
const ROLE_RE = /\b(?:country|regional|programme|program|field|deputy|assistant|senior|chief|head)\s+(?:director|coordinator|officer|manager|representative|of\s+(?:office|mission|programmes?|operations))\b|\b(?:director|coordinator|logistician|nutritionist|epidemiologist|protection officer|security officer|team leader)\b/i;
const FIRST_PERSON_RE = /\b(?:I\s+(?:work|worked|am based|was based|live|lead|run|manage|head)|my\s+(?:team|office|organi[sz]ation|agency|colleagues|mission|programme|program|district)|our\s+(?:office|team|mission|programme|program|base|compound)|as\s+(?:a|the)\s+\w+(?:\s+\w+)?\s+(?:in|for|at|of))\b/i;
const UNIQUE_RE = /\b(?:the\s+only|the\s+sole|the\s+one\s+(?:and\s+only\s+)?\w+\s+(?:in|at|for))\b/i;
const PLACE_RE = /\b(?:based\s+in|stationed\s+in|working\s+(?:in|out\s+of)|posted\s+(?:in|to)|(?:I|we)\s+live\s+in|(?:our|my)\s+office\s+in|here\s+in)\s+(?:the\s+)?([A-Z][\p{L}'-]{2,}(?:\s+[A-Z][\p{L}'-]{2,})?)/u;

/**
 * Mechanical identifying-detail hints: organisations, job titles,
 * first-person identifiers, uniqueness claims and self-location ("based in Juba").
 * Place names that are merely the subject of a forecast are NOT flagged: that
 * would fire on most cards and teach people to ignore it.
 * Returns [{ kind, match }] so a UI can offer a one-tap "remove detail".
 * Heuristic and incomplete by design: a hint is advice for a human, never proof
 * that text is safe.
 */
export function identifyingHints(text) {
  const t = String(text || '');
  const hints = [];
  const add = (kind, re) => {
    const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`);
    for (const m of t.matchAll(g)) hints.push({ kind, match: kind === 'place' ? m[1] : m[0] });
  };
  add('organisation', ORG_RE);
  add('role', ROLE_RE);
  add('first_person', FIRST_PERSON_RE);
  add('unique', UNIQUE_RE);
  add('place', PLACE_RE);
  return hints;
}

/** Replace every hinted span with a neutral marker. */
export function removeIdentifyingDetail(text, marker = '[detail removed]') {
  let out = String(text || '');
  const spans = [...new Set(identifyingHints(out).map((h) => h.match))].sort((a, b) => b.length - a.length);
  for (const sp of spans) out = out.split(sp).join(marker);
  return out;
}

/**
 * The failure mode nobody tests: pseudonymity that does not pseudonymise.
 *
 * With 5-10 experts per country, an alias is only protective if the text does
 * not identify its author. This checks the mechanical signals: a name in the
 * contribution, an organisation, job title, first-person identifier, uniqueness
 * claim or place name (see `identifyingHints()`), and a panel too small to hide
 * anyone.
 *
 * Deliberately conservative and deliberately incomplete — it returns warnings
 * for a human, it does not block.
 */
export function leaksBy(contribution, peers = []) {
  const warns = [];
  const text = String(contribution.text || '');
  const self = contribution.name || contribution.expertId;

  // A short name is not evidence. One- or two-character strings match almost
  // every sentence ("C" is inside "crossing"), so substring matching only
  // starts at 3 characters — otherwise the check cries wolf on every card and
  // a human learns to ignore it, which is worse than not having it.
  const MIN_NAME = 3;
  const named = (haystack, needle) =>
    String(needle).length >= MIN_NAME &&
    haystack.toLowerCase().includes(String(needle).toLowerCase());

  if (self && named(text, self)) {
    warns.push(`the contribution names its author (${self})`);
  }
  for (const p of peers) {
    const n = p.name || p.expertId;
    if (n && named(text, n)) {
      warns.push(`the contribution names another panellist (${n})`);
    }
  }
  const LABEL = {
    organisation: 'names an organisation',
    role: 'names a job title',
    first_person: 'uses a first-person identifier',
    unique: 'claims to be the only one',
    place: 'names a place',
  };
  const seen = new Set();
  for (const h of identifyingHints(text)) {
    const key = `${h.kind}:${h.match.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    warns.push(`the contribution ${LABEL[h.kind]} ("${h.match}") — in a small panel this can identify the author`);
  }
  if (peers.length > 0 && peers.length < 5) {
    warns.push(
      `panel of ${peers.length} — with fewer than 5 experts, any country+role detail may single out one person`
    );
  }
  return warns;
}

/**
 * The public-facing rule, which is not a setting: nothing attributable about an
 * individual ever leaves the panel. Aggregate statistics with counts below
 * `minCount` are suppressed, per the plug-in contract and SAFETY.md.
 */
export const PUBLIC = Object.freeze({ attributable: false, minCount: 10 });

export function publicable(counts = {}, minCount = PUBLIC.minCount) {
  if (counts === null || typeof counts !== 'object' || Array.isArray(counts)) {
    throw new TypeError('publicable() expects an object of { cell: count }');
  }
  const out = {};
  let suppressed = 0;
  for (const [k, n] of Object.entries(counts)) {
    if (n < minCount) { suppressed++; continue; }
    out[k] = n;
  }
  return { published: out, suppressedCells: suppressed };
}
