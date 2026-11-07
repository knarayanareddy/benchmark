/**
 * The dissent loop — the actual product.
 *
 * An objection is a first-class object with a strict five-state lifecycle
 * (OPEN -> ROUTED -> ACTIONED -> NOTIFIED -> CLOSED), integrated with
 * expert-controlled anonymity and the shared return-path module
 * (`packages/shared/loop.js`):
 *   - Notification copy and loop-latency calculation come exclusively from
 *     `packages/shared/loop.js` (`compose()`, `latency()`), eliminating drift
 *     between the shared spine and Benchmark's dissent flow.
 *   - Dissent IDs use `crypto.randomUUID()` so restarts or multi-worker
 *     processes never collide on sequential counters.
 *   - `act()` requires `STATE.ROUTED` (`OPEN -> ACTIONED` without routing is
 *     rejected).
 *   - IDENTIFIED / PSEUDONYMOUS dissenters are contactable by ACAPS and
 *     receive a `dissent_actioned` notification that bypasses the weekly cap.
 *   - ANONYMOUS dissenters have their `expert` identifier stripped at creation
 *     (`expert: null, contactable: false`) and never emit outbound recipients.
 */
import crypto from 'node:crypto';
import {
  LEVELS,
  DEFAULT_LEVEL,
  resolveLevel,
  attribute,
} from '../../core/src/anonymity.js';
import {
  LOOP_KIND,
  compose,
  latency,
} from '../../shared/loop.js';

export const STATE = Object.freeze({
  OPEN: 'open',
  ROUTED: 'routed',
  ACTIONED: 'actioned',
  CLOSED: 'closed',
  NOTIFIED: 'notified',
});

export const ACTION = Object.freeze({
  REWRITE: LOOP_KIND.REWRITE,
  SPLIT: LOOP_KIND.SPLIT,
  RETIRE: LOOP_KIND.RETIRE,
  RESOLVE_EARLY: LOOP_KIND.RESOLVE_EARLY,
});

export const KIND = Object.freeze({
  TWO_RISKS: 'two_risks',
  WINDOW: 'window',
  ALREADY_HAPPENING: 'already_happening',
  INTENT_NOT_CONDITION: 'intent_not_condition',
});

