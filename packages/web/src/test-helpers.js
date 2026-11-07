import { vi } from 'vitest';
import crypto from 'node:crypto';
import * as B from '@benchmark/core/blind';
import { ApiError } from './lib/api.js';

/** An api() whose behaviour is a table of "METHOD /path" -> handler or value. Unlisted routes fail loudly. */
export function routes(table) {
  return vi.fn(async (method, path, body) => {
    const key = `${method} ${path.split('?')[0]}`;
    const h = table[`${method} ${path}`] ?? table[key]; // the exact path (with its query) wins
    if (h === undefined) throw new Error(`unexpected request ${method} ${path}`);
    return typeof h === 'function' ? h(body, path) : h;
  });
}
export const fail = (status, message, data) => () => { throw new ApiError(message, { status, data }); };

/** A signing service for blind ballots, so device flows run for real in tests. */
export function blindServer() {
  const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = privateKey.export({ format: 'jwk' });
  const big = (s) => B.bytesToBig(Buffer.from(s, 'base64url'));
  const n = big(jwk.n); const d = big(jwk.d);
  const issued = new Map();
  return {
    n, e: big(jwk.e), jwk,
    key: { scheme: B.BLIND_SCHEME, n: jwk.n, e: jwk.e },
    issue(body) {
      const prior = issued.get(body.cardId);
      if (prior && prior !== body.blinded) throw new ApiError('a token was already issued to you for this card', { status: 409 });
      issued.set(body.cardId, body.blinded);
      return { signature: B.bytesToHex(B.bigToBytes(B.signBlinded(n, d, B.bytesToBig(B.hexToBytes(body.blinded))), B.modulusBytes(n))) };
    },
    verify: (cardId, token, signature) => B.verify(n, big(jwk.e), B.ballotMessage(cardId, token), B.bytesToBig(B.hexToBytes(signature))),
  };
}

export const card = (over = {}) => ({ id: 'C1', statement: 'Cholera cases in Chad will exceed 10,000 by 30 April 2027.', country: 'TCD', round: 1, window: { from: '2026-11-01', to: '2027-04-30' }, version: 0, seedP: 0.705, ...over });
export const emptyInbox = (over = {}) => ({ toAnswer: [], openForRevision: [], notifications: [], notices: [], deviceMode: false, ...over });
export const json = (body, status = 200) => new Response(JSON.stringify(body), { status });
