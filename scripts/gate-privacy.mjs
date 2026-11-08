#!/usr/bin/env node
/**
 * CI gate for Benchmark. The scoring and gate logic must never touch a network,
 * and nothing may carry an identifier for an individual expert into a payload
 * that leaves the analyst's server.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SCAN = ['packages/shared', 'packages/core/src', 'packages/benchmark/src', 'packages/service/src'].map((d) => path.join(ROOT, d));

const FORBIDDEN = [
  { re: /\bdocument\.cookie\b/, why: 'cookie write' },
  { re: /\bfingerprint|canvas\.toDataURL\b/, why: 'device fingerprinting' },
  { re: /\bnavigator\.sendBeacon\s*\(/, why: 'bypasses the validated write path' },
];

// Network spellings for the pure modules (core, shared). `fetch(` on its own
// was the whole rule and missed the others: globalThis.fetch, a Node http/https
// import, a dynamic import of a URL, a WebSocket. Scoped to the pure modules
// because the service legitimately talks to the network.
const PURE_NET = /(?:^|[^.\w])fetch\s*\(|\bglobalThis\.fetch\b|\bwindow\.fetch\b|\bself\.fetch\b|\bXMLHttpRequest\b|\bnew\s+WebSocket\b|\bnew\s+EventSource\b|node:(?:https?|net|tls|dns|dgram)\b|import\(\s*['"]https?:/;

const problems = [];
const walk = (dir) => {
  if (!fs.existsSync(dir)) return;
  for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, f.name);
    if (f.isDirectory()) walk(p);
    else if (/\.(js|mjs)$/.test(f.name)) check(p);
  }
};
const check = (p) => {
  const src = fs.readFileSync(p, 'utf8');
  const rel = path.relative(ROOT, p);
  for (const { re, why } of FORBIDDEN) {
    const m = src.match(re);
    if (m) problems.push(`${rel}: ${why}  →  "${m[0]}"`);
  }
  // Pure logic must stay pure.
  if (/packages\/(core|shared)\//.test(rel)) {
    const net = PURE_NET.exec(src);
    if (net) problems.push(`${rel}: pure module must stay network-free  →  "${net[0].trim()}"`);
  }
};
SCAN.forEach(walk);

if (problems.length) {
  console.error('\n✗ PRIVACY GATE FAILED\n');
  problems.forEach((p) => console.error('  ' + p));
  process.exit(1);
}
console.log('✓ privacy gate passed — no cookie, fingerprint or unvalidated write path; pure modules stay pure');
