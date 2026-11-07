import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { sha256, hmacSha256Hex, toHex } from '@benchmark/core/hmac';

test('sha256 matches node:crypto across block-boundary lengths', () => {
  for (const len of [0, 1, 55, 56, 63, 64, 65, 119, 120, 128, 1000]) {
    const msg = 'x'.repeat(len);
    assert.equal(toHex(sha256(msg)), crypto.createHash('sha256').update(msg).digest('hex'), `len ${len}`);
  }
});

test('hmac-sha256 matches RFC 4231 test cases 1, 2 and 6 (key longer than a block)', () => {
  const hex = (b) => Buffer.from(b).toString();
  assert.equal(
    hmacSha256Hex(Uint8Array.from(Buffer.alloc(20, 0x0b)), 'Hi There'),
    'b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7'
  );
  assert.equal(
    hmacSha256Hex('Jefe', 'what do ya want for nothing?'),
    '5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843'
  );
  assert.equal(
    hmacSha256Hex(Uint8Array.from(Buffer.alloc(131, 0xaa)), 'Test Using Larger Than Block-Size Key - Hash Key First'),
    '60e431591ee0b67f0d8a26aacbf5b77f8e0bc6213728c5140546040f0ee37f54'
  );
  assert.ok(hex);
});

test('hmac-sha256 matches node:crypto on random keys and unicode messages', () => {
  for (let i = 0; i < 50; i++) {
    const key = crypto.randomBytes(1 + (i * 7) % 150);
    const msg = `Adré ${i} ${crypto.randomBytes(i).toString('hex')} ✓`;
    assert.equal(hmacSha256Hex(key, msg), crypto.createHmac('sha256', key).update(msg).digest('hex'));
  }
});
