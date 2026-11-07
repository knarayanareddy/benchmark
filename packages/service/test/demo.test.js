import baseTest from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { BACKENDS, SECRETS, worldFor, CARD, many } from './helpers.js';
import { CONSENT_VERSION, consentHash } from '../src/consent.js';
import { createServer } from '../src/http.js';
import { ValidationError } from '../src/errors.js';
import { THEMES, REGIONS } from '@benchmark/core/taxonomy';
import { DEMO_CARDS } from '../src/demo-data.js';

// Anything that would tell a demo joiner what ACAPS thinks, in any spelling.
const LEAK = /acaps(P|Band)|acaps_p|seedP|0\.(105|305|505|705|905)\b|"High"|"Medium"|"Low"|midpoint|"probability"/;
const RADAR_FILE = fileURLToPath(new URL('../../../data/risk-radar.json', import.meta.url));
const PROFILE = {
  organisation: 'Test org', roleType: 'researcher', countries: ['KEN', 'BGD', 'MOZ', 'MEX'],
  themes: ['climate', 'displacement', 'conflict', 'political_economic'], weeklyCap: 3,
};
const SECOND_LOOK = {
  acapsReasoning: 'Analysts weigh the seasonal rainfall outlook and how many provinces are already on flood watch, which have been a fair guide to past declarations.',
  sources: [{ label: 'Demo background', url: 'https://reliefweb.int/' }],
  higher: ['Seasonal rainfall outlooks point to heavier than usual rain in several islands.'],
  lower: ['Past provincial declarations were often limited to a single district rather than a whole province.'],
};
const joinInput = (over = {}) => ({ name: 'Visitor', level: 'identified', mode: 'server', consentVersion: CONSENT_VERSION, profile: PROFILE, ...over });

/** Counts of everything a half-made account would leave behind. */
const footprint = async (w) => ({
  experts: (await w.roster.experts.all()).length,
  invites: (await w.roster.invites.all()).length,
  sessions: (await w.roster.sessions.all()).length,
});

