/**
 * Simulation parameters. No default lives in code: defaults, ranges and status come from assumptions.json (WP8a) via
 * assumptions.js. Resolved parameters are frozen and tracked: reading a key that is not in the table throws, and the
 * keys actually read are recorded so the register coverage test can check the two files against the code.
 */
import { isDeepStrictEqual } from 'node:util';
import { defaultsOf, loadAssumptions } from './assumptions.js';

/**
 * @typedef {object} ParamInfo
 * @property {string} register the judgement-call id (e.g. J05)
 * @property {string} status evidence tag: RAN, DOC, INFERRED, ASSUMED or CODE
 * @property {unknown} value the default from assumptions.json
 * @property {{ min?: number, max?: number, nullable?: boolean, oneOf?: unknown[] } | undefined} range
 */

/** @type {Map<string, ParamInfo> | null} */
let infoCache = null;

/** @returns {Map<string, ParamInfo>} */
function infoByKey() {
  if (infoCache) return infoCache;
  const assumptions = loadAssumptions();
  /** @type {Map<string, ParamInfo>} */
  const map = new Map();
  for (const entry of assumptions.entries) {
    for (const key of entry.keys) {
      map.set(key, {
        register: entry.id,
        status: entry.evidence.tag,
        value: entry.value[key],
        range: entry.range ? /** @type {ParamInfo['range']} */ (entry.range[key]) : undefined,
      });
    }
  }
  infoCache = map;
  return map;
}

/**
 * Check one override against its declared range (the same shapes assumptions.js validates: {min,max}, {oneOf}, nullable).
 * @param {string} key @param {unknown} value @param {ParamInfo} info
 */
function checkValue(key, value, info) {
  const fail = (why) => {
    throw new RangeError(`parameter ${key} = ${JSON.stringify(value)} ${why}`);
  };
  const range = info.range ?? {};
  if (value === null) {
    if (range.nullable === true || (Array.isArray(range.oneOf) && range.oneOf.includes(null))) return;
    fail('may not be null');
  }
  if (Array.isArray(range.oneOf)) {
    if (range.oneOf.some((allowed) => isDeepStrictEqual(allowed, value))) return;
    fail(`must be one of ${JSON.stringify(range.oneOf)}`);
  }
  if (typeof range.min !== 'number' || typeof range.max !== 'number') {
    fail('has no declared range in assumptions.json');
  }
  if (typeof value !== 'number' || !Number.isFinite(value)) fail('must be a finite number');
  if (value < range.min || value > range.max) fail(`is outside [${range.min}, ${range.max}]`);
}

/** @param {unknown} x @returns {unknown} */
function deepFreeze(x) {
  if (x && typeof x === 'object' && !Object.isFrozen(x)) {
    for (const v of Object.values(x)) deepFreeze(v);
    Object.freeze(x);
  }
  return x;
}

/** Names every object has; reading them through the proxy is harmless (for example by await or JSON.stringify). */
const PASS_THROUGH = new Set(['then', 'toJSON']);

/** @type {WeakMap<object, { values: Record<string, number|string|boolean|null>, accessed: Set<string> }>} */
const tracked = new WeakMap();

/**
 * Defaults, overridden by `overrides`, frozen. Throws on an unknown key, an out-of-range or wrongly typed value.
 * Reading an unknown key from the result throws.
 * @param {Record<string, unknown>} [overrides]
 * @returns {import('./types.js').Params}
 */
export function resolveParams(overrides = {}) {
  const info = infoByKey();
  const values = { ...defaultsOf(loadAssumptions()) };
  for (const [key, value] of Object.entries(overrides)) {
    const entry = info.get(key);
    if (!entry) throw new RangeError(`unknown parameter ${key}`);
    checkValue(key, value, entry);
    values[key] = value;
  }
  for (const v of Object.values(values)) deepFreeze(v);
  Object.freeze(values);
  const accessed = new Set();
  const proxy = new Proxy(values, {
    get(target, key) {
      if (typeof key === 'symbol' || PASS_THROUGH.has(key)) return Reflect.get(target, key);
      if (!Object.prototype.hasOwnProperty.call(target, key)) {
        throw new RangeError(`unknown parameter ${key}`);
      }
      accessed.add(key);
      return target[key];
    },
    set() {
      throw new TypeError('parameters are frozen');
    },
    defineProperty() {
      throw new TypeError('parameters are frozen');
    },
    deleteProperty() {
      throw new TypeError('parameters are frozen');
    },
  });
  tracked.set(proxy, { values, accessed });
  return /** @type {import('./types.js').Params} */ (proxy);
}

/**
 * Keys read from a resolved parameter object so far. Used by the register coverage test.
 * @param {object} params
 * @returns {string[]}
 */
export function paramKeysAccessed(params) {
  const t = tracked.get(params);
  if (!t) throw new TypeError('not a parameter object from resolveParams');
  return [...t.accessed];
}

/**
 * Every parameter with its current value, default, evidence tag and register id. Reading the table does not count as
 * reading the parameters.
 * @param {object} params
 * @returns {Array<{ key:string, value:unknown, default:unknown, status:string, register:string }>}
 */
export function paramTable(params) {
  const t = tracked.get(params);
  if (!t) throw new TypeError('not a parameter object from resolveParams');
  return [...infoByKey()].map(([key, info]) => ({
    key,
    value: t.values[key] ?? null,
    default: info.value,
    status: info.status,
    register: info.register,
  }));
}
