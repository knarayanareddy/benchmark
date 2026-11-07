// Answers given offline wait here, on the device, and are sent when the connection returns.
// The question id, the number and any context the person added (how sure, why, what it rests on) are kept, and they
// are removed the moment they are sent, or when the person signs out.
import { kvGet, kvSet } from './kv.js';

const KEY = 'queue';

/** @returns {Promise<Array<{ id: string, cardId: string, p: number, context?: Record<string, any> }>>} */
export const pending = async () => (await kvGet(KEY)) || [];

/** Forget everything waiting to be sent. Called on sign-out, so the next person on this device never sees or sends it. */
export const clearQueue = () => kvSet(KEY, []);

/** Remember one answer per card: a newer answer to the same card replaces the older one. @param {string} cardId @param {number} p @param {Record<string, any>} [context] */
export async function enqueue(cardId, p, context) {
  const rest = (await pending()).filter((q) => q.cardId !== cardId);
  await kvSet(KEY, [...rest, { id: `${cardId}:${Date.now()}`, cardId, p, ...(context && Object.keys(context).length ? { context } : {}) }]);
}

/**
 * Try every queued answer in order. An answer leaves the queue when it was sent OR
 * was refused for good (already answered, card closed); it stays only when the network failed.
 * @param {(cardId: string, p: number, context?: Record<string, any>) => Promise<unknown>} send
 * @returns {Promise<{ sent: number, dropped: number, left: number }>}
 */
export async function flush(send) {
  let sent = 0; let dropped = 0;
  const left = [];
  for (const q of await pending()) {
    try { await send(q.cardId, q.p, q.context); sent++; } catch (e) {
      const err = /** @type {{ offline?: boolean, status?: number }} */ (e);
      if (err.offline) left.push(q); else dropped++;
    }
  }
  await kvSet(KEY, left);
  return { sent, dropped, left: left.length };
}
