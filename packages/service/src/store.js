/**
 * Storage port + a dependency-free adapter.
 *
 * The service never touches storage directly; it uses these small, explicit
 * operations so each one maps to one SQL statement (see db/schema.sql). There
 * are TWO stores on purpose:
 *
 *   roster  — who the experts are: identities, declarations, invites, sessions,
 *             persisted aliases, consent.
 *   answers — what was said: cards, estimates, releases, dissents, audit.
 *
 * In production they are separate database roles (or databases) with no join
 * privilege, so a reader of the answers cannot re-link them to the roster.
 *
 * `table({ unique })` gives: insert (rejects a duplicate unique key),
 * get, find, update (compare-and-set on `version`), remove. If `file` is given,
 * the store writes an atomic JSON snapshot after every mutation, which is
 * enough to survive a restart in a pilot. It is NOT a substitute for Postgres.
 */
import fs from 'node:fs';
import path from 'node:path';
import { ConflictError } from './errors.js';

export { ConflictError };

function clone(v) {
  return v === undefined ? undefined : structuredClone(v);
}

export function createStore(spec, { file } = {}) {
  const data = {};
  const unique = {};
  for (const [name, opts] of Object.entries(spec)) {
    data[name] = new Map();
    unique[name] = opts.unique || [];
  }
  if (file && fs.existsSync(file)) {
    const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
    for (const name of Object.keys(data)) {
      for (const [k, v] of saved[name] || []) data[name].set(k, v);
    }
  }

  const persist = () => {
    if (!file) return;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const out = {};
    for (const [name, m] of Object.entries(data)) out[name] = [...m.entries()];
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(out), { mode: 0o600 });
    fs.renameSync(tmp, file);
  };

  const uniqueKey = (name, row) =>
    unique[name].map((cols) => cols.map((c) => JSON.stringify(row[c] ?? null)).join('|'));

  const tables = {};
  let seq = 0;
  for (const name of Object.keys(spec)) {
    const m = data[name];
    tables[name] = {
      /** Insert a row under `key`. Throws ConflictError on a duplicate key or unique constraint. */
      insert(key, row) {
        if (m.has(key)) throw new ConflictError(`${name}: ${key} already exists`);
        const keys = uniqueKey(name, row);
        for (const other of m.values()) {
          const ok = uniqueKey(name, other);
          keys.forEach((k, i) => {
            if (k === ok[i]) throw new ConflictError(`${name}: duplicate ${unique[name][i].join('+')}`);
          });
        }
        m.set(key, clone(row));
        persist();
        return clone(row);
      },
      /** Append with a generated key (for append-only tables). */
      append(row) {
        return this.insert(`${String(++seq).padStart(12, '0')}:${Date.now()}`, row);
      },
      get: (key) => clone(m.get(key)),
      find: (pred = () => true) => [...m.values()].filter(pred).map(clone),
      all: () => [...m.values()].map(clone),
      /**
       * Compare-and-set: writes only if the stored row still has
       * `expectedVersion`. Equivalent to `update ... where id=? and version=?`.
       */
      update(key, expectedVersion, next) {
        const cur = m.get(key);
        if (!cur) throw new ConflictError(`${name}: ${key} does not exist`);
        if ((cur.version ?? 0) !== expectedVersion) {
          throw new ConflictError(`${name}: ${key} changed (expected version ${expectedVersion}, found ${cur.version ?? 0})`);
        }
        m.set(key, clone(next));
        persist();
        return clone(next);
      },
      /** Unconditional replace, for tables without a version column. */
      put(key, row) { m.set(key, clone(row)); persist(); return clone(row); },
      remove(key) { const had = m.delete(key); if (had) persist(); return had; },
      removeWhere(pred) {
        let n = 0;
        for (const [k, v] of [...m.entries()]) if (pred(v)) { m.delete(k); n++; }
        if (n) persist();
        return n;
      },
    };
  }
  return tables;
}

export const createRosterStore = (opts) =>
  createStore(
    {
      experts: {},
      invites: {},
      sessions: {},
      aliases: {},
    },
    opts
  );

export const createAnswerStore = (opts) => {
  const t = createStore(
    {
      cards: {},
      estimates: { unique: [['cardId', 'respondentKey', 'round']] },
      releases: {},
      dissents: {},
      notifications: {},
      audit: {},
    },
    opts
  );
  // The audit log is append-only: it does not expose update or remove.
  const base = t.audit;
  t.audit = Object.freeze({ append: (row) => base.append(row), find: base.find, all: base.all });
  return t;
};
