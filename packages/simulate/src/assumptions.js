// Loads and validates assumptions.json: the one list of every judgement call and
// default the simulator uses, and the source of the ACAPS-facing register (power-spec §F WP8).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

/** @typedef {'RAN'|'DOC'|'INFERRED'|'ASSUMED'|'CODE'} EvidenceTag */
/** @typedef {'proposed'|'accepted'|'changed'|'vetoed'} ReviewState */
/**
 * @typedef {{ tag: EvidenceTag, source: string, note: string, refs?: string[] }} Evidence
 * @typedef {{ setting: string, result: string, tag: EvidenceTag, source: string }} IfWrong
 * @typedef {{ state: ReviewState, by: string|null, date: string|null, note: string|null }} Review
 * @typedef {{ id: string, keys: string[], plain: string, options: string[], value: Record<string, unknown>,
 *   range: Record<string, unknown>, why: string, evidence: Evidence, veto: string, ifWrong: IfWrong[], review: Review }} Entry
 * @typedef {{ file: string, entries: ReadonlyArray<Readonly<Entry>>, byKey: ReadonlyMap<string, Readonly<Entry>> }} Assumptions
 */

export const ASSUMPTIONS_PATH = fileURLToPath(new URL('../assumptions.json', import.meta.url));
export const EVIDENCE_TAGS = Object.freeze(['RAN', 'DOC', 'INFERRED', 'ASSUMED', 'CODE']);
export const REVIEW_STATES = Object.freeze(['proposed', 'accepted', 'changed', 'vetoed']);

const ID_PATTERN = /^J\d{2}$/;
const KEY_PATTERN = /^[A-Za-z][A-Za-z0-9]*$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const isObject = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const nonEmpty = (x) => typeof x === 'string' && x.trim() !== '';
const show = (x) => (typeof x === 'string' ? `"${x}"` : JSON.stringify(x));

/** Checks one key's range shape and returns a problem string, or null if the range is usable. */
function rangeProblem(where, key, range) {
  if (!isObject(range)) return `${where}: the range for "${key}" must be an object`;
  if (Array.isArray(range.oneOf)) {
    return range.oneOf.length > 0 ? null : `${where}: the list of allowed values for "${key}" is empty`;
  }
  if (typeof range.min !== 'number' || typeof range.max !== 'number' || range.min > range.max) {
    return `${where}: the range for "${key}" needs a "min" and a "max" (min at most max), or a "oneOf" list`;
  }
  return null;
}

/** Checks one chosen value against its range. */
function valueProblems(where, key, value, range) {
  if (value === null) {
    const allowsNull = range.nullable === true || (Array.isArray(range.oneOf) && range.oneOf.includes(null));
    return allowsNull ? [] : [`${where}: "${key}" has no value (null); give a value inside its range`];
  }
  if (Array.isArray(range.oneOf)) {
    return range.oneOf.some((allowed) => isDeepStrictEqual(allowed, value))
      ? []
      : [`${where}: the value ${show(value)} for "${key}" is not one of the allowed values: ${range.oneOf.map(show).join(', ')}`];
  }
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return [`${where}: the value ${show(value)} for "${key}" must be a number`];
  }
  if (value < range.min || value > range.max) {
    return [`${where}: the value ${value} for "${key}" is outside the allowed range ${range.min} to ${range.max}`];
  }
  return [];
}

/**
 * Lists every problem with a parsed assumptions file, in plain language. Empty means valid.
 * @param {unknown} data
 * @returns {string[]}
 */
