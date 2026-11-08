/**
 * Contexts where naming yourself, or being named, can put a person at risk.
 *
 * This list is a CONSERVATIVE DEFAULT, not a judgement. Who maintains it, and how often, is a decision for
 * ACAPS (docs/09-roundtable-and-credit.md). A deployment overrides it with BENCHMARK_SENSITIVE_COUNTRIES.
 * It is advice that adds a confirmation step, never a safeguard on its own.
 */

/** ISO 3-letter codes. */
export const DEFAULT_SENSITIVE_COUNTRIES = Object.freeze([
  'AFG', 'BFA', 'CAF', 'COD', 'ETH', 'HTI', 'IRQ', 'LBN', 'LBY', 'MLI', 'MMR', 'NER', 'NGA', 'PAK', 'PSE',
  'SDN', 'SOM', 'SSD', 'SYR', 'TCD', 'UKR', 'YEM',
]);

/**
 * @param {unknown} country an ISO 3-letter code
 * @param {readonly string[]} [list]
 */
export function isSensitiveCountry(country, list = DEFAULT_SENSITIVE_COUNTRIES) {
  return list.includes(String(country ?? '').trim().toUpperCase());
}
