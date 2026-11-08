/**
 * Dispatch — which question reaches which expert, and the hard cap that makes
 * a notification safe to accept. Declaration decides WHO IS TOLD.
 * It never decides how much weight anyone carries (see scoring.js / Cooke).
 */

export const TYPES = Object.freeze({
  dissent_actioned: 4, // build this first — always welcome, by construction
  outlier: 3,
  contested: 2,
  new_statement: 1,
});

export const DEFAULT_CAP = Object.freeze({ perWeek: 3, instantOnlyAbove: TYPES.outlier });

/**
 * Does this card fall inside the expert's Declaration?
 *
 * An EMPTY Declaration matches NOTHING: skipping it must not mean "tell me
 * everything", or the weekly cap becomes the only relevance filter. Matching
 * every card is a separate, explicit choice (`{ all: true }`) reserved for
 * moderators. Within a non-empty Declaration an undeclared dimension is a
 * wildcard, a declared one must hit.
 */
export function matches(card, declaration = {}, { all = false } = {}) {
  if (all === true) return true;
  const countries = declaration.countries || [];
  const regions = declaration.regions || [];
  const themes = declaration.themes || [];
  if (countries.length === 0 && regions.length === 0 && themes.length === 0) return false;
  const countryHit = countries.length === 0 || countries.includes(card.country);
  // A question that was not given a region or a theme cannot be narrowed by it: a person who ticked "health" is
  // not hidden from a question nobody classified.
  const regionHit = regions.length === 0 || !card.region || regions.includes(card.region);
  const themeHit = themes.length === 0 || !card.theme || themes.includes(card.theme);
  return countryHit && regionHit && themeHit;
}

/**
 * @param {Array<Record<string, any>>} candidates [{type, card, expert, severity}]
 * @param {{perWeek:number}} cap
 * @param {Array<Record<string, any>>} history  notifications already sent this week
 */
export function dispatch(candidates = [], cap = DEFAULT_CAP, history = []) {
  const perWeek = typeof cap === 'number' ? cap : cap.perWeek;
  const usedBy = new Map();
  for (const h of history) {
    if (priority(h.type) === TYPES.dissent_actioned) continue;
    const k = h.expert ?? h.expertId ?? h.to ?? '__unknown__';
    usedBy.set(k, (usedBy.get(k) || 0) + 1);
  }

  const ordered = [...candidates].sort((a, b) => {
    const ta = priority(a.type);
    const tb = priority(b.type);
    if (tb !== ta) return tb - ta;
    return (b.severity ?? 0) - (a.severity ?? 0);
  });

  const out = [];

  for (const c of ordered) {
    // Dissent feedback is never suppressed — it is the retention mechanism.
    // Accept both numeric priority (TYPES.dissent_actioned = 4) and string key
    // ('dissent_actioned', as emitted by dissent.js notify()).
    if (priority(c.type) === TYPES.dissent_actioned) { out.push({ ...c, decision: 'send' }); continue; }
    if (c.suppressed) { out.push({ ...c, decision: 'suppress', why: 'explicitly suppressed' }); continue; }
    const k = c.expert ?? c.expertId ?? c.to ?? '__unknown__';
    const used = usedBy.get(k) || 0;
    if (used >= perWeek) {
      out.push({ ...c, decision: 'defer', why: `weekly cap of ${perWeek} reached for ${k}` });
      continue;
    }
    out.push({ ...c, decision: 'send' });
    usedBy.set(k, used + 1);
  }
  return out;
}

/** Accept either the numeric priority or the key name. */
function priority(t) {
  if (typeof t === 'number') return t;
  return TYPES[t] ?? 0;
}

/** Dispatch health: a domain with nobody answering is worse than a known gap. */
export function health(events = [], { minCompletion = 0.2 } = {}) {
  const by = new Map();
  for (const e of events) {
    const k = e.domain || 'unknown';
    const row = by.get(k) || { domain: k, sent: 0, completed: 0 };
    if (e.type === 'sent') row.sent++;
    if (e.type === 'completed') row.completed++;
    by.set(k, row);
  }
  return [...by.values()].map((r) => ({
    ...r,
    rate: r.sent ? r.completed / r.sent : null,
    uncovered: r.sent >= 5 && r.completed / r.sent < minCompletion,
  }));
}
