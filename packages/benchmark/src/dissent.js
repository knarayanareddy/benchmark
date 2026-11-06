/**
 * The dissent loop — the actual product.
 *
 * An objection is a first-class object with a lifecycle, not a comment field.
 * The requirement that makes it real: the expert is TOLD what happened.
 * An expert who objects into silence does not object twice.
 */
import fs from 'node:fs';

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
export const newDissent = ({ cardId, expert, kind, text = '' }) => {
  if (!Object.values(KIND).includes(kind)) throw new Error(`unknown dissent kind: ${kind}`);
  return {
    id: `d_${++seq}`,
    cardId, expert, kind, text,
    status: STATE.OPEN,
    action: null,
    createdAt: Date.now(),
  };
};

/** Analyst acts. Returns the dissent plus the downstream cards it produced. */
export function act(dissent, action, { newCardIds = [], note = '' } = {}) {
  if (!Object.values(ACTION).includes(action)) throw new Error(`unknown action: ${action}`);
  if (dissent.status !== STATE.OPEN && dissent.status !== STATE.ROUTED) {
    throw new Error(`cannot act on dissent in state ${dissent.status}`);
  }
  const next = { ...dissent, action, status: STATE.ACTIONED, note, newCardIds, actionedAt: Date.now() };
  return next;
}

/** The notification. This is the loop closing, and it is never suppressed. */
export function notify(dissent) {
  if (dissent.status !== STATE.ACTIONED) return null;
  const body = {
    [ACTION.REWRITE]: 'You said the wording was wrong. It has been rewritten.',
    [ACTION.SPLIT]: 'You said this was two risks. It has been split. Here are both.',
    [ACTION.RETIRE]: 'You said this could not be resolved. It has been retired.',
    [ACTION.RESOLVE_EARLY]: 'You said this had already happened. It has been resolved early.',
  }[dissent.action];

  return {
    to: dissent.expert,
    type: 'dissent_actioned',
    dissentId: dissent.id,
    body,
    deepLinks: dissent.newCardIds.map((id) => `/c/${id}`),
    _next: { ...dissent, status: STATE.NOTIFIED, notifiedAt: Date.now() },
  };
}

/** Time from raising to notifying — the metric that proves the loop is real. */
export function loopLatencyMs(dissent) {
  if (!dissent.notifiedAt) return null;
  return dissent.notifiedAt - dissent.createdAt;
}
