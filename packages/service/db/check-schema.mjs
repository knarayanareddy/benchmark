#!/usr/bin/env node
/** Runs db/schema.sql on an in-process Postgres (PGlite) and proves each constraint rejects what it should.
 *  Optional: needs `npm i --no-save @electric-sql/pglite`. */
let PGlite;
try { ({ PGlite } = await import('@electric-sql/pglite')); } catch { console.log('skipped: npm i --no-save @electric-sql/pglite to run the Postgres schema check'); process.exit(0); }
import fs from 'node:fs';
const db = new PGlite();
await db.exec(fs.readFileSync(new URL('./schema.sql', import.meta.url), 'utf8'));
const ok = (l) => console.log('✓', l);
const bad = async (l, sql) => { try { await db.exec(sql); console.log('✗ SHOULD HAVE FAILED:', l); process.exitCode = 1; } catch (e) { ok(`rejected: ${l} (${e.message.split('\n')[0]})`); } };
await db.exec(`insert into roster.experts values ('e1','A','{"countries":["TCD"]}','anonymous',null,now())`);
await bad('empty declaration', `insert into roster.experts values ('e2',null,'{"countries":[]}',null,null,now())`);
await db.exec(`insert into answers.cards(id,status,round,statement,country,win_from,win_to,objective,resolution_source,resolver,seed_p,created_day) values ('C1','open',1,'s','TCD','2026-11-01','2027-04-30','o','IPC','r',0.7,'2026-11-07')`);
await bad('bad resolution source', `insert into answers.cards(id,status,round,statement,country,win_from,win_to,objective,resolution_source,resolver,seed_p,created_day) values ('C2','open',1,'s','TCD','2026-11-01','2027-04-30','o','blog','r',0.7,'2026-11-07')`);
await bad('window reversed', `insert into answers.cards(id,status,round,statement,country,win_from,win_to,objective,resolution_source,resolver,seed_p,created_day) values ('C3','open',1,'s','TCD','2027-11-01','2027-04-30','o','IPC','r',0.7,'2026-11-07')`);
await db.exec(`insert into answers.estimates values ('C1','tok1',1,null,'anonymous',0.4,now())`);
await bad('ballot stuffing (same card/respondent/round)', `insert into answers.estimates values ('C1','tok1',1,null,'anonymous',0.9,now())`);
await db.exec(`insert into answers.estimates values ('C1','tok1',2,null,'anonymous',0.5,now())`);
await bad('anonymous row carrying an expert id', `insert into answers.estimates values ('C1','tok2',1,'e1','anonymous',0.5,now())`);
await bad('unclamped probability', `insert into answers.estimates values ('C1','tok3',1,null,'anonymous',1.0,now())`);
await bad('release below the floor', `insert into answers.releases(card_id,round,visibility,n,closed,at,snapshot) values ('C1',1,'panel',4,true,now(),'{}')`);
await db.exec(`insert into answers.audit(at,actor_id,role,action) values (now(),'m','moderator','x')`);
await bad('audit update', `update answers.audit set action='y'`);
await bad('audit delete', `delete from answers.audit`);
await bad('audit truncate', `truncate answers.audit`);
// optimistic concurrency, as the service does it
await db.exec(`insert into answers.dissents values ('d1',0,'C1',null,'anonymous','anonymous',false,'window','t','open','{}','2026-11-07')`);
const a = await db.query(`update answers.dissents set version=1,status='routed' where id='d1' and version=0 returning id`);
const b = await db.query(`update answers.dissents set version=1,status='routed' where id='d1' and version=0 returning id`);
console.log(a.rows.length === 1 && b.rows.length === 0 ? '✓ CAS: second writer updates 0 rows' : '✗ CAS broken'); if (!(a.rows.length === 1 && b.rows.length === 0)) process.exitCode = 1;
await bad('alias collision in a country', `insert into roster.experts values ('e3',null,'{"countries":["TCD"]}',null,null,now()); insert into roster.aliases values ('e1','TCD','Analyst 4242'); insert into roster.aliases values ('e3','TCD','Analyst 4242')`);
