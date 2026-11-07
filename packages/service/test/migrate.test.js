import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import net from 'node:net';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import pg from 'pg';
import { migrate, listMigrations, checksum } from '../src/migrate.js';

const cleanups = [];
after(async () => { for (const c of cleanups.splice(0)) await c(); });

function dirWith(files) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'mig-'));
  cleanups.push(() => fs.rmSync(d, { recursive: true, force: true }));
  for (const [name, sql] of Object.entries(files)) fs.writeFileSync(path.join(d, name), sql);
  return pathToFileURL(`${d}/`);
}
const A = 'create table t_a (id int primary key);';
const B = 'create table t_b (id int primary key);';
const versions = async (db) => (await db.query('select version from public.schema_migrations order by version')).rows.map((r) => r.version);

test('applies migrations in order, records them, and a second run does nothing', async () => {
  const dir = dirWith({ '0002_b.sql': B, '0001_a.sql': A });
  const db = new PGlite();
  const first = await migrate(db, { dir });
  assert.deepEqual(first.applied, ['0001_a.sql', '0002_b.sql']);
  assert.deepEqual(await versions(db), [1, 2]);
  const second = await migrate(db, { dir });
  assert.deepEqual(second.applied, []);
  assert.equal(second.current, 2);
});

test('a new migration applies on top without touching the old ones', async () => {
  const d = dirWith({ '0001_a.sql': A });
  const db = new PGlite();
  await migrate(db, { dir: d });
  await db.exec("insert into t_a values (1)");
  fs.writeFileSync(new URL('0002_b.sql', d), B);
  assert.deepEqual((await migrate(db, { dir: d })).applied, ['0002_b.sql']);
  assert.equal((await db.query('select count(*)::int as n from t_a')).rows[0].n, 1, 'existing data survives');
});

test('editing an applied migration is refused', async () => {
  const d = dirWith({ '0001_a.sql': A });
  const db = new PGlite();
  await migrate(db, { dir: d });
  fs.writeFileSync(new URL('0001_a.sql', d), `${A}\n-- sneaky change`);
  await assert.rejects(() => migrate(db, { dir: d }), /changed after it was applied/);
});

test('a database ahead of the code, or with a hole in its history, is refused', async () => {
  const d = dirWith({ '0001_a.sql': A, '0002_b.sql': B });
  const db = new PGlite();
  await migrate(db, { dir: d });
  fs.rmSync(new URL('0002_b.sql', d));
  await assert.rejects(() => migrate(db, { dir: d }), /no such file exists/);

  const d2 = dirWith({ '0001_a.sql': A, '0003_c.sql': 'create table t_c (id int);' });
  const db2 = new PGlite();
  await migrate(db2, { dir: d2 });
  fs.writeFileSync(new URL('0002_b.sql', d2), B);
  await assert.rejects(() => migrate(db2, { dir: d2 }), /older than the database's version 3/);
});

test('a failing migration rolls back completely and is not recorded', async () => {
  const d = dirWith({ '0001_a.sql': A, '0002_bad.sql': 'create table t_half (id int); insert into nowhere values (1);' });
  const db = new PGlite();
  await assert.rejects(() => migrate(db, { dir: d }), /0002_bad.sql failed and was rolled back/);
  assert.deepEqual(await versions(db), [1]);
  assert.equal((await db.query("select to_regclass('t_half') as t")).rows[0].t, null, 'the half-applied table is gone');
  fs.writeFileSync(new URL('0002_bad.sql', d), B);
  assert.deepEqual((await migrate(db, { dir: d })).applied, ['0002_bad.sql'], 'a corrected file applies cleanly');
});

test('duplicate versions are rejected before anything runs', () => {
  const d = dirWith({ '0001_a.sql': A, '0001_other.sql': B });
  assert.throws(() => listMigrations(d), /share version 1/);
});

test('a database made before migrations existed is adopted as version 1, not rebuilt', async () => {
  const db = new PGlite();
  const real = listMigrations();
  await db.exec(real[0].sql); // the old schema.sql path
  await db.exec("insert into roster.experts(k,doc,declaration,created_at) values ('e1','{}','{\"countries\":[\"TCD\"]}',now())");
  const r = await migrate(db);
  assert.ok(!r.applied.includes(real[0].file));
  assert.equal((await db.query('select count(*)::int as n from roster.experts')).rows[0].n, 1, 'data untouched');
  assert.equal((await versions(db))[0], 1);
});

test('the real migrations build a database from nothing', async () => {
  const db = new PGlite();
  const r = await migrate(db);
  assert.deepEqual(r.applied, listMigrations().map((m) => m.file));
  assert.equal((await db.query("select to_regclass('answers.audit') as t")).rows[0].t, 'answers.audit');
  assert.equal(listMigrations()[0].checksum, checksum(listMigrations()[0].sql));
});

test('over the real pg client (pooled connection, advisory lock) the same guarantees hold', async () => {
  const db = await PGlite.create();
  const port = await new Promise((resolve) => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); });
  const server = new PGLiteSocketServer({ db, port, host: '127.0.0.1' });
  await server.start();
  const pool = new pg.Pool({ host: '127.0.0.1', port, user: 'postgres', database: 'postgres', max: 1 });
  cleanups.push(async () => { await pool.end(); await server.stop(); await db.close(); });
  const dir = dirWith({ '0001_a.sql': `${A} ${B}`, '0002_c.sql': 'create table t_c (id int);' });
  assert.deepEqual((await migrate(pool, { dir })).applied, ['0001_a.sql', '0002_c.sql']);
  assert.deepEqual((await migrate(pool, { dir })).applied, []);
  assert.deepEqual((await pool.query('select version from public.schema_migrations order by 1')).rows.map((r) => r.version), [1, 2]);
});
