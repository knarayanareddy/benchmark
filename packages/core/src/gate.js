/**
 * The Gate — five deterministic pre-checks on a risk statement.
 *
 * Honest about what mechanical rules can and cannot catch:
 *   1. `window` requires real calendar dates (`from` <= `to`), never arbitrary
 *      strings like risk IDs or status labels.
 *   2. `observable` requires an explicit quantity, official classification, or
 *      discrete verifiable event in the statement or its attached `objective`
 *      — unanchored directional prose ("increased violence", "escalating
 *      insecurity") fails until a resolution criterion is written.
 *   3. `single` catches bundled compound statements (`as well as`, `;`, etc.)
 *      without rejecting ACAPS' standard `Hazard -> Humanitarian Impact`
 *      causal framing ("X leads to Y").
 *   4. `no_leak` catches outcome-leaking phrasing (`expected to`, `further
 *      deterioration`, etc.).
 *   5. `condition` catches statements of actor intent rather than observable
 *      external conditions.
 */

export const CHECKS = ['window', 'observable', 'single', 'no_leak', 'condition'];

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

const MEASURABLE_OR_EVENT =
  /\d|%|per cent|number of|reported|recorded|classified|declared|phase\s?[1-5]|\bIPC\b|\b(?:election|polls|referendum|coup|ceasefire|offensive|siege|blockade|closure|blocked|suspension|ban|freeze|expulsion|deportation|outbreak|epidemic|cholera|measles|ebola|mpox|cyclone|typhoon|hurricane|earthquake|volcan\w+|landslides?|floods?|flooding|drought|harvest|famine)\b/i;

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
  // ACAPS export DD-MM-YYYY or DD/MM/YYYY
  m = /^(\d{2})[-/](\d{2})[-/](\d{4})$/.exec(s);
  if (m) {
    const day = Number(m[1]);
    const month = Number(m[2]);
    const year = Number(m[3]);
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    const ts = Date.UTC(year, month - 1, day);
    const d = new Date(ts);
    if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) {
      return null;
    }
    return ts;
  }
  return null;
}

export function gate(card) {
  const isObj = card !== null && typeof card === 'object';
  const statement = isObj ? card.statement : card;
  if (!String(statement || '').trim()) {
    return {
      ok: false,
      problems: ['statement is empty'],
      failed: [{ check: 'observable', reason: 'statement is empty' }],
      results: [{ check: 'observable', ok: false, reason: 'statement is empty' }],
    };
  }
  const t = String(statement || '');
  const objective = isObj && typeof card.objective === 'string' ? card.objective.trim() : '';
  const results = [];

  const fromTs = isObj ? parseWindowDate(card.window?.from) : null;
  const toTs = isObj ? parseWindowDate(card.window?.to) : null;
  const hasValidDates = fromTs !== null && toTs !== null;
  const windowReason = !hasValidDates
    ? 'no explicit resolution window (valid from/to dates required)'
    : toTs < fromTs
    ? 'resolution window ends before it starts'
    : null;
  results.push(fail('window', windowReason === null, windowReason));

  // Observable: requires an explicit measurable quantity, classification, or
  // discrete verifiable event in either the statement or an attached written
  // resolution `objective` — never passes merely because vague verbs are absent.
  const combined = objective ? `${t} ${objective}` : t;
  const hasObservable = MEASURABLE_OR_EVENT.test(combined);
  results.push(
    fail(
      'observable',
      hasObservable,
      'outcome is not observable — no quantity, defined event, or written objective'
    )
  );

  // Single risk. Plain "and" or ACAPS' standard `Hazard -> Impact` causal
  // framing ("X leads to Y") is not two independent risks; strong compound
  // conjunctions (`as well as`, `alongside`, `;`, `and also`) flag bundled cards.
  const strongConj = /(?:\bas well as\b|\balongside\b|;|\band also\b|\band furthermore\b)/i;
  results.push(
    fail('single', !strongConj.test(t), 'looks like two risks joined by a strong conjunction')
  );

  const leaked = LEAK.find((r) => Boolean(t.match(r)));
  results.push(fail('no_leak', !leaked, `outcome-leaking language: "${leaked?.source ?? ''}"`));

  const intent = INTENT.find((r) => r.test(t));
  results.push(
    fail('condition', !intent, `statement of intent rather than condition: "${intent?.source ?? ''}"`)
  );

  return {
    ok: results.every((r) => r.ok),
    failed: results.filter((r) => !r.ok).map((r) => ({ check: r.check, reason: r.reason })),
    results,
  };
}

function fail(check, ok, reason) {
  return { check, ok, reason: ok ? null : reason };
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
