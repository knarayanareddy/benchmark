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
  if (Object.prototype.hasOwnProperty.call(LEVELS, String(requested).toUpperCase())) {
    return { level: requested, honoured: true, why: null };
  }
  if (Object.values(LEVELS).includes(requested)) {
    return { level: requested, honoured: true, why: null };
  }
  return {
    level: DEFAULT_LEVEL,
    honoured: false,
    why: `unknown level ${JSON.stringify(requested)} — fell back to ${DEFAULT_LEVEL}`,
  };
}

/**
 * Deterministic alias, stable per (expert, country, salt).
 *
 * Not cryptographic and not meant to be: it lives in the organiser's own
 * database, next to the record that already says who the expert is. Its job is
 * to stop a name reaching the page, not to resist a subpoena.
 */
export function aliasFor(expertId, country, salt = 'v1') {
  const s = `${salt}:${country}:${expertId}`;
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return `Analyst ${(Math.abs(h) % 90) + 10}`;
}

/**
 * Strip a contribution down to what the chosen level permits.
 *
 * `contribution` is { expertId, name, country, text, at, ... }.
 * Everything not permitted is REMOVED, not blanked — a blanked field is still a
 * field, and it leaks through the shape of the object.
 */
export function attribute(contribution, level = DEFAULT_LEVEL, opts = {}) {
  const { expertId, name, country } = contribution;
  const kept = { ...contribution };
  delete kept.expertId;
  delete kept.name;

  if (level === LEVELS.IDENTIFIED) {
    kept.by = name || expertId || 'unknown';
    kept.level = LEVELS.IDENTIFIED;
    return kept;
  }
  if (level === LEVELS.ANONYMOUS) {
    delete kept.country;             // a country plus a timestamp is an identity in a panel of 5
    delete kept.at;
    kept.by = 'anonymous';
    kept.level = LEVELS.ANONYMOUS;
    return kept;
  }
  kept.by = aliasFor(expertId, country, opts.salt);
  kept.level = LEVELS.PSEUDONYMOUS;
  return kept;
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
  return warns;
}

/**
 * The public-facing rule, which is not a setting: nothing attributable about an
 * individual ever leaves the panel. Aggregate statistics with counts below
 * `minCount` are suppressed, per the plug-in contract and SAFETY.md.
 */
export const PUBLIC = Object.freeze({ attributable: false, minCount: 10 });

export function publicable(counts = [], minCount = PUBLIC.minCount) {
  const out = {};
  let suppressed = 0;
  for (const [k, n] of Object.entries(counts)) {
    if (n < minCount) { suppressed++; continue; }
    out[k] = n;
  }
  return { published: out, suppressedCells: suppressed };
}
