/**
 * The Gate — five deterministic pre-checks on a risk statement, separated into
 * hard structural blockers (`SEVERITY.BLOCKER`) and heuristic authoring
 * warnings (`SEVERITY.WARNING`).
 *
 *   Blockers (`dispatchable: false` when any fail):
 *     1. `window` — requires real calendar dates (`from` <= `to`), never
 *        arbitrary strings like risk IDs or status labels.
 *     3. `single` — catches bundled compound statements (`as well as`, `;`,
 *        etc.) without rejecting ACAPS' standard `Hazard -> Impact` framing.
 *     4. `no_leak` — catches outcome-leaking phrasing (`expected to`, `further
 *        deterioration`, etc.).
 *     5. `condition` — catches statements of actor intent rather than
 *        observable external conditions.
 *
 *   Authoring warning (`ok: false`, `dispatchable: true` when only warnings fire):
 *     2. `observable` — lexical heuristic flagging statements that carry
 *        neither a numeric threshold (excluding calendar dates and proper-noun
 *        digits like `COVID-19` or `M23`), an official classification (`IPC
 *        Phase 4`), nor a discrete named event (`election`, `blockade`,
 *        `invasion`), unless a concrete `objective` is attached. Surfaced as a
 *        warning rather than a silent blocker because lexical rules have
 *        non-zero false-warn and false-pass rates on ACLED/humanitarian prose
 *        (measured by `evaluateObservable()` on 50 labelled corpus items).
 */

export const CHECKS = ['window', 'observable', 'single', 'no_leak', 'condition'];

/** A resolution window shorter than this cannot be scored ahead of time. */
export const MIN_WINDOW_DAYS = 1;
/** Longer than this is not a forecast, it is a wish. */
export const MAX_WINDOW_DAYS = 400;
/**
 * A card needs enough horizon for a panel to respond before it closes. Below
 * this many days remaining, the release gate (`MIN_RELEASE_PANEL_SIZE = 5`)
 * cannot fill in time, so the card is created unresolvable.
 */
export const MIN_DAYS_TO_FILL_PANEL = 5;

export const SEVERITY = Object.freeze({
  BLOCKER: 'blocker',
  WARNING: 'warning',
});

export const CHECK_SEVERITY = Object.freeze({
  window: SEVERITY.BLOCKER,
  observable: SEVERITY.WARNING,
  single: SEVERITY.BLOCKER,
  no_leak: SEVERITY.BLOCKER,
  condition: SEVERITY.BLOCKER,
});

const LEAK = [
  /\bexpected to\b/gi,
  /\bto worsen\b/gi,
  /\bfurther deterioration\b/gi,
  /\balready deteriorating\b/gi,
  /\bto increase\b/gi,
  /\bto be revised\b/gi,
  /\bcontinued deterioration\b/gi,
  /\blikely to escalate\b/gi,
];

const INTENT = [/\bwill continue to\b/i, /\bintends?\b/i, /\bplans? to\b/i, /\baims? to\b/i];

