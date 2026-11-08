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

export function matches(card, declaration = {}) {
  const regions = declaration.regions || [];
  const themes = declaration.themes || [];
  const regionHit = regions.length === 0 || regions.includes(card.region);
  const themeHit = themes.length === 0 || themes.includes(card.theme);
  return regionHit && themeHit;
}

/**
 * Was this history row actually delivered to a person?
 *
 * `dispatch()`'s own output is the natural thing to persist, and it contains
 * `defer` and `suppress` rows. Counting those against the cap meant three
 * deferrals with nothing ever sent exhausted a cap of three — the retention
 * mechanism starved itself, permanently, on every run.
 */
function countsAgainstCap(h) {
  if (!h || typeof h !== 'object') return false;
  if (priority(h.type) === TYPES.dissent_actioned) return false; // bypasses the cap by design
  // A row is a send unless it says otherwise. Rows written before `decision`
  // existed are recorded sends; rows carrying `defer`/`suppress` are not.
  if (h.decision === 'defer' || h.decision === 'suppress') return false;
  if (h.suppressed) return false;
  return true;
}

/**
 * @param {object[]} candidates [{type, card, expert, severity}]
 * @param {{perWeek:number}} cap
 * @param {object[]} history  notifications actually sent this week
 */
export function dispatch(candidates = [], cap = DEFAULT_CAP, history = []) {
  const perWeek = typeof cap === 'number' ? cap : cap.perWeek;
  if (!Number.isInteger(perWeek) || perWeek < 0) {
    throw new RangeError(`cap perWeek must be a non-negative integer, got ${JSON.stringify(perWeek)}`);
  }
  const usedBy = new Map();
  for (const h of history) {
    if (!countsAgainstCap(h)) continue;
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
  return [...by.values()].map((r) => {
    // completions can exceed sends when a card is answered without a
    // notification (or an event is double-counted). A rate above 1 is not a
    // rate; flag it instead of publishing "200% completion".
    const anomaly = r.sent > 0 && r.completed > r.sent;
    return {
      ...r,
      rate: r.sent ? r.completed / r.sent : null,
      uncovered: r.sent >= 5 && r.completed / r.sent < minCompletion,
      anomaly,
      anomalyReason: anomaly ? `${r.completed} completions for ${r.sent} sends — check the event source` : null,
    };
  });
}
