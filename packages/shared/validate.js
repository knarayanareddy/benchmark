/**
 * @core/validate — strict whitelist validation for anything that leaves a device.
 *
 * The rule that matters: unknown keys are REJECTED, not stripped. A silently
 * stripped identifier is an identifier someone believed they had removed.
 */

const isPlainObject = (v) =>
  v !== null && typeof v === 'object' && !Array.isArray(v);

/** schema: { field: (value) => boolean } */
export function strict(schema, input = {}) {
  if (!isPlainObject(schema)) {
    throw new TypeError('strict() requires a schema object of field -> predicate');
  }
  // Return validation errors for the worst input, never throw a TypeError:
  // a validator that crashes on null is not a validator.
  if (!isPlainObject(input)) {
    return { ok: false, errors: ['payload must be a plain object, got ' + (input === null ? 'null' : Array.isArray(input) ? 'array' : typeof input)] };
  }
  const errors = [];
  for (const k of Object.keys(input)) {
    if (!(k in schema)) errors.push('unknown field: ' + k);
  }
  for (const k of Object.keys(schema)) {
    if (input[k] === undefined) errors.push('missing field: ' + k);
    else if (!schema[k](input[k])) errors.push('invalid ' + k + ': ' + String(input[k]).slice(0, 40));
  }
  if (errors.length) return { ok: false, errors };
  const payload = {};
  for (const k of Object.keys(schema)) payload[k] = input[k];
  return { ok: true, payload };
}

/**
 * k-anonymity: cells below k are suppressed before display, not rounded.
 *
 * A cell whose count is missing or non-numeric is suppressed, not published.
 * `undefined < 10` is `false`, so the naive comparison passed the cell through
 * untouched — and an uncountable cell is the one most likely to be a person.
 */
export function suppress(rows, k = 10) {
  if (!Array.isArray(rows)) throw new TypeError('suppress() requires an array of rows');
  if (!Number.isInteger(k) || k < 1) {
    throw new RangeError(`suppress() requires a positive integer k, got ${JSON.stringify(k)}`);
  }
  return rows.map((r) => {
    const n = Number(r?.count);
    if (Number.isFinite(n) && n >= k) return r;
    return Object.assign({}, r, {
      count: null,
      suppressed: true,
      why: r?.count === undefined || r?.count === null ? 'no count' : 'below k',
    });
  });
}

/** A rate is never reported without its denominator. */
export function rate(numerator, denominator, opts = {}) {
  const minN = opts.minN == null ? 100 : opts.minN;
  if (!Number.isFinite(numerator) || numerator < 0) {
    throw new RangeError(`rate() numerator must be a finite count >= 0, got ${JSON.stringify(numerator)}`);
  }
  if (!Number.isFinite(denominator) || denominator < 0) {
    throw new RangeError(`rate() denominator must be a finite count >= 0, got ${JSON.stringify(denominator)}`);
  }
  if (denominator === 0) return { value: null, numerator, denominator, note: 'no denominator' };
  return {
    value: numerator / denominator,
    numerator, denominator,
    note: denominator < minN ? 'small denominator — treat as indicative' : null,
  };
}
