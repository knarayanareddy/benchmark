/**
 * Scoring — Brier with a bootstrap interval, and PAIRED comparisons.
 *
 * The rule this file enforces: no point estimate is ever returned without an
 * interval, and no two methods are ever compared unless they were scored on the
 * same items.
 *
 * MEASURED STANDARD ERRORS at n=104 on `data/risk-radar.json` (reproduce with
 * `npm run ladder`; the bootstrap intervals imply the same figures):
 *
 *   constant base-rate predictor   item SD 0.0856   SE of mean Brier 0.0084
 *   ACAPS rating (ordinal/5)       item SD 0.1874   SE of mean Brier 0.0184
 *   PAIRED difference (ACAPS−floor) SD 0.1505       SE of difference 0.0148
 *
 * An earlier revision of this header said the standard error was "~0.04–0.05".
 * It is not: it is 2–5× smaller, and the sentence was repeated in docs/02 and
 * planning/product-audit.html. The conclusion it supported (nothing here is
 * distinguishable from zero) still holds — but for the right reason, which is
 * that pairing shrinks the comparison to 0.0148 and 0.0009 is still far inside
 * that. Quoting an inflated SE would have made the ladder look unreadable
 * rather than merely underpowered.
 *
 * PROVENANCE — read before quoting these numbers. All three are measured by
 * scripts in this repo. Run `npm run ladder` and you get exactly these back.
 *
 *   naiveFloor   0.2425   scripts/measure-baseline.mjs        n=104
 *   acapsRatings 0.2168   scripts/measure-baseline.mjs        n=104
 *   logistic     0.2177   scripts/fit-baseline.mjs (LOO-CV)   n=104
 *
 * WHAT THIS LADDER SAYS — the opposite of what an earlier revision claimed.
 *
 * Lower Brier is better. 0.2177 > 0.2168. The regression is fractionally WORSE
 * than the analyst, and the paired difference (0.0009) is nowhere near
 * distinguishable from zero. So the honest sentence is: a logistic regression
 * on ACAPS' own structured fields is statistically indistinguishable from
 * ACAPS' judgement, and neither is meaningfully distinguishable from the base
 * rate at n=104. ACAPS clears the floor by 0.0257; the model does not clear
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
  acapsRatings: 0.2168, // measured, n=104  [0.1815, 0.2540]  ← ACAPS is BETTER
  fourFieldLogistic: 0.2177, // measured, LOO-CV, n=104  [0.1783, 0.2600] — despite the name, 2 fields
});

/** Where each rung came from. Displayed in the product; not decoration. */
export const LADDER_PROVENANCE = Object.freeze({
  naiveFloor: 'measured — scripts/measure-baseline.mjs',
  acapsRatings: 'measured — scripts/measure-baseline.mjs',
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

function validatePair(d, label = 'item') {
  if (!d || typeof d !== 'object') {
    throw new TypeError(`${label} must be an object with { p, y }`);
  }
  if (typeof d.p !== 'number' || !Number.isFinite(d.p) || d.p < 0 || d.p > 1) {
    throw new RangeError(
      `${label}.p must be a finite probability in [0, 1], got ${JSON.stringify(d.p)}`
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

/**
 * Rule R2, in code: 10,000 resamples, alpha 0.05, seed recorded with the result.
 * One constant, consumed by `aggregate()` too, so "pre-registered" cannot mean
 * two different numbers in two files.
 */
export const DEFAULT_REPS = 10000;
export const MIN_REPS = 1000;
export const DEFAULT_ALPHA = 0.05;
export const DEFAULT_SEED = 42;

/**
 * Validate bootstrap options at entry.
 *
 * `reps: 0` used to produce NaN bounds that `JSON.stringify` turned into
 * `{"lo":null,"hi":null}` — indistinguishable from "suppressed", in the one
 * place the repo says must never happen. NaN is not an interval.
 */
export function bootstrapOptions({ reps = DEFAULT_REPS, seed = DEFAULT_SEED, alpha = DEFAULT_ALPHA } = {}) {
  if (!Number.isInteger(reps) || reps < MIN_REPS) {
    throw new RangeError(`reps must be an integer >= ${MIN_REPS}, got ${JSON.stringify(reps)}`);
  }
  if (!Number.isInteger(seed)) {
    throw new RangeError(`seed must be an integer, got ${JSON.stringify(seed)}`);
  }
  if (typeof alpha !== 'number' || !Number.isFinite(alpha) || !(alpha > 0 && alpha < 1)) {
    throw new RangeError(`alpha must be a finite number in (0, 1), got ${JSON.stringify(alpha)}`);
  }
  return { reps, seed, alpha };
}

/** Bootstrap CI on the mean Brier. Always return this alongside the score. */
export function bootstrapBrier(pairs, opts = {}) {
  const { reps, seed, alpha } = bootstrapOptions(opts);
  const o = observed(pairs);
  const interval = { reps, seed, alpha, method: 'discrete_bootstrap' };
  if (o.length < 2) {
    return { score: null, lo: null, hi: null, n: o.length, note: 'too few', interval };
  }
  const items = o.map(brierItem);
  const rnd = mulberry32(seed);
  const means = new Array(reps);
  for (let r = 0; r < reps; r++) {
    let acc = 0;
    for (let i = 0; i < items.length; i++) acc += items[(rnd() * items.length) | 0];
    means[r] = acc / items.length;
  }
  means.sort((a, b) => a - b);
  const score = mean(items);
  const lo = quantile(means, alpha / 2);
  const hi = quantile(means, 1 - alpha / 2);
  // Identical items give a zero-width interval. That is arithmetically honest
  // and rhetorically dangerous: "0.010 [0.010, 0.010]" reads as certainty.
  const degenerate = new Set(items).size === 1;
  return {
    score,
    lo,
    hi,
    n: items.length,
    reps,
    interval,
    note: degenerate ? 'degenerate: every item scored identically — the interval carries no information' : null,
  };
}

/**
 * PAIRED comparison on identical items. Returns the difference A−B with an
 * interval, and whether that interval excludes zero.
 */
export function paired(aPairs, bPairs, opts = {}) {
  if (!Array.isArray(aPairs) || !Array.isArray(bPairs)) {
    throw new TypeError('paired() requires two arrays of labelled items');
  }
  if (aPairs.length && bPairs.length) {
    const missing = aPairs.concat(bPairs).filter((d) => d?.id === undefined).length;
    if (missing) throw new Error('paired() requires an id on every item — unlabelled pairing is unsafe');
  }
  const { reps, seed, alpha } = bootstrapOptions({ seed: opts.seed === undefined ? 7 : opts.seed, ...opts });

  // Duplicate ids on either side silently overwrite in a Map, so a renamed or
  // duplicated risk shrinks n and moves the point estimate with no signal.
  const keyed = new Map();
  for (const d of observed(bPairs)) {
    if (keyed.has(d.id)) {
      throw new Error(`paired() received duplicate id ${JSON.stringify(d.id)} on the B side — cannot pair safely`);
    }
    keyed.set(d.id, d);
  }

  const diffs = [];
  const unmatchedA = [];
  const matchedA = new Set();
  for (const d of observed(aPairs)) {
    if (matchedA.has(d.id)) {
      throw new Error(`paired() received duplicate id ${JSON.stringify(d.id)} on the A side — cannot pair safely`);
    }
    matchedA.add(d.id);
    const other = keyed.get(d.id);
    if (!other) {
      unmatchedA.push(d.id);
      continue;
    }
    if (d.y !== other.y) throw new Error(`paired() matched ${d.id} across different outcomes`);
    diffs.push(brierItem(d) - brierItem(other));
  }
  // Items only on the B side are equally a bug: they were scored for one method
  // and silently dropped from the comparison.
  const unmatchedB = [...keyed.keys()].filter((id) => !matchedA.has(id));

  if (opts.onUnmatched !== 'ignore' && (unmatchedA.length || unmatchedB.length)) {
    throw new Error(
      `paired() sides do not cover the same items — ${unmatchedA.length} only on A, ` +
        `${unmatchedB.length} only on B. Pass the same items to both, or set { onUnmatched: 'ignore' } ` +
        `and read the returned unmatched ids.`
    );
  }

  const interval = { reps, seed, alpha, method: 'discrete_bootstrap' };
  if (diffs.length < 2) {
    return { diff: null, lo: null, hi: null, n: diffs.length, significant: null, unmatchedA, unmatchedB, interval };
  }
  const rnd = mulberry32(seed);
  const means = new Array(reps);
  for (let r = 0; r < reps; r++) {
    let acc = 0;
    for (let i = 0; i < diffs.length; i++) acc += diffs[(rnd() * diffs.length) | 0];
    means[r] = acc / diffs.length;
  }
  means.sort((x, y) => x - y);
  const lo = quantile(means, alpha / 2);
  const hi = quantile(means, 1 - alpha / 2);
  return {
    diff: mean(diffs),
    lo,
    hi,
    n: diffs.length,
    significant: lo > 0 || hi < 0,
    unmatchedA,
    unmatchedB,
    interval,
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
