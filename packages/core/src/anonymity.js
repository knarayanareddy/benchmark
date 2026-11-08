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

/** The three levels, in the order the expert sees them. */
export const LEVELS = Object.freeze({
  IDENTIFIED: 'identified',      // known to ACAPS, named to peers
  PSEUDONYMOUS: 'pseudonymous',  // known to ACAPS, stable alias to peers
  ANONYMOUS: 'anonymous',        // no longer linkable to the person by anyone
});

export const DEFAULT_LEVEL = LEVELS.PSEUDONYMOUS;

/**
 * What each level promises. Rendered verbatim next to the choice, because an
 * anonymity setting the expert cannot understand is not expert-controlled.
 *
 * `capability` states what the implementation can actually do, and it is
 * asserted against the copy by test. An earlier revision of this file told the
 * expert ACAPS held a "sealed record that only the moderator can open" while
 * `attribute()` stripped the identifier before storage — the copy promised a
 * capability the code did not have, which is the one defect a patch cannot fix
 * after a demo. Until a sealed-record escrow exists, the honest level is
 * `capability: 'none'` and the copy says so.
 */
export const LEVEL_COPY = Object.freeze({
  [LEVELS.IDENTIFIED]: Object.freeze({
    label: 'Known',
    capability: 'named',
    toAcaps: 'Your name, alongside your contribution.',
    toPeers: 'Your name, alongside your contribution.',
    warn: 'Choose this only if you are content for colleagues to know what you said.',
  }),
  [LEVELS.PSEUDONYMOUS]: Object.freeze({
    label: 'Pseudonymous',
    capability: 'alias',
    toAcaps: 'Your name, so this can be followed up.',
    toPeers: 'A stable alias, e.g. "Analyst 4". The same alias each time, so the group can see that one person has consistently disagreed.',
    warn: 'Your alias stays the same across questions within a country. Writing style can still identify you to people who know you.',
  }),
  [LEVELS.ANONYMOUS]: Object.freeze({
    label: 'Anonymous',
    capability: 'none',
    toAcaps: 'Nothing that identifies you. Your contribution is not stored with your expert ID and cannot be traced back to you — not by other experts, and not by ACAPS.',
    toPeers: 'Nothing. Your contribution appears as "anonymous".',
    warn: 'You cannot be contacted to clarify or to credit. Some follow-ups will not reach you.',
  }),
});

/** Affirmative claims of a sealed-record escrow. Only valid once one exists. */
const SEALED_RECORD_CLAIMS = /\bsealed record\b|\bmoderator can open\b|\bonly the moderator\b|\bACAPS can open\b/i;

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
 * A salt that is published in this repository cannot protect an alias: anyone
 * holding the roster can precompute `aliasFor()` and read the panel back. Every
 * production path therefore validates its salt, and the development constant is
 * rejected by name. `panelAliases()` has always done this; `attribute()` did
 * not, which meant the default path silently used the public constant.
 */
export const MIN_SALT_LENGTH = 16;

export function assertDeploymentSalt(salt, who = 'attribute()') {
  if (typeof salt !== 'string' || salt.trim().length < MIN_SALT_LENGTH || salt === DEFAULT_DEV_SALT || salt === 'v1') {
    throw new Error(
      `${who} requires a non-public deployment salt of at least ${MIN_SALT_LENGTH} characters, ` +
        'or a precomputed panelAliases map — an alias derived from a published constant is not a pseudonym'
    );
  }
  return salt;
}

function hashSlot(input) {
  let h1 = 0x811c9dc5;
  let h2 = 0x9e3779b9;
  for (let i = 0; i < input.length; i++) {
    const c = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193);
    h2 = Math.imul(h2 ^ (c + i), 0x85ebca6b);
  }
  h1 ^= h1 >>> 16;
  h2 ^= h2 >>> 13;
  const mixed = (Math.imul(h1, 0xc2b2ae35) ^ h2) >>> 0;
  return (mixed % ALIAS_SPACE) + 1000;
}

/**
 * Deterministic alias, stable per (expert, country, salt).
 *
 * Uses a 9,000-slot space (Analyst 1000..9999) rather than 90 slots so
 * uncoordinated panels of 10 collide ~0.5% of the time instead of 40.5%.
 *
 * Named `aliasForDev` because it silently accepts the public default salt: it
 * exists for tests and for local development. Production panels go through
 * `panelAliases()` (guaranteed collision-free) or `attribute()` with a
 * deployment salt, both of which reject the published constant.
 */
export function aliasForDev(expertId, country, salt = DEFAULT_DEV_SALT) {
  return `Analyst ${hashSlot(`${salt}:${country}:${expertId}`)}`;
}

