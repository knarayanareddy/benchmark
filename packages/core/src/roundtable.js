/**
 * The roundtable's post rules: what a discussion post may say, and how long it may be.
 *
 * Pure: no storage, no clock, no I/O. A post that states a number is refused here because
 * Round 2 is measured against an unbroken Round 1, and a number in a post would move
 * everyone else's estimate. It is a guard, not a proof: moderators read every post.
 */
import { containsProbabilityFigure } from './secondlook.js';

export const MAX_TEXT = 600;
export const MAX_POSTS_PER_RESPONDENT = 5;
export const KINDS = Object.freeze(['claim', 'evidence', 'counter', 'question', 'missing_risk', 'reply']);

// "my estimate is", "our forecast was", "my answer would be": a stated figure, in words.
const OWN_NUMBER = /\b(my|our)\s+(answer|estimate|forecast|number|probability)\s+(is|was|would be)\b/i;

/**
 * Collects every problem at once; never throws.
 * @param {{ kind?: unknown, text?: unknown, parentId?: unknown }} input
 * @returns {{ ok: boolean, problems: string[], post: { kind: string, text: string, parentId: string | null } | null }}
 */
export function validatePost(input) {
  const src = input ?? {};
  /** @type {string[]} */
  const problems = [];
  const kind = typeof src.kind === 'string' ? src.kind : '';
  if (!KINDS.includes(kind)) problems.push(`kind must be one of ${KINDS.join(', ')}`);
  const text = typeof src.text === 'string' ? src.text.trim() : '';
  if (text.length < 1 || text.length > MAX_TEXT) problems.push(`text must be 1 to ${MAX_TEXT} characters of text`);
  if (containsProbabilityFigure(text)) problems.push('text must not state a probability, percentage or odds');
  if (OWN_NUMBER.test(text)) problems.push('text must not state your own answer, estimate or forecast as a figure');
  const hasParent = src.parentId !== undefined && src.parentId !== null;
  if (kind === 'reply' && (typeof src.parentId !== 'string' || src.parentId.trim() === '')) {
    problems.push('a reply needs a parentId');
  }
  if (kind !== 'reply' && hasParent) problems.push('only a reply may have a parentId');
  if (problems.length) return { ok: false, problems, post: null };
  return { ok: true, problems, post: { kind, text, parentId: kind === 'reply' ? String(src.parentId).trim() : null } };
}