for (const backend of BACKENDS) {
  const test = (name, fn) => baseTest(`[${backend}] ${name}`, () => fn());
  const seeded = async (opts = {}) => {
    const w = await worldFor(backend, { demo: true, ...opts });
    await w.svc.seedDemo();
    return w;
  };

  test('seed creates the expected states: 5 open in round 1, 1 closed with a thread, 1 in round 2', async () => {
    const w = await seeded();
    const rows = await w.svc.listCards(w.analyst);
    assert.equal(rows.length, DEMO_CARDS.length);
    assert.ok(rows.every((c) => c.demo === true), 'every seeded card is flagged demo');
    const count = (f) => rows.filter(f).length;
    const openData = DEMO_CARDS.filter((c) => c.state === 'open');
    assert.equal(count((c) => c.status === 'open' && c.round === 1), openData.length);
    assert.equal(count((c) => c.status === 'closed' && c.round === 1), 1);
    assert.equal(count((c) => c.status === 'open' && c.round === 2), 1);
    // The open cards have 0 to 3 panel answers each, varied, so the Pulse can say the circle needs more.
    const responses = rows.filter((c) => c.status === 'open' && c.round === 1).map((c) => c.responses).sort((a, b) => a - b);
    assert.deepEqual(responses, openData.map((c) => c.estimates.length).sort((a, b) => a - b));
    assert.ok(responses.every((n) => n >= 0 && n <= 3));
    assert.ok(new Set(responses).size >= 3, 'the answer counts vary');
  });

  test('the closed card has a thread with 3 approved posts and 1 pending, and the round-2 card has a released aggregate', async () => {
    const w = await seeded();
    const rows = await w.svc.listCards(w.analyst);
    const closed = rows.find((c) => c.status === 'closed');
    assert.equal(closed.threadEnabled, true);
    const posts = await w.answers.thread_posts.find({ cardId: closed.id });
    assert.equal(posts.filter((p) => p.status === 'approved').length, 3);
    assert.equal(posts.filter((p) => p.status === 'pending').length, 1);
    assert.equal((await w.svc.listPending(w.mod)).length, 1, 'the moderator queue is not empty');

    const r2 = rows.find((c) => c.round === 2);
    assert.equal(r2.hasSecondLook, true);
    const round1 = await w.svc.cardRelease(r2.id, { round: 1 });
    assert.equal(round1.suppressed, false, 'the round-1 result was released when round 1 closed');
    assert.equal(round1.n, 6);
    assert.ok((await w.answers.releases.find({ cardId: r2.id, round: 1, visibility: 'panel' })).length >= 1);
  });

  test('seed twice creates nothing new', async () => {
    const w = await seeded();
    const before = { cards: (await w.answers.cards.all()).length, experts: (await w.roster.experts.all()).length, posts: (await w.answers.thread_posts.all()).length };
    const again = await w.svc.seedDemo();
    assert.equal(again.seeded, false);
    assert.deepEqual({
      cards: (await w.answers.cards.all()).length, experts: (await w.roster.experts.all()).length, posts: (await w.answers.thread_posts.all()).length,
    }, before);
  });

  test('every demo card is flagged demo and its objective starts DEMO:', async () => {
    const w = await seeded();
    const cards = await w.answers.cards.all();
    assert.equal(cards.length, DEMO_CARDS.length);
    for (const c of cards) {
      assert.equal(c.demo, true, `${c.id} is flagged`);
      assert.ok(c.objective.startsWith('DEMO:'), `${c.id} objective is labelled`);
    }
  });

  test('presenter mode (demoLabels false): no objective says DEMO:, statements are unchanged, and every card and expert is still flagged demo', async () => {
    const w = await seeded({ demoLabels: false });
    const cards = await w.answers.cards.all();
    assert.equal(cards.length, DEMO_CARDS.length);
    cards.forEach((c, i) => {
      assert.equal(c.demo, true, `${c.id} is flagged`);
      assert.doesNotMatch(c.objective, /DEMO:/, `${c.id} objective is not labelled`);
      assert.equal(c.objective, DEMO_CARDS[i].objective.replace(/^DEMO: /, ''));
      assert.equal(c.statement, DEMO_CARDS[i].statement);
    });
    const experts = await w.roster.experts.all();
    assert.ok(experts.length > 0 && experts.every((e) => e.demo === true), 'every panel expert is flagged demo');
  });

  test('every seeded card carries a theme key from THEMES and a region from REGIONS', async () => {
    const w = await seeded();
    for (const c of await w.answers.cards.all()) {
      assert.ok(Object.hasOwn(THEMES, c.theme), `${c.id} theme ${c.theme}`);
      assert.ok(REGIONS.includes(c.region), `${c.id} region ${c.region}`);
    }
  });

  test('the open cards cover at least 20 countries, and every open card has a theme and a region', async () => {
    const w = await seeded();
    const open = (await w.answers.cards.all()).filter((c) => c.status === 'open' && c.round === 1);
    assert.ok(new Set(open.map((c) => c.country)).size >= 20, `${new Set(open.map((c) => c.country)).size} countries`);
    for (const c of open) {
      assert.ok(Object.hasOwn(THEMES, c.theme), `${c.id} theme`);
      assert.ok(REGIONS.includes(c.region), `${c.id} region`);
    }
  });

  test('a joiner who declares only one country, with no themes, is asked about its open cards', async () => {
    const w = await seeded();
    for (const iso of ['SDN', 'SYR', 'YEM', 'TCD', 'UKR']) {
      const join = await w.svc.demoJoin(joinInput({ profile: { ...PROFILE, countries: [iso], themes: [] } }));
      const box = await w.svc.inbox(await w.svc.authenticate(join.sessionToken));
      assert.ok(box.toAnswer.length >= 1, `${iso} gets at least one card`);
      assert.ok(box.toAnswer.every((c) => c.country === iso), `${iso} gets only its own cards`);
    }
  });

  test('the strict rule holds: a joiner who declares Sudan and a theme no Sudan card has gets nothing', async () => {
    const w = await seeded();
    const join = await w.svc.demoJoin(joinInput({ profile: { ...PROFILE, countries: ['SDN'], themes: ['health'] } }));
    const box = await w.svc.inbox(await w.svc.authenticate(join.sessionToken));
    assert.deepEqual(box.toAnswer, []);
  });

  test('different profiles get different asks: a Kenya + climate person sees only the Kenya card, a Somalia + food person sees only Somalia', async () => {
    const w = await seeded();
    const kenya = await w.svc.demoJoin(joinInput({ profile: { ...PROFILE, countries: ['KEN'], themes: ['climate'] } }));
    const somalia = await w.svc.demoJoin(joinInput({ profile: { ...PROFILE, countries: ['SOM'], themes: ['food'] } }));
    const ask = async (j) => (await w.svc.inbox(await w.svc.authenticate(j.sessionToken))).toAnswer.map((c) => c.country);
    assert.deepEqual(await ask(kenya), ['KEN']);
    assert.deepEqual(await ask(somalia), ['SOM']);
  });

  test('the panel is 8 synthetic experts, flagged demo, with a mix of levels and a saved profile', async () => {
    const w = await seeded();
    const experts = await w.roster.experts.all();
    assert.equal(experts.length, 8);
    assert.ok(experts.every((e) => e.demo === true));
    assert.ok(experts.every((e) => e.profile?.completedAt), 'each panellist saved a profile');
    const levels = new Set(experts.map((e) => e.level));
    assert.deepEqual([...levels].sort(), ['anonymous', 'identified', 'pseudonymous']);
  });

  test('a demo joiner\'s inbox shows the open demo cards in their countries and no ACAPS number anywhere', async () => {
    const w = await seeded();
    const join = await w.svc.demoJoin(joinInput());
    const box = await w.svc.inbox(await w.svc.authenticate(join.sessionToken));
    assert.deepEqual(box.toAnswer.map((c) => c.country).sort(), ['BGD', 'KEN', 'MEX', 'MOZ']);
    assert.doesNotMatch(JSON.stringify(box), LEAK);
  });

  test('an anonymous demo joiner leaves no name in the roster; a named one keeps it', async () => {
    const w = await worldFor(backend, { demo: true });
    const anon = await w.svc.demoJoin(joinInput({ name: 'Zorblax Quimby', level: 'anonymous' }));
    const named = await w.svc.demoJoin(joinInput({ name: 'Ulrika Thorne', level: 'identified' }));
    const dump = JSON.stringify(await w.roster.experts.all());
    assert.ok(!dump.includes('Zorblax'), 'the anonymous joiner\'s typed name must not be stored');
    assert.ok(dump.includes('Ulrika'), 'an identified joiner\'s name is kept');
    assert.equal((await w.roster.experts.get(anon.expertId)).name, null);
    assert.equal((await w.roster.experts.get(named.expertId)).name, 'Ulrika Thorne');
  });

  test('demoJoin makes a real account: the consent hash redeemInvite stores for that level, and the profile is saved', async () => {
    const w = await worldFor(backend, { demo: true });
    const normal = await w.enroll('pseudonymous');
    const normalRow = await w.roster.experts.get(normal.expertId);
    const join = await w.svc.demoJoin(joinInput({ level: 'pseudonymous', profile: { ...PROFILE, countries: ['KEN'], organisation: 'Test org' } }));
    const row = await w.roster.experts.get(join.expertId);
    assert.equal(join.level, 'pseudonymous');
    assert.equal(join.mode, 'server');
    assert.equal(row.consent.textHash, normalRow.consent.textHash);
    assert.equal(row.consent.textHash, consentHash('pseudonymous', { breakGlass: false, device: false }));
    assert.equal(row.demoJoined, true);
    const p = await w.svc.getProfile(await w.svc.authenticate(join.sessionToken));
    assert.equal(p.organisation, 'Test org');
    assert.deepEqual(p.declaration.countries, ['KEN']);
    assert.equal(p.needsSetup, false);
  });

  test('demoJoin works for the device-held option when a blind key is configured, with the device consent hash', async () => {
    const blindKey = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' });
    const w = await worldFor(backend, { demo: true, blindKey });
    const inv = await w.svc.createInvite(w.mod, { declaration: { countries: ['TCD'] } });
    const dev = await w.svc.redeemInvite(inv.token, { level: 'anonymous', mode: 'device', consentVersion: CONSENT_VERSION });
    const devRow = await w.roster.experts.get(dev.expertId);
    const join = await w.svc.demoJoin(joinInput({ level: 'anonymous', mode: 'device' }));
    const row = await w.roster.experts.get(join.expertId);
    assert.equal(join.mode, 'device');
    assert.equal(row.tokenMode, 'device');
    assert.equal(row.consent.textHash, devRow.consent.textHash);
  });

  test('a join with a bad profile fails cleanly: the half-made account is erased, nothing is left behind', async () => {
    const w = await worldFor(backend, { demo: true });
    const before = await footprint(w);
    await assert.rejects(w.svc.demoJoin(joinInput({ profile: { ...PROFILE, roleType: 'astronaut' } })), ValidationError);
    assert.deepEqual(await footprint(w), before);
  });

  test('a device-held join without a configured blind key, or device with a non-anonymous level, leaves no account', async () => {
    const w = await worldFor(backend, { demo: true });
    const before = await footprint(w);
    await assert.rejects(w.svc.demoJoin(joinInput({ level: 'anonymous', mode: 'device' })), { status: 409 });
    await assert.rejects(w.svc.demoJoin(joinInput({ level: 'identified', mode: 'device' })), ValidationError);
    assert.deepEqual(await footprint(w), before);
  });

  test('a join refuses a bad name, a bad level and a bad mode before creating anything', async () => {
    const w = await worldFor(backend, { demo: true });
    const before = await footprint(w);
    for (const bad of [{ name: '' }, { name: '   ' }, { name: 'x'.repeat(81) }, { name: 42 }, { level: 'public' }, { level: undefined }, { mode: 'phone' }]) {
      await assert.rejects(w.svc.demoJoin(joinInput(bad)), ValidationError, JSON.stringify(bad));
    }
    assert.deepEqual(await footprint(w), before);
  });

  test('a stale consent version leaves no account behind', async () => {
    const w = await worldFor(backend, { demo: true });
    const before = await footprint(w);
    await assert.rejects(w.svc.demoJoin(joinInput({ consentVersion: 'stale' })), ValidationError);
    assert.deepEqual(await footprint(w), before);
  });

  test('the seed links each card to the first radar risk for its country; with no radar, no card has one', async () => {
    const radar = [
      { id: 'R0002', title: 'Kenya second risk', iso: 'KEN', country: 'Kenya' },
      { id: 'R0001', title: 'Kenya first risk', iso: 'KEN', country: 'Kenya' },
      { id: 'R0009', title: 'Haiti risk', iso: 'HTI', country: 'Haiti' },
    ];
    const w = await seeded({ radar });
    const rows = await w.svc.listCards(w.analyst);
    assert.equal(rows.find((c) => c.country === 'KEN').riskId, 'R0001');
    assert.equal(rows.find((c) => c.country === 'BGD').riskId, null);
    const empty = await seeded();
    assert.ok((await empty.svc.listCards(empty.analyst)).every((c) => c.riskId === null));
  });

  for (const demoLabels of [true, false]) test(`secondLookSummary ignores a demo card and counts the same shape on a non-demo card (presenter mode: ${!demoLabels})`, async () => {
    const w = await worldFor(backend, { demo: true, demoLabels });
    const es = await many(8, () => w.enroll('identified'));
    const { card: demoCard } = await w.svc.createCard(w.analyst, { ...CARD, statement: 'Cholera cases in Chad will exceed 12,000 by 30 April 2027.' });
    const { card: plain } = await w.svc.createCard(w.analyst, CARD);
    // Flagged the way the seed flags its cards. The service must still see the same shape on the plain card.
    const flag = async (id, demo) => {
      const c = await w.answers.cards.get(id);
      await w.answers.cards.update(id, c.version, { ...c, demo, version: c.version + 1 });
    };
    await flag(demoCard.id, true);
    for (const id of [demoCard.id, plain.id]) await w.svc.setSecondLook(w.analyst, { cardId: id, content: SECOND_LOOK });
    for (const e of es) {
      for (const id of [demoCard.id, plain.id]) await w.svc.submitEstimate(e.actor, { cardId: id, p: 0.4 });
    }
    for (const id of [demoCard.id, plain.id]) await w.svc.closeRound(w.mod, id);
    for (const id of [demoCard.id, plain.id]) await w.svc.openRound2(w.mod, id);
    for (const e of es) {
      for (const id of [demoCard.id, plain.id]) await w.svc.submitEstimate(e.actor, { cardId: id, p: 0.6 });
    }
    const pairsOf = (s) => Object.values(s.arms).reduce((sum, a) => sum + a.n, 0);

    const demoOn = await w.svc.secondLookSummary(w.mod);
    assert.equal(demoOn.cards, 1, 'only the plain card counts');
    assert.equal(pairsOf(demoOn), 8, 'only its eight pairs count');

    await flag(demoCard.id, false);
    const demoOff = await w.svc.secondLookSummary(w.mod);
    assert.equal(demoOff.cards, 2, 'with the flag removed, the same card does count');
    assert.equal(pairsOf(demoOff), 16);
  });

  test('seedDemo and demoJoin do not exist when demo is off', async () => {
    const w = await worldFor(backend);
    assert.equal(w.svc.demoJoin, undefined);
    assert.equal(w.svc.seedDemo, undefined);
  });
}

