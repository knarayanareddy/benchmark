// The device-held ballot secret is 32 random bytes. The recovery code is that secret in a
// form a person can write down: Crockford base32 in groups of four, plus a 2-character
// checksum so a mistyped code is caught instead of silently becoming a different key.
import { sha256 } from '@benchmark/core/hmac';

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** @param {Uint8Array} bytes */
function toBase32(bytes) {
  let bits = 0; let value = 0; let out = '';
  for (const b of bytes) {
    value = (value << 8) | b; bits += 8;
    while (bits >= 5) { out += ALPHABET[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

/** @param {string} s @returns {Uint8Array} */
function fromBase32(s) {
  let bits = 0; let value = 0; const out = [];
  for (const ch of s) {
    const v = ALPHABET.indexOf(ch);
    if (v < 0) throw new Error('not a recovery code');
    value = (value << 5) | v; bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Uint8Array.from(out);
}

const check = (/** @type {Uint8Array} */ secret) => toBase32(sha256(secret).subarray(0, 2)).slice(0, 2);

/** @param {Uint8Array} secret 32 bytes @returns {string} like ABCD-EFGH-... */
export function encodeRecovery(secret) {
  if (secret.length !== 32) throw new RangeError('the secret must be 32 bytes');
  return `${toBase32(secret)}${check(secret)}`.match(/.{1,4}/g)?.join('-') ?? '';
}

/** Accepts lower case, spaces, dashes, and the look-alike letters (O for 0, I and L for 1). @param {string} code @returns {Uint8Array} */
export function decodeRecovery(code) {
  const clean = String(code).toUpperCase().replace(/[\s-]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
  if (clean.length !== 54) throw new Error('A recovery code has 54 characters. Check it and try again.');
  const body = clean.slice(0, 52);
  const secret = fromBase32(body).subarray(0, 32);
  if (check(secret) !== clean.slice(52)) throw new Error('That code does not check out: one character is wrong.');
  return secret;
}
