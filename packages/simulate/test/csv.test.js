// CSV output: the banner is line 1, the header starts with `synthetic`, REAL- files are marked real (power-spec §D).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { csvText, writeCsv } from '../src/csv.js';
import { BANNER_UPPER, REAL_BANNER } from '../src/label.js';

const ROWS = [{ N: 28, power: 0.14, note: 'a, "quoted"' }, { N: 58, power: 0.4, note: null }];

test('a synthetic CSV has the banner as line 1 and a header that starts with synthetic', () => {
  const lines = csvText(ROWS, { seed: 7, runId: 'r1' }).split('\n');
  assert.equal(lines[0], `# ${BANNER_UPPER}. Seed=7, run=r1`);
  assert.equal(lines[1], 'synthetic,N,power,note');
  assert.ok(lines[0].startsWith('# SIMULATION UNDER STATED ASSUMPTIONS, NOT A RESULT'));
});

test('every synthetic data row starts with TRUE, and cells with commas or quotes are escaped', () => {
  const lines = csvText(ROWS, { seed: 7, runId: 'r1' }).trimEnd().split('\n');
  assert.equal(lines[2], 'TRUE,28,0.14,"a, ""quoted"""');
  assert.equal(lines[3], 'TRUE,58,0.4,');
});

test('a REAL- file is written with the real-data banner and synthetic FALSE', () => {
  const dir = mkdtempSync(join(tmpdir(), 'csv-'));
  try {
    const file = join(dir, 'REAL-arrivals.csv');
    writeCsv(file, ROWS, { seed: 7, runId: 'r1', real: true });
    const lines = readFileSync(file, 'utf8').split('\n');
    assert.equal(lines[0], REAL_BANNER);
    assert.ok(lines[1].startsWith('synthetic,'));
    assert.ok(lines[2].startsWith('FALSE,'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a synthetic file cannot be written under a REAL- name, and a REAL- name needs real=true', () => {
  const dir = mkdtempSync(join(tmpdir(), 'csv-'));
  try {
    assert.throws(() => writeCsv(join(dir, 'REAL-x.csv'), ROWS, { seed: 7, runId: 'r1' }), /REAL-/);
    assert.throws(() => writeCsv(join(dir, 'SYNTHETIC-x.csv'), ROWS, { seed: 7, runId: 'r1', real: true }), /REAL-/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a row may not set its own synthetic column (the flag cannot be spoofed)', () => {
  assert.throws(() => csvText([{ synthetic: 'FALSE', N: 1 }], { seed: 7, runId: 'r1' }), /synthetic/);
});

test('the banner test has teeth: removing the banner line would break line 1', () => {
  const text = csvText(ROWS, { seed: 7, runId: 'r1' });
  const without = text.split('\n').slice(1).join('\n');
  assert.notEqual(without.split('\n')[0], text.split('\n')[0]);
  assert.ok(!without.startsWith('# SIMULATION'));
});
