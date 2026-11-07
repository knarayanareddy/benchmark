#!/usr/bin/env node
/**
 * Start the service. Everything sensitive comes from the environment so it
 * never sits in the same place as the data:
 *
 *   BENCHMARK_BALLOT_SECRET   >= 16 chars, keys anonymous ballot tokens
 *   BENCHMARK_ALIAS_SECRET    >= 16 chars, different from the above
 *   DATABASE_URL              Postgres for the ANSWERS schema (cards, estimates, audit...)
 *   ROSTER_DATABASE_URL       Postgres for the ROSTER schema; give it a different
 *                             role (or database) so no one connection can join both.
 *                             Defaults to DATABASE_URL.
 *   BENCHMARK_DATA_DIR        no Postgres: JSON snapshots here (a one-machine pilot only)
 *   OIDC_ISSUER, OIDC_CLIENT_ID, OIDC_CLIENT_SECRET, OIDC_REDIRECT_URI,
 *   STAFF_ROLES               staff SSO (see src/oidc.js). STAFF_ROLES is
 *                             "email:role,email:role" with role analyst|moderator.
 *   BENCHMARK_STAFF_TOKENS    "id:role:sha256hex,..." static credentials, only when
 *                             OIDC is not configured (pilot stand-in)
 *   BENCHMARK_BLIND_KEY       RSA private key (PEM) that blind-signs device-held ballots. Optional: without
 *                             it the device-held option is simply not offered. Generate: bin/blind-keygen.mjs
 *   BENCHMARK_BREAKGLASS_PUBLIC_KEY   RSA public key (PEM) that seals anonymous objections for the
 *                             two-moderator safety override. Optional: without it there is no override,
 *                             and the consent text says so. Generate: bin/breakglass-keygen.mjs.
 *                             The matching PRIVATE key should NOT be on this service; moderators supply it
 *                             when they collect an approved request (BENCHMARK_BREAKGLASS_PRIVATE_KEY exists
 *                             for single-host pilots only).
 *   Every secret above also accepts a <NAME>_FILE variant that names a file (Docker/Kubernetes secrets).
 *   BENCHMARK_DEMO=1          showcase deployment: lets a visitor open an account without an invite, seeds clearly
 *                             labelled demo questions and a synthetic panel, and prints two random demo staff
 *                             credentials to the console (never served over HTTP). Refuses to start with
 *                             DATABASE_URL unless BENCHMARK_DEMO_ALLOW_DATABASE=1. NEVER on a real pilot database
 *                             (docs/10-pilot-experience.md).
 *   BENCHMARK_DEMO_STAFF_CREDENTIALS  "a,b" optional: the two demo moderator credentials to use instead of random ones.
 *   BENCHMARK_DEMO_ALLOW_DATABASE=1   required, with BENCHMARK_DEMO=1 and DATABASE_URL, to start at all.
 *   BENCHMARK_RADAR_FILE      the ACAPS radar export as JSON (default data/risk-radar.json in this repo)
 *   BENCHMARK_SENSITIVE_COUNTRIES  "TCD,SDN,..." ISO codes where being named needs an extra acknowledgement.
 *                             Optional: a conservative default list applies (docs/09-roundtable-and-credit.md).
 *   PORT                      default 8080
 *   BENCHMARK_TRUST_PROXY=1   behind a TLS-terminating proxy that sets
 *                             X-Forwarded-Proto / X-Forwarded-For
 *
 * TLS is terminated by the proxy; the service refuses non-https requests
 * unless BENCHMARK_ALLOW_HTTP=1 (local development only).
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createService } from '../src/service.js';
import { createRosterStore, createAnswerStore } from '../src/store.js';
import { createPgStores } from '../src/pg-store.js';
import { migrate } from '../src/migrate.js';
import { createServer } from '../src/http.js';
import { hashToken } from '../src/auth.js';
import { createOidc } from '../src/oidc.js';

const env = process.env;
/** Read NAME, or the file named by NAME_FILE. PEM values may carry literal \n from an env file. */
const read = (k) => {
  const file = env[`${k}_FILE`];
  const v = env[k] ?? (file ? fs.readFileSync(file, 'utf8').trim() : undefined);
  return v === undefined ? undefined : v.replace(/\\n/g, '\n');
};
const need = (k) => {
  const v = read(k);
  if (!v) { console.error(`missing ${k}`); process.exit(2); }
  return v;
};

const demo = env.BENCHMARK_DEMO === '1';
if (demo && env.DATABASE_URL && env.BENCHMARK_DEMO_ALLOW_DATABASE !== '1') {
  console.error('BENCHMARK_DEMO=1 with DATABASE_URL: refusing to start. Demo writes synthetic accounts and data into that database. Set BENCHMARK_DEMO_ALLOW_DATABASE=1 only for a throwaway showcase database, never a pilot database.');
  process.exit(2);
}

