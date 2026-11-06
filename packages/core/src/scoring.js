/**
 * Scoring — Brier with a bootstrap interval, and PAIRED comparisons.
 *
 * The rule this file enforces: no point estimate is ever returned without an
 * interval, and no two methods are ever compared unless they were scored on the
 * same items. At n≈104 the standard error on a Brier score is ~0.04–0.05, which
 * is larger than the gap between ACAPS's rating and any model tried.
 * Comparing them unpaired would be a mistake a juror should catch.
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
 *    Risk Level. Applied to the export it holds on 97 of 125 rows. On the other
 *    28 the analyst departed from it — 22 of them upwards, and 16 of the 22
 *    with a resolved outcome materialised (73% vs a 59% base rate). Two
 *    consequences: (a) the 28 departures are analyst knowledge that the two
 *    axes do not capture, which is exactly what this product exists to elicit;
 *    (b) for the 97 rows that follow the matrix, Probability already determines
 *    Risk Level, so a model containing both is fitting one field twice — which
 *    the earlier "four-field" model did. The model here uses only the fields
 *    that survive that test.
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

/** pairs: [{p: 0..1, y: 0|1|null}] — null y is unobservable and is EXCLUDED. */
export function observed(pairs) {
  return pairs.filter((d) => d.y === 0 || d.y === 1);
}

export function brierItem(d) {
  const e = d.p - d.y;
  return e * e;
}

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
  const keyed = new Map(observed(bPairs).map((d, i) => [d.id ?? i, d]));
  const diffs = [];
  for (const d of observed(aPairs)) {
    const other = keyed.get(d.id ?? diffs.length);
    if (!other) continue;
    diffs.push(brierItem(d) - brierItem(other));
  }
  if (diffs.length < 2) return { diff: null, lo: null, hi: null, n: diffs.length, significant: null };
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
    n: diffs.length,
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
