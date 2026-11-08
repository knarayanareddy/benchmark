/**
 * RSA full-domain-hash BLIND signatures, in BigInt, so the same code runs in a
 * browser (the expert's device) and on the server.
 *
 * Why: to let each expert answer a card once WITHOUT the server being able to
 * link the answer to them. The expert's device picks a secret token, blinds it,
 * and the server signs the blinded value for an authenticated expert (at most
 * once per card). The device unblinds the signature and later submits
 * (token, signature, answer) with NO login. The server can check the signature
 * is its own and that the token is fresh, but cannot connect the unblinded
 * token to the earlier signing request. That is blindness.
 *
 *   m   = FDH(message)            message = "ballot:v1:<cardId>:<token>"
 *   B   = m * r^e  mod n          (device; r random, coprime to n)
 *   S'  = B^d      mod n          (server)
 *   S   = S' * r^-1 mod n         (device)       S^e == m  <=>  valid
 *
 * !! This is textbook RSA-FDH blinding (Chaum), implemented here rather than
 * taken from an audited library, and it has not been reviewed by a
 * cryptographer. Do not rely on it for real anonymity before it has been.
 * RFC 9474 (RSABSSA) is the standard to migrate to.
 */
import { sha256, hmacSha256, utf8 } from './hmac.js';

export const BLIND_SCHEME = 'rsa-fdh-sha256-v1';

/** @param {Uint8Array} bytes */
export const bytesToBig = (bytes) => {
  let x = 0n;
  for (const b of bytes) x = (x << 8n) | BigInt(b);
  return x;
};

/** @param {bigint} x @param {number} len */
export function bigToBytes(x, len) {
  const out = new Uint8Array(len);
  let v = x;
  for (let i = len - 1; i >= 0; i--) { out[i] = Number(v & 0xffn); v >>= 8n; }
  if (v !== 0n) throw new RangeError('number does not fit in the requested length');
  return out;
}

export const hexToBytes = (/** @type {string} */ h) => {
  if (!/^([0-9a-f]{2})*$/i.test(h)) throw new TypeError('not hex');
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  return out;
};
export const bytesToHex = (/** @type {Uint8Array} */ b) => [...b].map((x) => x.toString(16).padStart(2, '0')).join('');

/** b^e mod m by square-and-multiply. @param {bigint} b @param {bigint} e @param {bigint} m */
export function modPow(b, e, m) {
  let result = 1n;
  let base = ((b % m) + m) % m;
  let exp = e;
  while (exp > 0n) {
    if (exp & 1n) result = (result * base) % m;
    base = (base * base) % m;
    exp >>= 1n;
  }
  return result;
}

/** @param {bigint} a @param {bigint} b */
export function gcd(a, b) {
  let x = a < 0n ? -a : a;
  let y = b < 0n ? -b : b;
  while (y) [x, y] = [y, x % y];
  return x;
}

/** Modular inverse by the extended Euclidean algorithm; throws if none exists. @param {bigint} a @param {bigint} m */
export function modInv(a, m) {
  let [r0, r1] = [((a % m) + m) % m, m];
  let [s0, s1] = [1n, 0n];
  while (r1) {
    const q = r0 / r1;
    [r0, r1] = [r1, r0 - q * r1];
    [s0, s1] = [s1, s0 - q * s1];
  }
  if (r0 !== 1n) throw new RangeError('no modular inverse');
  return ((s0 % m) + m) % m;
}

const nLen = (/** @type {bigint} */ n) => Math.ceil(n.toString(16).length / 2);

/**
 * Full-domain hash: expand SHA-256 in counter mode to the modulus size plus 64
 * bits (so the reduction mod n is uniform to within 2^-64), then reduce.
 * @param {string} message @param {bigint} n
 */
export function fdh(message, n) {
  const need = nLen(n) + 8;
  const out = new Uint8Array(need + 32);
  const msg = utf8(message);
  for (let i = 0, off = 0; off < need; i++, off += 32) {
    const block = new Uint8Array(4 + msg.length + 24);
    new DataView(block.buffer).setUint32(0, i);
    block.set(msg, 4);
    block.set(utf8('benchmark-blind-fdh-v1').subarray(0, 24), 4 + msg.length);
    out.set(sha256(block), off);
  }
  return bytesToBig(out.subarray(0, need)) % n;
}

/** The message a token is signed over; the card id stops a token being reused on another card. */
export const ballotMessage = (/** @type {string} */ cardId, /** @type {string} */ token) => `ballot:v1:${cardId}:${token}`;

/**
 * Derive everything a device needs from ONE secret, so a recovery code is just that secret.
 * Deterministic on purpose: asking the server again for the same card repeats the same
 * blinded value, so a lost response can be re-fetched without a second token.
 * @param {Uint8Array} secret 32 bytes held only by the device
 * @param {string} cardId
 * @param {bigint} n
 */
export function deriveBallot(secret, cardId, n) {
  const token = bytesToHex(hmacSha256(secret, `ballot:token:${cardId}`));
  const len = nLen(n) + 8;
  const stream = new Uint8Array(len + 32);
  for (let i = 0, off = 0; off < len; i++, off += 32) stream.set(hmacSha256(secret, `ballot:blind:${cardId}:${i}`), off);
  let r = bytesToBig(stream.subarray(0, len)) % n;
  if (r < 2n || gcd(r, n) !== 1n) r = (r + 2n) % n; // astronomically unlikely
  return { token, r };
}

/** @param {bigint} n @param {bigint} e @param {string} message @param {bigint} r */
export function blind(n, e, message, r) {
  if (gcd(r, n) !== 1n) throw new RangeError('blinding factor must be coprime to the modulus');
  return (fdh(message, n) * modPow(r, e, n)) % n;
}

/** @param {bigint} n @param {bigint} blindSig @param {bigint} r */
export const unblind = (n, blindSig, r) => (blindSig * modInv(r, n)) % n;

/** @param {bigint} n @param {bigint} e @param {string} message @param {bigint} sig */
export function verify(n, e, message, sig) {
  if (sig <= 0n || sig >= n) return false;
  return modPow(sig, e, n) === fdh(message, n);
}

/** Private-key operation; the server uses node:crypto for speed, this exists for tests and tooling. @param {bigint} n @param {bigint} d @param {bigint} blinded */
export const signBlinded = (n, d, blinded) => modPow(blinded, d, n);

export { nLen as modulusBytes };