// A demo deployment gets two moderator credentials (two-person rules need two): random per boot, printed to
// the console only, or the operator's own pair from BENCHMARK_DEMO_STAFF_CREDENTIALS. Never sent over HTTP.
const demoStaff = demo
  ? (env.BENCHMARK_DEMO_STAFF_CREDENTIALS
    ? env.BENCHMARK_DEMO_STAFF_CREDENTIALS.split(',').map((s) => s.trim()).filter(Boolean)
    : [0, 1].map(() => `demo-${crypto.randomBytes(12).toString('base64url')}`))
  : [];
if (demo && demoStaff.length !== 2) { console.error('BENCHMARK_DEMO_STAFF_CREDENTIALS must name exactly two credentials'); process.exit(2); }

let stores;
if (env.DATABASE_URL) {
  const { default: pg } = await import('pg');
  const answersDb = new pg.Pool({ connectionString: env.DATABASE_URL });
  const rosterDb = env.ROSTER_DATABASE_URL ? new pg.Pool({ connectionString: env.ROSTER_DATABASE_URL }) : answersDb;
  if (env.BENCHMARK_MIGRATE !== '0') await migrate(answersDb);
  stores = createPgStores({ roster: rosterDb, answers: answersDb });
} else {
  const dir = env.BENCHMARK_DATA_DIR;
  if (!dir) console.warn('no DATABASE_URL or BENCHMARK_DATA_DIR: using an in-memory store; everything is lost on restart');
  stores = {
    roster: createRosterStore({ file: dir && path.join(dir, 'roster.json') }),
    answers: createAnswerStore({ file: dir && path.join(dir, 'answers.json') }),
  };
}

if (demo && env.DATABASE_URL) console.warn('BENCHMARK_DEMO=1 with a real database: demo accounts and synthetic data will be written to it. Do not do this on a pilot database.');
const radarFile = env.BENCHMARK_RADAR_FILE || fileURLToPath(new URL('../../../data/risk-radar.json', import.meta.url));
let radar = [];
try { radar = JSON.parse(fs.readFileSync(radarFile, 'utf8')); } catch { console.warn(`no radar loaded from ${radarFile}: the risk browser will be empty`); }

const service = createService({
  ...stores,
  secrets: { ballot: need('BENCHMARK_BALLOT_SECRET'), alias: need('BENCHMARK_ALIAS_SECRET') },
  blindKey: read('BENCHMARK_BLIND_KEY'),
  radar, demo,
  breakGlassPublicKey: read('BENCHMARK_BREAKGLASS_PUBLIC_KEY'),
  breakGlassPrivateKey: read('BENCHMARK_BREAKGLASS_PRIVATE_KEY'),
  ...(env.BENCHMARK_SENSITIVE_COUNTRIES ? { sensitiveCountries: env.BENCHMARK_SENSITIVE_COUNTRIES.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean) } : {}),
});

/** @type {ReturnType<typeof createOidc> | null} */
let oidc = null;
if (env.OIDC_ISSUER) {
  oidc = createOidc({
    issuer: need('OIDC_ISSUER'),
    clientId: need('OIDC_CLIENT_ID'),
    clientSecret: need('OIDC_CLIENT_SECRET'),
    redirectUri: need('OIDC_REDIRECT_URI'),
    staffRoles: Object.fromEntries(
      String(need('STAFF_ROLES')).split(',').filter(Boolean).map((s) => s.trim().split(':').map((x) => x.trim()))
    ),
  });
}

const staff = new Map(
  String(env.BENCHMARK_STAFF_TOKENS || '').split(',').filter(Boolean).map((s) => {
    const [id, role, hash] = s.split(':');
    return [hash, { id, role }];
  })
);
demoStaff.forEach((cred, i) => staff.set(hashToken(cred), { id: `demo-mod${i + 1}`, role: 'moderator' }));
if (demo) {
  await service.seedDemo?.();
  console.log(`DEMO MODE. Demo staff credentials (sign in on the staff page): ${demoStaff.join(', ')}`);
}
const verifyStaff = async (req, body) =>
  oidc ? null : staff.get(hashToken(String(body.credential || ''))) || null;

createServer({
  service, oidc, verifyStaff,
  config: { demo, deviceKeys: Boolean(read('BENCHMARK_BLIND_KEY')), breakGlass: Boolean(read('BENCHMARK_BREAKGLASS_PUBLIC_KEY')) },
  ready: async () => { await stores.answers.cards.get('__ready__'); await stores.roster.experts.get('__ready__'); },
  requireHttps: env.BENCHMARK_ALLOW_HTTP !== '1',
  trustProxy: env.BENCHMARK_TRUST_PROXY === '1',
  staticDir: env.BENCHMARK_STATIC_DIR || fileURLToPath(new URL('../../web/dist/', import.meta.url)),
}).listen(Number(env.PORT || 8080), () => console.log(`benchmark service listening on ${env.PORT || 8080}`));
