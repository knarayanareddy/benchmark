#!/usr/bin/env node
/**
 * Prove the demo can be opened, and that the modules it imports are served.
 *
 * Without this, B1 was invisible: the page rendered from its static fallback and
 * nothing in CI could tell the difference between "the anonymity panel is live"
 * and "the anonymity panel is a <noscript> paragraph".
 */
import { createServer } from './serve.mjs';

const server = createServer();
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const { port } = server.address();
const base = `http://127.0.0.1:${port}`;

const cases = [
  ['/', 'text/html', /benchmark/i],
  ['/packages/core/src/anonymity.js', 'text/javascript', /export function attribute/],
  ['/packages/core/src/aggregate.js', 'text/javascript', /export function releaseAggregate/],
  ['/packages/shared/loop.js', 'text/javascript', /export function compose/],
];

let bad = 0;
for (const [path, type, body] of cases) {
  const res = await fetch(base + path);
  const text = await res.text();
  const problems = [];
  if (res.status !== 200) problems.push(`status ${res.status}`);
  if (!String(res.headers.get('content-type')).startsWith(type)) problems.push(`content-type ${res.headers.get('content-type')}`);
  if (!body.test(text)) problems.push('body did not contain the expected module');
  if (problems.length) {
    bad++;
    console.error(`✗ ${path}: ${problems.join('; ')}`);
  }
}

// A traversal attempt must not escape the repository root.
const escape = await fetch(base + '/../../etc/passwd');
if (escape.status === 200) {
  bad++;
  console.error('✗ path traversal escaped the repository root');
}

server.close();
if (bad) {
  console.error('\n✗ the demo cannot be served — B1 is back');
  process.exit(1);
}
console.log(`✓ demo serves over HTTP: index + 3 ES modules (${cases.length} paths, traversal blocked)`);