// ── HTTP (every backend) ────────────────────────────────────────────────
for (const backend of BACKENDS) {
  const boot = async (w, opts = {}) => {
    const server = createServer({ service: w.svc, limits: { writesPerMinute: 10000, burstWrites: 10000 }, ...opts });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const base = `http://127.0.0.1:${server.address().port}`;
    const call = async (method, path, { body } = {}) => {
      const res = await fetch(base + path, {
        method, headers: body === undefined ? {} : { 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const text = await res.text();
      return { status: res.status, json: text ? JSON.parse(text) : null };
    };
    return { call, close: () => new Promise((r) => server.close(r)) };
  };

  baseTest(`[${backend}] HTTP: with demo off, POST /api/demo/join is 404`, async () => {
    const w = await worldFor(backend);
    const h = await boot(w);
    try {
      assert.equal((await h.call('POST', '/api/demo/join', { body: joinInput() })).status, 404);
      assert.deepEqual((await h.call('GET', '/api/config')).json, { demo: false, deviceKeys: false, breakGlass: false, demoLabels: false });
    } finally { await h.close(); }
  });

  baseTest(`[${backend}] HTTP: /api/config answers exactly four booleans, each taken from its own config flag, and no key material`, async () => {
    const w = await worldFor(backend);
    for (const config of [
      { demo: false, deviceKeys: true, breakGlass: false },
      { demo: false, deviceKeys: false, breakGlass: true },
      { demo: true, deviceKeys: true, breakGlass: true },
      { demo: true, demoLabels: false },
      { demo: true, demoLabels: true },
      { demoLabels: true },
      {},
    ]) {
      const h = await boot(w, { config });
      try {
        const res = await h.call('GET', '/api/config');
        assert.equal(res.status, 200);
        assert.deepEqual(Object.keys(res.json).sort(), ['breakGlass', 'demo', 'demoLabels', 'deviceKeys']);
        // demoLabels is true only when demo is on and the labels are not switched off.
        assert.deepEqual(res.json, {
          demo: Boolean(config.demo), deviceKeys: Boolean(config.deviceKeys), breakGlass: Boolean(config.breakGlass),
          demoLabels: Boolean(config.demo) && config.demoLabels !== false,
        });
        assert.doesNotMatch(JSON.stringify(res.json), /BEGIN|PRIVATE|MII/);
      } finally { await h.close(); }
    }
  });

  baseTest(`[${backend}] HTTP: with demo on, the join route works and /api/config reports only the four flags`, async () => {
    const w = await worldFor(backend, { demo: true });
    await w.svc.seedDemo();
    const h = await boot(w, { config: { demo: true } });
    try {
      const cfg = await h.call('GET', '/api/config');
      assert.deepEqual(Object.keys(cfg.json).sort(), ['breakGlass', 'demo', 'demoLabels', 'deviceKeys']);
      assert.deepEqual(cfg.json, { demo: true, deviceKeys: false, breakGlass: false, demoLabels: true });
      assert.doesNotMatch(JSON.stringify(cfg.json), /demo-moderator|credential|password|demo-[A-Za-z0-9_-]{8,}/i);
      const bad = await h.call('POST', '/api/demo/join', { body: joinInput({ consentVersion: 'stale' }) });
      assert.equal(bad.status, 400);
      assert.match(bad.json.consentText, /Residual risk/);
      const ok = await h.call('POST', '/api/demo/join', { body: joinInput() });
      assert.equal(ok.status, 200);
      assert.equal(ok.json.level, 'identified');
      assert.ok(ok.json.sessionToken && ok.json.expertId);
      assert.equal((await w.roster.experts.get(ok.json.expertId)).demoJoined, true);
    } finally { await h.close(); }
  });
}

// The demo staff credentials are random per boot and printed to the console; the served config never carries them.
const SERVE = fileURLToPath(new URL('../bin/serve.mjs', import.meta.url));
const freePort = () => new Promise((resolve) => {
  const srv = net.createServer();
  srv.listen(0, '127.0.0.1', () => { const { port } = srv.address(); srv.close(() => resolve(port)); });
});
/** Only the variables the test sets: nothing from the developer's shell leaks into the child. */
const childEnv = (extra) => ({ PATH: process.env.PATH, HOME: process.env.HOME, ...extra });

baseTest('[memory] serve.mjs refuses BENCHMARK_DEMO=1 with DATABASE_URL unless BENCHMARK_DEMO_ALLOW_DATABASE=1', async () => {
  const child = spawn(process.execPath, [SERVE], {
    env: childEnv({
      BENCHMARK_DEMO: '1', DATABASE_URL: 'postgres://nobody@127.0.0.1:1/none', PORT: String(await freePort()),
      BENCHMARK_BALLOT_SECRET: SECRETS.ballot, BENCHMARK_ALIAS_SECRET: SECRETS.alias,
    }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let err = '';
  child.stderr.on('data', (d) => { err += d; });
  const code = await new Promise((resolve) => child.on('exit', resolve));
  assert.equal(code, 2);
  assert.match(err, /refusing to start/);
  assert.match(err, /BENCHMARK_DEMO_ALLOW_DATABASE=1/);
});

baseTest('[memory] serve.mjs in demo mode prints two random staff credentials that sign in, and never serves them', async () => {
  const port = await freePort();
  const child = spawn(process.execPath, [SERVE], {
    env: childEnv({
      BENCHMARK_DEMO: '1', BENCHMARK_ALLOW_HTTP: '1', PORT: String(port), BENCHMARK_STATIC_DIR: tmpdir(),
      BENCHMARK_BALLOT_SECRET: SECRETS.ballot, BENCHMARK_ALIAS_SECRET: SECRETS.alias,
    }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  try {
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    const printed = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`no DEMO MODE line; stdout: ${out}`)), 20000);
      const look = () => {
        const m = out.match(/Demo staff credentials \(sign in on the staff page\): (.+)/);
        if (m && out.includes('listening on')) { clearTimeout(timer); resolve(m[1].split(', ')); }
      };
      child.stdout.on('data', look);
      look();
    });
    assert.equal(printed.length, 2);
    for (const c of printed) assert.match(c, /^demo-[A-Za-z0-9_-]{16}$/, 'random, not a fixed string');
    assert.notEqual(printed[0], printed[1]);
    const base = `http://127.0.0.1:${port}`;
    const cfg = await (await fetch(`${base}/api/config`)).text();
    assert.deepEqual(JSON.parse(cfg), { demo: true, deviceKeys: false, breakGlass: false, demoLabels: true });
    for (const c of printed) assert.ok(!cfg.includes(c));
    const signIn = (credential) => fetch(`${base}/api/staff/session`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ credential }),
    });
    assert.equal((await signIn(printed[0])).status, 200, 'a printed credential signs in');
    assert.notEqual((await signIn('demo-moderator-1')).status, 200, 'the old fixed credential does not');
  } finally {
    child.kill();
  }
});

// What serve.mjs tells browsers about the keys it was given: booleans, never the keys themselves.
const KEYGEN = fileURLToPath(new URL('../bin/blind-keygen.mjs', import.meta.url));
/** serve.mjs in memory mode with `extra` env; resolves once it is listening. */
async function serveWith(extra) {
  const port = await freePort();
  const child = spawn(process.execPath, [SERVE], {
    env: childEnv({ BENCHMARK_ALLOW_HTTP: '1', PORT: String(port), BENCHMARK_STATIC_DIR: tmpdir(), BENCHMARK_BALLOT_SECRET: SECRETS.ballot, BENCHMARK_ALIAS_SECRET: SECRETS.alias, ...extra }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  child.stdout.on('data', (d) => { out += d; });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`serve.mjs did not start: ${out}`)), 20000);
    child.stdout.on('data', () => { if (out.includes('listening on')) { clearTimeout(timer); resolve(); } });
    child.on('exit', (code) => { clearTimeout(timer); reject(new Error(`serve.mjs exited with ${code}`)); });
  });
  return { base: `http://127.0.0.1:${port}`, stop: () => child.kill() };
}