const NON_QUANTITY_TOKENS = [
  /\b(?:COVID-19|SARS-CoV-2|M23|G7|G20|COP\d+|H\dN\d)\b/gi,
  /\b\d{1,2}[-/]\d{1,2}[-/](?:19|20)\d{2}\b/g,
  /\b(?:19|20)\d{2}[-/]\d{1,2}(?:[-/]\d{1,2})?\b/g,
  /\b(?:january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{1,2}(?:,?\s+(?:19|20)\d{2})?\b/gi,
  /\b\d{1,2}\s+(?:january|february|march|april|may|june|july|august|september|october|november|december)(?:\s+(?:19|20)\d{2})?\b/gi,
  /\b(?:in|by|before|after|since|during|from|until|through|early|mid|late|january|february|march|april|may|june|july|august|september|october|november|december)\s+(?:19|20)\d{2}\b/gi,
];

const EMPTY_OBJECTIVE_PLACEHOLDER =
  /^(?:no|none|n\/?a|nil|tbd|-|\?)\.?$|\bno specific threshold\b/i;

const MEASURABLE_OR_EVENT =
  /\d|%|per cent|number of|reported|recorded|classified|declared|phase\s?[1-5]|\bIPC\b|\b(?:elections?|polls|referendums?|coups?|ceasefires?|offensives?|invasions?|sieges?|blockades?|closures?|blocked|boycotts?|hartals?|suspensions?|bans?|freezes?|expulsions?|deportations?|outbreaks?|epidemics?|cholera|measles|ebola|mpox|cyclones?|typhoons?|hurricanes?|earthquakes?|volcan\w+|landslides?|floods?|flooding|droughts?|harvests?|famines?)\b/i;

function stripNonQuantityDigits(text) {
  let out = text;
  for (const re of NON_QUANTITY_TOKENS) {
    out = out.replace(re, ' ');
  }
  return out;
}

/**
 * Parse a resolution date. ISO (`YYYY-MM-DD`, `YYYY-MM`) is unambiguous; the
 * ACAPS export's `DD-MM-YYYY` is only accepted when the day exceeds 12,
 * because `01-02-2027` means 1 February to ACAPS and 2 January to most
 * readers, and silently picking one is how a window moves by eleven months.
 */
function parseWindowDate(raw) {
  if (typeof raw !== 'string') return null;
  const s = raw.trim();
  // ISO YYYY-MM-DD or YYYY-MM
  let m = /^(\d{4})-(\d{2})(?:-(\d{2}))?$/.exec(s);
  if (m) {
    const year = Number(m[1]);
    const month = Number(m[2]);
    const day = m[3] ? Number(m[3]) : 1;
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    const ts = Date.UTC(year, month - 1, day);
    const d = new Date(ts);
    if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) {
      return null;
    }
    return ts;
  }
  // ACAPS export DD-MM-YYYY or DD/MM/YYYY — ambiguous when both parts are <= 12,
  // so require the day to be unambiguous (13..31).
  m = /^(\d{2})[-/](\d{2})[-/](\d{4})$/.exec(s);
  if (m) {
    const day = Number(m[1]);
    const month = Number(m[2]);
    const year = Number(m[3]);
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    if (day <= 12 && month <= 12) return null; // ambiguous DD/MM vs MM/DD
    const ts = Date.UTC(year, month - 1, day);
    const d = new Date(ts);
    if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) {
      return null;
    }
    return ts;
  }
  return null;
}

export function hasObservableSignal(statement, objective = '') {
  const s = String(statement || '').trim();
  if (!s) return false;
  const obj = String(objective || '').trim();
  // If ACAPS explicitly recorded "No specific threshold present", treat that
  // analyst annotation as authoritative over a bare "Number of..." noun phrase.
  if (/\bno specific threshold\b/i.test(obj)) return false;
  const usableObj = obj && !EMPTY_OBJECTIVE_PLACEHOLDER.test(obj) ? obj : '';
  const combined = usableObj ? `${s} ${usableObj}` : s;
  const scrubbed = stripNonQuantityDigits(combined);
  return MEASURABLE_OR_EVENT.test(scrubbed);
}

