/** @typedef {{ demo: boolean }} Config */

/** @type {Config | null} */
let cached = null;

/** Tests only: forget the cached answer. */
export function resetConfigCache() { cached = null; }

/**
 * Whether this deployment is in demo mode. No login is sent. Any failure answers "not demo", so a
 * broken config route never turns the demo on; only a successful answer is cached for the page's life.
 * @returns {Promise<Config>}
 */
export async function getConfig() {
  if (cached) return cached;
  try {
    const res = await fetch('/api/config');
    if (!res.ok) throw new Error(`config ${res.status}`);
    const body = await res.json();
    cached = { demo: body?.demo === true };
    return cached;
  } catch {
    return { demo: false };
  }
}
