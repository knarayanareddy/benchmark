import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import * as B from '@benchmark/core/blind';

const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = privateKey.export({ format: 'jwk' });
const big = (s) => B.bytesToBig(Buffer.from(String(s), 'base64url'));
const n = big(jwk.n); const e = big(jwk.e); const d = big(jwk.d);
const secret = Uint8Array.from(crypto.randomBytes(32));

function issue(cardId, sec = secret) {
  const { token, r } = B.deriveBallot(sec, cardId, n);
  const msg = B.ballotMessage(cardId, token);
  const blinded = B.blind(n, e, msg, r);
  const sig = B.unblind(n, B.signBlinded(n, d, blinded), r);
  return { token, r, msg, blinded, sig };
}

test('blind sign then unblind gives a valid signature, and it is exactly the signature the signer would have made on the clear message', () => {
  const x = issue('C1');
  assert.equal(B.verify(n, e, x.msg, x.sig), true);
  assert.equal(x.sig, B.modPow(B.fdh(x.msg, n), d, n), 'unblinding recovers FDH(m)^d');
});

test('the signer sees neither the message nor the signature: different blinding factors give unrelated blinded values that unblind to the SAME signature', () => {
  const msg = B.ballotMessage('C1', 'a'.repeat(64));
  const r1 = 123456789123456789n; const r2 = 987654321987654321n;
  const b1 = B.blind(n, e, msg, r1); const b2 = B.blind(n, e, msg, r2);
  assert.notEqual(b1, b2);
  assert.notEqual(b1, B.fdh(msg, n), 'the blinded value is not the hash of the message');
  assert.equal(B.unblind(n, B.signBlinded(n, d, b1), r1), B.unblind(n, B.signBlinded(n, d, b2), r2));
});

test('a signature is bound to its card and its token, and forgeries fail', () => {
  const x = issue('C1');
  assert.equal(B.verify(n, e, B.ballotMessage('C2', x.token), x.sig), false, 'not valid on another card');
  assert.equal(B.verify(n, e, B.ballotMessage('C1', 'b'.repeat(64)), x.sig), false, 'not valid for another token');
  assert.equal(B.verify(n, e, x.msg, x.sig + 1n), false);
  assert.equal(B.verify(n, e, x.msg, 0n), false);
  assert.equal(B.verify(n, e, x.msg, n), false);
  assert.equal(B.verify(n, e, x.msg, B.bytesToBig(crypto.randomBytes(256)) % n), false);
  const other = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ format: 'jwk' });
  const forged = B.modPow(B.fdh(x.msg, n), big(other.d), big(other.n));
  assert.equal(B.verify(n, e, x.msg, forged % n), false, 'a signature from a different key does not verify');
});

test('everything is derived from one secret, deterministically, so a recovery code is just that secret', () => {
  const a = B.deriveBallot(secret, 'C1', n); const a2 = B.deriveBallot(secret, 'C1', n);
  assert.deepEqual([a.token, a.r], [a2.token, a2.r]);
  assert.notEqual(B.deriveBallot(secret, 'C2', n).token, a.token, 'unlinkable across cards');
  assert.notEqual(B.deriveBallot(Uint8Array.from(crypto.randomBytes(32)), 'C1', n).token, a.token);
  assert.match(a.token, /^[0-9a-f]{64}$/);
  assert.equal(B.gcd(a.r, n), 1n);
  // asking again repeats the SAME blinded value, which is what makes a lost response recoverable
  assert.equal(B.blind(n, e, B.ballotMessage('C1', a.token), a.r), B.blind(n, e, B.ballotMessage('C1', a2.token), a2.r));
});

test("the server's native raw-RSA operation agrees with the BigInt one", () => {
  const x = issue('C1');
  const raw = crypto.privateEncrypt({ key: privateKey, padding: crypto.constants.RSA_NO_PADDING }, Buffer.from(B.bigToBytes(x.blinded, B.modulusBytes(n))));
  assert.equal(B.bytesToBig(raw), B.signBlinded(n, d, x.blinded));
});

test('number helpers: modular inverse, gcd, byte conversion and its overflow guard', () => {
  assert.equal((B.modInv(3n, 11n) * 3n) % 11n, 1n);
  assert.throws(() => B.modInv(6n, 9n), /no modular inverse/);
  assert.equal(B.gcd(48n, 18n), 6n);
  assert.deepEqual([...B.bigToBytes(258n, 3)], [0, 1, 2]);
  assert.throws(() => B.bigToBytes(2n ** 24n, 3), /does not fit/);
  assert.equal(B.bytesToHex(B.hexToBytes('00ff10')), '00ff10');
  assert.throws(() => B.hexToBytes('zz'), TypeError);
  assert.equal(B.modPow(4n, 13n, 497n), 445n, 'the textbook modPow example');
  assert.throws(() => B.blind(n, e, 'm', n), /coprime/);
});
