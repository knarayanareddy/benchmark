/**
 * Scoring — Brier with a bootstrap interval, and PAIRED comparisons.
 *
 * The rule this file enforces: no point estimate is ever returned without an
 * interval, and no two methods are ever compared unless they were scored on the
 * same items. At n≈104 the standard error on a Brier score is ~0.008–0.016
 * (measured, below), which is about the size of the gaps between methods:
 * comparing them unpaired would be a mistake a juror should catch.
 *
 * MEASURED STANDARD ERRORS at n=104 (`data/power-baseline.json`, written by
 * `npm run baseline`):
 *
 *   constant base-rate predictor   SE of mean Brier 0.0084
 *   ACAPS rating (band midpoint)   SE of mean Brier 0.0155
 *   PAIRED difference (ACAPS−floor) SE of difference 0.0157
 *
 * An earlier revision of this header said the standard error was "~0.04–0.05".
 * It was 2–5× too large, and the same sentence was repeated in docs/02. The
 * numbers gate now reads the figures from the data file and fails on the old one.
 *
 * PROVENANCE — read before quoting these numbers. All are measured by
 * scripts in this repo. Run `npm run ladder` and you get exactly these back.
 *
 *   naiveFloor    0.2425   scripts/measure-baseline.mjs        n=104
 *   acapsRatings  0.2171   scripts/measure-baseline.mjs        n=104  HEADLINE: band midpoints
 *   acapsOrdinal  0.2168   scripts/measure-baseline.mjs        n=104  sensitivity: rating / 5
 *   logistic      0.2177   scripts/fit-baseline.mjs (LOO-CV)   n=104
 *
 * Why the midpoint is the headline: ACAPS publishes the percentage bands behind
 * its scale (Very High = 81-100). Reading the ordinal as rating/5 scores "Very
 * High" as a 100% forecast, which no analyst means and which is infinitely
 * overconfident under a log score. The two readings differ by 0.0003 Brier.
 *
 * WHAT THIS LADDER SAYS — the opposite of what an earlier revision claimed.
 *
 * Lower Brier is better. 0.2177 > 0.2171. The regression is fractionally WORSE (and indistinguishable)
 * than the analyst, and the paired difference (0.0007) is nowhere near
 * distinguishable from zero. So the honest sentence is: a logistic regression
 * on ACAPS' own structured fields is statistically indistinguishable from
 * ACAPS' judgement, and neither is meaningfully distinguishable from the base
 * rate at n=104. ACAPS clears the floor by 0.0255 (paired interval spans zero); the model does not clear
 * ACAPS at all.
 *
 * TWO CORRECTIONS TO THE RECORD, both found by writing the scripts:
 *
 * 1. An earlier revision carried fourFieldLogistic = 0.1981 and described it as
 *    "the bar to beat". That number is not reproducible from this export under
 *    any specification tried (see the variant tables in the two scripts).
 *
 * 2. ACAPS publishes a 5×5 in docs/risk-methodology.md where IMPACT drives the
 *    Risk Level, and a rule — Risk = Probability × Impact. In this export the
 *    Risk Level is a function of PROBABILITY ALONE on 128 of 128 rows, and
 *    departure from the matrix is a function of the (Probability, Impact) cell
 *    on all 19 occupied cells. There are therefore no analyst overrides in this
 *    data, and an earlier revision of this file said there were. What remains
 *    true and useful: Impact is collected and does not change the rating, and
 *    does not move the realised outcome once probability is known.
 *
 * The in-sample fit scores 0.1965. It must never be quoted: its optimism
 * (0.021) is larger than the entire effect under test. That gap is the whole
 * reason this file reports LOO-CV.
 */

export const LADDER = Object.freeze({
  naiveFloor: 0.2425, // measured, n=104  [0.2259, 0.2592]
  acapsRatings: 0.2171, // measured, n=104  [0.1872, 0.2492]  band midpoints (headline) ← ACAPS is BETTER
  acapsOrdinal: 0.2168, // measured, n=104  [0.1815, 0.2540]  rating / 5 (sensitivity check)
  fourFieldLogistic: 0.2177, // measured, LOO-CV, n=104  [0.1783, 0.2600] — despite the name, 2 fields
});

/** Where each rung came from. Displayed in the product; not decoration. */
export const LADDER_PROVENANCE = Object.freeze({
  naiveFloor: 'measured — scripts/measure-baseline.mjs',
  acapsRatings: 'measured — scripts/measure-baseline.mjs (band midpoints)',
  acapsOrdinal: 'measured — scripts/measure-baseline.mjs (rating / 5, sensitivity)',
  fourFieldLogistic: 'measured out-of-sample — scripts/fit-baseline.mjs',
});

/** True when the regression beats ACAPS out of sample. It does not. */
export const REGRESSION_BEATS_ACAPS = LADDER.fourFieldLogistic < LADDER.acapsRatings;

/** Deterministic PRNG so published numbers are reproducible. */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const show = (v) => (typeof v === 'number' ? String(v) : JSON.stringify(v));

function validatePair(d, label = 'item') {
  if (!d || typeof d !== 'object') {
    throw new TypeError(`${label} must be an object with { p, y }`);
  }
  if (typeof d.p !== 'number' || !Number.isFinite(d.p) || d.p < 0 || d.p > 1) {
    throw new RangeError(
      `${label}.p must be a finite probability in [0, 1], got ${show(d.p)}`
    );
  }
  if (d.y !== 0 && d.y !== 1 && d.y !== null && d.y !== undefined) {
    throw new RangeError(
      `${label}.y must be 0, 1, or null/undefined (unobservable), got ${JSON.stringify(d.y)}`
    );
  }
}

