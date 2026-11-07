// Answers given offline wait here, on the device, and are sent when the connection returns.
// Only the question id and the number are kept, and they are removed the moment they are sent.
import { kvGet, kvSet } from './kv.js';

const KEY = 'queue';

/** @returns {Promise<Array<{ id: string, cardId: string, p: number }>>} */
export const pending = async () => (await kvGet(KEY)) || [];

/** Remember one answer per card: a newer answer to the same card replaces the older one. @param {string} cardId @param {number} p */
export async function enqueue(cardId, p) {
  const rest = (await pending()).filter((q) => q.cardId !== cardId);
  await kvSet(KEY, [...rest, { id: `${cardId}:${Date.now()}`, cardId, p }]);
}

/**
 * Try every queued answer in order. An answer leaves the queue when it was sent OR
 * was refused for good (already answered, card closed); it stays only when the network failed.
 * @param {(cardId: string, p: number) => Promise<unknown>} send
 * @returns {Promise<{ sent: number, dropped: number, left: number }>}
 */
export async function flush(send) {
  let sent = 0; let dropped = 0;
  const left = [];
  for (const q of await pending()) {
    try { await send(q.cardId, q.p); sent++; } catch (e) {
      const err = /** @type {{ offline?: boolean, status?: number }} */ (e);
      if (err.offline) left.push(q); else dropped++;
    }
  }
  await kvSet(KEY, left);
  return { sent, dropped, left: left.length };
}
