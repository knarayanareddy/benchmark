// Shared helpers. Every dynamic string becomes a text node, so page content cannot inject markup.
/**
 * @template {keyof HTMLElementTagNameMap} K
 * @param {K} tag
 * @param {Record<string, any>} [attrs]
 * @param {...any} kids
 * @returns {HTMLElementTagNameMap[K]}
 */
export function el(tag, attrs = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === false || v == null) continue;
    if (k === 'class') n.className = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) n.append(kid instanceof Node ? kid : document.createTextNode(String(kid ?? '')));
  return n;
}

/** @param {number} p */
export const pct = (p) => `${Math.round(p * 100)}%`;

/** @param {string} tokenKey */
export function api(tokenKey) {
  /**
   * @param {string} method
   * @param {string} path
   * @param {any} [body]
   * @returns {Promise<any>}
   */
  return async function call(method, path, body) {
    const token = sessionStorage.getItem(tokenKey);
    const res = await fetch(path, {
      method,
      headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    /** @type {any} */
    let data = null;
    try { data = await res.json(); } catch { /* empty body */ }
    if (!res.ok) {
      throw Object.assign(new Error((data && data.error) || `request failed (${res.status})`), { status: res.status, data });
    }
    return data;
  };
}

/**
 * @param {HTMLElement} host
 * @param {string} text
 * @param {string} [kind]
 */
export function notice(host, text, kind = 'ok') {
  host.replaceChildren(el('div', { class: `msg ${kind}`, role: kind === 'err' ? 'alert' : 'status' }, text));
}

/**
 * @param {string} id
 * @returns {HTMLElement}
 */
export function byId(id) {
  const e = document.getElementById(id);
  if (!e) throw new Error(`missing #${id}`);
  return e;
}

/**
 * Anything thrown becomes an Error that may carry the HTTP status and body of a failed call.
 * @param {unknown} e
 * @returns {Error & { status?: number, data?: any }}
 */
export const asErr = (e) => (e instanceof Error ? e : new Error(String(e)));
