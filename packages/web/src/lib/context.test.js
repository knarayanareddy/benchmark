import { describe, it, expect, vi, afterEach } from 'vitest';
import { enqueue, flush, pending } from './queue.js';
import { sendEstimate } from './send.js';
import { createSecret } from './device.js';
import { blindServer, json, routes } from '../test-helpers.js';

afterEach(() => { vi.unstubAllGlobals(); });

describe('the offline queue keeps an answer context', () => {
  it('enqueue without context stores no context key', async () => {
    await enqueue('C1', 0.3);
    const [q] = await pending();
    expect(q).toMatchObject({ cardId: 'C1', p: 0.3 });
    expect('context' in q).toBe(false);
  });

  it('enqueue with an empty context stores no context key', async () => {
    await enqueue('C1', 0.3, {});
    const [q] = await pending();
    expect('context' in q).toBe(false);
  });

  it('enqueue with context stores it with the answer', async () => {
    await enqueue('C1', 0.3, { confidence: 2, reason: 'Field report.', coi: true });
    expect(await pending()).toMatchObject([{ cardId: 'C1', p: 0.3, context: { confidence: 2, reason: 'Field report.', coi: true } }]);
  });

  it('flush passes each answer its context, and undefined when there is none', async () => {
    await enqueue('C1', 0.3, { confidence: 2 });
    await enqueue('C2', 0.5);
    const send = vi.fn(async () => {});
    expect(await flush(send)).toEqual({ sent: 2, dropped: 0, left: 0 });
    expect(send).toHaveBeenNthCalledWith(1, 'C1', 0.3, { confidence: 2 });
    expect(send).toHaveBeenNthCalledWith(2, 'C2', 0.5, undefined);
  });
});

describe('sendEstimate carries the context in both modes', () => {
  it('server: the context is in the body, next to cardId and p', async () => {
    const api = routes({ 'POST /api/estimates': (b) => ({ cardId: b.cardId, p: b.p }) });
    await sendEstimate(api, 'server', 'C1', 0.3, { confidence: 3, reason: 'x', evidenceType: 'data', coi: true });
    expect(api).toHaveBeenCalledWith('POST', '/api/estimates', { cardId: 'C1', p: 0.3, confidence: 3, reason: 'x', evidenceType: 'data', coi: true });
  });

  it('server: with no context the body is exactly {cardId, p}', async () => {
    const api = routes({ 'POST /api/estimates': (b) => ({ cardId: b.cardId, p: b.p }) });
    await sendEstimate(api, 'server', 'C1', 0.3);
    const body = api.mock.calls[0][2];
    expect(Object.keys(body)).toEqual(['cardId', 'p']);
  });

  it('device: the context is in the anonymous body beside the ballot', async () => {
    const srv = blindServer();
    await createSecret();
    const api = routes({ 'GET /api/blind/key': srv.key, 'POST /api/blind/issue': (b) => srv.issue(b) });
    const seen = [];
    vi.stubGlobal('fetch', vi.fn(async (url, init) => { seen.push(JSON.parse(init.body)); return json({ ok: true }); }));
    await sendEstimate(api, 'device', 'C1', 0.4, { confidence: 1, evidenceType: 'analysis' });
    expect(seen[0]).toMatchObject({ cardId: 'C1', p: 0.4, confidence: 1, evidenceType: 'analysis' });
    expect(srv.verify('C1', seen[0].token, seen[0].signature)).toBe(true);
  });

  it('device: with no context the body is the ballot and p only', async () => {
    const srv = blindServer();
    await createSecret();
    const api = routes({ 'GET /api/blind/key': srv.key, 'POST /api/blind/issue': (b) => srv.issue(b) });
    const seen = [];
    vi.stubGlobal('fetch', vi.fn(async (url, init) => { seen.push(JSON.parse(init.body)); return json({ ok: true }); }));
    await sendEstimate(api, 'device', 'C1', 0.4);
    expect(Object.keys(seen[0]).sort()).toEqual(['cardId', 'p', 'signature', 'token']);
  });
});
