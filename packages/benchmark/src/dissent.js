/**
 * The dissent loop — the actual product.
 *
 * An objection is a first-class object with a five-state lifecycle
 * (OPEN -> ROUTED -> ACTIONED -> NOTIFIED -> CLOSED), integrated with
 * expert-controlled anonymity:
 *   - IDENTIFIED / PSEUDONYMOUS dissenters are contactable by ACAPS and
 *     receive a loop-closing notification (`dissent_actioned`) that bypasses
 *     the weekly dispatch cap.
 *   - ANONYMOUS dissenters have their `expert` identifier stripped at creation
 *     (`expert: null, contactable: false`), honouring LEVEL_COPY[ANONYMOUS]'s
 *     promise that they cannot be contacted or traced in analysis; their
 *     objection still routes, actions, and closes on the card.
 */
import {
  LEVELS,
  DEFAULT_LEVEL,
  resolveLevel,
  attribute,
} from '../../core/src/anonymity.js';

export const STATE = Object.freeze({
  OPEN: 'open',
  ROUTED: 'routed',
  ACTIONED: 'actioned',
  CLOSED: 'closed',
  NOTIFIED: 'notified',
});

export const ACTION = Object.freeze({
  REWRITE: 'rewrite',
  SPLIT: 'split',
  RETIRE: 'retire',
  RESOLVE_EARLY: 'resolve_early',
});

export const KIND = Object.freeze({
  TWO_RISKS: 'two_risks',
  WINDOW: 'window',
  ALREADY_HAPPENING: 'already_happening',
  INTENT_NOT_CONDITION: 'intent_not_condition',
});

let seq = 0;

export function newDissent({
  cardId,
  expert,
  name,
  country,
  kind,
  text = '',
  level = DEFAULT_LEVEL,
  salt,
  panelAliases,
  now,
}) {
  if (!Object.values(KIND).includes(kind)) {
    throw new Error(`unknown dissent kind: ${kind}`);
  }
  const resolved = resolveLevel(level);
  // Fail closed to ANONYMOUS when an unrecognised privacy level is passed.
  const effectiveLevel = resolved.honoured ? resolved.level : LEVELS.ANONYMOUS;
  const attributed = attribute(
    { cardId, expertId: expert, name, country, kind, text },
    effectiveLevel,
    { salt, panelAliases }
  );

  const isAnonymous = effectiveLevel === LEVELS.ANONYMOUS;
  const createdAt = now ?? Date.now();

  return {
    id: `d_${++seq}`,
    cardId,
    expert: isAnonymous ? null : (expert ?? null),
    by: attributed.by,
    level: effectiveLevel,
    contactable: !isAnonymous && Boolean(expert),
    kind,
    text,
    status: STATE.OPEN,
    action: null,
    createdAt,
  };
}

/** Route an open dissent into an analyst review queue. */
export function route(dissent, { queue = 'analyst', now } = {}) {
  if (!dissent || dissent.status !== STATE.OPEN) {
    throw new Error(`cannot route dissent in state ${dissent?.status}`);
  }
  return {
    ...dissent,
    status: STATE.ROUTED,
    queue,
    routedAt: now ?? Date.now(),
  };
}

/** Analyst acts. Returns the dissent plus the downstream cards it produced. */
export function act(dissent, action, { newCardIds = [], note = '', now } = {}) {
  if (!Object.values(ACTION).includes(action)) {
    throw new Error(`unknown action: ${action}`);
  }
  if (!dissent || (dissent.status !== STATE.OPEN && dissent.status !== STATE.ROUTED)) {
    throw new Error(`cannot act on dissent in state ${dissent?.status}`);
  }
  return {
    ...dissent,
    action,
    status: STATE.ACTIONED,
    note,
    newCardIds,
    actionedAt: now ?? Date.now(),
  };
}

/**
 * Emit the loop-closing notification for contactable dissenters.
 *
 * Returns `null` if the dissent is not in `ACTIONED` state or if the expert
 * opted into `ANONYMOUS` (`contactable: false`), preventing accidental
 * re-identification. Emits both `expert` and `to` so `dispatch()` recognises
 * the recipient and never suppresses `dissent_actioned` at the weekly cap.
 */
export function notify(dissent, { now } = {}) {
  if (!dissent || dissent.status !== STATE.ACTIONED) return null;
  if (!dissent.contactable || !dissent.expert) return null;

  const body = {
    [ACTION.REWRITE]: 'You said the wording was wrong. It has been rewritten.',
    [ACTION.SPLIT]: 'You said this was two risks. It has been split. Here are both.',
    [ACTION.RETIRE]: 'You said this could not be resolved. It has been retired.',
    [ACTION.RESOLVE_EARLY]: 'You said this had already happened. It has been resolved early.',
  }[dissent.action];

  return {
    to: dissent.expert,
    expert: dissent.expert,
    type: 'dissent_actioned',
    dissentId: dissent.id,
    body,
    deepLinks: dissent.newCardIds.map((id) => `/c/${id}`),
    _next: { ...dissent, status: STATE.NOTIFIED, notifiedAt: now ?? Date.now() },
  };
}

/** Finalise a dissent into STATE.CLOSED (after notification, or directly for anonymous dissent). */
export function close(dissent, { reason = '', now } = {}) {
  const allowed = [STATE.OPEN, STATE.ROUTED, STATE.ACTIONED, STATE.NOTIFIED];
  if (!dissent || !allowed.includes(dissent.status)) {
    throw new Error(`cannot close dissent in state ${dissent?.status}`);
  }
  return {
    ...dissent,
    status: STATE.CLOSED,
    closeReason: reason,
    closedAt: now ?? Date.now(),
  };
}

/** Elapsed ms from creation to loop completion (notification or anonymous closure). */
export function loopLatencyMs(dissent) {
  if (!dissent) return null;
  const end = dissent.notifiedAt ?? dissent.closedAt;
  if (end === undefined || end === null) return null;
  return Math.max(0, end - dissent.createdAt);
}
