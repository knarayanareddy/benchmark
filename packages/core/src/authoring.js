/**
 * Card authoring rules, in one place so the service, the CSV importer and the
 * worklist all apply the SAME test. A card opens only with real dates, a written
 * objective (what counts as "yes"), a resolution source from a fixed list and a
 * named resolver, all fixed at authoring and never at resolution (rule R5).
 *
 * Nothing here invents an objective. `classifyHeadline()` triages what a human
 * must still do; `validateCardInput()` decides whether what they wrote is enough.
 */
import { gate, hasObservableSignal, evaluateObservable } from './gate.js';
import { cohenKappa } from './stats.js';

export const RESOLUTION_SOURCES = Object.freeze(['ACLED', 'IPC', 'UNHCR', 'IMF', 'official_decree']);
const ISO3 = /^[A-Z]{3}$/;

/**
 * Keyword suggestions only. An empty list means "a human decides"; a suggestion
 * is a starting point for the author, never a filled-in field.
 * @param {string} text
 * @returns {string[]}
 */
export function suggestSources(text) {
  const t = String(text || '').toLowerCase();
  const out = [];
  if (/\b(ipc|famine|food insecurity|food security|acute malnutrition|hunger|harvest|drought|crop)\b/.test(t)) out.push('IPC');
  if (/\b(displace\w*|refugee\w*|returnee\w*|returns?|asylum|idp\w*|border crossing\w*|deport\w*|repatriat\w*)\b/.test(t)) out.push('UNHCR');
  if (/\b(inflation|exchange rate|currency|gdp|debt|imf|fiscal|budget deficit|devaluation|sovereign|reserves)\b/.test(t)) out.push('IMF');
  if (/\b(clash\w*|attack\w*|fatalit\w*|killed|violence|conflict|offensive|insurgen\w*|militant\w*|protest\w*|riot\w*|coup|airstrike\w*|shelling|hostilit\w*|armed group\w*)\b/.test(t)) out.push('ACLED');
  if (/\b(decree|law|ban\w*|suspension|suspend\w*|sanction\w*|election\w*|referendum|ceasefire|martial law|state of emergency)\b/.test(t)) out.push('official_decree');
  return out;
}

/**
 * Where a compound statement could be cut into single-claim cards. Suggestions
 * for the human; nothing is split automatically.
 * @param {string} statement
 * @returns {string[]}
 */
export function suggestSplit(statement) {
  const parts = String(statement || '')
    .split(/\s*;\s*|,?\s+(?:as well as|and also|along with)\s+/i)
    .map((s) => s.trim().replace(/[.,]$/, ''))
    .filter((s) => s.length > 12);
  return parts.length > 1 ? parts : [];
}

/**
 * What kind of "objective" text did ACAPS write? Heuristic and labelled as such.
 * `retrospective` text states an outcome that had already happened when it was
 * written, so it cannot serve as a criterion fixed in advance.
 * @param {string} text
 * @returns {'none' | 'no_threshold' | 'yes_no_note' | 'retrospective' | 'candidate'}
 */