baseTest('[memory] serve.mjs reports deviceKeys from BENCHMARK_BLIND_KEY_FILE and breakGlass from the break-glass public key, as booleans only', async () => {
  const dir = fs.mkdtempSync(path.join(tmpdir(), 'config-'));
  const blindFile = path.join(dir, 'blind.pem');
  fs.writeFileSync(blindFile, execFileSync(process.execPath, [KEYGEN], { stdio: ['ignore', 'pipe', 'ignore'] }));
  const breakGlassPem = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }).publicKey.export({ type: 'spki', format: 'pem' });
  const servers = [];
  try {
    const none = await serveWith({}); servers.push(none);
    const blind = await serveWith({ BENCHMARK_BLIND_KEY_FILE: blindFile }); servers.push(blind);
    const both = await serveWith({ BENCHMARK_BLIND_KEY_FILE: blindFile, BENCHMARK_BREAKGLASS_PUBLIC_KEY: breakGlassPem }); servers.push(both);
    const cfg = async (s) => (await fetch(`${s.base}/api/config`)).text();
    assert.deepEqual(JSON.parse(await cfg(none)), { demo: false, deviceKeys: false, breakGlass: false, demoLabels: false });
    assert.deepEqual(JSON.parse(await cfg(blind)), { demo: false, deviceKeys: true, breakGlass: false, demoLabels: false });
    assert.deepEqual(JSON.parse(await cfg(both)), { demo: false, deviceKeys: true, breakGlass: true, demoLabels: false });
    for (const s of servers) assert.doesNotMatch(await cfg(s), /BEGIN|PRIVATE|MII/);
  } finally {
    for (const s of servers) s.stop();
  }
});