export function validate(data) {
  const errors = [];
  if (!isObject(data)) return ['The file must be a JSON object with an "entries" list.'];
  if (data.schemaVersion !== 1) errors.push('The file must say "schemaVersion": 1.');
  if (!Array.isArray(data.entries)) return [...errors, 'The file has no "entries" list.'];

  /** @type {Map<string, string>} */
  const idSeen = new Map();
  /** @type {Map<string, string>} */
  const keySeen = new Map();

  data.entries.forEach((entry, index) => {
    if (!isObject(entry)) {
      errors.push(`Entry number ${index + 1} is not an object.`);
      return;
    }
    const id = entry.id;
    const where = nonEmpty(id) ? `Entry ${id}` : `Entry number ${index + 1}`;
    if (!nonEmpty(id)) {
      errors.push(`${where}: the id is missing.`);
    } else if (!ID_PATTERN.test(id)) {
      errors.push(`${where}: the id must look like J01.`);
    }
    if (nonEmpty(id)) {
      if (idSeen.has(id)) errors.push(`The id ${id} appears more than once; ids must be unique.`);
      idSeen.set(id, where);
    }

    /** @type {string[]} */
    const keys = [];
    if (!Array.isArray(entry.keys) || entry.keys.length === 0) {
      errors.push(`${where}: the "keys" list is missing or empty.`);
    } else {
      for (const key of entry.keys) {
        if (typeof key !== 'string' || !KEY_PATTERN.test(key)) {
          errors.push(`${where}: "${show(key)}" is not a valid key name (letters and digits, starting with a letter).`);
          continue;
        }
        if (keySeen.has(key)) {
          errors.push(`The key "${key}" is defined in more than one entry (${keySeen.get(key)} and ${where}).`);
        }
        keySeen.set(key, where);
        keys.push(key);
      }
    }

    if (!nonEmpty(entry.plain)) errors.push(`${where}: the plain-language description ("plain") is missing or empty.`);
    if (!nonEmpty(entry.why)) errors.push(`${where}: the reason ("why") is missing or empty.`);
    if (!nonEmpty(entry.veto)) errors.push(`${where}: who may veto ("veto") is missing or empty.`);

    const evidence = entry.evidence;
    if (!isObject(evidence)) {
      errors.push(`${where}: the evidence ("evidence") is missing.`);
    } else {
      if (!EVIDENCE_TAGS.includes(/** @type {string} */ (evidence.tag))) {
        errors.push(`${where}: the evidence tag ${show(evidence.tag)} is not one of ${EVIDENCE_TAGS.join(', ')}.`);
      }
      if (!nonEmpty(evidence.source)) errors.push(`${where}: the evidence has no source; say where the number comes from.`);
      if (!nonEmpty(evidence.note)) errors.push(`${where}: the evidence note is missing or empty.`);
      if (evidence.refs !== undefined && !(Array.isArray(evidence.refs) && evidence.refs.every(nonEmpty))) {
        errors.push(`${where}: "evidence.refs" must be a list of file names.`);
      }
    }

    const isCode = isObject(evidence) && evidence.tag === 'CODE';
    if (!Array.isArray(entry.options) || !entry.options.every(nonEmpty)) {
      errors.push(`${where}: "options" must be a list of option texts.`);
    } else if (!isCode && entry.options.length < 2) {
      errors.push(`${where}: "options" must list at least two options considered.`);
    }

    const value = isObject(entry.value) ? entry.value : null;
    const range = isObject(entry.range) ? entry.range : null;
    if (!value) errors.push(`${where}: "value" is missing; give the chosen value for each key.`);
    if (!range) errors.push(`${where}: "range" is missing; give the allowed range for each key.`);
    if (value && range) {
      for (const key of keys) {
        const hasValue = Object.hasOwn(value, key);
        const hasRange = Object.hasOwn(range, key);
        if (!hasValue) errors.push(`${where}: no value is given for key "${key}".`);
        if (!hasRange) errors.push(`${where}: no range is given for key "${key}".`);
        if (hasRange) {
          const bad = rangeProblem(where, key, range[key]);
          if (bad) errors.push(bad);
          else if (hasValue) errors.push(...valueProblems(where, key, value[key], /** @type {object} */ (range[key])));
        }
      }
      for (const key of [...Object.keys(value), ...Object.keys(range)]) {
        if (!keys.includes(key)) errors.push(`${where}: "${key}" is given a value or range but is not listed in keys.`);
      }
    }

    if (!Array.isArray(entry.ifWrong) || entry.ifWrong.length === 0) {
      errors.push(`${where}: the effect if wrong ("ifWrong") is missing; say what changes if this value is wrong.`);
    } else {
      entry.ifWrong.forEach((item, j) => {
        const label = `${where}, effect if wrong ${j + 1}`;
        if (!isObject(item)) {
          errors.push(`${label}: not an object.`);
          return;
        }
        if (!nonEmpty(item.setting)) errors.push(`${label}: "setting" is missing or empty.`);
        if (!nonEmpty(item.result)) errors.push(`${label}: "result" is missing or empty.`);
        if (!EVIDENCE_TAGS.includes(/** @type {string} */ (item.tag))) {
          errors.push(`${label}: the tag ${show(item.tag)} is not one of ${EVIDENCE_TAGS.join(', ')}.`);
        }
        if (!nonEmpty(item.source)) errors.push(`${label}: no source is given.`);
      });
    }

    const review = entry.review;
    if (!isObject(review)) {
      errors.push(`${where}: the review ("review") is missing.`);
    } else if (!REVIEW_STATES.includes(/** @type {string} */ (review.state))) {
      errors.push(`${where}: the review state ${show(review.state)} is not one of ${REVIEW_STATES.join(', ')}.`);
    } else if (review.state !== 'proposed') {
      if (!nonEmpty(review.by)) errors.push(`${where}: review state "${review.state}" needs the reviewer ("by").`);
      if (typeof review.date !== 'string' || !DATE_PATTERN.test(review.date)) {
        errors.push(`${where}: review state "${review.state}" needs a date as YYYY-MM-DD.`);
      }
      if (!nonEmpty(review.note)) errors.push(`${where}: review state "${review.state}" needs a note.`);
    }
  });
  return errors;
}