export function newDissent({
  id,
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
  if (id !== undefined && (typeof id !== 'string' || !id.trim())) {
    throw new Error('dissent id, when provided, must be a non-empty string');
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
  const dissentId = id ? id.trim() : `d_${crypto.randomUUID()}`;

  return {
    id: dissentId,
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

/**
 * Analyst acts on a routed dissent (`STATE.ROUTED -> STATE.ACTIONED`).
 * Rejects unrouted (`STATE.OPEN`) dissents so queue triage cannot be bypassed.
 */
export function act(dissent, action, { newCardIds = [], title = '', note = '', now } = {}) {
  if (!Object.values(ACTION).includes(action)) {
    throw new Error(`unknown action: ${action}`);
  }
  if (!dissent || dissent.status !== STATE.ROUTED) {
    throw new Error(
      `cannot act on dissent in state ${dissent?.status} (must be routed first)`
    );
  }
  return {
    ...dissent,
    action,
    status: STATE.ACTIONED,
    title: String(title || ''),
    note,
    newCardIds,
    actionedAt: now ?? Date.now(),
  };
}

/**
 * Emit the loop-closing notification for contactable dissenters, composed
 * exclusively via `packages/shared/loop.js` (`compose()`).
 *
 * Returns `null` if the dissent is not in `ACTIONED` state or if the expert
 * opted into `ANONYMOUS` (`contactable: false`), preventing accidental
 * re-identification. Emits both `expert` and `to` so `dispatch()` recognises
 * the recipient and never suppresses `dissent_actioned` at the weekly cap.
 */
export function notify(dissent, { now } = {}) {
  if (!dissent || dissent.status !== STATE.ACTIONED) return null;
  if (!dissent.contactable || !dissent.expert) return null;

  const deepLinks = dissent.newCardIds.map((id) => `/c/${id}`);
  const msg = compose(dissent.action, {
    title: dissent.title || undefined,
    count: dissent.newCardIds.length || undefined,
    deepLinks,
  });

  return {
    to: dissent.expert,
    expert: dissent.expert,
    type: 'dissent_actioned',
    dissentId: dissent.id,
    kind: msg.kind,
    body: msg.body,
    deepLinks: msg.deepLinks,
    honesty: msg.honesty,
    _next: { ...dissent, status: STATE.NOTIFIED, notifiedAt: now ?? Date.now() },
  };
}

/**
 * Finalise a dissent into STATE.CLOSED with strict transition guards (B3):
 *   - `STATE.OPEN` is rejected (cannot bypass analyst routing).
 *   - `STATE.ROUTED` dismissal without action requires a non-empty `reason`.
 *   - `STATE.ACTIONED` with `contactable === true` is rejected until `notify()`
 *     transitions it to `STATE.NOTIFIED`, so contactable dissenters are never
 *     silently closed without hearing back.
 *   - `STATE.ACTIONED` with `contactable === false` (`ANONYMOUS`) closes
 *     directly since outbound notifications are suppressed for safety.
 *   - `STATE.NOTIFIED` closes cleanly.
 */
export function close(dissent, { reason = '', now } = {}) {
  if (!dissent || typeof dissent !== 'object') {
    throw new Error(`cannot close dissent in state ${dissent?.status}`);
  }
  const trimmedReason = typeof reason === 'string' ? reason.trim() : '';

  if (dissent.status === STATE.OPEN) {
    throw new Error('cannot close unrouted dissent in state open (must be routed first)');
  }
  if (dissent.status === STATE.ROUTED) {
    if (!trimmedReason) {
      throw new Error('closing an unactioned dissent from state routed requires a non-empty reason');
    }
  } else if (dissent.status === STATE.ACTIONED) {
    if (dissent.contactable && dissent.expert) {
      throw new Error(
        'cannot close actioned dissent for contactable expert before notify()'
      );
    }
  } else if (dissent.status !== STATE.NOTIFIED) {
    throw new Error(`cannot close dissent in state ${dissent.status}`);
  }

  return {
    ...dissent,
    status: STATE.CLOSED,
    closeReason: trimmedReason,
    closedAt: now ?? Date.now(),
  };
}

/**
 * Emit an addressless, card-scoped "you said, we did" ledger entry (B4).
 *
 * Closes the feedback loop for `ANONYMOUS` dissenters (and informs the wider
 * panel) on the card itself without storing or addressing any individual:
 * carries zero `expert`, `to`, `by`, `name`, `country`, `level`, or `dissentId`
 * attributes, and composes copy via `packages/shared/loop.js`.
 */
export function ledgerEntry(dissent) {
  if (!dissent || !dissent.action) return null;
  const validStates = [STATE.ACTIONED, STATE.NOTIFIED, STATE.CLOSED];
  if (!validStates.includes(dissent.status)) return null;

  const deepLinks = (dissent.newCardIds || []).map((id) => `/c/${id}`);
  const msg = compose(dissent.action, {
    title: dissent.title || undefined,
    count: dissent.newCardIds?.length || undefined,
    deepLinks,
  });

  return {
    cardId: dissent.cardId,
    kind: dissent.kind,
    action: dissent.action,
    body: msg.body,
    deepLinks: msg.deepLinks,
    actionedAt: dissent.actionedAt ?? null,
  };
}

/** Build the chronological de-identified "you said, we did" ledger for a card or feed. */
export function cardLedger(dissents, cardId) {
  if (!Array.isArray(dissents)) {
    throw new TypeError('dissents must be an array');
  }
  return dissents
    .filter((d) => (cardId === undefined ? true : d?.cardId === cardId))
    .map(ledgerEntry)
    .filter((entry) => entry !== null)
    .sort((a, b) => (a.actionedAt ?? 0) - (b.actionedAt ?? 0));
}

/** Elapsed ms from creation to loop completion, delegated to `packages/shared/loop.js`. */
export function loopLatencyMs(dissent) {
  if (!dissent) return null;
  const end = dissent.notifiedAt ?? dissent.closedAt;
  if (end === undefined || end === null) return null;
  return latency(dissent.createdAt, end);
}
