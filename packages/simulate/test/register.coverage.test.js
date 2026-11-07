// Key-coverage tests for the register (power-spec §F WP8b): every key in assumptions.json is in the register under its
// own judgement call, and the register lists no key that does not exist. Deterministic, no simulator run needed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ASSUMPTIONS_PATH, loadAssumptions, listKeys } from '../src/assumptions.js';
import { renderRegister, registerCoverage, DOC_PATH } from '../src/register.js';

const REAL = JSON.parse(readFileSync(ASSUMPTIONS_PATH, 'utf8'));
const clone = (x) => structuredClone(x);
const entryOf = (data, id) => data.entries.find((e) => e.id === id);

test('the rendered register covers every key of assumptions.json', () => {
  const assumptions = loadAssumptions();
  assert.deepEqual(registerCoverage(assumptions, renderRegister(assumptions)), []);
});

test('the committed docs/15 covers every key of assumptions.json', () => {
  const assumptions = loadAssumptions();
  assert.deepEqual(registerCoverage(assumptions, readFileSync(DOC_PATH, 'utf8')), []);
});

test('coverage fails when a key line is removed from the register', () => {
  const assumptions = loadAssumptions();
  const text = renderRegister(assumptions).replace(/^- Parameter `icc`:.*\n/m, '');
  const problems = registerCoverage(assumptions, text);
  assert.equal(problems.length, 1, problems.join('\n'));
  assert.match(problems[0], /key "icc" \(J05\) is in assumptions\.json but not in the register/);
});

test('coverage fails when a whole judgement call is missing from the register', () => {
  const assumptions = loadAssumptions();
  const text = renderRegister(assumptions).replace(/^## J08\n[\s\S]*?(?=^## J09$)/m, '');
  const problems = registerCoverage(assumptions, text);
  assert.deepEqual(problems, ['The judgement call J08 is in assumptions.json but missing from the register.']);
});

test('coverage fails when the register lists a key that does not exist', () => {
  const assumptions = loadAssumptions();
  const text = renderRegister(assumptions).replace('- Parameter `tau`:', '- Parameter `ghostKey`: 1 (allowed: 0 to 2)\n- Parameter `tau`:');
  const problems = registerCoverage(assumptions, text);
  assert.ok(problems.some((p) => /lists "ghostKey" under J01, but J01 does not own that key/.test(p)), problems.join('\n'));
});

test('coverage fails when the register lists a key under the wrong judgement call', () => {
  const assumptions = loadAssumptions();
  const text = renderRegister(assumptions).replace('- Parameter `icc`:', '- Parameter `tau`: 1.25 (allowed: 0.75 to 1.5)\n- Parameter `icc`:');
  const problems = registerCoverage(assumptions, text);
  assert.ok(problems.some((p) => /lists "tau" under J05/.test(p)), problems.join('\n'));
});

test('coverage fails when the register has a block for an id that is not in assumptions.json', () => {
  const assumptions = loadAssumptions();
  const text = `${renderRegister(assumptions)}\n## J99\n\n**What it is.** Extra.\n`;
  const problems = registerCoverage(assumptions, text);
  assert.ok(problems.some((p) => /The register has J99, which is not in assumptions\.json/.test(p)), problems.join('\n'));
});

test('a key listed in an entry with no value fails to load, naming the key', () => {
  const dir = mkdtempSync(join(tmpdir(), 'register-cov-'));
  try {
    const bad = clone(REAL);
    entryOf(bad, 'J05').keys.push('ghost');
    const file = join(dir, 'assumptions.json');
    writeFileSync(file, JSON.stringify(bad));
    assert.throws(() => loadAssumptions(file), /no value is given for key "ghost"/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the register and the keys agree in number: every key of the file is listed exactly once', () => {
  const assumptions = loadAssumptions();
  const text = renderRegister(assumptions);
  const listed = [...text.matchAll(/^- Parameter `([^`]+)`/gm)].map((m) => m[1]);
  assert.deepEqual([...listed].sort(), [...listKeys()].sort());
});
