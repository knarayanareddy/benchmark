import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createService } from '../src/service.js';
import { createRosterStore, createAnswerStore } from '../src/store.js';
import { createServer } from '../src/http.js';

const WEB = fileURLToPath(new URL('../../web/', import.meta.url));
const DIST = path.join(WEB, 'dist');
const SECRETS = { ballot: 'ballot-secret-for-tests-0001', alias: 'alias-secret-for-tests-00002' };

// Test what is actually shipped, never a stale build: it takes well under a second.
const built = spawnSync('npx', ['vite', 'build'], { cwd: WEB, encoding: 'utf8' });
assert.equal(built.status, 0, built.stdout + built.stderr);

async function boot() {
  const service = createService({ roster: createRosterStore(), answers: createAnswerStore(), secrets: SECRETS });
  const server = createServer({ service, staticDir: `${DIST}/`, limits: { readsPerMinute: 10000 } });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { base: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((r) => server.close(r)) };
}
const assets = () => fs.readdirSync(path.join(DIST, 'assets'));

test('the built apps are served with a strict CSP, no cookies, and the right caching', async () => {
  const s = await boot();
  try {
    const files = [['/', 'text/html'], ['/staff', 'text/html'], ['/staff.html', 'text/html'], ['/manifest.webmanifest', 'application/manifest\\+json'], ['/icon-192.png', 'image/png'], ['/icon.svg', 'image/svg\\+xml'], ['/sw.js', 'text/javascript']];
    for (const f of assets()) files.push([`/assets/${f}`, f.endsWith('.css') ? 'text/css' : 'text/javascript']);
    for (const [p, type] of files) {
      const r = await fetch(s.base + p);
      assert.equal(r.status, 200, p);
      assert.match(r.headers.get('content-type'), new RegExp(type), p);
      assert.match(r.headers.get('content-security-policy'), /script-src 'self'/, p);
      assert.match(r.headers.get('content-security-policy'), /worker-src 'self'/);
      assert.match(r.headers.get('content-security-policy'), /frame-ancestors 'none'/);
      assert.equal(r.headers.get('set-cookie'), null, p);
      const cache = r.headers.get('cache-control');
      if (p.startsWith('/assets/')) assert.match(cache, /immutable/, 'hashed assets are cached for good');
      else assert.equal(cache, 'no-cache', `${p} must be re-checked so a deploy reaches installed apps`);
    }
    assert.equal((await fetch(`${s.base}/..%2f..%2fpackage.json`)).status, 404, 'no path traversal');
    assert.equal((await fetch(`${s.base}/../../package.json`)).status, 404);
    assert.equal((await fetch(`${s.base}/vite.config.js`)).status, 404, 'only the built files are served');
  } finally { await s.close(); }
});

test('the built pages carry no inline script, handler or style, so the CSP holds', () => {
  for (const f of ['index.html', 'staff.html']) {
    const src = fs.readFileSync(path.join(DIST, f), 'utf8');
    assert.ok(!/<script(?![^>]*\bsrc=)[^>]*>/i.test(src), `${f}: inline <script>`);
    assert.ok(!/\son\w+\s*=/i.test(src), `${f}: inline event handler`);
    assert.ok(!/style\s*=/i.test(src), `${f}: inline style`);
    assert.match(src, /rel="manifest"|staff/, f);
  }
});

test('the app is installable and works offline: manifest, icons, and a worker that never touches the API', () => {
  const m = JSON.parse(fs.readFileSync(path.join(DIST, 'manifest.webmanifest'), 'utf8'));
  assert.equal(m.display, 'standalone');
  assert.equal(m.start_url, '/');
  for (const size of ['192x192', '512x512']) assert.ok(m.icons.some((i) => i.sizes === size && i.type === 'image/png'), `a ${size} png icon`);
  assert.ok(m.icons.some((i) => i.purpose === 'maskable'));
  for (const i of m.icons) assert.ok(fs.existsSync(path.join(DIST, i.src)), `${i.src} exists`);

  const sw = fs.readFileSync(path.join(DIST, 'sw.js'), 'utf8');
  assert.ok(!sw.includes('__VERSION__') && !sw.includes('__PRECACHE__'), 'the build filled in the cache name and file list');
  const precache = JSON.parse(/JSON\.parse\('(\[.*\])'\)/.exec(sw)[1]);
  for (const f of ['/index.html', '/staff.html', '/manifest.webmanifest', ...assets().map((a) => `/assets/${a}`)]) assert.ok(precache.includes(f), `${f} is precached`);
  assert.ok(!precache.some((p) => p.startsWith('/api/')), 'no API path is precached');
  assert.match(sw, /startsWith\('\/api\/'\)\) return/, 'the worker returns early for /api/*: it never caches an answer, token or ballot');
  assert.ok(!/localStorage|caches\.put\([^)]*api/.test(sw));
});

test('the sources never write markup from data, and keep tokens in one place', () => {
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
  for (const f of walk(path.join(WEB, 'src')).filter((x) => /\.jsx?$/.test(x) && !/\.test\./.test(x))) {
    const src = fs.readFileSync(f, 'utf8');
    const rel = path.relative(WEB, f);
    assert.ok(!/dangerouslySetInnerHTML|innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\(/.test(src), `${rel}: unsafe DOM sink`);
    assert.ok(!/localStorage|sessionStorage/.test(src), `${rel}: persistence goes through lib/kv.js`);
  }
});
