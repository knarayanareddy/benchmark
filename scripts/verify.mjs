#!/usr/bin/env node
/**
 * Run every check, never stop at the first failure, and print one table.
 *
 * The old `verify` was a single && chain: when it failed you learned only that
 * something broke, not which gate, and everything after it never ran. Here each
 * step runs to completion; the table says which failed, and the output of each
 * failing step is printed under it.
 *
 *   npm run verify              everything
 *   npm run verify -- lint test only the steps whose id matches
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const node = (...args) => [process.execPath, ...args];

const STEPS = [
  ['typecheck', 'types: server and shared code (tsc, strict)', ['npx', 'tsc', '-p', 'tsconfig.json']],
  ['typecheck-ui', 'types: browser pages (tsc, strict)', ['npx', 'tsc', '-p', 'tsconfig.public.json']],
  ['lint', 'lint (eslint)', ['npx', 'eslint', '.']],
  ['spine', 'shared spine integrity', node('scripts/check-spine.mjs')],
  ['test', 'unit and flow tests (memory, Postgres, pg driver)', node('--test', 'packages/shared/core.test.js', ...globTests())],
  ['anonymity', 'anonymity gate', node('scripts/gate-anonymity.mjs')],
  ['privacy', 'privacy gate', node('scripts/gate-privacy.mjs')],
  ['numbers', 'numbers gate (prose matches measurement)', node('scripts/numbers-gate.mjs')],
  ['export', 'real export through the card gate', node('scripts/gate-export.mjs')],
  ['methodology', 'ACAPS 5x5 methodology check', node('scripts/check-methodology.mjs')],
  ['baseline', 'baselines reproduce from the data', node('scripts/measure-baseline.mjs')],
  ['journey', 'dissent loop journey', node('scripts/journey.mjs')],
  ['backtest', 'scoring harness', node('scripts/backtest.mjs')],
];

function globTests() {
  const out = spawnSync('sh', ['-c', 'ls packages/*/test/*.test.js'], { cwd: ROOT, encoding: 'utf8' });
  return out.stdout.split('\n').filter(Boolean);
}

const only = process.argv.slice(2);
const chosen = only.length ? STEPS.filter(([id]) => only.some((o) => id.includes(o))) : STEPS;
const results = [];
for (const [id, label, cmd] of chosen) {
  const t0 = Date.now();
  const r = spawnSync(cmd[0], cmd.slice(1), { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: process.env });
  results.push({ id, label, ok: r.status === 0, ms: Date.now() - t0, out: `${r.stdout || ''}${r.stderr || ''}` });
  process.stdout.write(`${r.status === 0 ? '✓' : '✗'} ${id}\n`);
}

const w = Math.max(...results.map((r) => r.id.length));
console.log('\n' + '─'.repeat(72));
for (const r of results) {
  console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.id.padEnd(w)}  ${(r.ms / 1000).toFixed(1).padStart(5)}s  ${r.label}`);
}
console.log('─'.repeat(72));
const failed = results.filter((r) => !r.ok);
for (const r of failed) {
  console.log(`\n── ${r.id} failed ──`);
  console.log(r.out.trim().split('\n').slice(-40).join('\n'));
}
console.log(failed.length ? `\n${failed.length} of ${results.length} checks failed: ${failed.map((r) => r.id).join(', ')}` : `\nall ${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
