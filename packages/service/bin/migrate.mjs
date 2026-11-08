#!/usr/bin/env node
/**
 * Apply database migrations and the least-privilege roles. Run as the database
 * OWNER before starting (or upgrading) the service:
 *
 *   OWNER_DATABASE_URL=postgres://owner:...@db/benchmark \
 *   ROSTER_DB_PASSWORD=... ANSWERS_DB_PASSWORD=... node packages/service/bin/migrate.mjs
 *
 *   node packages/service/bin/migrate.mjs --status    show what is applied and what is pending
 *
 * Then run the service as bm_answers / bm_roster with BENCHMARK_MIGRATE=0 (those
 * roles cannot create tables). Migrations are forward-only and checksummed; see
 * src/migrate.js and docs/07-deploy.md.
 */
import { migrate, listMigrations, applyRoles } from '../src/migrate.js';

const env = process.env;
const status = process.argv.includes('--status');
const required = status ? ['OWNER_DATABASE_URL'] : ['OWNER_DATABASE_URL', 'ROSTER_DB_PASSWORD', 'ANSWERS_DB_PASSWORD'];
for (const k of required) {
  if (!env[k]) { console.error(`missing ${k}`); process.exit(2); }
}
const { default: pg } = await import('pg');
// migrate() checks a connection out of a pool; a bare pg.Client cannot be connected twice.
const db = new pg.Pool({ connectionString: env.OWNER_DATABASE_URL });
try {
  if (status) {
    const have = (await db.query("select to_regclass('public.schema_migrations') as t")).rows[0].t
      ? (await db.query('select version, checksum from public.schema_migrations')).rows : [];
    const done = new Map(have.map((r) => [Number(r.version), r.checksum]));
    for (const m of listMigrations()) {
      const state = !done.has(m.version) ? 'pending' : done.get(m.version) === m.checksum ? 'applied' : 'CHANGED AFTER APPLY';
      console.log(`${String(m.version).padStart(4, '0')}  ${state.padEnd(20)} ${m.name}`);
    }
  } else {
    const r = await migrate(db, { log: (m) => console.log(m) });
    console.log(r.applied.length ? `applied ${r.applied.length} migration(s); at version ${r.current}` : `up to date at version ${r.current}`);
    await applyRoles(db);
    const lit = (s) => `'${String(s).replace(/'/g, "''")}'`;
    await db.query(`alter role bm_roster login password ${lit(env.ROSTER_DB_PASSWORD)}`);
    await db.query(`alter role bm_answers login password ${lit(env.ANSWERS_DB_PASSWORD)}`);
    console.log('roles bm_roster and bm_answers ready');
  }
} finally {
  await db.end();
}
