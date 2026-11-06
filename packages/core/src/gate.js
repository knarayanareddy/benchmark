/**
 * The Gate — five deterministic pre-checks on a risk statement.
 * Crude heuristics, and honest about being crude: this catches the failures a
 * mechanical reader can catch, and the expert's assumptions checklist catches
 * the rest. See docs/01: the gate is the difference between a forecast and an
 * opinion, and it must reject at least one real statement from the export.
 */

export const CHECKS = ['window', 'observable', 'single', 'no_leak', 'condition'];

const LEAK = [
  /\bexpected to\b/i, /\bto worsen\b/i, /\bfurther deterioration\b/i,
  /\balready deteriorating\b/i, /\bto increase\b/i, /\bto be revised\b/i,
  /\bcontinued deterioration\b/i, /\blikely to escalate\b/i,
];

const INTENT = [/\bwill continue to\b/i, /\bintends?\b/i, /\bplans? to\b/i, /\baims? to\b/i];

const VAGUE = [/\bdeteriorat/i, /\bworsen/i, /\bdestabilis/i, /\bdeteriorat/i];

export function gate(card) {
  const t = String(card.statement || '');
  const results = [];

  const hasWindow = Boolean(card.window?.from && card.window?.to);
  results.push(fail('window', hasWindow, 'no explicit resolution window'));

  // Observable: a measurable quantity OR a defined event. A bare claim of
  // "worsening" with neither cannot be resolved by anyone.
  const measurable = /\d|%|per cent|number of|reported|recorded|classified|phase\s?[1-5]|IPC|\b(?:election|ceasefire|offensive|closure|ban|harvest|expulsion|deportation|outbreak|famine declaration)\b/i.test(t);
  const onlyVague = VAGUE.some((r) => r.test(t)) && !measurable;
  results.push(fail('observable', measurable || !onlyVague, 'outcome is not observable — no quantity or defined event'));

  // Single risk. NOTE: a plain "and" is NOT evidence of two risks — real ACAPS
  // titles are full of it ("worsens drought and leads to agricultural losses").
  // An earlier version split on bare "and" and flagged 43% of the corpus, which
  // is a false-positive rate no reviewer would accept. Only STRONG conjunction
  // markers count, and anything ambiguous goes to the expert's checklist instead.
  const strongConj = /(?:\bas well as\b|\balongside\b|;|\band also\b|\band furthermore\b)/i;
  results.push(fail('single', !strongConj.test(t), 'looks like two risks joined by a strong conjunction'));

  const leaked = LEAK.find((r) => r.test(t));
  results.push(fail('no_leak', !leaked, `outcome-leaking language: "${leaked?.source ?? ''}"`));

  const intent = INTENT.find((r) => r.test(t));
  results.push(fail('condition', !intent, `statement of intent rather than condition: "${intent?.source ?? ''}"`));

  return {
    ok: results.every((r) => r.ok),
    failed: results.filter((r) => !r.ok).map((r) => ({ check: r.check, reason: r.reason })),
    results,
  };
}

function fail(check, ok, reason) {
  return { check, ok, reason: ok ? null : reason };
}

/** Remove leaking language from the card the expert sees; keep the original for audit. */
export function decontaminate(card) {
  let s = String(card.statement || '');
  for (const r of LEAK) s = s.replace(r, '');
  return { ...card, statement: s.replace(/\s{2,}/g, ' ').trim(), original: card.statement };
}
