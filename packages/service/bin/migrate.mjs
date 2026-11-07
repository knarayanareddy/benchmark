#!/usr/bin/env node
/**
 * Create the schema and the two least-privilege roles. Run as the database OWNER,
 * once per environment, before starting the service:
 *
 *   OWNER_DATABASE_URL=postgres://owner:...@db/benchmark \
 *   ROSTER_DB_PASSWORD=... ANSWERS_DB_PASSWORD=... node packages/service/bin/migrate.mjs
 *
 * Then run the service with DATABASE_URL as bm_answers and ROSTER_DATABASE_URL as
 * bm_roster, and BENCHMARK_MIGRATE=0 (the service roles cannot create tables).
 *
 * This is create-if-absent, not versioned migrations: a future schema change
 * needs a real migration step before it can ship.
 */
import fs from 'node:fs';

const env = process.env;
for (const k of ['OWNER_DATABASE_URL', 'ROSTER_DB_PASSWORD', 'ANSWERS_DB_PASSWORD']) {
  if (!env[k]) { console.error(`missing ${k}`); process.exit(2); }
}
const { default: pg } = await import('pg');
const db = new pg.Client({ connectionString: env.OWNER_DATABASE_URL });
await db.connect();
try {
  const read = (f) => fs.readFileSync(new URL(`../db/${f}`, import.meta.url), 'utf8');
  const exists = (await db.query("select to_regclass('answers.cards') as t")).rows[0].t;
  if (exists) console.log('schema already present: skipping schema.sql');
  else { await db.query(read('schema.sql')); console.log('schema created'); }
  await db.query(read('roles.sql'));
  const lit = (s) => `'${String(s).replace(/'/g, "''")}'`;
  await db.query(`alter role bm_roster login password ${lit(env.ROSTER_DB_PASSWORD)}`);
  await db.query(`alter role bm_answers login password ${lit(env.ANSWERS_DB_PASSWORD)}`);
  console.log('roles bm_roster and bm_answers ready');
} finally {
  await db.end();
}