// Presenter mode: BENCHMARK_DEMO_LABELS=0 switches the labels off and nothing else. The server still flags demo data.
baseTest('[memory] serve.mjs with BENCHMARK_DEMO_LABELS=0 prints the presenter line, serves demoLabels false, and still prints staff credentials', async () => {
  const port = await freePort();
  const child = spawn(process.execPath, [SERVE], {
    env: childEnv({
      BENCHMARK_DEMO: '1', BENCHMARK_DEMO_LABELS: '0', BENCHMARK_ALLOW_HTTP: '1', PORT: String(port), BENCHMARK_STATIC_DIR: tmpdir(),
      BENCHMARK_BALLOT_SECRET: SECRETS.ballot, BENCHMARK_ALIAS_SECRET: SECRETS.alias,
    }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  try {
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`serve.mjs did not start: ${out}`)), 20000);
      const look = () => { if (out.includes('listening on')) { clearTimeout(timer); resolve(); } };
      child.stdout.on('data', look);
      child.on('exit', (code) => { clearTimeout(timer); reject(new Error(`serve.mjs exited with ${code}`)); });
      look();
    });
    assert.ok(out.includes('DEMO LABELS OFF (presenter mode): the app will not say it is a demo.'), out);
    assert.match(out, /Demo staff credentials \(sign in on the staff page\): demo-/);
    const cfg = await (await fetch(`http://127.0.0.1:${port}/api/config`)).text();
    assert.deepEqual(JSON.parse(cfg), { demo: true, deviceKeys: false, breakGlass: false, demoLabels: false });
  } finally {
    child.kill();
  }
});

