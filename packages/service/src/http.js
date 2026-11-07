/**
 * Thin JSON transport over the service. It owns only transport concerns:
 * body-size caps, rate limiting, security headers, HTTPS enforcement, routing
 * and error mapping. No domain rules live here.
 *
 * No cookies are ever set: sessions are bearer tokens, so there is no ambient
 * credential for a cross-site request to ride on.
 */
import http from 'node:http';
import { HttpError, ValidationError, AuthError, NotFoundError } from './errors.js';

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

export function createHandler({
  service,
  verifyStaff = async () => null,
  limits = {},
  requireHttps = false,
  trustProxy = false,
  now = Date.now,
}) {
  const L = { ...DEFAULT_LIMITS, ...limits };
  const takeWrite = createRateLimiter({ perMinute: L.writesPerMinute, burst: L.burstWrites, now });
  const takeRead = createRateLimiter({ perMinute: L.readsPerMinute, now });

  const bearer = (req) => {
    const h = String(req.headers.authorization || '');
    return h.startsWith('Bearer ') ? h.slice(7).trim() : null;
  };
  const actorOf = (req) => service.authenticate(bearer(req));

  const routes = [
    // experts
    ['POST', /^\/api\/invite\/redeem$/, (req, m, b) => service.redeemInvite(b.token, { level: b.level, consentVersion: b.consentVersion })],
    ['GET', /^\/api\/inbox$/, (req) => service.inbox(actorOf(req))],
    ['POST', /^\/api\/estimates$/, (req, m, b) => service.submitEstimate(actorOf(req), { cardId: b.cardId, p: b.p })],
    ['POST', /^\/api\/dissents$/, (req, m, b) => service.submitDissent(actorOf(req), { cardId: b.cardId, kind: b.kind, text: b.text })],
    ['PUT', /^\/api\/me\/declaration$/, (req, m, b) => service.setDeclaration(actorOf(req), b)],
    ['GET', /^\/api\/me\/export$/, (req) => service.exportMe(actorOf(req))],
    ['DELETE', /^\/api\/me$/, (req) => service.eraseMe(actorOf(req))],
    ['GET', /^\/api\/cards\/([^/]+)\/release$/, (req, m) => { actorOf(req); return service.cardRelease(m[1]); }],
    // public: the only unauthenticated reads, all of them aggregate or addressless
    ['GET', /^\/api\/public\/cards\/([^/]+)$/, (req, m) => service.cardRelease(m[1], { visibility: 'public' })],
    ['GET', /^\/api\/public\/cards\/([^/]+)\/ledger$/, (req, m) => service.publicLedger(m[1])],
    // staff
    ['POST', /^\/api\/staff\/session$/, async (req, m, b) => {
      const staff = await verifyStaff(req, b);
      if (!staff) throw new AuthError('staff identity not verified');
      return { sessionToken: service.createStaffSession(staff) };
    }],
    ['POST', /^\/api\/staff\/invites$/, (req, m, b) => service.createInvite(actorOf(req), b)],
    ['POST', /^\/api\/staff\/cards$/, (req, m, b) => service.createCard(actorOf(req), b)],
    ['POST', /^\/api\/staff\/cards\/([^/]+)\/close$/, (req, m) => service.closeRound(actorOf(req), m[1])],
    ['POST', /^\/api\/staff\/cards\/([^/]+)\/round2$/, (req, m) => service.openRound2(actorOf(req), m[1])],
    ['POST', /^\/api\/staff\/cards\/([^/]+)\/resolve$/, (req, m, b) => service.resolveCard(actorOf(req), { ...b, cardId: m[1] })],
    ['GET', /^\/api\/staff\/dissents$/, (req) => service.listDissents(actorOf(req))],
    ['POST', /^\/api\/staff\/dissents\/([^/]+)\/route$/, (req, m, b) => service.routeDissent(actorOf(req), m[1], b)],
    ['POST', /^\/api\/staff\/dissents\/([^/]+)\/act$/, (req, m, b) => service.actDissent(actorOf(req), m[1], b)],
    ['POST', /^\/api\/staff\/dissents\/([^/]+)\/notify$/, (req, m, b) => service.notifyDissent(actorOf(req), m[1], b)],
    ['POST', /^\/api\/staff\/dissents\/([^/]+)\/close$/, (req, m, b) => service.closeDissent(actorOf(req), m[1], b)],
    ['POST', /^\/api\/staff\/retention$/, (req, m, b) => service.applyRetention(actorOf(req), b)],
    ['GET', /^\/api\/staff\/audit$/, (req) => service.readAudit(actorOf(req))],
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

  return async function handler(req, res) {
    try {
      if (requireHttps && String(req.headers['x-forwarded-proto'] || '') !== 'https') {
        throw new HttpError(400, 'https required');
      }
      const url = new URL(req.url, 'http://localhost');
      const isWrite = req.method !== 'GET' && req.method !== 'HEAD';
      const gate = (isWrite ? takeWrite : takeRead)(`${clientKey(req)}`);
      if (!gate.ok) {
        return send(res, 429, { error: 'rate limit exceeded' }, { 'Retry-After': String(gate.retryAfter) });
      }
      const route = routes.find(([method, re]) => method === req.method && re.test(url.pathname));
      if (!route) {
        const known = routes.some(([, re]) => re.test(url.pathname));
        throw known ? new HttpError(405, 'method not allowed') : new NotFoundError('no such route');
      }
      const body = isWrite ? await readJson(req, L.maxBodyBytes) : {};
      const m = route[1].exec(url.pathname).map((s, i) => (i === 0 ? s : decodeURIComponent(s)));
      const out = await route[2](req, m, body);
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

export function createServer(opts) {
  const server = http.createServer(createHandler(opts));
  server.requestTimeout = 10000;
  server.headersTimeout = 5000;
  server.maxHeadersCount = 50;
  return server;
}