export function gate(card, opts = {}) {
  const now = opts.now === undefined ? Date.now() : Number(opts.now);
  if (!Number.isFinite(now)) {
    throw new RangeError(`gate() option now must be a finite epoch-ms number, got ${JSON.stringify(opts.now)}`);
  }
  const maxWindowDays = opts.maxWindowDays === undefined ? MAX_WINDOW_DAYS : opts.maxWindowDays;
  const minWindowDays = opts.minWindowDays === undefined ? MIN_WINDOW_DAYS : opts.minWindowDays;
  if (!Number.isFinite(maxWindowDays) || maxWindowDays <= 0) {
    throw new RangeError(`gate() option maxWindowDays must be a positive number, got ${JSON.stringify(opts.maxWindowDays)}`);
  }

  const isObj = card !== null && typeof card === 'object';
  const statement = isObj ? card.statement : card;
  if (!String(statement || '').trim()) {
    const emptyFailure = {
      check: 'observable',
      severity: SEVERITY.BLOCKER,
      reason: 'statement is empty',
    };
    return {
      ok: false,
      dispatchable: false,
      scoreable: false,
      problems: ['statement is empty'],
      blockers: [emptyFailure],
      warnings: [],
      failed: [emptyFailure],
      results: [{ check: 'observable', severity: SEVERITY.BLOCKER, ok: false, reason: 'statement is empty' }],
      window: null,
    };
  }
  const t = String(statement || '');
  const objective = isObj && typeof card.objective === 'string' ? card.objective.trim() : '';
  const results = [];

  const fromTs = isObj ? parseWindowDate(card.window?.from) : null;
  const toTs = isObj ? parseWindowDate(card.window?.to) : null;
  const hasValidDates = fromTs !== null && toTs !== null;
  const spanDays = hasValidDates ? (toTs - fromTs) / 86400000 : null;
  const windowReason = !hasValidDates
    ? 'no explicit resolution window (valid from/to dates required)'
    : toTs <= fromTs
    ? 'resolution window ends on or before it starts'
    : spanDays < minWindowDays
    ? `resolution window shorter than ${minWindowDays} day(s) — too short to forecast into`
    : spanDays > maxWindowDays
    ? `resolution window longer than ${maxWindowDays} days — not a forecastable card`
    : toTs < now
    ? 'resolution window has already closed — this card cannot be scored prospectively'
    : null;
  results.push(record('window', windowReason === null, windowReason));

  // A card created with less runway than the release gate needs to reach a
  // panel cannot ever be resolved. Advise rather than block: a short-fuse card
  // is a scheduling mistake, not a malformed forecast, so it is a warning.
  const daysToClose = hasValidDates && windowReason === null ? (toTs - now) / 86400000 : null;
  if (daysToClose !== null && daysToClose < MIN_DAYS_TO_FILL_PANEL) {
    results.push({
      check: 'window',
      severity: SEVERITY.WARNING,
      ok: false,
      reason:
        `only ${daysToClose.toFixed(1)} day(s) until the window closes — the release gate needs ` +
        `${MIN_DAYS_TO_FILL_PANEL}+ days to reach a panel of 5, so this card may be created unresolvable`,
    });
  }

  // Observable: authoring warning (SEVERITY.WARNING) when neither statement nor
  // objective names a numeric threshold, official classification, or discrete
  // verifiable event. Keeps `ok: false` until an objective is attached, while
  // allowing `dispatchable: true` with a visible warning banner once blockers pass.
  const hasObservable = hasObservableSignal(t, objective);
  results.push(
    record(
      'observable',
      hasObservable,
      'outcome lacks an explicit threshold, event, or written objective (warn: attach objective before resolution)'
    )
  );

  // Single risk. Plain "and" or ACAPS' standard `Hazard -> Impact` causal
  // framing ("X leads to Y") is not two independent risks; strong compound
  // conjunctions (`as well as`, `alongside`, `;`, `and also`) flag bundled cards.
  const strongConj = /(?:\bas well as\b|\balongside\b|;|\band also\b|\band furthermore\b)/i;
  results.push(
    record('single', !strongConj.test(t), 'looks like two risks joined by a strong conjunction')
  );

  const leaked = LEAK.find((r) => Boolean(t.match(r)));
  results.push(record('no_leak', !leaked, `outcome-leaking language: "${leaked?.source ?? ''}"`));

  const intent = INTENT.find((r) => r.test(t));
  results.push(
    record('condition', !intent, `statement of intent rather than condition: "${intent?.source ?? ''}"`)
  );

  const failed = results
    .filter((r) => !r.ok)
    .map((r) => ({ check: r.check, severity: r.severity, reason: r.reason }));
  const blockers = failed.filter((f) => f.severity === SEVERITY.BLOCKER);
  const warnings = failed.filter((f) => f.severity === SEVERITY.WARNING);

  // Three distinct questions, deliberately not collapsed (Rule R5):
  //   ok           — every check passed, warnings included
  //   dispatchable — no hard structural blocker; the card may be shown
  //   scoreable    — dispatchable AND resolvable against a written criterion
  // `observable` is a warning because the lexical rule has a 22% false-warn
  // rate on real ACLED prose. That is a reason not to *block*, not a reason to
  // score a card whose resolution nobody wrote down — 101 of 139 scored triggers
  // in the live export have no objective.
  const dispatchable = blockers.length === 0;

  return {
    ok: failed.length === 0,
    dispatchable,
    scoreable: dispatchable && hasObservable,
    blockers,
    warnings,
    failed,
    results,
    window: hasValidDates
      ? { from: new Date(fromTs).toISOString().slice(0, 10), to: new Date(toTs).toISOString().slice(0, 10), spanDays }
      : null,
  };
}

function record(check, ok, reason) {
  return {
    check,
    severity: CHECK_SEVERITY[check],
    ok,
    reason: ok ? null : reason,
  };
}

