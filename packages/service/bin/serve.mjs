#!/usr/bin/env node
/**
 * Start the service. Everything sensitive comes from the environment so it
 * never sits in the same place as the data:
 *
 *   BENCHMARK_BALLOT_SECRET   >= 16 chars, keys anonymous ballot tokens
 *   BENCHMARK_ALIAS_SECRET    >= 16 chars, different from the above
 *   BENCHMARK_DATA_DIR        where roster.json / answers.json live (pilot only)
 *   BENCHMARK_STAFF_TOKENS    "id:role:sha256hex,..." static staff credentials
 *                             (a stand-in for SSO: replace verifyStaff below)
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
import { createServer } from '../src/http.js';
import { hashToken } from '../src/auth.js';

const env = process.env;
const need = (k) => {
  if (!env[k]) { console.error(`missing ${k}`); process.exit(2); }
  return env[k];
};
const dir = env.BENCHMARK_DATA_DIR;
const roster = createRosterStore({ file: dir && path.join(dir, 'roster.json') });
const answers = createAnswerStore({ file: dir && path.join(dir, 'answers.json') });
const service = createService({
  roster, answers,
  secrets: { ballot: need('BENCHMARK_BALLOT_SECRET'), alias: need('BENCHMARK_ALIAS_SECRET') },
});

const staff = new Map(
  String(env.BENCHMARK_STAFF_TOKENS || '').split(',').filter(Boolean).map((s) => {
    const [id, role, hash] = s.split(':');
    return [hash, { id, role }];
  })
);
// Replace with SSO verification. The static table exists so a pilot can start.
const verifyStaff = async (req, body) => staff.get(hashToken(String(body.credential || ''))) || null;

createServer({
  service, verifyStaff,
  requireHttps: env.BENCHMARK_ALLOW_HTTP !== '1',
  trustProxy: env.BENCHMARK_TRUST_PROXY === '1',
}).listen(Number(env.PORT || 8080), () => console.log(`benchmark service listening on ${env.PORT || 8080}`));
