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
  { re: /\bnavigator\.sendBeacon\(/, why: 'bypasses the validated write path' },
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
  // Pure logic must stay pure.
  if (/packages\/(core|shared)\//.test(rel) && /fetch\(|XMLHttpRequest/.test(src)) {
    problems.push(`${rel}: pure module must stay network-free`);
  }
};
SCAN.forEach(walk);

if (problems.length) {
  console.error('\n✗ PRIVACY GATE FAILED\n');
  problems.forEach((p) => console.error('  ' + p));
  process.exit(1);
}
console.log('✓ privacy gate passed — no cookie, fingerprint or unvalidated write path; pure modules stay pure');
