/**
 * Publication credit (docs/09-roundtable-and-credit.md, Part B): the state machine and the
 * validators. Pure: no storage, no clock, no I/O.
 */
import { identifyingHints } from './anonymity.js';

export const COOLING_OFF_MS = 48 * 3600 * 1000;
export const CHECKLIST = Object.freeze(['noThirdParties', 'noLocationDetail', 'riskUnderstood']);
export const DECISIONS = Object.freeze(['decline', 'uncredited', 'credited']);
export const TEXT_MAX = 2000;

export const STATUS = Object.freeze({
  PROPOSED: 'proposed',
  CONSENTED: 'consented',
  APPROVED: 'approved',
  PUBLISHED: 'published',
  DECLINED: 'declined',
  REJECTED: 'rejected',
  WITHDRAWN: 'withdrawn',
});

export const TRANSITIONS = Object.freeze({
  [STATUS.PROPOSED]: Object.freeze([STATUS.CONSENTED, STATUS.DECLINED, STATUS.WITHDRAWN]),
  [STATUS.CONSENTED]: Object.freeze([STATUS.APPROVED, STATUS.REJECTED, STATUS.WITHDRAWN]),
  [STATUS.APPROVED]: Object.freeze([STATUS.PUBLISHED, STATUS.WITHDRAWN]),
  [STATUS.PUBLISHED]: Object.freeze([STATUS.WITHDRAWN]),
  [STATUS.DECLINED]: Object.freeze([]),
  [STATUS.REJECTED]: Object.freeze([]),
  [STATUS.WITHDRAWN]: Object.freeze([]),
});

/** @param {string} from @param {string} to */
export function canTransition(from, to) {
  return Object.prototype.hasOwnProperty.call(TRANSITIONS, from) && TRANSITIONS[from].includes(to);
}

const fail = (problems) => ({ ok: false, problems, value: null });

/**
 * The author's choice. `credited` may name a role; `uncredited` may not carry any identifying hint.
 * @param {Record<string, any>} [input]
 * @param {{ sensitive?: boolean }} [opts]
 */
export function validateResponse(input = {}, { sensitive = false } = {}) {
  const decision = input?.decision;
  if (!DECISIONS.includes(decision)) return fail(['decision must be decline, uncredited or credited']);
  if (decision === 'decline') return { ok: true, problems: [], value: { decision, text: null, credit: null } };

  const problems = [];
  const text = typeof input.text === 'string' ? input.text.trim() : '';
  if (text.length < 1 || text.length > TEXT_MAX) problems.push(`text must be 1 to ${TEXT_MAX} characters`);

  if (decision === 'uncredited') {
    if (identifyingHints(text).length > 0) {
      problems.push('the text contains a detail that could identify you; remove it, or choose to be credited');
    }
    return problems.length ? fail(problems) : { ok: true, problems, value: { decision, text, credit: { mode: 'uncredited' } } };
  }

  const displayName = typeof input.displayName === 'string' ? input.displayName.trim() : '';
  if (displayName.length < 2 || displayName.length > 80) problems.push('displayName must be 2 to 80 characters');
  const organisation = typeof input.organisation === 'string' ? input.organisation.trim() : '';
  if (organisation.length > 120) problems.push('organisation must be at most 120 characters');
  if (sensitive && input.acknowledgedRisk !== true) {
    problems.push('this card is in a sensitive country: confirm that you accept the risk of being named (acknowledgedRisk)');
  }
  if (problems.length) return fail(problems);
  return {
    ok: true,
    problems,
    value: { decision, text, credit: { mode: 'credited', displayName, organisation: organisation || null } },
  };
}

/**
 * A moderator's safety review. Approval needs every checklist item ticked; rejection needs a note.
 * @param {Record<string, any>} [input]
 */
export function validateReview(input = {}) {
  const approve = input?.approve;
  if (typeof approve !== 'boolean') return fail(['approve must be true or false']);
  if (approve) {
    const checked = input.checked ?? {};
    const missing = CHECKLIST.filter((k) => checked[k] !== true);
    if (missing.length) return fail([`approval needs every checklist item ticked: ${missing.join(', ')}`]);
    return { ok: true, problems: [], value: { approve: true, note: null } };
  }
  const note = typeof input.note === 'string' ? input.note.trim() : '';
  if (note.length < 1 || note.length > 300) return fail(['a rejection needs a note of 1 to 300 characters']);
  return { ok: true, problems: [], value: { approve: false, note } };
}

/** What the public sees, and nothing else. */
export function publicView(pub) {
  const c = pub.credit;
  const creditLine = c?.mode === 'credited'
    ? (c.organisation ? `${c.displayName}, ${c.organisation}` : c.displayName)
    : null;
  return { id: pub.id, text: pub.text, creditLine, cardStatement: pub.cardStatement, country: pub.country, day: pub.day };
}

/**
 * The record that remains after withdrawal or decline: the text, the credit and the statement are
 * gone. Only the keys the database needs (and the version for compare-and-set) are kept.
 */
const KEPT = ['expertId', 'sourceKind', 'sourceId', 'cardId', 'proposer', 'reviewer'];
export function erasedRecord(pub, { status, day, version }) {
  const out = { id: pub.id, status, day, version };
  for (const k of KEPT) out[k] = pub[k] ?? null;
  return out;
}
