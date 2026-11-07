/**
 * Thin JSON transport over the service. It owns only transport concerns:
 * body-size caps, rate limiting, security headers, HTTPS enforcement, routing
 * and error mapping. No domain rules live here.
 *
 * No cookies are ever set: sessions are bearer tokens, so there is no ambient
 * credential for a cross-site request to ride on.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { HttpError, ValidationError, AuthError, NotFoundError } from './errors.js';

/** Return one of these from a route to redirect instead of sending JSON. */
export class Redirect { constructor(url) { this.url = url; } }

export const DEFAULT_LIMITS = Object.freeze({
  maxBodyBytes: 16 * 1024,
  writesPerMinute: 30,
  readsPerMinute: 240,
  burstWrites: 10,
});

const SECURITY_HEADERS = Object.freeze({
  'Strict-Transport-Security': 'max-age=63072000; includeSubDomains',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Cache-Control': 'no-store',
  'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
  'X-Frame-Options': 'DENY',
});

/** Token bucket per key. `now` is injectable so the limiter is testable. */
export function createRateLimiter({ perMinute, burst, now = Date.now }) {
  const buckets = new Map();
  const capacity = burst ?? perMinute;
  return function take(key) {
    const t = now();
    const b = buckets.get(key) || { tokens: capacity, at: t };
    b.tokens = Math.min(capacity, b.tokens + ((t - b.at) / 60000) * perMinute);
    b.at = t;
    if (b.tokens < 1) {
      buckets.set(key, b);
      return { ok: false, retryAfter: Math.ceil(((1 - b.tokens) / perMinute) * 60) };
    }
    b.tokens -= 1;
    buckets.set(key, b);
    if (buckets.size > 50000) for (const k of buckets.keys()) { buckets.delete(k); break; }
    return { ok: true };
  };
}

async function readJson(req, maxBytes) {
  const declared = Number(req.headers['content-length']);
  if (Number.isFinite(declared) && declared > maxBytes) throw new HttpError(413, 'request body too large');
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) { req.destroy(); throw new HttpError(413, 'request body too large'); }
    chunks.push(chunk);
  }
  if (size === 0) return {};
  const type = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
  if (type !== 'application/json') throw new HttpError(415, 'content-type must be application/json');
  try {
    const v = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (v === null || typeof v !== 'object' || Array.isArray(v)) throw new Error('not an object');
    return v;
  } catch {
    throw new ValidationError('body must be a JSON object');
  }
}

/**
 * @typedef {{ login: () => Promise<string>, callback: (q: { code: string | null, state: string | null }) => Promise<{ id: string, role: string }> }} Oidc
 * @typedef {{
 *   service: any, oidc?: Oidc | null, staticDir?: string | null, ready?: () => Promise<void>,
 *   verifyStaff?: (req: any, body: any) => Promise<{ id: string, role: string } | null>,
 *   limits?: Record<string, number>, requireHttps?: boolean, trustProxy?: boolean, now?: () => number
 * }} HandlerOptions
 */