export function objectiveKind(text) {
  const t = String(text || '').trim();
  if (!t) return 'none';
  if (/\bno specific threshold\b/i.test(t)) return 'no_threshold';
  if (/^(yes|no)\b[.:,]?/i.test(t)) return 'yes_no_note';
  if (/\b(approved|announced|reported|recorded|increased to|decreased to|rose to|fell to|were|was|had|has been|have been)\b|\bas of\b|\b(?:in|by|since)\s+(?:january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{4}\b/i.test(t)) return 'retrospective';
  return 'candidate';
}

/**
 * Triage one headline or trigger for a human author.
 * @param {{ statement: string, objective?: string }} item
 * @returns {{ status: 'needs_rewrite' | 'needs_threshold' | 'needs_objective', blockers: string[], missing: string[], sources: string[], split: string[], objectiveKind: string }}
 */
export function classifyHeadline({ statement, objective = '' }) {
  // A placeholder window removes the window blocker: dates are the author's to set, not ours.
  const g = gate({ statement, window: { from: '2000-01-01', to: '2000-01-02' }, objective });
  // The placeholder window is in the past, so the gate's window check (C1) would
  // always fire on it; the window blocker is the author's to resolve, not triage's.
  const blockers = g.blockers.filter((b) => b.check !== 'window').map((b) => `${b.check}: ${b.reason}`);
  const signal = hasObservableSignal(statement, objective);
  /** @type {string[]} */
  const missing = ['window', 'objective', 'resolution source', 'resolver'];
  if (!signal) missing.unshift('measurable threshold or event');
  const status = blockers.length ? 'needs_rewrite' : signal ? 'needs_objective' : 'needs_threshold';
  return {
    status, blockers, missing,
    sources: suggestSources(`${statement} ${objective}`),
    split: g.blockers.some((b) => b.check === 'single') ? suggestSplit(statement) : [],
    objectiveKind: objectiveKind(objective),
  };
}

/**
 * The one test for "may this card open". Returns problems instead of throwing,
 * so a batch import can report every row.
 * @param {Record<string, any>} input
 * @returns {{ ok: boolean, problems: string[], warnings: string[], card: Record<string, any> }}
 */
export function validateCardInput(input) {
  const problems = [];
  const c = { ...input };
  const text = (v) => (typeof v === 'string' ? v.trim() : '');
  const country = text(c.country).toUpperCase();
  if (!ISO3.test(country)) problems.push('country must be an ISO 3-letter code (like TCD)');
  c.country = country;
  if (!text(c.resolver)) problems.push('a named resolver is required');
  if (!RESOLUTION_SOURCES.includes(c.resolutionSource)) problems.push(`resolutionSource must be one of ${RESOLUTION_SOURCES.join(', ')}`);
  if (!text(c.objective)) problems.push('a written objective (what counts as yes) is required before a card opens');
  const g = gate({ statement: c.statement, window: c.window, objective: c.objective });
  for (const b of g.blockers) problems.push(`gate ${b.check}: ${b.reason}`);
  return { ok: problems.length === 0, problems, warnings: g.warnings.map((w) => `${w.check}: ${w.reason}`), card: c };
}

export const WORKLIST_HEADER = Object.freeze([
  'id', 'kind', 'risk_id', 'country', 'prospective', 'acaps_probability', 'statement', 'description',
  'acaps_objective', 'acaps_objective_kind', 'status', 'missing', 'blockers', 'suggested_sources', 'suggested_split',
  // The author's columns. Everything above is triage; everything below is a human decision.
  'author_statement', 'author_window_from', 'author_window_to', 'author_objective', 'author_source', 'author_resolver',
]);

/**
 * Turn the ingested export into a worklist for human authors: one row per risk
 * headline and per trigger, each triaged and with the fields a person must fill
 * left empty. Deterministic: no clock, no randomness.
 * @param {Array<Record<string, any>>} blocks the ingested risk blocks (data/risk-radar.json)
 */
export function buildWorklist(blocks) {
  /** @type {Array<Record<string, string>>} */
  const rows = [];
  for (const b of blocks) {
    if (!b.title) continue;
    const prospective = b.status === 'Active' ? 'yes' : 'no';
    const push = (id, kind, statement, description, objective) => {
      const c = classifyHeadline({ statement, objective });
      rows.push({
        id, kind, risk_id: b.id, country: b.iso || '', prospective, acaps_probability: b.probability || '',
        statement, description, acaps_objective: objective, acaps_objective_kind: c.objectiveKind,
        status: c.status, missing: c.missing.join('; '), blockers: c.blockers.join('; '),
        suggested_sources: c.sources.join('; '), suggested_split: c.split.join(' | '),
        author_statement: '', author_window_from: '', author_window_to: '', author_objective: '', author_source: '', author_resolver: '',
      });
    };
    push(b.id, 'risk', b.title, '', '');
    for (const t of b.triggerList || []) push(t.fullId, 'trigger', t.title || '', t.description || '', t.objective || '');
  }
  return rows;
}

/**
 * Counts for the summary. `prospective` rows are the ones under Active risks,
 * which are the ones a live trial can still score.
 * @param {Array<Record<string, string>>} rows
 */
export function summariseWorklist(rows) {
  const tally = (list) => {
    const out = { total: list.length, needs_rewrite: 0, needs_threshold: 0, needs_objective: 0, with_source_suggestion: 0 };
    for (const r of list) {
      out[r.status] += 1;
      if (r.suggested_sources) out.with_source_suggestion += 1;
    }
    return out;
  };
  const objectiveKinds = {};
  for (const r of rows.filter((x) => x.kind === 'trigger')) objectiveKinds[r.acaps_objective_kind] = (objectiveKinds[r.acaps_objective_kind] || 0) + 1;
  return {
    risks: tally(rows.filter((r) => r.kind === 'risk')),
    triggers: tally(rows.filter((r) => r.kind === 'trigger')),
    prospectiveRisks: tally(rows.filter((r) => r.kind === 'risk' && r.prospective === 'yes')),
    prospectiveTriggers: tally(rows.filter((r) => r.kind === 'trigger' && r.prospective === 'yes')),
    triggerObjectiveKinds: Object.fromEntries(Object.entries(objectiveKinds).sort()),
    openable: 0,
    note: 'openable is 0 until a human fills the author_* columns and the importer accepts the row. No script writes an objective.',
  };
}

/**
 * Read a filled worklist: validate every row a person touched with the SAME rule
 * the service applies, and report all problems at once.
 * @param {Array<Record<string, string>>} rows
 */
export function importAuthored(rows) {
  const accepted = [];
  const rejected = [];
  let untouched = 0;
  for (const r of rows) {
    const touched = ['author_statement', 'author_window_from', 'author_window_to', 'author_objective', 'author_source', 'author_resolver']
      .some((k) => String(r[k] || '').trim() !== '');
    if (!touched) { untouched++; continue; }
    const input = {
      id: r.id,
      statement: String(r.author_statement || r.statement || '').trim(),
      country: r.country,
      window: { from: String(r.author_window_from || '').trim(), to: String(r.author_window_to || '').trim() },
      objective: String(r.author_objective || '').trim(),
      resolutionSource: String(r.author_source || '').trim(),
      resolver: String(r.author_resolver || '').trim(),
      probability: r.acaps_probability || undefined,
    };
    const v = validateCardInput(input);
    if (v.ok) accepted.push({ ...input, country: v.card.country, warnings: v.warnings });
    else rejected.push({ id: r.id, problems: v.problems });
  }
  return { accepted, rejected, untouched };
}

/**
 * Score two raters' labels of "is this resolvable as written by an external
 * source by a date?" and, only if they agree enough, the lexical `observable`
 * check against their consensus. Refuses to produce a number from raters who
 * disagree: adjudicate first.
 * @param {Array<{ id: string, statement: string, objective?: string, rater_a: string, rater_b: string }>} rows
 * @param {number} [minKappa]
 */
export function scoreRaters(rows, minKappa = 0.6) {
  const VALID = new Set(['resolvable', 'needs_criterion']);
  const labelled = rows.filter((r) => r.rater_a || r.rater_b);
  const incomplete = labelled.filter((r) => !VALID.has(r.rater_a) || !VALID.has(r.rater_b)).map((r) => r.id);
  if (labelled.length === 0) return { ok: false, reason: 'no labelled rows' };
  if (incomplete.length) return { ok: false, reason: `both raters must label every row with resolvable or needs_criterion; incomplete: ${incomplete.slice(0, 10).join(', ')}` };
  const k = cohenKappa(labelled.map((r) => r.rater_a), labelled.map((r) => r.rater_b));
  const disagreements = labelled.filter((r) => r.rater_a !== r.rater_b).map((r) => r.id);
  if (!k || k.kappa < minKappa) {
    return { ok: false, reason: `raters agree too little (kappa ${k ? k.kappa.toFixed(2) : 'undefined'} < ${minKappa}); adjudicate the ${disagreements.length} disagreements first`, kappa: k, disagreements };
  }
  const consensus = labelled.filter((r) => r.rater_a === r.rater_b)
    .map((r) => ({ id: r.id, statement: r.statement, objective: r.objective || '', resolvableAsWritten: r.rater_a === 'resolvable' }));
  return { ok: true, kappa: k, disagreements, n: consensus.length, consensus, result: evaluateObservable(consensus) };
}
