/**
 * The optional "second look": background text shown to experts in Round 2 only,
 * whose content depends on a randomly assigned arm. It exists so we can measure
 * whether such background helps forecasting or only pulls people toward one view.
 *
 * Pure: no storage, no clock, no I/O. The probability ACAPS gave a risk is never
 * part of this content, and the validator refuses percentage, decimal, "x in y" and rating wording
 * so a moderator cannot paste that number in by accident. It is a guard, not a proof: a determined
 * author can still hide a number, so moderators must read the text before Round 1 opens.
 */

export const ARMS = Object.freeze(['control', 'balanced', 'acaps_view']);

/**
 * @typedef {{ label: string, url: string }} Source
 * @typedef {{ acapsReasoning: string, sources: Source[], higher: string[], lower: string[] }} SecondLookContent
 * @typedef {{ arm: string, p1: number, p2: number, acapsP: number | null, saw: boolean }} Pair
 */

/**
 * @param {string} hex a lowercase hex digest; only its first 8 characters decide the arm
 * @returns {string}
 */
export function assignArm(hex) {
  if (typeof hex !== 'string' || !/^[0-9a-f]{8,}$/.test(hex)) {
    throw new TypeError('assignArm() needs a lowercase hex string of at least 8 characters');
  }
  return ARMS[parseInt(hex.slice(0, 8), 16) % ARMS.length];
}

// A probability figure in prose, in the forms a person would actually use to slip one in:
// "70%", "70 per cent", "0.7", ".7", "7 in 10", "7 out of 10", "seven in ten", "three quarters", "70 points".
const WORD = '(?:one|two|three|four|five|six|seven|eight|nine|ten|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)';
const FIGURE = new RegExp([
  String.raw`\d+(\.\d+)?\s*(%|per\s?cent|percent|percentage points?|pts?\b)`,
  String.raw`(^|[^\d])0?\.\d+`,
  String.raw`\b\d+\s+(in|out of)\s+\d+\b`,
  String.raw`\b${WORD}\s+(in|out of)\s+${WORD}\b`,
  String.raw`\b(a |one |two |three )?(half|third|thirds|quarter|quarters)\b.*\b(chance|likel|probab|odds)`,
  String.raw`\b(chance|likelihood|probability|odds)\b[^.]{0,30}\b\d`,
].join('|'), 'i');
// An ACAPS rating used as a probability ("high probability", "probability is high").
const RATING = /\b(very low|low|medium|high|very high)\s+probability\b|\bprobability\s+(is|of)\s+(very low|low|medium|high|very high)\b/i;

/**
 * Checks one piece of text, records every problem it has, and returns it trimmed.
 * @param {unknown} value @param {string} label @param {number} min @param {number} max @param {string[]} problems
 * @returns {string}
 */
function text(value, label, min, max, problems) {
  const s = typeof value === 'string' ? value.trim() : '';
  if (s.length < min || s.length > max) problems.push(`${label} must be ${min} to ${max} characters of text`);
  if (FIGURE.test(s) || RATING.test(s)) problems.push(`${label} must not state a probability, percentage or odds`);
  return s;
}

/** @param {unknown} value @param {string} label @param {string[]} problems */
function strings(value, label, problems) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 5) {
    problems.push(`${label} must be a list of 1 to 5 items`);
    return [];
  }
  return value.map((v, i) => text(v, `${label}[${i}]`, 10, 500, problems));
}

/** @param {unknown} value @param {string[]} problems @returns {Source[]} */
function sources(value, problems) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 8) {
    problems.push('sources must be a list of 1 to 8 items');
    return [];
  }
  return value.map((s, i) => {
    const o = s !== null && typeof s === 'object' ? s : {};
    const label = text(o.label, `sources[${i}].label`, 1, 120, problems);
    const url = typeof o.url === 'string' ? o.url.trim() : '';
    let protocol = '';
    try { protocol = new URL(url).protocol; } catch { /* reported below */ }
    if (protocol !== 'https:') problems.push(`sources[${i}].url must be an https address`);
    return { label, url };
  });
}

/**
 * Collects every problem at once; never throws.
 * @param {unknown} input
 * @returns {{ ok: boolean, problems: string[], content: SecondLookContent | null }}
 */
export function validateSecondLook(input) {
  const src = /** @type {any} */ (input ?? {});
  /** @type {string[]} */
  const problems = [];
  const acapsReasoning = text(src.acapsReasoning, 'acapsReasoning', 20, 2000, problems);
  const srcs = sources(src.sources, problems);
  const higher = strings(src.higher, 'higher', problems);
  const lower = strings(src.lower, 'lower', problems);
  if (problems.length) return { ok: false, problems, content: null };
  return { ok: true, problems, content: { acapsReasoning, sources: srcs, higher, lower } };
}

/**
 * What one arm's expert is shown. Only that arm's fields; control is shown nothing.
 * @param {SecondLookContent} content
 * @param {string} arm
 */
export function contentForArm(content, arm) {
  if (arm === 'control') return null;
  if (arm === 'balanced') return { kind: 'balanced', higher: [...content.higher], lower: [...content.lower] };
  if (arm === 'acaps_view') {
    return {
      kind: 'acaps_view',
      acapsReasoning: content.acapsReasoning,
      sources: content.sources.map(({ label, url }) => ({ label, url })),
    };
  }
  throw new RangeError(`unknown arm ${JSON.stringify(arm)}`);
}

/**
 * Pooled aggregates per arm. An arm with fewer than `floor` pairs reports only its size,
 * and the ACAPS comparison is shown only once it has `floor` pairs of its own.
 * @param {Pair[]} pairs
 * @param {{ floor?: number }} [opts]
 */
export function summariseArms(pairs, { floor = 5 } = {}) {
  /** @param {number[]} xs */
  const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  /** @type {Record<string, any>} */
  const out = {};
  for (const arm of ARMS) {
    const mine = pairs.filter((p) => p.arm === arm);
    const n = mine.length;
    if (n < floor) {
      out[arm] = { n, suppressed: true, meanShift: null, meanTowardAcaps: null, nWithAcaps: null, sawCount: null };
      continue;
    }
    const withAcaps = mine.filter((p) => typeof p.acapsP === 'number');
    const towards = withAcaps.map((p) => {
      const a = /** @type {number} */ (p.acapsP);
      return Math.abs(p.p1 - a) - Math.abs(p.p2 - a);
    });
    out[arm] = {
      n,
      suppressed: false,
      meanShift: mean(mine.map((p) => p.p2 - p.p1)),
      meanTowardAcaps: withAcaps.length >= floor ? mean(towards) : null,
      nWithAcaps: withAcaps.length >= floor ? withAcaps.length : null,
      sawCount: mine.filter((p) => p.saw).length,
    };
  }
  return out;
}