/** @param {HandlerOptions} opts */
export function createHandler({
  service,
  oidc = null,
  staticDir = null,
  ready = async () => {},
  verifyStaff = async () => null,
  limits = {},
  requireHttps = false,
  trustProxy = false,
  now = Date.now,
}) {
  const L = { ...DEFAULT_LIMITS, ...limits };
  const takeWrite = createRateLimiter({ perMinute: L.writesPerMinute, burst: L.burstWrites, now });
  const takeRead = createRateLimiter({ perMinute: L.readsPerMinute, burst: L.readsPerMinute, now });

  const bearer = (req) => {
    const h = String(req.headers.authorization || '');
    return h.startsWith('Bearer ') ? h.slice(7).trim() : null;
  };
  const actorOf = async (req) => service.authenticate(bearer(req));

  /** @type {Array<[string, RegExp, (req: any, m: string[], b: any) => Promise<any>]>} */
  const routes = [
    // experts
    ['POST', /^\/api\/invite\/redeem$/, async (req, m, b) => service.redeemInvite(b.token, { level: b.level, consentVersion: b.consentVersion, mode: b.mode })],
    ['GET', /^\/api\/inbox$/, async (req) => service.inbox(await actorOf(req))],
    ['POST', /^\/api\/estimates$/, async (req, m, b) => service.submitEstimate(await actorOf(req), { cardId: b.cardId, p: b.p })],
    ['POST', /^\/api\/dissents$/, async (req, m, b) => service.submitDissent(await actorOf(req), { cardId: b.cardId, kind: b.kind, text: b.text })],
    ['PUT', /^\/api\/me\/declaration$/, async (req, m, b) => service.setDeclaration(await actorOf(req), b)],
    ['GET', /^\/api\/me\/export$/, async (req) => service.exportMe(await actorOf(req))],
    ['DELETE', /^\/api\/me$/, async (req) => service.eraseMe(await actorOf(req))],
    ['GET', /^\/api\/cards\/([^/]+)\/release$/, async (req, m) => { await actorOf(req); return service.cardRelease(m[1]); }],
    // The exact text an expert accepts, so the screen and the record cannot drift.
    ['GET', /^\/api\/consent\/([^/]+)$/, async (req, m) => service.consentFor(m[1], { device: new URL(req.url, 'http://x').searchParams.get('mode') === 'device' })],
    // public: the only unauthenticated reads, all of them aggregate or addressless
    ['GET', /^\/api\/public\/cards\/([^/]+)$/, async (req, m) => service.cardRelease(m[1], { visibility: 'public' })],
    ['GET', /^\/api\/public\/cards\/([^/]+)\/ledger$/, async (req, m) => service.publicLedger(m[1])],
    // staff sign-in through the identity provider (only when configured)
    ['GET', /^\/api\/staff\/oidc\/login$/, async () => {
      if (!oidc) throw new NotFoundError('staff SSO is not configured');
      return new Redirect(await oidc.login());
    }],
    ['GET', /^\/api\/staff\/oidc\/callback$/, async (req) => {
      if (!oidc) throw new NotFoundError('staff SSO is not configured');
      const q = new URL(req.url, 'http://x').searchParams;
      const staff = await oidc.callback({ code: q.get('code'), state: q.get('state') });
      // The token goes in the URL fragment so it never reaches a server log or a Referer header.
      return new Redirect(`/staff.html#token=${await service.createStaffSession(staff)}`);
    }],
    // staff
    ['POST', /^\/api\/staff\/session$/, async (req, m, b) => {
      const staff = await verifyStaff(req, b);
      if (!staff) throw new AuthError('staff identity not verified');
      return { sessionToken: await service.createStaffSession(staff) };
    }],
    ['POST', /^\/api\/staff\/invites$/, async (req, m, b) => service.createInvite(await actorOf(req), b)],
    ['GET', /^\/api\/staff\/cards$/, async (req) => service.listCards(await actorOf(req))],
    ['GET', /^\/api\/staff\/me$/, async (req) => { const a = await actorOf(req); if (a.kind !== 'staff') throw new AuthError('staff only'); return { id: a.id, role: a.role }; }],
    ['GET', /^\/api\/staff\/experts$/, async (req) => service.listExperts(await actorOf(req))],
    ['POST', /^\/api\/staff\/experts\/([^/]+)\/reinvite$/, async (req, m) => service.createReinvite(await actorOf(req), m[1])],
    ['POST', /^\/api\/staff\/cards$/, async (req, m, b) => service.createCard(await actorOf(req), b)],
    ['POST', /^\/api\/staff\/cards\/([^/]+)\/close$/, async (req, m) => service.closeRound(await actorOf(req), m[1])],
    ['POST', /^\/api\/staff\/cards\/([^/]+)\/round2$/, async (req, m) => service.openRound2(await actorOf(req), m[1])],
    ['POST', /^\/api\/staff\/cards\/([^/]+)\/resolve$/, async (req, m, b) => service.resolveCard(await actorOf(req), { ...b, cardId: m[1] })],
    ['GET', /^\/api\/staff\/dissents$/, async (req) => service.listDissents(await actorOf(req))],
    ['POST', /^\/api\/staff\/dissents\/([^/]+)\/route$/, async (req, m, b) => service.routeDissent(await actorOf(req), m[1], b)],
    ['POST', /^\/api\/staff\/dissents\/([^/]+)\/act$/, async (req, m, b) => service.actDissent(await actorOf(req), m[1], b)],
    ['POST', /^\/api\/staff\/dissents\/([^/]+)\/notify$/, async (req, m, b) => service.notifyDissent(await actorOf(req), m[1], b)],
    ['POST', /^\/api\/staff\/dissents\/([^/]+)\/close$/, async (req, m, b) => service.closeDissent(await actorOf(req), m[1], b)],
    // Device-held ballots. /api/anon/* take NO login: the blind-signed token is the credential.
    ['GET', /^\/api\/blind\/key$/, async () => service.blindPublicKey()],
    ['POST', /^\/api\/blind\/issue$/, async (req, m, b) => service.issueBlindToken(await actorOf(req), b)],
    ['POST', /^\/api\/anon\/estimates$/, async (req, m, b) => service.submitAnonymousEstimate(b)],
    ['POST', /^\/api\/anon\/status$/, async (req, m, b) => service.anonymousStatus(b)],
    ['POST', /^\/api\/anon\/erase$/, async (req, m, b) => service.eraseAnonymousEstimate(b)],
    // The optional second look (Round 2). Its arm is never in any response, only its background.
    ['POST', /^\/api\/second-look$/, async (req, m, b) => service.openSecondLook(await actorOf(req), { cardId: b.cardId })],
    ['POST', /^\/api\/anon\/second-look$/, async (req, m, b) => service.openAnonymousSecondLook(b)],
    ['GET', /^\/api\/staff\/cards\/([^/]+)\/second-look$/, async (req, m) => service.getSecondLook(await actorOf(req), m[1])],
    ['PUT', /^\/api\/staff\/cards\/([^/]+)\/second-look$/, async (req, m, b) => service.setSecondLook(await actorOf(req), { cardId: m[1], content: b })],
    ['GET', /^\/api\/staff\/second-look\/summary$/, async (req) => service.secondLookSummary(await actorOf(req))],
    // Roundtable: one moderated thread per card. Posts are read by a moderator before anyone else sees them.
    ['PUT', /^\/api\/staff\/cards\/([^/]+)\/thread$/, async (req, m, b) => service.setThread(await actorOf(req), { cardId: m[1], enabled: b.enabled })],
    ['GET', /^\/api\/staff\/thread\/pending$/, async (req) => service.listPending(await actorOf(req), { cardId: new URL(req.url, 'http://x').searchParams.get('cardId') || undefined })],
    ['POST', /^\/api\/staff\/thread\/posts\/([^/]+)\/moderate$/, async (req, m, b) => service.moderate(await actorOf(req), m[1], { approve: b.approve, note: b.note })],
    ['POST', /^\/api\/thread$/, async (req, m, b) => service.openThread(await actorOf(req), { cardId: b.cardId })],
    ['POST', /^\/api\/thread\/posts$/, async (req, m, b) => service.postToThread(await actorOf(req), { cardId: b.cardId, kind: b.kind, text: b.text, parentId: b.parentId })],
    ['POST', /^\/api\/anon\/thread$/, async (req, m, b) => service.openAnonymousThread(b)],
    ['POST', /^\/api\/anon\/thread\/posts$/, async (req, m, b) => service.postAnonymous(b)],
    ['POST', /^\/api\/anon\/thread\/erase$/, async (req, m, b) => service.eraseAnonymous(b)],
    // Publication credit: one contribution, one consent, a second moderator, a cooling-off wait.
    ['POST', /^\/api\/staff\/publications$/, async (req, m, b) => service.propose(await actorOf(req), { sourceKind: b.sourceKind, sourceId: b.sourceId })],
    ['GET', /^\/api\/staff\/publications\/offerable$/, async (req) => service.listOfferable(await actorOf(req))],
    ['GET', /^\/api\/staff\/publications$/, async (req) => service.listForStaff(await actorOf(req))],
    ['POST', /^\/api\/staff\/publications\/([^/]+)\/review$/, async (req, m, b) => service.review(await actorOf(req), m[1], { approve: b.approve, note: b.note, checked: b.checked })],
    ['POST', /^\/api\/staff\/publications\/([^/]+)\/publish$/, async (req, m) => service.publish(await actorOf(req), m[1])],
    ['POST', /^\/api\/publications\/([^/]+)\/respond$/, async (req, m, b) => service.respond(await actorOf(req), m[1], b)],
    ['POST', /^\/api\/publications\/([^/]+)\/withdraw$/, async (req, m) => service.withdraw(await actorOf(req), m[1])],
    // The one public list that can carry a name, and only a name its owner agreed to for that one item.
    ['GET', /^\/api\/public\/credits$/, async () => service.listPublic()],
    ['GET', /^\/api\/staff\/breakglass$/, async (req) => service.listBreakGlass(await actorOf(req))],
    ['POST', /^\/api\/staff\/breakglass$/, async (req, m, b) => service.requestBreakGlass(await actorOf(req), b)],
    ['POST', /^\/api\/staff\/breakglass\/([^/]+)\/decide$/, async (req, m, b) => service.decideBreakGlass(await actorOf(req), m[1], b)],
    ['POST', /^\/api\/staff\/breakglass\/([^/]+)\/collect$/, async (req, m, b) => service.collectBreakGlass(await actorOf(req), m[1], b)],
    ['DELETE', /^\/api\/me\/notices\/([^/]+)$/, async (req, m) => service.ackNotice(await actorOf(req), m[1])],
    ['POST', /^\/api\/staff\/retention$/, async (req, m, b) => service.applyRetention(await actorOf(req), b)],
    ['GET', /^\/api\/staff\/audit$/, async (req) => service.readAudit(await actorOf(req))],
  ];

  const send = (res, status, body, extra = {}) => {
    const payload = JSON.stringify(body ?? null);
    res.writeHead(status, {
      ...SECURITY_HEADERS,
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': Buffer.byteLength(payload),
      ...extra,
    });
    res.end(payload);
  };

  const clientKey = (req) => {
    if (trustProxy) {
      const xf = String(req.headers['x-forwarded-for'] || '').split(',').map((s) => s.trim()).filter(Boolean);
      if (xf.length) return xf[xf.length - 1]; // the hop our own proxy appended
    }
    return req.socket.remoteAddress || 'unknown';
  };

  const MIME = {
    '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
    '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json',
  };
  // The pages are static and use only same-origin script and style: no inline code, no third parties.
  const PAGE_CSP = "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; manifest-src 'self'; worker-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";

  function serveStatic(req, res, pathname) {
    if (!staticDir || (req.method !== 'GET' && req.method !== 'HEAD')) return false;
    const rel = pathname === '/' ? '/index.html' : pathname === '/staff' ? '/staff.html' : pathname === '/credits' ? '/credits.html' : pathname;
    const file = path.normalize(path.join(staticDir, rel));
    if (!file.startsWith(path.normalize(staticDir)) || !MIME[path.extname(file)]) return false;
    let body;
    try { body = fs.readFileSync(file); } catch { return false; }
    // Built assets are content-hashed, so they can be cached for good. Pages and the worker must be
    // re-checked every time, or a deploy would not reach people who already have the app installed.
    const immutable = rel.startsWith('/assets/');
    res.writeHead(200, {
      ...SECURITY_HEADERS, 'Content-Security-Policy': PAGE_CSP, 'Content-Type': MIME[path.extname(file)],
      'Content-Length': body.length, 'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
    });
    res.end(req.method === 'HEAD' ? undefined : body);
    return true;
  }

  return async function handler(req, res) {
    try {
      // Orchestrator probes: before the https and rate-limit checks, because they arrive over plain http from inside.
      if (req.method === 'GET' && req.url === '/healthz') return send(res, 200, { ok: true });
      if (req.method === 'GET' && req.url === '/readyz') {
        try { await ready(); } catch { throw new HttpError(503, 'not ready'); }
        return send(res, 200, { ok: true });
      }
      if (requireHttps && String(req.headers['x-forwarded-proto'] || '') !== 'https') {
        throw new HttpError(400, 'https required');
      }
      const url = new URL(req.url, 'http://localhost');
      const isWrite = req.method !== 'GET' && req.method !== 'HEAD';
      const gate = (isWrite ? takeWrite : takeRead)(`${clientKey(req)}`);
      if (!gate.ok) {
        return send(res, 429, { error: 'rate limit exceeded' }, { 'Retry-After': String(gate.retryAfter) });
      }
      if (serveStatic(req, res, url.pathname)) return undefined;
      const route = routes.find(([method, re]) => method === req.method && re.test(url.pathname));
      if (!route) {
        const known = routes.some(([, re]) => re.test(url.pathname));
        throw known ? new HttpError(405, 'method not allowed') : new NotFoundError('no such route');
      }
      const body = isWrite ? await readJson(req, L.maxBodyBytes) : {};
      const m = (/** @type {RegExpExecArray} */ (route[1].exec(url.pathname))).map((s, i) => (i === 0 ? s : decodeURIComponent(s)));
      const out = await route[2](req, m, body);
      if (out instanceof Redirect) {
        res.writeHead(302, { ...SECURITY_HEADERS, Location: out.url });
        return res.end();
      }
      return send(res, 200, out);
    } catch (e) {
      if (e instanceof HttpError) {
        const { status, message, problems, consentText } = e;
        return send(res, status, { error: message, ...(problems ? { problems } : {}), ...(consentText ? { consentText } : {}) });
      }
      // Never leak internals; the stack goes to the operator's log only.
      console.error('unhandled', e);
      return send(res, 500, { error: 'internal error' });
    }
  };
}

/** @param {HandlerOptions} opts */
export function createServer(opts) {
  const server = http.createServer(createHandler(opts));
  server.requestTimeout = 10000;
  server.headersTimeout = 5000;
  server.maxHeadersCount = 50;
  return server;
}
