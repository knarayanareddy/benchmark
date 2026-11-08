/**
 * Labelling and refusal. Every synthetic output carries BANNER; every pilot-analysis entry point calls
 * assertNotSynthetic so simulated cards can never be scored as if they were real.
 */
import { KINDS } from './types.js';

export const BANNER = 'SYNTHETIC: simulation under stated assumptions, not a result';

/** The same statement in the upper-case form used on CSV line 1 and in the report banner. */
export const BANNER_UPPER = 'SIMULATION UNDER STATED ASSUMPTIONS, NOT A RESULT';

export const REAL_BANNER = '# REAL DATA (historical, already resolved), not simulated.';

const SIM_PREFIX = 'SIM-';

/**
 * @param {number} i 1-based card index
 * @param {'risk'|'trigger'} [kind]
 * @returns {string}
 */
export function simCardId(i, kind = 'risk') {
  if (!KINDS.includes(kind)) throw new RangeError(`unknown card kind ${String(kind)}`);
  if (!Number.isInteger(i) || i < 1) throw new RangeError(`card index must be a positive integer, got ${i}`);
  const digits = String(i).padStart(6, '0');
  return kind === 'trigger' ? `SIM-T${digits}` : `SIM-${digits}`;
}

/**
 * Throws if x is flagged synthetic (`synthetic === true`) or carries a `SIM-` id. Arrays are checked element by
 * element; a bare string is checked as an id. Anything else passes.
 * @param {unknown} x
 * @returns {void}
 */
export function assertNotSynthetic(x) {
  if (Array.isArray(x)) {
    for (const item of x) assertNotSynthetic(item);
    return;
  }
  if (typeof x === 'string') {
    if (x.startsWith(SIM_PREFIX)) throw new Error(`refusing synthetic id ${x}`);
    return;
  }
  if (x && typeof x === 'object') {
    const o = /** @type {Record<string, unknown>} */ (x);
    if (o.synthetic === true) throw new Error('refusing input flagged synthetic');
    if (typeof o.id === 'string' && o.id.startsWith(SIM_PREFIX)) {
      throw new Error(`refusing synthetic id ${o.id}`);
    }
  }
}

/**
 * A copy of obj flagged synthetic. The copy is not checked against assertNotSynthetic: marking is how synthetic
 * objects are made.
 * @template {object} T
 * @param {T} obj
 * @returns {T & { synthetic: true }}
 */
export function markSynthetic(obj) {
  return { ...obj, synthetic: true };
}

/**
 * First lines of a CSV. Synthetic files get the simulation banner with seed and run; REAL-* files get the real-data
 * banner. The column header row (starting with `synthetic`) is written by the caller.
 * @param {{ seed: number|string, runId: string, real?: boolean }} meta
 * @returns {string[]}
 */
export function csvHeaderLines(meta) {
  if (meta.real) return [REAL_BANNER];
  return [`# ${BANNER_UPPER}. Seed=${meta.seed}, run=${meta.runId}`];
}
