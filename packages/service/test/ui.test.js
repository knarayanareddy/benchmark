import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createService } from '../src/service.js';
import { createRosterStore, createAnswerStore } from '../src/store.js';
import { createServer } from '../src/http.js';

const PUBLIC = new URL('../public/', import.meta.url);
const SECRETS = { ballot: 'ballot-secret-for-tests-0001', alias: 'alias-secret-for-tests-00002' };

async function boot() {
  const service = createService({ roster: createRosterStore(), answers: createAnswerStore(), secrets: SECRETS });
  const server = createServer({ service, staticDir: PUBLIC.pathname, limits: { readsPerMinute: 10000 } });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { base: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((r) => server.close(r)) };
}

test('the pages are served with a strict CSP and no cookies', async () => {
  const s = await boot();
  try {
    for (const [path, type] of [['/', 'text/html'], ['/staff.html', 'text/html'], ['/app.js', 'text/javascript'], ['/staff.js', 'text/javascript'], ['/ui.js', 'text/javascript'], ['/style.css', 'text/css']]) {
      const r = await fetch(s.base + path);
      assert.equal(r.status, 200, path);
      assert.match(r.headers.get('content-type'), new RegExp(type));
      assert.match(r.headers.get('content-security-policy'), /script-src 'self'/);
      assert.match(r.headers.get('content-security-policy'), /frame-ancestors 'none'/);
      assert.equal(r.headers.get('set-cookie'), null);
    }
    assert.equal((await fetch(`${s.base}/..%2f..%2fpackage.json`)).status, 404, 'no path traversal');
    assert.equal((await fetch(`${s.base}/../../package.json`)).status, 404);
    assert.equal((await fetch(`${s.base}/schema.sql`)).status, 404, 'only the page assets are served');
  } finally { await s.close(); }
});

test('the pages carry no inline script, no inline handlers, and never use innerHTML', () => {
  for (const f of fs.readdirSync(PUBLIC)) {
    const src = fs.readFileSync(new URL(f, PUBLIC), 'utf8');
    if (f.endsWith('.html')) {
      assert.ok(!/<script(?![^>]*\bsrc=)[^>]*>/i.test(src), `${f}: inline <script>`);
      assert.ok(!/\son\w+\s*=/i.test(src), `${f}: inline event handler`);
      assert.ok(!/style\s*=/i.test(src), `${f}: inline style`);
    }
    if (f.endsWith('.js')) {
      assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\(/.test(src), `${f}: unsafe DOM sink`);
      assert.ok(!/localStorage/.test(src), `${f}: tokens belong in sessionStorage`);
    }
  }
});
