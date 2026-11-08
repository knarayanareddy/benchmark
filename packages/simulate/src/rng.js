/**
 * Seeded randomness. mulberry32 for the stream, FNV-1a to turn names into seeds, Box–Muller for normals (no caching,
 * so each normal costs exactly two draws).
 *
 * Streams are split by name, not by position: `fork(tag)` seeds a child from the parent's ROOT seed and the tag, never
 * from its current state. So drawing from a parent (or from a sibling) cannot shift a child, and adding a draw in one
 * place never moves another stream.
 */

const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

/**
 * FNV-1a 32-bit over the parts, joined with a separator that cannot appear in the numeric parts.
 * @param {...(string|number|boolean|null)} parts
 * @returns {number} unsigned 32-bit
 */
export function hashSeed(...parts) {
  const text = parts.map((p) => String(p)).join('\u001f');
  let h = FNV_OFFSET;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, FNV_PRIME);
  }
  return h >>> 0;
}

/** @param {number} x @returns {number} */
export function expit(x) {
  return 1 / (1 + Math.exp(-x));
}

/** @param {number} p @returns {number} */
export function logit(p) {
  return Math.log(p / (1 - p));
}

/**
 * @typedef {object} Rng
 * @property {() => number} next uniform on [0, 1)
 * @property {() => number} normal standard normal (Box–Muller, two draws each)
 * @property {(n:number) => number} int uniform integer in [0, n)
 * @property {(a:number, b:number) => number} uniform uniform on [a, b)
 * @property {(a:number, b:number) => number} beta Beta(a, b)
 * @property {(p:number) => 0|1} bernoulli 1 with probability p
 * @property {(tag:string) => Rng} fork independent child stream named by tag
 */

/**
 * @param {number} seed unsigned 32-bit
 * @returns {() => number}
 */
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Standard gamma via Marsaglia–Tsang; shape < 1 is boosted from shape + 1.
 * @param {Rng} rng @param {number} shape @returns {number}
 */
function gamma(rng, shape) {
  if (shape < 1) return gamma(rng, shape + 1) * Math.pow(1 - rng.next(), 1 / shape);
  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  for (;;) {
    const x = rng.normal();
    const v = (1 + c * x) ** 3;
    if (v <= 0) continue;
    const u = 1 - rng.next();
    if (u < 1 - 0.0331 * x ** 4) return d * v;
    if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
}

/**
 * @param {number | string} seed a 32-bit integer, or any string (hashed with FNV-1a)
 * @returns {Rng}
 */
export function makeRng(seed) {
  const root = typeof seed === 'string' ? hashSeed(seed) : seed;
  if (typeof root !== 'number' || !Number.isInteger(root)) {
    throw new TypeError(`makeRng needs an integer or string seed, got ${String(seed)}`);
  }
  const rootSeed = root >>> 0;
  const next = mulberry32(rootSeed);
  /** @type {Rng} */
  const rng = {
    next,
    normal() {
      const u1 = 1 - next();
      const u2 = next();
      return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    },
    int(n) {
      if (!Number.isInteger(n) || n <= 0) throw new RangeError(`int needs a positive integer, got ${n}`);
      return Math.floor(next() * n);
    },
    uniform(a, b) {
      return a + (b - a) * next();
    },
    beta(a, b) {
      if (!(a > 0) || !(b > 0)) throw new RangeError(`beta needs positive shapes, got ${a}, ${b}`);
      const x = gamma(rng, a);
      const y = gamma(rng, b);
      return x / (x + y);
    },
    bernoulli(p) {
      return next() < p ? 1 : 0;
    },
    fork(tag) {
      return makeRng(hashSeed(rootSeed, tag));
    },
  };
  return rng;
}