/**
 * Evaluate the lexical `observable` heuristic against analyst-labelled items.
 *
 * Each item is `{ id, statement, objective?, resolvableAsWritten: boolean }`:
 *   - `tpWarn`: heuristic warns AND label says needs written criterion (`false`)
 *   - `fpWarn`: heuristic warns BUT label says resolvable as written (`true`)
 *   - `tnPass`: heuristic passes AND label says resolvable as written (`true`)
 *   - `fnPass`: heuristic passes BUT label says needs written criterion (`false`)
 */
export function evaluateObservable(examples) {
  if (!Array.isArray(examples) || examples.length === 0) {
    throw new TypeError('examples must be a non-empty array of labelled statements');
  }
  let tpWarn = 0;
  let fpWarn = 0;
  let tnPass = 0;
  let fnPass = 0;
  const disagreements = [];

  for (const ex of examples) {
    if (typeof ex?.resolvableAsWritten !== 'boolean') {
      throw new TypeError(`example ${ex?.id ?? '<unnamed>'} must declare boolean resolvableAsWritten`);
    }
    const predictedPass = hasObservableSignal(ex.statement, ex.objective);
    if (!predictedPass && !ex.resolvableAsWritten) {
      tpWarn++;
    } else if (!predictedPass && ex.resolvableAsWritten) {
      fpWarn++;
      disagreements.push({ id: ex.id, kind: 'false_warn', statement: ex.statement });
    } else if (predictedPass && ex.resolvableAsWritten) {
      tnPass++;
    } else {
      fnPass++;
      disagreements.push({ id: ex.id, kind: 'false_pass', statement: ex.statement });
    }
  }

  const n = examples.length;
  const totalWarns = tpWarn + fpWarn;
  const totalPasses = tnPass + fnPass;
  const totalNeedsObjective = tpWarn + fnPass;

  return {
    n,
    tpWarn,
    fpWarn,
    tnPass,
    fnPass,
    warnPrecision: totalWarns ? tpWarn / totalWarns : null,
    passPrecision: totalPasses ? tnPass / totalPasses : null,
    warnRecall: totalNeedsObjective ? tpWarn / totalNeedsObjective : null,
    falseWarnRate: n - totalNeedsObjective > 0 ? fpWarn / (n - totalNeedsObjective) : null,
    accuracy: (tpWarn + tnPass) / n,
    disagreements,
  };
}

/**
 * Explicitly redact outcome-leaking phrases with `[…]` and flag the card for
 * human analyst rewrite (`needsAnalystRewrite: true`), preserving `original`
 * for audit. Never silently deletes words to emit broken grammar ("Prices are
 * increase", "stokes a of food security") as if it were clean prose.
 */
export function decontaminate(card) {
  const original = String(card?.statement || '');
  const spans = [];

  for (const r of LEAK) {
    const flags = r.flags.includes('g') ? r.flags : `${r.flags}g`;
    const re = new RegExp(r.source, flags);
    let m;
    while ((m = re.exec(original)) !== null) {
      spans.push([m.index, m.index + m[0].length]);
    }
  }

  if (spans.length === 0) {
    return {
      ...card,
      statement: original.replace(/\s{2,}/g, ' ').trim(),
      original,
      redactedPhrases: [],
      needsAnalystRewrite: false,
    };
  }

  // Sort and merge overlapping or whitespace-adjacent leak spans on `original`
  // so compound leaks like "expected to increase" or "expected to worsen" are
  // redacted as one clean unit rather than mutating the string mid-pass.
  spans.sort((a, b) => a[0] - b[0] || b[1] - a[1]);
  const merged = [spans[0]];
  for (let i = 1; i < spans.length; i++) {
    const prev = merged[merged.length - 1];
    const cur = spans[i];
    const between = original.slice(prev[1], cur[0]);
    if (cur[0] <= prev[1] || /^\s*$/.test(between)) {
      prev[1] = Math.max(prev[1], cur[1]);
    } else {
      merged.push(cur);
    }
  }

  const redactedPhrases = merged.map(([s, e]) => original.slice(s, e));
  let out = '';
  let cursor = 0;
  for (const [s, e] of merged) {
    out += original.slice(cursor, s) + '[…]';
    cursor = e;
  }
  out += original.slice(cursor);

  return {
    ...card,
    statement: out.replace(/\s{2,}/g, ' ').trim(),
    original,
    redactedPhrases,
    needsAnalystRewrite: true,
  };
}