// The seed against the organisers' real export: every link must be a risk that exists in it.
baseTest('[memory] the seed runs against the real radar export and every riskId it links exists there', async (t) => {
  const radar = JSON.parse(fs.readFileSync(RADAR_FILE, 'utf8'));
  const ids = new Set(radar.map((r) => String(r.id).trim()));
  const w = await worldFor('memory', { demo: true, radar });
  const seededNow = await w.svc.seedDemo();
  assert.equal(seededNow.cards, DEMO_CARDS.length);
  const linked = (await w.svc.listCards(w.analyst)).map((c) => [c.country, c.riskId]);
  t.diagnostic(`linked riskIds: ${JSON.stringify(linked)}`);
  for (const [country, riskId] of linked) {
    if (riskId === null) continue;
    assert.ok(ids.has(riskId), `${riskId} (${country}) is in the export`);
  }
  assert.ok(linked.some(([, riskId]) => riskId !== null), 'at least one card links to a risk');
  // Every country an open card covers has risks in the export, so every open card links one.
  const cards = await w.answers.cards.all();
  for (const c of cards.filter((x) => x.status === 'open' && x.round === 1)) {
    assert.ok(c.riskId && ids.has(c.riskId), `${c.country} open card links a real risk`);
  }
});

baseTest('[memory] seeding takes well under a second, so it is safe at start-up', async (t) => {
  const w = await worldFor('memory', { demo: true });
  const started = performance.now();
  await w.svc.seedDemo();
  const ms = Math.round(performance.now() - started);
  t.diagnostic(`seedDemo on memory: ${ms} ms`);
  assert.ok(ms < 1000, `seed took ${ms} ms`);
});

// The cap is 300 real accounts, so it runs on memory only (the other backends would take minutes).
baseTest('[memory] the demo refuses the 301st join: 300 accounts, then ConflictError', async () => {
  const w = await worldFor('memory', { demo: true });
  await many(300, (i) => w.svc.demoJoin(joinInput({ name: `Visitor ${i}` })));
  await assert.rejects(w.svc.demoJoin(joinInput({ name: 'Too late' })), { status: 409 });
  assert.equal((await w.roster.experts.find({ demoJoined: true })).length, 300);
});
