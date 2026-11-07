/** @typedef {{ demo: boolean, deviceKeys: boolean, breakGlass: boolean }} Config */

/** @type {Config | null} */
let cached = null;

/** Tests only: forget the cached answer. */
export function resetConfigCache() { cached = null; }

/**
 * What this deployment offers (GET /api/config). Any failure answers "off" for everything, so a broken
 * config route never turns the demo on or offers a device-held key the server cannot sign. Only a
 * successful answer is cached for the page's life. Unknown or non-boolean fields count as off.
 * @returns {Promise<Config>}
 */
export async function getConfig() {
  if (cached) return cached;
  try {
    const res = await fetch('/api/config');
    if (!res.ok) throw new Error(`config ${res.status}`);
    const body = await res.json();
    cached = { demo: body?.demo === true, deviceKeys: body?.deviceKeys === true, breakGlass: body?.breakGlass === true };
    return cached;
  } catch {
    return { demo: false, deviceKeys: false, breakGlass: false };
  }
}