/** @deprecated Use `aliasForDev()` or `panelAliases()`; kept so old imports do not break. */
export const aliasFor = aliasForDev;

/**
 * Assign guaranteed collision-free aliases across a country panel, using a
 * deployment-specific secret salt so an attacker with the roster cannot
 * precompute aliases from a public repository constant.
 *
 * Returns a frozen prototype-free record: expert ids such as `__proto__` are
 * ordinary keys here, not object internals.
 */
export function panelAliases(expertIds = [], country = '', { salt } = {}) {
  assertDeploymentSalt(salt, 'panelAliases()');
  const unique = [...new Set(expertIds.filter((id) => id !== undefined && id !== null && String(id).trim() !== '').map(String))].sort();
  if (unique.length > ALIAS_SPACE) {
    throw new RangeError(`panel size ${unique.length} exceeds alias space ${ALIAS_SPACE}`);
  }
  const taken = new Set();
  const entries = [];
  for (const id of unique) {
    if (!VALID_ID.test(id)) throw new Error(`invalid expert id ${JSON.stringify(id)} — ids must match ${VALID_ID}`);
    let attempt = 0;
    let candidate = aliasForDev(id, country, salt);
    while (taken.has(candidate)) {
      attempt++;
      candidate = `Analyst ${hashSlot(`${salt}:${country}:${id}#${attempt}`)}`;
    }
    taken.add(candidate);
    entries.push([id, candidate]);
  }
  // Object.fromEntries defines own properties, so `__proto__` stays a key.
  return Object.freeze(Object.assign(Object.create(null), Object.fromEntries(entries)));
}

/**
 * Explicit allowlists for `attribute()`.
 *
 * Never use a blacklist on privacy boundaries: any field added to a profile or
 * request context later (email, ip, role, organisation, session token) would
 * otherwise survive into `ANONYMOUS` output by default.
 */
