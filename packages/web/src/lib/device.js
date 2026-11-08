import { kvGet, kvSet, kvDel } from './kv.js';
import { bytesToBig, hexToBytes, bytesToHex, bigToBytes, modulusBytes, deriveBallot, blind, unblind, verify, ballotMessage } from '@benchmark/core/blind';

const SECRET = 'device.secret';
const BALLOTS = 'device.ballots';

export const hasDeviceSecret = async () => Boolean(await kvGet(SECRET));
/** @returns {Promise<Uint8Array | undefined>} */
export const getSecret = () => kvGet(SECRET);
export const setSecret = (/** @type {Uint8Array} */ s) => kvSet(SECRET, s);

/** A new random secret. It exists only on this device until the person writes the recovery code down. */
export async function createSecret() {
  const s = crypto.getRandomValues(new Uint8Array(32));
  await setSecret(s);
  return s;
}
export async function clearDevice() { await kvDel(SECRET); await kvDel(BALLOTS); }

/** Ballots already obtained, by card: { token, signature }. A cache; the secret alone can always rebuild the token. */
async function cache() { return (await kvGet(BALLOTS)) || {}; }
/** @param {string} cardId */
export async function cachedBallot(cardId) { return (await cache())[cardId] || null; }
export async function knownCards() { return Object.keys(await cache()); }

/**
 * Get this card's ballot: derive the token from the secret, blind it, have the server
 * sign it blind (once per card; asking again repeats the same answer), unblind, and
 * check the signature before ever using it.
 * @param {(m: string, p: string, b?: any) => Promise<any>} api
 * @param {string} cardId
 * @returns {Promise<{ cardId: string, token: string, signature: string }>}
 */
export async function obtainBallot(api, cardId) {
  const have = await cachedBallot(cardId);
  if (have) return { cardId, ...have };
  const secret = await getSecret();
  if (!secret) throw new Error('This device does not hold your key. Restore it with your recovery code.');
  const pk = await api('GET', '/api/blind/key');
  const n = bytesToBig(base64urlToBytes(pk.n));
  const e = bytesToBig(base64urlToBytes(pk.e));
  const { token, r } = deriveBallot(secret, cardId, n);
  const msg = ballotMessage(cardId, token);
  const len = modulusBytes(n);
  const { signature } = await api('POST', '/api/blind/issue', { cardId, blinded: bytesToHex(bigToBytes(blind(n, e, msg, r), len)) });
  const sig = unblind(n, bytesToBig(hexToBytes(signature)), r);
  if (!verify(n, e, msg, sig)) throw new Error('The service returned a signature that does not verify. Nothing was sent.');
  const ballot = { token, signature: bytesToHex(bigToBytes(sig, len)) };
  await kvSet(BALLOTS, { ...(await cache()), [cardId]: ballot });
  return { cardId, ...ballot };
}

/** @param {string} s */
function base64urlToBytes(s) {
  const b = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(b, (c) => c.charCodeAt(0));
}