/** pairs: [{p: 0..1, y: 0|1|null}] — null/undefined y is unobservable and is EXCLUDED; invalid p or y throws. */
export function observed(pairs) {
  if (!Array.isArray(pairs)) {
    throw new TypeError('pairs must be an array');
  }
  const out = [];
  for (let i = 0; i < pairs.length; i++) {
    const d = pairs[i];
    validatePair(d, `pairs[${i}]`);
    if (d.y === 0 || d.y === 1) out.push(d);
  }
  return out;
}

export function brierItem(d) {
  validatePair(d, 'item');
  if (d.y !== 0 && d.y !== 1) {
    throw new RangeError(
      `brierItem requires a resolved binary outcome (0 or 1), got ${JSON.stringify(d.y)}`
    );
  }
  const e = d.p - d.y;
  return e * e;
}

/** Low-level scalar mean Brier primitive; use bootstrapBrier() for interval-bearing output. */
export function brier(pairs) {
  const o = observed(pairs);
  if (!o.length) return { score: null, n: 0, note: 'no observable outcomes' };
  const s = o.reduce((a, d) => a + brierItem(d), 0) / o.length;
  return { score: s, n: o.length };
}

function mean(xs) {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function quantile(sorted, q) {
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

/** Bootstrap CI on the mean Brier. Always return this alongside the score. */
export function bootstrapBrier(pairs, { reps = 10000, seed = 42, alpha = 0.05 } = {}) {
  const o = observed(pairs);
  if (o.length < 2) return { score: null, lo: null, hi: null, n: o.length, note: 'too few' };
  const items = o.map(brierItem);
  const rnd = mulberry32(seed);
  const means = new Array(reps);
  for (let r = 0; r < reps; r++) {
    let acc = 0;
    for (let i = 0; i < items.length; i++) acc += items[(rnd() * items.length) | 0];
    means[r] = acc / items.length;
  }
  means.sort((a, b) => a - b);
  return {
    score: mean(items),
    lo: quantile(means, alpha / 2),
    hi: quantile(means, 1 - alpha / 2),
    n: items.length,
    reps,
  };
}

/**
 * PAIRED comparison on identical items. Returns the difference A−B with an
 * interval, and whether that interval excludes zero.
 */
export function paired(aPairs, bPairs, opts = {}) {
  if (aPairs.length && bPairs.length) {
    const missing = aPairs.concat(bPairs).filter((d) => d.id === undefined).length;
    if (missing) throw new Error('paired() requires an id on every item — unlabelled pairing is unsafe');
  }
  for (const [label, arr] of [['first', aPairs], ['second', bPairs]]) {
    const seen = new Set();
    for (const d of arr) {
      if (seen.has(d.id)) {
        throw new Error(`paired() received duplicate id ${JSON.stringify(d.id)} in the ${label} array — one item cannot be counted twice`);
      }
      seen.add(d.id);
    }
  }
  const allIds = new Set(aPairs.concat(bPairs).map((d) => d.id));
  const keyed = new Map(observed(bPairs).map((d) => [d.id, d]));
  const diffs = [];
  for (const d of observed(aPairs)) {
    const other = keyed.get(d.id);
    if (!other) continue;
    if (d.y !== other.y) throw new Error(`paired() matched ${d.id} across different outcomes`);
    diffs.push(brierItem(d) - brierItem(other));
  }
  const n_unique = diffs.length;
  const n_dropped = allIds.size - n_unique;
  if (diffs.length < 2) return { diff: null, lo: null, hi: null, n: n_unique, n_unique, n_dropped, significant: null };
  const rnd = mulberry32(opts.seed ?? 7);
  const reps = opts.reps ?? 10000;
  const means = new Array(reps);
  for (let r = 0; r < reps; r++) {
    let acc = 0;
    for (let i = 0; i < diffs.length; i++) acc += diffs[(rnd() * diffs.length) | 0];
    means[r] = acc / diffs.length;
  }
  means.sort((x, y) => x - y);
  const lo = quantile(means, 0.025);
  const hi = quantile(means, 0.975);
  return {
    diff: mean(diffs),
    lo,
    hi,
    n: n_unique,
    n_unique,
    n_dropped,
    significant: lo > 0 || hi < 0,
    note:
      lo > 0
        ? 'A is worse than B (positive diff = higher Brier)'
        : hi < 0
        ? 'A is better than B'
        : 'interval spans zero — no detectable difference',
  };
}

/** Calibration curve, for showing an expert their own track record. */
export function calibration(pairs, bins = 5) {
  const o = observed(pairs);
  const buckets = Array.from({ length: bins }, () => ({ n: 0, p: 0, y: 0 }));
  for (const d of o) {
    const i = Math.min(bins - 1, Math.floor(d.p * bins));
    buckets[i].n++; buckets[i].p += d.p; buckets[i].y += d.y;
  }
  return buckets
    .filter((b) => b.n > 0)
    .map((b) => ({ n: b.n, meanPredicted: b.p / b.n, observedRate: b.y / b.n }));
}
