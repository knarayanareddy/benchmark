/**
 * Staff sign-in with any OpenID Connect provider (Entra ID, Google Workspace,
 * Okta, Keycloak...). Authorization-code flow with PKCE; the ID token is
 * verified here (RS256 signature against the provider's JWKS, issuer, audience,
 * expiry, nonce). Nothing is trusted from the browser except `code` and `state`.
 *
 * Authorisation is a separate step on purpose: a valid sign-in from your
 * provider is not enough. The email must be in `staffRoles` (analyst or
 * moderator), so a new employee at the identity provider gets no access.
 */
import crypto from 'node:crypto';
import { AuthError, ForbiddenError, HttpError } from './errors.js';

const b64u = (buf) => Buffer.from(buf).toString('base64url');
const PENDING_TTL_MS = 10 * 60 * 1000;
const JWKS_TTL_MS = 10 * 60 * 1000;

export function createOidc({
  issuer, clientId, clientSecret, redirectUri, staffRoles,
  fetchImpl = fetch, now = Date.now, allowInsecure = false, clockSkewMs = 60000,
}) {
  for (const [k, v] of Object.entries({ issuer, clientId, clientSecret, redirectUri })) {
    if (typeof v !== 'string' || !v) throw new Error(`oidc: ${k} is required`);
  }
  const roles = new Map(Object.entries(staffRoles || {}).map(([e, r]) => [e.toLowerCase(), r]));
  for (const r of roles.values()) {
    if (r !== 'analyst' && r !== 'moderator') throw new Error(`oidc: staff role must be analyst or moderator, got ${r}`);
  }
  const secure = (u) => allowInsecure || new URL(u).protocol === 'https:';
  if (!secure(issuer)) throw new Error('oidc: issuer must be https');

  const pending = new Map();
  /** @type {Record<string, any> | null} */
  let discovery = null;
  /** @type {{ keys: any[], at: number } | null} */
  let jwks = null;

  const getJson = async (url, init) => {
    if (!secure(url)) throw new Error(`oidc: refusing non-https endpoint ${url}`);
    const res = await fetchImpl(url, init);
    if (!res.ok) throw new HttpError(502, `identity provider returned ${res.status}`);
    return res.json();
  };

  async function meta() {
    if (discovery) return discovery;
    const d = await getJson(`${issuer.replace(/\/$/, '')}/.well-known/openid-configuration`);
    if (d.issuer !== issuer) throw new Error('oidc: discovery issuer mismatch');
    discovery = d;
    return d;
  }

  async function keys(force = false) {
    if (!force && jwks && jwks.at + JWKS_TTL_MS > now()) return jwks.keys;
    const { keys: list } = await getJson((await meta()).jwks_uri);
    jwks = { keys: list, at: now() };
    return list;
  }

  function sweep() {
    for (const [s, p] of pending) if (p.expires <= now()) pending.delete(s);
  }

  /** Start a sign-in. Returns the provider URL to redirect the browser to. */
  async function login() {
    sweep();
    const m = await meta();
    const state = b64u(crypto.randomBytes(24));
    const nonce = b64u(crypto.randomBytes(24));
    const verifier = b64u(crypto.randomBytes(48));
    pending.set(state, { nonce, verifier, expires: now() + PENDING_TTL_MS });
    const u = new URL(m.authorization_endpoint);
    u.search = new URLSearchParams({
      response_type: 'code', client_id: clientId, redirect_uri: redirectUri,
      scope: 'openid email', state, nonce,
      code_challenge: b64u(crypto.createHash('sha256').update(verifier).digest()),
      code_challenge_method: 'S256',
    }).toString();
    return u.toString();
  }

  async function verifyIdToken(idToken, nonce) {
    const parts = String(idToken).split('.');
    if (parts.length !== 3) throw new AuthError('malformed id_token');
    const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString());
    if (header.alg !== 'RS256') throw new AuthError(`unsupported id_token alg ${header.alg}`);
    let jwk = (await keys()).find((k) => k.kid === header.kid);
    if (!jwk) jwk = (await keys(true)).find((k) => k.kid === header.kid); // key rotation
    if (!jwk) throw new AuthError('id_token signed by an unknown key');
    const ok = crypto.verify(
      'RSA-SHA256', Buffer.from(`${parts[0]}.${parts[1]}`),
      crypto.createPublicKey({ key: jwk, format: 'jwk' }), Buffer.from(parts[2], 'base64url')
    );
    if (!ok) throw new AuthError('id_token signature invalid');
    const c = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
    const aud = Array.isArray(c.aud) ? c.aud : [c.aud];
    if (c.iss !== issuer) throw new AuthError('id_token issuer mismatch');
    if (!aud.includes(clientId)) throw new AuthError('id_token audience mismatch');
    if (aud.length > 1 && c.azp !== clientId) throw new AuthError('id_token authorised party mismatch');
    if (typeof c.exp !== 'number' || c.exp * 1000 <= now() - clockSkewMs) throw new AuthError('id_token expired');
    if (c.nonce !== nonce) throw new AuthError('id_token nonce mismatch');
    return c;
  }

  /** Finish a sign-in. Returns { id, role } for the service to mint a session. */
  /** @param {{ code: string | null, state: string | null }} q */
  async function callback({ code, state }) {
    sweep();
    const p = state ? pending.get(state) : undefined;
    if (state) pending.delete(state); // single use, even on failure
    if (!p) throw new AuthError('unknown or expired sign-in attempt');
    if (typeof code !== 'string' || !code) throw new AuthError('missing code');
    const m = await meta();
    const res = await fetchImpl(m.token_endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code', code, redirect_uri: redirectUri,
        client_id: clientId, client_secret: clientSecret, code_verifier: p.verifier,
      }).toString(),
    });
    if (!res.ok) throw new AuthError('identity provider refused the code');
    const tok = await res.json();
    const claims = await verifyIdToken(tok.id_token, p.nonce);
    const email = String(claims.email || '').toLowerCase();
    if (!email || claims.email_verified === false) throw new AuthError('a verified email is required');
    const role = roles.get(email);
    if (!role) throw new ForbiddenError('this account is not authorised as staff');
    return { id: email, role };
  }

  return Object.freeze({ login, callback });
}
