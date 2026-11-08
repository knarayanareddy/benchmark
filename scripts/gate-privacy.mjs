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
const SCAN = ['packages/shared', 'packages/core/src', 'packages/benchmark/src'].map((d) => path.join(ROOT, d));

const FORBIDDEN = [
  { re: /\bdocument\.cookie\b/, why: 'cookie write' },
  { re: /\bfingerprint|canvas\.toDataURL\b/, why: 'device fingerprinting' },
  { re: /\bnavigator\.sendBeacon\s*\(/, why: 'bypasses the validated write path' },
  // `fetch` on its own was the whole rule, and it missed every other way out:
  // a Node http import, a dynamic import of a URL, a WebSocket. A privacy gate
  // that only knows one spelling of "network" is a gate in name only.
  { re: /(?:^|[^.\w])fetch\s*\(/, why: 'network call' },
  { re: /\bglobalThis\.fetch\b|\bwindow\.fetch\b|\bself\.fetch\b/, why: 'network call' },
  { re: /\bnew\s+XMLHttpRequest\b/, why: 'network call' },
  { re: /\bnew\s+WebSocket\b|\bnew\s+EventSource\b/, why: 'network call' },
  { re: /from\s+['"]node:(?:https?|net|tls|dns|dgram)['"]/, why: 'Node network module import' },
  { re: /require\(\s*['"]node:(?:https?|net|tls|dns|dgram)['"]\s*\)/, why: 'Node network module import' },
  { re: /import\(\s*['"](?:https?:|node:(?:https?|net|tls|dns))/, why: 'dynamic network import' },
];

let problems = [];
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
  // Pure logic must stay pure — including the spellings that are not `fetch(`.
  if (/packages\/(core|shared)\//.test(rel)) {
    const NET = /(?:^|[^.\w])fetch\s*\(|\bXMLHttpRequest\b|\bWebSocket\b|\bEventSource\b|node:(?:https?|net|tls|dns|dgram)/;
    if (NET.test(src)) problems.push(`${rel}: pure module must stay network-free`);
  }
};
SCAN.forEach(walk);

if (problems.length) {
  console.error('\n✗ PRIVACY GATE FAILED\n');
  problems.forEach((p) => console.error('  ' + p));
  process.exit(1);
}
console.log('✓ privacy gate passed — no cookie, fingerprint or unvalidated write path; pure modules stay pure');
