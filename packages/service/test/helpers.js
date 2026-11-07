// Shared by the service test suites: the same world on every backend.
import { after } from 'node:test';
import net from 'node:net';
import { createService } from '../src/service.js';
import { createRosterStore, createAnswerStore } from '../src/store.js';
import { createPgStores } from '../src/pg-store.js';
import { migrate } from '../src/migrate.js';
import { CONSENT_VERSION } from '../src/consent.js';

export const SECRETS = { ballot: 'ballot-secret-for-tests-0001', alias: 'alias-secret-for-tests-00002' };
export const DAY = 86400000;
export const T0 = Date.UTC(2026, 10, 7, 10, 23, 45, 123);
export const WINDOW = { from: '2026-11-01', to: '2027-04-30' };
export const CARD = {
  statement: 'Cholera cases in Chad will exceed 10,000 by 30 April 2027.',
  country: 'TCD', region: 'Sahel', theme: 'health', window: WINDOW,
  objective: 'WHO weekly bulletin cumulative cases above 10,000', resolutionSource: 'IPC',
  resolver: 'R. Resolver', probability: 'High',
};

export let PGlite = null;
let PGLiteSocketServer = null;
let pg = null;
try { ({ PGlite } = await import('@electric-sql/pglite')); } catch { /* dev dependency */ }
try { ({ PGLiteSocketServer } = await import('@electric-sql/pglite-socket')); ({ default: pg } = await import('pg')); } catch { /* dev dependency */ }
// 'postgres' runs PGlite in-process. 'pg-driver' runs the real `pg` client over the
// Postgres wire protocol, which is what production uses.
export const BACKENDS = ['memory', ...(PGlite ? ['postgres'] : []), ...(PGlite && PGLiteSocketServer && pg ? ['pg-driver'] : [])];

const cleanups = [];
after(async () => { for (const c of cleanups.splice(0)) await c(); });

const freePort = () => new Promise((resolve) => {
  const s = net.createServer();
  s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
});

export async function pgDriverStores() {
  const db = await PGlite.create();
  const port = await freePort();
  const server = new PGLiteSocketServer({ db, port, host: '127.0.0.1' });
  await server.start();
  const pool = new pg.Pool({ host: '127.0.0.1', port, user: 'postgres', database: 'postgres', max: 1 });
  cleanups.push(async () => { await pool.end(); await server.stop(); await db.close(); });
  // The pglite-socket test shim closes the connection after ANY SQL error (real Postgres
  // does not), so the next query on that connection fails before it runs. Retry it once.
  const db2 = {
    async query(sql, params) {
      try { return await pool.query(sql, params); } catch (e) {
        if (e.code === 'ECONNRESET') return pool.query(sql, params);
        throw e;
      }
    },
  };
  await migrate(db2);
  return createPgStores({ roster: db2, answers: db2 });
}

export const many = async (n, f) => { const out = []; for (let i = 0; i < n; i++) out.push(await f(i)); return out; };

export async function makeStores(backend) {
  if (backend === 'memory') return { roster: createRosterStore(), answers: createAnswerStore() };
  if (backend === 'pg-driver') return pgDriverStores();
  const db = new PGlite();
  await migrate(db);
  return createPgStores({ roster: db, answers: db });
}

export async function worldFor(backend, overrides = {}) {
  const { roster, answers } = await makeStores(backend);
  const clock = { now: T0 };
  const svc = createService({ roster, answers, secrets: SECRETS, now: () => clock.now, ...overrides });
  const mod = await svc.authenticate(await svc.createStaffSession({ id: 'mod1', role: 'moderator' }));
  const analyst = await svc.authenticate(await svc.createStaffSession({ id: 'an1', role: 'analyst' }));
  const enroll = async (level, { name, countries = ['TCD'] } = {}) => {
    const inv = await svc.createInvite(mod, { declaration: { countries }, name });
    const r = await svc.redeemInvite(inv.token, { level, consentVersion: CONSENT_VERSION });
    return { ...r, actor: await svc.authenticate(r.sessionToken), invite: inv };
  };
  return { roster, answers, clock, svc, mod, analyst, enroll };
}

