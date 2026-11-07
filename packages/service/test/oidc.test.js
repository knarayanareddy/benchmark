import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import http from 'node:http';
import { createOidc } from '../src/oidc.js';
import { createService } from '../src/service.js';
import { createRosterStore, createAnswerStore } from '../src/store.js';
import { createServer } from '../src/http.js';

const b64u = (x) => Buffer.from(x).toString('base64url');
const SECRETS = { ballot: 'ballot-secret-for-tests-0001', alias: 'alias-secret-for-tests-00002' };
const CLIENT = { id: 'benchmark-staff', secret: 'client-secret-for-tests' };

/** A minimal OpenID provider: discovery, JWKS, token endpoint with PKCE and client-secret checks. */
async function fakeIdp() {
  const key = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const other = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = { ...key.publicKey.export({ format: 'jwk' }), kid: 'k1', alg: 'RS256', use: 'sig' };
  const codes = new Map();
  const state = { rotated: false, tokenCalls: 0 };
  let base = '';
  const sign = (claims, { priv = key.privateKey, kid = 'k1', alg = 'RS256' } = {}) => {
    const h = b64u(JSON.stringify({ alg, kid, typ: 'JWT' }));
    const c = b64u(JSON.stringify(claims));
    const sig = alg === 'none' ? '' : crypto.sign('RSA-SHA256', Buffer.from(`${h}.${c}`), priv).toString('base64url');
    return `${h}.${c}.${sig}`;
  };
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, base);
    const json = (o, s = 200) => { res.writeHead(s, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
    if (url.pathname === '/.well-known/openid-configuration') {
      return json({ issuer: base, authorization_endpoint: `${base}/authorize`, token_endpoint: `${base}/token`, jwks_uri: `${base}/jwks` });
    }
    if (url.pathname === '/jwks') return json({ keys: [jwk] });
    if (url.pathname === '/token' && req.method === 'POST') {
      let body = '';
      req.on('data', (d) => { body += d; });
      req.on('end', () => {
        state.tokenCalls++;
        const f = new URLSearchParams(body);
        const grant = codes.get(f.get('code'));
        codes.delete(f.get('code'));
        const challenge = b64u(crypto.createHash('sha256').update(f.get('code_verifier') || '').digest());
        if (!grant || f.get('client_secret') !== CLIENT.secret || f.get('client_id') !== CLIENT.id || challenge !== grant.challenge) {
          return json({ error: 'invalid_grant' }, 400);
        }
        return json({ id_token: sign({ iss: base, aud: CLIENT.id, exp: Math.floor(Date.now() / 1000) + 300, nonce: grant.nonce, email: grant.email, ...grant.claims }, grant.signing) });
      });
      return undefined;
    }
    return json({}, 404);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  /** Play the part of the user's browser: follow the authorize URL and get a code back. */
  const authorize = (authUrl, email, { claims, signing } = {}) => {
    const q = new URL(authUrl).searchParams;
    assert.equal(q.get('code_challenge_method'), 'S256');
    assert.equal(q.get('response_type'), 'code');
    assert.ok(q.get('state') && q.get('nonce'));
    const code = b64u(crypto.randomBytes(16));
    codes.set(code, { nonce: q.get('nonce'), challenge: q.get('code_challenge'), email, claims, signing });
    return { code, state: q.get('state') };
  };
  return { base, server, authorize, state, close: () => new Promise((r) => server.close(r)), wrongKey: other.privateKey, sign };
}

const make = (idp, extra = {}) => createOidc({
  issuer: idp.base, clientId: CLIENT.id, clientSecret: CLIENT.secret, redirectUri: 'https://bm.example/api/staff/oidc/callback',
  staffRoles: { 'Mod@acaps.example': 'moderator', 'analyst@acaps.example': 'analyst' }, allowInsecure: true, ...extra,
});

test('a staff member on the allow-list signs in and gets their role', async () => {
  const idp = await fakeIdp();
  try {
    const oidc = make(idp);
    const grant = idp.authorize(await oidc.login(), 'mod@acaps.example');
    assert.deepEqual(await oidc.callback(grant), { id: 'mod@acaps.example', role: 'moderator' });
    const g2 = idp.authorize(await oidc.login(), 'analyst@acaps.example');
    assert.equal((await oidc.callback(g2)).role, 'analyst');
  } finally { await idp.close(); }
});

test('a valid sign-in from the provider is not enough: the email must be an authorised staff member', async () => {
  const idp = await fakeIdp();
  try {
    const oidc = make(idp);
    const grant = idp.authorize(await oidc.login(), 'stranger@acaps.example');
    await assert.rejects(() => oidc.callback(grant), /not authorised/);
  } finally { await idp.close(); }
});

test('forged or replayed sign-ins are refused', async () => {
  const idp = await fakeIdp();
  try {
    const oidc = make(idp);
    const url = await oidc.login();
    const grant = idp.authorize(url, 'mod@acaps.example');
    await assert.rejects(() => oidc.callback({ ...grant, state: 'made-up' }), /unknown or expired/);
    assert.equal((await oidc.callback(grant)).role, 'moderator');
    await assert.rejects(() => oidc.callback(grant), /unknown or expired/, 'state is single use');

    const other = idp.authorize(await oidc.login(), 'mod@acaps.example');
    await assert.rejects(() => oidc.callback({ code: 'wrong-code', state: other.state }), /refused the code/);
  } finally { await idp.close(); }
});

test('ID token checks: signature, algorithm, audience, issuer, expiry, nonce, verified email', async () => {
  const idp = await fakeIdp();
  try {
    const oidc = make(idp);
    const attempt = async (opts) => oidc.callback(idp.authorize(await oidc.login(), 'mod@acaps.example', opts));
    const exp = Math.floor(Date.now() / 1000);
    await assert.rejects(() => attempt({ signing: { priv: idp.wrongKey } }), /signature invalid/);
    await assert.rejects(() => attempt({ signing: { alg: 'none' } }), /unsupported id_token alg/);
    await assert.rejects(() => attempt({ signing: { kid: 'nope' } }), /unknown key/);
    await assert.rejects(() => attempt({ claims: { aud: 'someone-else' } }), /audience/);
    await assert.rejects(() => attempt({ claims: { iss: 'https://evil.example' } }), /issuer/);
    await assert.rejects(() => attempt({ claims: { exp: exp - 3600 } }), /expired/);
    await assert.rejects(() => attempt({ claims: { nonce: 'replayed' } }), /nonce/);
    await assert.rejects(() => attempt({ claims: { email_verified: false } }), /verified email/);
    assert.equal((await attempt({})).role, 'moderator');
  } finally { await idp.close(); }
});

test('configuration is validated and https is required outside tests', () => {
  assert.throws(() => createOidc({ issuer: 'http://idp.example', clientId: 'a', clientSecret: 'b', redirectUri: 'https://x' }), /https/);
  assert.throws(() => createOidc({ issuer: 'https://idp.example', clientId: '', clientSecret: 'b', redirectUri: 'https://x' }), /clientId/);
  assert.throws(() => createOidc({ issuer: 'https://idp.example', clientId: 'a', clientSecret: 'b', redirectUri: 'https://x', staffRoles: { 'a@b.c': 'admin' } }), /analyst or moderator/);
});

test('over HTTP: login redirects to the provider, the callback mints a staff session in the URL fragment', async () => {
  const idp = await fakeIdp();
  const svc = createService({ roster: createRosterStore(), answers: createAnswerStore(), secrets: SECRETS });
  const server = createServer({ service: svc, oidc: make(idp), limits: { readsPerMinute: 10000 } });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const login = await fetch(`${base}/api/staff/oidc/login`, { redirect: 'manual' });
    assert.equal(login.status, 302);
    const grant = idp.authorize(login.headers.get('location'), 'mod@acaps.example');
    const cb = await fetch(`${base}/api/staff/oidc/callback?code=${grant.code}&state=${grant.state}`, { redirect: 'manual' });
    assert.equal(cb.status, 302);
    const loc = new URL(cb.headers.get('location'), base);
    assert.equal(loc.pathname, '/staff.html');
    assert.equal(loc.search, '', 'the token is never in the query string');
    const token = new URLSearchParams(loc.hash.slice(1)).get('token');
    const actor = await svc.authenticate(token);
    assert.deepEqual([actor.role, actor.id], ['moderator', 'mod@acaps.example']);
    const bad = await fetch(`${base}/api/staff/oidc/callback?code=x&state=y`, { redirect: 'manual' });
    assert.equal(bad.status, 401);
    const off = createServer({ service: svc });
    await new Promise((r) => off.listen(0, '127.0.0.1', r));
    assert.equal((await fetch(`http://127.0.0.1:${off.address().port}/api/staff/oidc/login`, { redirect: 'manual' })).status, 404, 'no SSO configured, no login route');
    await new Promise((r) => off.close(r));
  } finally { await new Promise((r) => server.close(r)); await idp.close(); }
});
