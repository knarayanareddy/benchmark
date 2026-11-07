import test from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { migrate } from '../src/pg-store.js';

// These prove the DATABASE refuses what the service also refuses, so a bug or a
// second writer cannot get around the rules. Run on a real Postgres engine.
async function fresh() {
  const db = new PGlite();
  await migrate(db);
  await db.exec(`insert into answers.cards(k,doc,status,round,country,win_from,win_to,objective,resolution_source,resolver,seed_p)
    values ('C1','{}','open',1,'TCD','2026-11-01','2027-04-30','o','IPC','r',0.7)`);
  return db;
}
const rejects = (db, sql, re) => assert.rejects(() => db.exec(sql), re);
const est = (key, resp, round, expert, level, p) =>
  `insert into answers.estimates(k,doc,card_id,respondent_key,round,expert_id,level,p) values ('${key}','{}','C1','${resp}',${round},${expert},'${level}',${p})`;

test('an empty Declaration is refused (it would match every card)', async () => {
  const db = await fresh();
  await db.exec(`insert into roster.experts(k,doc,declaration,created_at) values ('e1','{}','{"countries":["TCD"]}',now())`);
  await rejects(db, `insert into roster.experts(k,doc,declaration,created_at) values ('e2','{}','{"countries":[]}',now())`, /declaration_has_country/);
});

test('cards need a real source, a written objective, a resolver and a sane window', async () => {
  const db = await fresh();
  const card = (k, o) => `insert into answers.cards(k,doc,status,round,country,win_from,win_to,objective,resolution_source,resolver,seed_p)
    values ('${k}','{}','open',1,'TCD',${o.from ?? "'2026-11-01'"},'2027-04-30','${o.obj ?? 'o'}','${o.src ?? 'IPC'}','${o.res ?? 'r'}',0.7)`;
  await rejects(db, card('X1', { src: 'a blog' }), /resolution_source/);
  await rejects(db, card('X2', { obj: '   ' }), /objective/);
  await rejects(db, card('X3', { res: ' ' }), /resolver/);
  await rejects(db, card('X4', { from: "'2028-01-01'" }), /violates check/);
});

test('ballot stuffing: one answer per (card, respondent, round); anonymous rows hold no expert id; p is clamped', async () => {
  const db = await fresh();
  await db.exec(est('a', 'tok1', 1, 'null', 'anonymous', 0.4));
  await rejects(db, est('b', 'tok1', 1, 'null', 'anonymous', 0.9), /unique|duplicate/);
  await db.exec(est('c', 'tok1', 2, 'null', 'anonymous', 0.5));
  await rejects(db, est('d', 'tok2', 1, "'e1'", 'anonymous', 0.5), /violates check/);
  await rejects(db, est('e', 'tok3', 1, 'null', 'anonymous', 1.0), /p_check|violates check/);
  await rejects(db, est('f', 'tok4', 1, 'null', 'anonymous', 0.0), /p_check|violates check/);
});

test('a release below the floor of 5, or a duplicate release, is refused', async () => {
  const db = await fresh();
  const rel = (k, n) => `insert into answers.releases(k,doc,card_id,round,visibility,n,closed) values ('${k}','{}','C1',1,'panel',${n},true)`;
  await rejects(db, rel('r1', 4), /n_check|violates check/);
  await db.exec(rel('r2', 6));
  await rejects(db, rel('r3', 6), /unique|duplicate/);
});

test('the audit log is append-only even for the table owner', async () => {
  const db = await fresh();
  await db.exec(`insert into answers.audit(k,doc,actor_id,action) values ('a1','{}','m','x')`);
  await rejects(db, `update answers.audit set action='y'`, /append-only/);
  await rejects(db, `delete from answers.audit`, /append-only/);
  await rejects(db, `truncate answers.audit`, /append-only/);
});

test('aliases: one per expert and country, and no two experts share one in a country', async () => {
  const db = await fresh();
  const al = (k, e, a) => `insert into roster.aliases(k,doc,expert_id,country,alias) values ('${k}','{}','${e}','TCD','${a}')`;
  await db.exec(al('1', 'e1', 'Analyst 4242'));
  await rejects(db, al('2', 'e2', 'Analyst 4242'), /unique|duplicate/);
  await rejects(db, al('3', 'e1', 'Analyst 5000'), /unique|duplicate/);
});

test('compare-and-set: the second writer on a stale version updates zero rows', async () => {
  const db = await fresh();
  await db.exec(`insert into answers.dissents(k,doc,card_id,expert_id,level,status) values ('d1','{"version":0}','C1',null,'anonymous','open')`);
  const cas = `update answers.dissents set doc='{"version":1}', status='routed' where k='d1' and coalesce((doc->>'version')::int,0)=0 returning k`;
  assert.equal((await db.query(cas)).rows.length, 1);
  assert.equal((await db.query(cas)).rows.length, 0);
});

test('roles: bm_answers cannot read the roster, bm_roster cannot read the answers, and the audit log cannot be rewritten', async () => {
  const db = await fresh();
  const fs = await import('node:fs');
  await db.exec(fs.readFileSync(new URL('../db/roles.sql', import.meta.url), 'utf8'));
  await db.exec(`insert into roster.experts(k,doc,declaration,created_at) values ('e1','{}','{"countries":["TCD"]}',now())`);
  await db.exec(est('a', 'tok1', 1, 'null', 'anonymous', 0.4));
  await db.exec(`insert into answers.audit(k,doc,actor_id,action) values ('a1','{}','m','x')`);

  await db.exec('set role bm_answers');
  assert.equal((await db.query('select count(*)::int as n from answers.estimates')).rows[0].n, 1, 'bm_answers reads answers');
  await assert.rejects(() => db.exec('select * from roster.experts'), /permission denied/);
  await assert.rejects(() => db.exec('select * from roster.aliases'), /permission denied/);
  await assert.rejects(() => db.exec(`delete from answers.audit`), /permission denied|append-only/);
  await assert.rejects(() => db.exec(`update answers.audit set action = 'y'`), /permission denied|append-only/);
  await db.exec(`insert into answers.audit(k,doc,actor_id,action) values ('a2','{}','m','y')`);
  await db.exec('reset role');

  await db.exec('set role bm_roster');
  assert.equal((await db.query('select count(*)::int as n from roster.experts')).rows[0].n, 1, 'bm_roster reads the roster');
  await assert.rejects(() => db.exec('select * from answers.estimates'), /permission denied/);
  await assert.rejects(() => db.exec('select * from answers.dissents'), /permission denied/);
  await db.exec('reset role');
});
