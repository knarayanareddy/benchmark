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
 *   PORT                      default 8080
 *   BENCHMARK_TRUST_PROXY=1   behind a TLS-terminating proxy that sets
 *                             X-Forwarded-Proto / X-Forwarded-For
 *
 * TLS is terminated by the proxy; the service refuses non-https requests
 * unless BENCHMARK_ALLOW_HTTP=1 (local development only).
 */
import path from 'node:path';
import { createService } from '../src/service.js';
import { createRosterStore, createAnswerStore } from '../src/store.js';
import { createPgStores, migrate } from '../src/pg-store.js';
import { createServer } from '../src/http.js';
import { hashToken } from '../src/auth.js';
import { createOidc } from '../src/oidc.js';

const env = process.env;
const need = (k) => {
  if (!env[k]) { console.error(`missing ${k}`); process.exit(2); }
  return env[k];
};

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

const service = createService({
  ...stores,
  secrets: { ballot: need('BENCHMARK_BALLOT_SECRET'), alias: need('BENCHMARK_ALIAS_SECRET') },
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
const verifyStaff = async (req, body) =>
  oidc ? null : staff.get(hashToken(String(body.credential || ''))) || null;

createServer({
  service, oidc, verifyStaff,
  ready: async () => { await stores.answers.cards.get('__ready__'); await stores.roster.experts.get('__ready__'); },
  requireHttps: env.BENCHMARK_ALLOW_HTTP !== '1',
  trustProxy: env.BENCHMARK_TRUST_PROXY === '1',
  staticDir: new URL('../public/', import.meta.url).pathname,
}).listen(Number(env.PORT || 8080), () => console.log(`benchmark service listening on ${env.PORT || 8080}`));
