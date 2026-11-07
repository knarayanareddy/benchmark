import { obtainBallot } from './device.js';

/**
 * Send one answer the right way for how this person's key is held.
 *  server: the service derives the key from the login.
 *  device: the answer carries a blind-signed ballot and NO login at all.
 * @param {(m: string, p: string, b?: any) => Promise<any>} api
 * @param {'server' | 'device'} mode
 * @param {string} cardId
 * @param {number} p probability 0..1
 */
export async function sendEstimate(api, mode, cardId, p) {
  if (mode === 'device') {
    const ballot = await obtainBallot(api, cardId);
    return anonymous('POST', '/api/anon/estimates', { ...ballot, p });
  }
  return api('POST', '/api/estimates', { cardId, p });
}

/** The anonymous endpoints must not carry the login, so they use plain fetch and no Authorization. */
export async function anonymous(method, path, body) {
  let res;
  try {
    res = await fetch(path, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  } catch {
    const { ApiError } = await import('./api.js');
    throw new ApiError('You appear to be offline.', { offline: true });
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const { ApiError } = await import('./api.js');
    throw new ApiError((data && data.error) || `request failed (${res.status})`, { status: res.status, data });
  }
  return data;
}