/** @template T @param {T} x @returns {T} */
function deepFreeze(x) {
  if (x && typeof x === 'object' && !Object.isFrozen(x)) {
    Object.freeze(x);
    for (const child of Object.values(x)) deepFreeze(child);
  }
  return x;
}

/**
 * Reads and validates the assumptions file. Throws one error listing every problem.
 * @param {string} [file]
 * @returns {Readonly<Assumptions>}
 */
export function loadAssumptions(file = ASSUMPTIONS_PATH) {
  let data;
  try {
    data = JSON.parse(readFileSync(file, 'utf8'));
  } catch (err) {
    throw new Error(`Cannot read ${file} as JSON: ${/** @type {Error} */ (err).message}`, { cause: err });
  }
  const problems = validate(data);
  if (problems.length > 0) {
    throw new Error(`${file} has ${problems.length} problem(s):\n- ${problems.join('\n- ')}`);
  }
  const entries = deepFreeze(structuredClone(/** @type {{entries: Entry[]}} */ (data).entries));
  const byKey = new Map();
  for (const entry of entries) for (const key of entry.keys) byKey.set(key, entry);
  return Object.freeze({ file, entries, byKey });
}

/** @type {Readonly<Assumptions>|undefined} */
let shipped;
/** @param {Readonly<Assumptions>} [assumptions] */
const current = (assumptions) => assumptions ?? (shipped ??= loadAssumptions());

/**
 * @param {string} key
 * @param {Readonly<Assumptions>} [assumptions]
 * @returns {unknown}
 */
export function getValue(key, assumptions) {
  const entry = current(assumptions).byKey.get(key);
  if (!entry) throw new Error(`Unknown assumption key "${key}"; add it to assumptions.json first.`);
  return entry.value[key];
}

/** @param {Readonly<Assumptions>} [assumptions] @returns {string[]} */
export function listKeys(assumptions) {
  return [...current(assumptions).byKey.keys()];
}

/**
 * The default value of every key, as the simulator reads it.
 * @param {Readonly<Assumptions>} [assumptions]
 * @returns {Record<string, unknown>}
 */
export function defaults(assumptions) {
  const out = {};
  for (const key of listKeys(assumptions)) out[key] = getValue(key, assumptions);
  return out;
}

/** Same as defaults(); the name WP1's params.js uses. @param {Readonly<Assumptions>} assumptions */
export const defaultsOf = (assumptions) => defaults(assumptions);

/** Keys whose judgement call has not been reviewed yet. @param {Readonly<Assumptions>} [assumptions] @returns {string[]} */
export function unreviewedKeys(assumptions) {
  return listKeys(assumptions).filter((key) => current(assumptions).byKey.get(key)?.review.state === 'proposed');
}

/**
 * Counts of entries (judgement calls) by review state.
 * @param {Readonly<Assumptions>} [assumptions]
 * @returns {{ proposed:number, accepted:number, changed:number, vetoed:number }}
 */
export function reviewSummary(assumptions) {
  const counts = { proposed: 0, accepted: 0, changed: 0, vetoed: 0 };
  for (const entry of current(assumptions).entries) counts[entry.review.state]++;
  return counts;
}
