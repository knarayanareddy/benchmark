import test from 'node:test';
import assert from 'node:assert/strict';
import { createService } from '../src/service.js';
import { createRosterStore, createAnswerStore } from '../src/store.js';
import { createServer, createRateLimiter } from '../src/http.js';
import { CONSENT_VERSION } from '../src/consent.js';

const SECRETS = { ballot: 'ballot-secret-for-tests-0001', alias: 'alias-secret-for-tests-00002' };
const CARD = {
  statement: 'Cholera cases in Chad will exceed 10,000 by 30 April 2027.', country: 'TCD',
  window: { from: '2026-11-01', to: '2027-04-30' }, objective: 'WHO bulletin above 10,000',
  resolutionSource: 'IPC', resolver: 'R. Resolver', probability: 'High',
};

async function boot(opts = {}) {
  const svc = createService({ roster: createRosterStore(), answers: createAnswerStore(), secrets: SECRETS });
  const server = createServer({
    service: svc,
    verifyStaff: async (req, body) => (body.credential === 'mod-ok' ? { id: 'mod1', role: 'moderator' } : null),
    ...opts,
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, path, { token, body, headers } = {}) => {
    const res = await fetch(base + path, {
      method,
      headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
      body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
    });
    const text = await res.text();
    return { status: res.status, headers: res.headers, json: text ? JSON.parse(text) : null };
  };
  return { svc, server, call, close: () => new Promise((r) => server.close(r)) };
}

test('end to end over HTTP: invite -> consent -> estimate -> close -> release; staff and expert roles stay apart (B-01)', async () => {
  const w = await boot({ limits: { writesPerMinute: 10000, burstWrites: 10000 } });
  try {
    assert.equal((await w.call('POST', '/api/staff/session', { body: { credential: 'wrong' } })).status, 401);
    const staff = (await w.call('POST', '/api/staff/session', { body: { credential: 'mod-ok' } })).json.sessionToken;
    const card = (await w.call('POST', '/api/staff/cards', { token: staff, body: CARD })).json.card;

    const experts = [];
    for (let i = 0; i < 5; i++) {
      const inv = (await w.call('POST', '/api/staff/invites', { token: staff, body: { declaration: { countries: ['TCD'] } } })).json;
      const bad = await w.call('POST', '/api/invite/redeem', { body: { token: inv.token, level: 'anonymous', consentVersion: 'stale' } });
      assert.equal(bad.status, 400);
      assert.match(bad.json.consentText, /Residual risk/);
      const ok = await w.call('POST', '/api/invite/redeem', { body: { token: inv.token, level: i % 2 ? 'anonymous' : 'identified', consentVersion: CONSENT_VERSION } });
      assert.equal(ok.status, 200);
      assert.equal((await w.call('POST', '/api/invite/redeem', { body: { token: inv.token, level: 'anonymous', consentVersion: CONSENT_VERSION } })).status, 401, 'single use');
      experts.push(ok.json.sessionToken);
    }
    assert.equal((await w.call('GET', '/api/inbox')).status, 401);
    const inbox = (await w.call('GET', '/api/inbox', { token: experts[0] })).json;
    assert.ok(!JSON.stringify(inbox).match(/acaps|seed|0\.705/i), 'a Round-1 card carries no ACAPS reading');
    for (const [i, tok] of experts.entries()) {
      assert.equal((await w.call('POST', '/api/estimates', { token: tok, body: { cardId: card.id, p: 0.3 + i * 0.1 } })).status, 200);
    }
    assert.equal((await w.call('POST', '/api/estimates', { token: experts[0], body: { cardId: card.id, p: 0.5 } })).status, 409);
    assert.equal((await w.call('POST', '/api/staff/cards', { token: experts[0], body: CARD })).status, 403, 'an expert is not staff');
    assert.equal((await w.call('POST', `/api/staff/cards/${card.id}/close`, { token: experts[0] })).status, 403);

    assert.equal((await w.call('GET', `/api/cards/${card.id}/release`, { token: experts[0] })).json.suppressed, true, 'open round is withheld');
    assert.equal((await w.call('POST', `/api/staff/cards/${card.id}/close`, { token: staff, body: {} })).status, 200);
    const rel = (await w.call('GET', `/api/cards/${card.id}/release`, { token: experts[0] })).json;
    assert.equal(rel.suppressed, false);
    assert.equal(rel.n, 5);
    assert.equal((await w.call('GET', `/api/public/cards/${card.id}`)).json.suppressed, true, 'public floor is 10');
    assert.deepEqual((await w.call('GET', `/api/public/cards/${card.id}/ledger`)).json, []);
    const audit = (await w.call('GET', '/api/staff/audit', { token: staff })).json;
    assert.ok(audit.some((a) => a.action === 'round.close'));
    assert.equal((await w.call('DELETE', '/api/me', { token: experts[1], body: undefined })).status, 200);
    assert.equal((await w.call('GET', '/api/inbox', { token: experts[1] })).status, 401, 'erased sessions die');
  } finally { await w.close(); }
});

test('transport hardening: headers, no cookies, body cap, content type, methods, errors (B-01)', async () => {
  const w = await boot({ limits: { maxBodyBytes: 200, writesPerMinute: 10000, burstWrites: 10000 } });
  try {
    const r = await w.call('GET', '/api/public/cards/nope');
    assert.equal(r.status, 404);
    assert.match(r.headers.get('strict-transport-security'), /max-age=\d+/);
    assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(r.headers.get('cache-control'), 'no-store');
    assert.equal(r.headers.get('set-cookie'), null, 'no cookies, ever');
    assert.equal((await w.call('GET', '/nope')).status, 404);
    assert.equal((await w.call('PATCH', '/api/estimates', { body: {} })).status, 405);
    assert.equal((await w.call('POST', '/api/estimates', { body: 'x'.repeat(500) })).status, 413);
    const big = await w.call('POST', '/api/invite/redeem', { body: { token: 'a'.repeat(400) } });
    assert.equal(big.status, 413);
    assert.equal((await w.call('POST', '/api/invite/redeem', { body: 'not json' })).status, 400);
    assert.equal((await w.call('POST', '/api/invite/redeem', { body: '[1]' })).status, 400);
    assert.equal((await w.call('POST', '/api/invite/redeem', { body: '{}', headers: { 'content-type': 'text/plain' } })).status, 415);
    const noisy = await w.call('POST', '/api/staff/cards', { token: 'forged', body: {} });
    assert.equal(noisy.status, 401);
    assert.ok(!JSON.stringify(noisy.json).includes('at '), 'no stack traces');
  } finally { await w.close(); }
});

test('every write is rate limited and says when to retry (B-01)', async () => {
  const w = await boot({ limits: { writesPerMinute: 6, burstWrites: 3 } });
  try {
    const codes = [];
    for (let i = 0; i < 6; i++) codes.push((await w.call('POST', '/api/invite/redeem', { body: { token: 'x' } })).status);
    assert.deepEqual(codes.slice(0, 3), [401, 401, 401]);
    assert.ok(codes.slice(3).every((c) => c === 429), `got ${codes}`);
    const limited = await w.call('POST', '/api/invite/redeem', { body: { token: 'x' } });
    assert.equal(limited.status, 429);
    assert.ok(Number(limited.headers.get('retry-after')) >= 1);
    assert.equal((await w.call('GET', '/api/public/cards/x')).status, 404, 'reads have their own bucket');
  } finally { await w.close(); }
});

test('the token bucket refills with time', () => {
  let t = 0;
  const take = createRateLimiter({ perMinute: 60, burst: 2, now: () => t });
  assert.equal(take('a').ok, true);
  assert.equal(take('a').ok, true);
  assert.equal(take('a').ok, false);
  assert.equal(take('b').ok, true, 'keys are independent');
  t += 1000;
  assert.equal(take('a').ok, true);
  assert.equal(take('a').ok, false);
});

test('requireHttps rejects plain requests unless a proxy says they were https', async () => {
  const w = await boot({ requireHttps: true });
  try {
    assert.equal((await w.call('GET', '/api/public/cards/x')).status, 400);
    assert.equal((await w.call('GET', '/api/public/cards/x', { headers: { 'x-forwarded-proto': 'https' } })).status, 404);
  } finally { await w.close(); }
});

test('consent text is served so the screen and the record cannot drift; staff can list cards', async () => {
  const w = await boot({ limits: { writesPerMinute: 10000, burstWrites: 10000 } });
  try {
    const c = await w.call('GET', '/api/consent/anonymous');
    assert.equal(c.status, 200);
    assert.equal(c.json.version, CONSENT_VERSION);
    assert.match(c.json.text, /Residual risk: .*server access/);
    assert.equal((await w.call('GET', '/api/consent/everyone')).status, 404);
    const staff = (await w.call('POST', '/api/staff/session', { body: { credential: 'mod-ok' } })).json.sessionToken;
    await w.call('POST', '/api/staff/cards', { token: staff, body: CARD });
    const list = (await w.call('GET', '/api/staff/cards', { token: staff })).json;
    assert.equal(list.length, 1);
    assert.equal(list[0].responses, 0);
    assert.ok(!('seedP' in list[0]) && !JSON.stringify(list).includes('respondent'));
    assert.equal((await w.call('GET', '/api/staff/cards')).status, 401);
  } finally { await w.close(); }
});

test('a mistyped country is refused instead of creating a card nobody can see', async () => {
  const w = await boot({ limits: { writesPerMinute: 10000, burstWrites: 10000 } });
  try {
    const staff = (await w.call('POST', '/api/staff/session', { body: { credential: 'mod-ok' } })).json.sessionToken;
    const bad = await w.call('POST', '/api/staff/cards', { token: staff, body: { ...CARD, country: 'TCTCD' } });
    assert.equal(bad.status, 400);
    assert.match(bad.json.error, /ISO 3-letter/);
    assert.equal((await w.call('POST', '/api/staff/cards', { token: staff, body: { ...CARD, country: 'tcd' } })).json.card.country, 'TCD', 'lower case is normalised');
    const inv = await w.call('POST', '/api/staff/invites', { token: staff, body: { declaration: { countries: ['Chad'] } } });
    assert.equal(inv.status, 400);
  } finally { await w.close(); }
});

test('health probes answer over plain http, skip the rate limit, and readiness reflects the database', async () => {
  let up = true;
  const w = await boot({ requireHttps: true, limits: { readsPerMinute: 1 }, ready: async () => { if (!up) throw new Error('db down'); } });
  try {
    for (let i = 0; i < 5; i++) assert.equal((await w.call('GET', '/healthz')).status, 200);
    assert.equal((await w.call('GET', '/readyz')).status, 200);
    up = false;
    const r = await w.call('GET', '/readyz');
    assert.equal(r.status, 503);
    assert.ok(!JSON.stringify(r.json).includes('db down'), 'no internals in the probe response');
  } finally { await w.close(); }
});
