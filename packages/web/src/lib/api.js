import { kvGet } from './kv.js';

/** @typedef {(method: string, path: string, body?: any) => Promise<any>} Api */

export class ApiError extends Error {
  /** @param {string} message @param {{ status?: number, data?: any, offline?: boolean }} [extra] */
  constructor(message, { status, data, offline = false } = {}) {
    super(message);
    this.name = 'ApiError';
    /** @type {number | undefined} */ this.status = status;
    /** @type {any} */ this.data = data;
    /** @type {boolean} */ this.offline = offline;
  }
}

/** Anything thrown becomes an Error that may carry the HTTP status and body of a failed call. @param {unknown} e */
export const asErr = (e) => /** @type {ApiError} */ (e instanceof Error ? e : new ApiError(String(e)));

/**
 * @param {string} tokenKey where the bearer token is kept (expert and staff sessions are separate)
 * @returns {(method: string, path: string, body?: any) => Promise<any>}
 */
export function createApi(tokenKey) {
  return async function call(method, path, body) {
    const token = await kvGet(tokenKey);
    let res;
    try {
      res = await fetch(path, {
        method,
        headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch {
      // fetch only rejects when the network is down or unreachable; the page treats that as "try later".
      throw new ApiError('You appear to be offline.', { offline: true });
    }
    /** @type {any} */
    let data = null;
    try { data = await res.json(); } catch { /* empty body */ }
    if (!res.ok) throw new ApiError((data && data.error) || `request failed (${res.status})`, { status: res.status, data });
    return data;
  };
}
