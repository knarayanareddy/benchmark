import { describe, it, expect, vi } from 'vitest';
import crypto from 'node:crypto';
import { kvGet, kvSet, resetKv } from './kv.js';
import { createApi, ApiError, asErr } from './api.js';
import { encodeRecovery, decodeRecovery } from './recovery.js';
import { createSecret, getSecret, obtainBallot, cachedBallot, clearDevice, hasDeviceSecret, knownCards } from './device.js';
import { enqueue, flush, pending } from './queue.js';
import * as B from '@benchmark/core/blind';

describe('kv', () => {
  it('stores and returns structured values, and resets', async () => {
    await kvSet('a', { x: [1, 2] });
    expect(await kvGet('a')).toEqual({ x: [1, 2] });
    await resetKv();
    expect(await kvGet('a')).toBeUndefined();
  });
});

describe('api', () => {
  it('sends the stored token, parses errors, and reports a dead network as offline', async () => {
    await kvSet('tok', 'abc');
    const call = createApi('tok');
    const seen = [];
    vi.stubGlobal('fetch', vi.fn(async (url, init) => { seen.push(init.headers.authorization); return new Response(JSON.stringify({ ok: 1 }), { status: 200 }); }));
    expect(await call('GET', '/x')).toEqual({ ok: 1 });
    expect(seen[0]).toBe('Bearer abc');
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'nope' }), { status: 409 })));
    await expect(call('POST', '/x', {})).rejects.toMatchObject({ message: 'nope', status: 409, offline: false });
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('failed to fetch'); }));
    await expect(call('GET', '/x')).rejects.toMatchObject({ offline: true });
    expect(asErr('boom')).toBeInstanceOf(ApiError);
  });
});

describe('recovery code', () => {
  it('round-trips, tolerates how people copy it, and catches a wrong character', () => {
    const secret = Uint8Array.from(crypto.randomBytes(32));
    const code = encodeRecovery(secret);
    expect(code).toMatch(/^([0-9A-Z]{4}-){13}[0-9A-Z]{2}$/);
    expect(Buffer.from(decodeRecovery(code))).toEqual(Buffer.from(secret));
    expect(Buffer.from(decodeRecovery(code.toLowerCase().replaceAll('-', ' ')))).toEqual(Buffer.from(secret));
    const wrong = code.replace(/[1-9A-Z]/, (c) => (c === 'A' ? 'B' : 'A'));
    expect(() => decodeRecovery(wrong)).toThrow(/does not check out/);
    expect(() => decodeRecovery('ABCD')).toThrow(/54 characters/);
    expect(() => decodeRecovery('!'.repeat(54))).toThrow();
    expect(() => encodeRecovery(new Uint8Array(5))).toThrow(RangeError);
  });

  it('is unambiguous: I, L and O read as 1, 1 and 0, so a copy error cannot change the key silently', () => {
    const secret = Uint8Array.from({ length: 32 }, (_, i) => i * 7);
    const code = encodeRecovery(secret);
    expect(code).not.toMatch(/[ILOU]/);
    expect(Buffer.from(decodeRecovery(code.replaceAll('1', 'l').replaceAll('0', 'o')))).toEqual(Buffer.from(secret));
  });
});

describe('device key and blind ballots', () => {
  const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = privateKey.export({ format: 'jwk' });
  const pub = { scheme: B.BLIND_SCHEME, n: jwk.n, e: jwk.e };
  const big = (s) => B.bytesToBig(Buffer.from(s, 'base64url'));
  const fakeServer = () => {
    const issued = new Map();
    const api = vi.fn(async (method, path, body) => {
      if (path === '/api/blind/key') return pub;
      if (path === '/api/blind/issue') {
        const prior = issued.get(body.cardId);
        if (prior && prior.blinded !== body.blinded) throw new ApiError('already issued', { status: 409 });
        issued.set(body.cardId, { blinded: body.blinded });
        const b = B.bytesToBig(B.hexToBytes(body.blinded));
        return { signature: B.bytesToHex(B.bigToBytes(B.signBlinded(big(jwk.n), big(jwk.d), b), B.modulusBytes(big(jwk.n)))) };
      }
      throw new Error(`unexpected ${path}`);
    });
    return api;
  };

  it('a secret is created once, kept on the device, and wiped on request', async () => {
    expect(await hasDeviceSecret()).toBe(false);
    const s = await createSecret();
    expect(s).toHaveLength(32);
    expect(Buffer.from(await getSecret())).toEqual(Buffer.from(s));
    await clearDevice();
    expect(await hasDeviceSecret()).toBe(false);
  });

  it('obtains a ballot that verifies against the public key, caches it, and never sends the secret or the token', async () => {
    const s = await createSecret();
    const api = fakeServer();
    const b = await obtainBallot(api, 'C1');
    const n = big(jwk.n); const e = big(jwk.e);
    expect(B.verify(n, e, B.ballotMessage('C1', b.token), B.bytesToBig(B.hexToBytes(b.signature)))).toBe(true);
    const sent = JSON.stringify(api.mock.calls);
    expect(sent).not.toContain(b.token);
    expect(sent).not.toContain(Buffer.from(s).toString('hex'));
    expect(sent).not.toContain(b.signature);
    expect(await cachedBallot('C1')).toMatchObject({ token: b.token });
    expect(await knownCards()).toEqual(['C1']);
    const calls = api.mock.calls.length;
    await obtainBallot(api, 'C1');
    expect(api.mock.calls.length).toBe(calls);
  });

  it('after losing the cache, the same secret rebuilds the same ballot (the recovery case)', async () => {
    const s = await createSecret();
    const first = await obtainBallot(fakeServer(), 'C1');
    await resetKv();
    const { setSecret } = await import('./device.js');
    await setSecret(decodeRecovery(encodeRecovery(s)));
    const again = await obtainBallot(fakeServer(), 'C1');
    expect(again.token).toBe(first.token);
    expect(again.signature).toBe(first.signature);
  });

  it('refuses a signature that does not verify instead of using it', async () => {
    await createSecret();
    const bad = vi.fn(async (m, path) => (path === '/api/blind/key' ? pub : { signature: '0a'.repeat(256) }));
    await expect(obtainBallot(bad, 'C1')).rejects.toThrow(/does not verify/);
    expect(await cachedBallot('C1')).toBeNull();
  });

  it('says so when this device holds no key', async () => {
    await expect(obtainBallot(fakeServer(), 'C1')).rejects.toThrow(/does not hold your key/);
  });
});

describe('offline queue', () => {
  it('keeps one answer per card, sends in order, and keeps only what failed for lack of a network', async () => {
    await enqueue('C1', 0.2);
    await enqueue('C2', 0.5);
    await enqueue('C1', 0.3);
    expect((await pending()).map((q) => [q.cardId, q.p])).toEqual([['C2', 0.5], ['C1', 0.3]]);
    const sent = [];
    const r = await flush(async (cardId, p) => {
      if (cardId === 'C1') throw new ApiError('You appear to be offline.', { offline: true });
      sent.push([cardId, p]);
    });
    expect(r).toEqual({ sent: 1, dropped: 0, left: 1 });
    expect(sent).toEqual([['C2', 0.5]]);
    expect((await pending()).map((q) => q.cardId)).toEqual(['C1']);
    const r2 = await flush(async () => { throw new ApiError('already answered', { status: 409 }); });
    expect(r2).toEqual({ sent: 0, dropped: 1, left: 0 });
    expect(await pending()).toEqual([]);
  });
});
