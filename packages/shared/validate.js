/**
 * @core/validate — strict whitelist validation for anything that leaves a device.
 *
 * The rule that matters: unknown keys are REJECTED, not stripped. A silently
 * stripped identifier is an identifier someone believed they had removed.
 */

/** schema: { field: (value) => boolean } */
export function strict(schema, input = {}) {
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

/** k-anonymity: cells below k are suppressed before display, not rounded. */
export function suppress(rows, k = 10) {
  return rows.map((r) => (r.count < k ? Object.assign({}, r, { count: null, suppressed: true }) : r));
}

/** A rate is never reported without its denominator. */
export function rate(numerator, denominator, opts = {}) {
  const minN = opts.minN == null ? 100 : opts.minN;
  if (!denominator) return { value: null, numerator, denominator, note: 'no denominator' };
  return {
    value: numerator / denominator,
    numerator, denominator,
    note: denominator < minN ? 'small denominator — treat as indicative' : null,
  };
}