const CONTENT_FIELDS = Object.freeze([
  // NOT `id`. A bare `id` is ambiguous between a contribution and a
  // contributor, and every other module in this repo (`paired`, `seedWeights`,
  // `deduplicateRounds`) accepts `id` on items — so callers supply it for the
  // item and a contributor id rides along into ANONYMOUS output. Contributions
  // carry `contributionId`; see assertNoIdentityLeak() for the backstop.
  'contributionId',
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

/**
 * Internal identifiers seen on this boundary. None may appear as a value in an
 * emitted payload at any level. The display `name` is deliberately absent from
 * this list: IDENTIFIED is the level that publishes it, and that disclosure is
 * made in the `by` field where the expert can see it.
 */
const INTERNAL_ID_FIELDS = Object.freeze(['expertId', 'expert', 'email', 'ip', 'org', 'role', 'sessionToken']);

const VALID_ID = /^[A-Za-z0-9._:-]{1,64}$/;

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
 * Coarsen a timestamp to the precision the level can afford.
 *
 * PSEUDONYMOUS used to keep `at` to the second. With 5–10 experts per country,
 * "Analyst 7916, TCD, 10:14:32" plus a known meeting or shift pattern is an
 * identity, so the timestamp is reduced to a day. ANONYMOUS keeps none — the
 * field is dropped by the allowlist, not blanked here.
 */
function coarsenTimestamp(at) {
  if (typeof at === 'string') {
    const m = /^(\d{4}-\d{2}-\d{2})/.exec(at.trim());
    if (m) return m[1];
    const ts = Date.parse(at);
    if (Number.isFinite(ts)) return new Date(ts).toISOString().slice(0, 10);
    return null; // unparseable: drop rather than pass through unknown shape
  }
  if (at instanceof Date && Number.isFinite(at.getTime())) {
    return at.toISOString().slice(0, 10);
  }
  return null;
}

/**
 * Backstop for the allowlist: no value in the emitted payload may equal an
 * identifier the contribution carried. Belts and braces, because the allowlist
 * is a static list and identity leaks through *values*, not only keys.
 */
function assertNoIdentityLeak(out, contribution) {
  const identities = INTERNAL_ID_FIELDS.map((k) => contribution[k])
    .filter((v) => v !== undefined && v !== null && String(v).trim() !== '')
    .map((v) => String(v));
  // A contribution attached to a named expert must never emit that name at a
  // level that is not IDENTIFIED.
  if (out.level !== LEVELS.IDENTIFIED && contribution.name !== undefined && contribution.name !== null) {
    const n = String(contribution.name).trim();
    if (n) identities.push(n);
  }
  if (!identities.length) return out;
  for (const [key, value] of Object.entries(out)) {
    if (value === null || typeof value === 'object') continue;
    const s = String(value);
    for (const id of identities) {
      if (s === id) {
        throw new Error(`identity leaked into "${key}" at level ${out.level} — refusing to emit this payload`);
      }
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
 *
 * Fail-closed rules, all enforced here so there is exactly one place where
 * identity is decided:
 *   - an unrecognised level emits the ANONYMOUS payload, never pseudonymous;
 *   - a pseudonym requires a deployment salt or a precomputed panel alias;
 *   - no emitted value may equal an identifier the contribution carried.
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
    return assertNoIdentityLeak(kept, contribution);
  }

  if (level === LEVELS.ANONYMOUS) {
    // Country + timestamp or role in a panel of 5–10 is an identity.
    const kept = pickAllowed(contribution, CONTENT_FIELDS);
    kept.by = 'anonymous';
    kept.level = LEVELS.ANONYMOUS;
    return assertNoIdentityLeak(kept, contribution);
  }

  const kept = pickAllowed(contribution, [...CONTENT_FIELDS, ...CONTEXT_FIELDS]);
  if (kept.at !== undefined) {
    const coarse = coarsenTimestamp(kept.at);
    if (coarse === null) delete kept.at;
    else kept.at = coarse;
  }

  if (level === LEVELS.IDENTIFIED) {
    // A missing display name must not fall through to the internal id: `by` is
    // rendered to peers, and an internal id is a worse disclosure than a gap.
    kept.by = name && String(name).trim() ? String(name).trim() : 'unnamed contributor';
    kept.level = LEVELS.IDENTIFIED;
    return assertNoIdentityLeak(kept, contribution);
  }

  const preassigned =
    opts.panelAliases instanceof Map
      ? opts.panelAliases.get(expertId)
      : opts.panelAliases && typeof opts.panelAliases === 'object' &&
        Object.prototype.hasOwnProperty.call(opts.panelAliases, expertId)
      ? opts.panelAliases[expertId]
      : undefined;

  if (preassigned !== undefined) {
    if (typeof preassigned !== 'string' || !preassigned.trim()) {
      throw new Error('panelAliases map must yield a non-empty string — refusing to emit a non-string pseudonym');
    }
    kept.by = preassigned;
  } else {
    assertDeploymentSalt(opts.salt, 'attribute() for PSEUDONYMOUS');
    if (expertId === undefined || expertId === null || String(expertId).trim() === '') {
      throw new Error('attribute() cannot derive an alias without an expertId — pass one, or choose ANONYMOUS');
    }
    kept.by = aliasForDev(String(expertId), country, opts.salt);
  }
  kept.level = LEVELS.PSEUDONYMOUS;
  return assertNoIdentityLeak(kept, contribution);
}

/**
 * The failure mode nobody tests: pseudonymity that does not pseudonymise.
 *
 * With 5–10 experts per country, an alias is only protective if the text does
 * not identify its author. This checks the two that are mechanical: a name
 * appearing in the contribution, and a country–role pair specific enough to
 * pick one person out of a panel that small.
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
  if (peers.length > 0 && peers.length < 5) {
    warns.push(
      `panel of ${peers.length} — with fewer than 5 experts, any country+role detail may single out one person`
    );
  }
  // A country plus a time of day is an identity in a 5–10 person panel: it is
  // enough to match a contribution against a meeting, a shift, or a message.
  // `attribute()` coarsens the timestamp; this catches a caller that bypassed it.
  const at = contribution.at;
  if (contribution.country && typeof at === 'string' && /\d{2}:\d{2}/.test(at)) {
    warns.push(
      'the contribution carries a country and a time of day — in a small panel that combination identifies one person; coarsen the timestamp'
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

/**
 * Publish a table of counts, suppressing every cell that cannot be shown to be
 * above `minCount`.
 *
 * A cell whose count is not an integer is NOT publishable: `undefined < 10` is
 * `false`, so the naive comparison published the cell, and on this boundary an
 * uncountable cell is the one most likely to be a person. `minCount` may be
 * raised but never lowered — otherwise the caller can switch the rule off.
 */
export function publicable(counts = {}, minCount = PUBLIC.minCount) {
  if (!Number.isInteger(minCount) || minCount < PUBLIC.minCount) {
    throw new RangeError(
      `minCount may be raised above PUBLIC.minCount (${PUBLIC.minCount}), never lowered — got ${JSON.stringify(minCount)}`
    );
  }
  if (!counts || typeof counts !== 'object') {
    throw new TypeError('counts must be a record of cell -> count');
  }
  const out = Object.create(null);
  let suppressed = 0;
  let uncountable = 0;
  for (const [k, n] of Object.entries(counts)) {
    if (!Number.isInteger(n)) {
      uncountable++;
      suppressed++;
      continue;
    }
    if (n < minCount) { suppressed++; continue; }
    out[k] = n;
  }
  return { published: out, suppressedCells: suppressed, uncountableCells: uncountable };
}
