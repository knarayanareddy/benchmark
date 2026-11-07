/**
 * Versioned, forward-only migrations.
 *
 * Files in db/migrations are named NNNN_name.sql and applied in order, each in
 * its own transaction, under an advisory lock so two starting instances cannot
 * race. What was applied, and the checksum of the file at that time, is recorded
 * in public.schema_migrations. Editing an applied file is refused: a changed
 * history is how a staging database and a production database quietly diverge.
 *
 * Forward-only on purpose. There is no "down": a destructive change ships as
 * expand (add the new thing, write both) then contract (a later migration drops
 * the old thing once nothing reads it). See docs/07-deploy.md.
 *
 * Works with a `pg.Pool` / `pg.Client` or PGlite.
 */
import fs from 'node:fs';
import { sha256, toHex } from '@benchmark/core/hmac';

const DIR = new URL('../db/migrations/', import.meta.url);
const LOCK_KEY = 727274; // arbitrary, fixed: "BENCHMARK" in a hurry

export const checksum = (sql) => toHex(sha256(sql));

/** @returns {{ version: number, name: string, file: string, sql: string, checksum: string }[]} */
export function listMigrations(dir = DIR) {
  const files = fs.readdirSync(dir).filter((f) => /^\d{4}_[\w-]+\.sql$/.test(f)).sort();
  const seen = new Set();
  return files.map((file) => {
    const version = Number(file.slice(0, 4));
    if (seen.has(version)) throw new Error(`migrations: two files share version ${version}`);
    seen.add(version);
    const sql = fs.readFileSync(new URL(file, dir), 'utf8');
    return { version, name: file.slice(5, -4), file, sql, checksum: checksum(sql) };
  });
}

/**
 * @param {any} db a pg.Pool, pg.Client or PGlite
 * @param {{ dir?: URL, log?: (m: string) => void }} [opts]
 * @returns {Promise<{ applied: string[], current: number }>}
 */
export async function migrate(db, { dir = DIR, log = () => {} } = {}) {
  const migrations = listMigrations(dir);
  const pooled = typeof db.connect === 'function' && typeof db.exec !== 'function';
  const conn = pooled ? await db.connect() : db;
  const run = (sql) => (typeof conn.exec === 'function' ? conn.exec(sql) : conn.query(sql));
  const query = (sql, params) => conn.query(sql, params);
  try {
    await run(`select pg_advisory_lock(${LOCK_KEY})`);
    await run(`create table if not exists public.schema_migrations (
      version int primary key, name text not null, checksum text not null, applied_at timestamptz not null default now())`);
    const done = new Map((await query('select version, name, checksum from public.schema_migrations order by version')).rows
      .map((r) => [Number(r.version), r]));

    // A database made by the pre-migration schema.sql: adopt it as 0001 instead of failing.
    if (done.size === 0 && migrations[0]) {
      const existing = (await query("select to_regclass('answers.cards') as t")).rows[0].t;
      if (existing) {
        const m = migrations[0];
        await query('insert into public.schema_migrations(version, name, checksum) values ($1,$2,$3)', [m.version, m.name, m.checksum]);
        done.set(m.version, { version: m.version, name: m.name, checksum: m.checksum });
        log(`adopted existing schema as ${m.file}`);
      }
    }

    for (const d of done.values()) {
      const m = migrations.find((x) => x.version === d.version);
      if (!m) throw new Error(`migrations: the database has version ${d.version} (${d.name}) but no such file exists; refusing to continue`);
      if (m.checksum !== d.checksum) throw new Error(`migrations: ${m.file} was changed after it was applied (checksum mismatch); add a new migration instead`);
    }
    const highest = Math.max(0, ...done.keys());
    const gaps = migrations.filter((m) => m.version < highest && !done.has(m.version));
    if (gaps.length) throw new Error(`migrations: ${gaps.map((g) => g.file).join(', ')} is older than the database's version ${highest} but was never applied`);

    const applied = [];
    for (const m of migrations) {
      if (done.has(m.version)) continue;
      await run('begin');
      try {
        await run(m.sql);
        await query('insert into public.schema_migrations(version, name, checksum) values ($1,$2,$3)', [m.version, m.name, m.checksum]);
        await run('commit');
      } catch (e) {
        await run('rollback');
        throw new Error(`migrations: ${m.file} failed and was rolled back: ${e instanceof Error ? e.message : e}`, { cause: e });
      }
      applied.push(m.file);
      log(`applied ${m.file}`);
    }
    return { applied, current: Math.max(0, ...migrations.map((m) => m.version)) };
  } finally {
    try { await run(`select pg_advisory_unlock(${LOCK_KEY})`); } catch { /* connection already gone */ }
    if (pooled) conn.release();
  }
}

/** Re-apply the least-privilege grants (idempotent; covers tables added by later migrations). */
export async function applyRoles(db) {
  const sql = fs.readFileSync(new URL('../db/roles.sql', import.meta.url), 'utf8');
  if (typeof db.exec === 'function') await db.exec(sql);
  else await db.query(sql);
}
