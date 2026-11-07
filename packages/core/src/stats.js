/**
 * Small, exact statistics for reporting a measurement honestly: a proportion
 * always comes with its interval, and two raters always come with their
 * agreement. Pure; no dependencies.
 */

/**
 * Wilson score interval for k successes in n trials (default 95%).
 * Better than the normal approximation at the small n and extreme p this repo has.
 * @param {number} k
 * @param {number} n
 * @param {number} [z]
 * @returns {{ lo: number, hi: number } | null}
 */
export function wilson(k, n, z = 1.959964) {
  if (!Number.isInteger(k) || !Number.isInteger(n) || n < 0 || k < 0 || k > n) {
    throw new RangeError(`wilson needs 0 <= k <= n integers, got k=${k} n=${n}`);
  }
  if (n === 0) return null;
  const p = k / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const centre = (p + z2 / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denom;
  return { lo: Math.max(0, centre - half), hi: Math.min(1, centre + half) };
}

/**
 * Cohen's kappa for two raters over the same items (boolean or categorical labels).
 * Returns null when agreement by chance is total (kappa is undefined).
 * @param {any[]} a
 * @param {any[]} b
 */
export function cohenKappa(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length || a.length === 0) {
    throw new TypeError('cohenKappa needs two non-empty arrays of equal length');
  }
  const n = a.length;
  const cats = [...new Set([...a, ...b])];
  let agree = 0;
  for (let i = 0; i < n; i++) if (a[i] === b[i]) agree++;
  const po = agree / n;
  let pe = 0;
  for (const c of cats) {
    pe += (a.filter((x) => x === c).length / n) * (b.filter((x) => x === c).length / n);
  }
  if (pe === 1) return null;
  return { kappa: (po - pe) / (1 - pe), observedAgreement: po, expectedAgreement: pe, n };
}
