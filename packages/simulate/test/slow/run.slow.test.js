// SLOW: the end-to-end quick run (power-spec §D, WP7). Not part of the fast test folder (which must run in under 20 s).
// Run with: node --test packages/simulate/test/slow/run.slow.test.js   (about one minute)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BANNER, BANNER_UPPER } from '../../src/label.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const RUN = join(HERE, '..', '..', 'bin', 'run.mjs');
const QUICK_LIMIT_SEC = 90;

test('a --quick run completes under 90 seconds, validates, and its report mentions both couplings', () => {
  const dir = mkdtempSync(join(tmpdir(), 'simrun-'));
  try {
    const started = Date.now();
    const out = execFileSync(process.execPath, [RUN, '--quick', '--out', dir], { encoding: 'utf8', maxBuffer: 1 << 24 });
    const seconds = (Date.now() - started) / 1000;
    assert.ok(seconds < QUICK_LIMIT_SEC, `quick run took ${seconds.toFixed(1)} s, limit ${QUICK_LIMIT_SEC} s`);
    assert.match(out, /Validation: \d+ of \d+ checks pass\./);

    const report = readFileSync(join(dir, 'SYNTHETIC-report.md'), 'utf8');
    assert.ok(report.includes(BANNER), 'report lacks the banner');
    assert.match(report, /^\| 0\.3 \|/m, 'report lacks coupling 0.3');
    assert.match(report, /^\| 0\.7 \|/m, 'report lacks coupling 0.7');
    assert.match(report, /about 82% of cards reach 5 answers/);
    assert.doesNotMatch(report, /bandRateUncertainty|outlier/i);

    const files = readdirSync(dir);
    for (const f of files.filter((x) => x.endsWith('.csv'))) {
      const first = readFileSync(join(dir, f), 'utf8').split('\n')[0];
      if (f.startsWith('REAL-')) assert.match(first, /^# REAL DATA/, f);
      else assert.ok(first.startsWith(`# ${BANNER_UPPER}`), `${f} line 1`);
    }
    for (const f of files.filter((x) => x.endsWith('.svg'))) {
      const svg = readFileSync(join(dir, f), 'utf8');
      assert.match(svg, /role="img"/, f);
    }
    for (const f of files.filter((x) => x.startsWith('SYNTHETIC-'))) {
      assert.doesNotMatch(readFileSync(join(dir, f), 'utf8'), /\bR\d{4}\b/, `${f} contains an ACAPS risk id`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
