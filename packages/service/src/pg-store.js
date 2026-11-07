/**
 * Postgres adapter for the store port (see store.js). It takes anything with
 * `query(sql, params) -> { rows }`: a `pg.Pool` in production, PGlite in tests.
 *
 * Each table keeps the full document in `doc` (what the service reads back) and
 * mirrors the rule-bearing fields into typed columns so Postgres enforces them
 * too (see db/schema.sql). `find(where)` is a jsonb containment query, so it
 * can be served by a GIN index on `doc`.
 *
 * Statements are individually atomic. Multi-row operations (erase, retention)
 * are idempotent and ordered so a retry after a failure finishes the job.
 */
import fs from 'node:fs';
import { ConflictError } from './errors.js';

const ts = (ms) => (ms == null ? null : new Date(ms).toISOString());
const json = (v) => JSON.stringify(v ?? null);

/** table -> { schema, columns(doc) -> { column: value } }. Values for jsonb columns are JSON strings. */
const TABLES = {
  experts: { schema: 'roster', columns: (d) => ({ level: d.level ?? null, declaration: json(d.declaration), created_at: ts(d.createdAt) }) },
  invites: { schema: 'roster', columns: (d) => ({ expert_id: d.expertId, expires_at: ts(d.expiresAt), used_at: ts(d.usedAt) }) },
  sessions: { schema: 'roster', columns: (d) => ({ expires_at: ts(d.expiresAt) }) },
  aliases: { schema: 'roster', columns: (d) => ({ expert_id: d.expertId, country: d.country, alias: d.alias }) },
  cards: {
    schema: 'answers',
    columns: (d) => ({
      parent_id: d.parentId ?? null, status: d.status, round: d.round, country: d.country,
      win_from: d.window?.from, win_to: d.window?.to, objective: d.objective,
      resolution_source: d.resolutionSource, resolver: d.resolver, seed_p: d.seedP, evidence_url: d.evidenceUrl ?? null,
    }),
  },
  estimates: {
    schema: 'answers',
    columns: (d) => ({
      card_id: d.cardId, respondent_key: d.respondentKey, round: d.round, expert_id: d.expertId ?? null, level: d.level, p: d.p,
    }),
  },
  releases: {
    schema: 'answers',
    columns: (d) => ({ card_id: d.cardId, round: d.round, visibility: d.visibility, n: d.n, closed: d.closed }),
  },
  dissents: {
    schema: 'answers',
    columns: (d) => ({ card_id: d.cardId, expert_id: d.expert ?? null, level: d.level, status: d.status }),
  },
  notifications: { schema: 'answers', columns: (d) => ({ expert_id: d.to }) },
  audit: { schema: 'answers', columns: (d) => ({ actor_id: d.actorId, action: d.action }) },
};

const JSONB_COLUMNS = new Set(['declaration']);
const UNIQUE_VIOLATION = '23505';

export async function migrate(db) {
  const sql = fs.readFileSync(new URL('../db/schema.sql', import.meta.url), 'utf8');
  if (typeof db.exec === 'function') await db.exec(sql); // PGlite
  else await db.query(sql); // pg runs a multi-statement string on the simple protocol
}

function pgTable(db, name, spec) {
  const fq = `${spec.schema}.${name}`;
  const docs = (res) => res.rows.map((r) => r.doc);
  const cast = (col) => (JSONB_COLUMNS.has(col) ? '::jsonb' : '');

  async function run(sql, params) {
    try {
      return await db.query(sql, params);
    } catch (e) {
      const err = /** @type {any} */ (e);
      if (err && err.code === UNIQUE_VIOLATION) throw new ConflictError(`${name}: ${String(err.detail || err.message).split('\n')[0]}`);
      throw e;
    }
  }

  return {
    async insert(key, row) {
      const cols = spec.columns(row);
      const names = ['k', 'doc', ...Object.keys(cols)];
      const marks = names.map((c, i) => `$${i + 1}${c === 'doc' ? '::jsonb' : cast(c)}`);
      await run(
        `insert into ${fq} (${names.join(',')}) values (${marks.join(',')})`,
        [key, json(row), ...Object.values(cols)]
      );
      return row;
    },
    async append(row) {
      return this.insert(`${Date.now()}:${Math.random().toString(36).slice(2, 10)}`, row);
    },
    async get(key) {
      const r = await run(`select doc from ${fq} where k = $1`, [key]);
      return r.rows[0]?.doc;
    },
    async find(where = {}, pred) {
      const r = await run(`select doc from ${fq} where doc @> $1::jsonb order by seq`, [json(where)]);
      return pred ? docs(r).filter(pred) : docs(r);
    },
    async all() {
      return docs(await run(`select doc from ${fq} order by seq`, []));
    },
    async update(key, expectedVersion, next) {
      const cols = spec.columns(next);
      const names = Object.keys(cols);
      const sets = ['doc = $3::jsonb', ...names.map((c, i) => `${c} = $${i + 4}${cast(c)}`)];
      const r = await run(
        `update ${fq} set ${sets.join(', ')} where k = $1 and coalesce((doc->>'version')::int, 0) = $2 returning k`,
        [key, expectedVersion, json(next), ...Object.values(cols)]
      );
      if (r.rows.length === 0) {
        throw new ConflictError(`${name}: ${key} changed or does not exist (expected version ${expectedVersion})`);
      }
      return next;
    },
    async put(key, row) {
      const cols = spec.columns(row);
      const names = ['k', 'doc', ...Object.keys(cols)];
      const marks = names.map((c, i) => `$${i + 1}${c === 'doc' ? '::jsonb' : cast(c)}`);
      const sets = names.slice(1).map((c) => `${c} = excluded.${c}`);
      await run(
        `insert into ${fq} (${names.join(',')}) values (${marks.join(',')}) on conflict (k) do update set ${sets.join(', ')}`,
        [key, json(row), ...Object.values(cols)]
      );
      return row;
    },
    async remove(key) {
      const r = await run(`delete from ${fq} where k = $1 returning k`, [key]);
      return r.rows.length > 0;
    },
    async removeWhere(where = {}, pred) {
      if (!pred) {
        const r = await run(`delete from ${fq} where doc @> $1::jsonb returning k`, [json(where)]);
        return r.rows.length;
      }
      const r = await run(`select k, doc from ${fq} where doc @> $1::jsonb`, [json(where)]);
      const doomed = r.rows.filter((x) => pred(x.doc)).map((x) => x.k);
      for (const k of doomed) await run(`delete from ${fq} where k = $1`, [k]);
      return doomed.length;
    },
  };
}

/** Build both stores over one connection (or two, to give each its own database role). */
export function createPgStores({ roster: rosterDb, answers: answersDb }) {
  const roster = {};
  const answers = {};
  for (const [name, spec] of Object.entries(TABLES)) {
    if (spec.schema === 'roster') roster[name] = pgTable(rosterDb, name, spec);
    else answers[name] = pgTable(answersDb, name, spec);
  }
  const base = answers.audit;
  answers.audit = Object.freeze({ append: (row) => base.append(row), find: (w, p) => base.find(w, p), all: () => base.all() });
  return { roster, answers };
}
