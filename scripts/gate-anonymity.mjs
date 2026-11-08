#!/usr/bin/env node
/**
 * Gate: the anonymity Must Have is built, wired, and cannot regress silently.
 *
 * ACAPS' evaluation criteria call expert-controlled anonymity a Must Have.
 * A Must Have that lives only in a document is a claim, not a feature — so this
 * gate fails if any of the following is true:
 *
 *   1. the module is gone
 *   2. any of the three levels lost its copy explaining what ACAPS and peers see
 *   3. attribution can emit an internal expert id
 *   4. public output can publish a count below the suppression threshold
 *   5. the choice is not exposed to the expert at the point of contribution
 *
 * Cheap, dependency-free, and it reads the real module — not a copy.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  LEVELS, LEVEL_COPY, DEFAULT_LEVEL, attribute, publicable, PUBLIC,
} from '@benchmark/core/anonymity';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const problems = [];

// 1 + 2: three levels, each fully explained
const levels = Object.values(LEVELS);
if (levels.length !== 3) problems.push(`expected 3 anonymity levels, found ${levels.length}`);
for (const lvl of levels) {
  const c = LEVEL_COPY[lvl];
  if (!c) { problems.push(`${lvl}: no copy — the expert cannot be said to have chosen it`); continue; }
  // A label is allowed to be one word ("Known"). The sentences that carry the
  // promise are not — those are what the expert actually reads before choosing.
  if (!c.label || !c.label.trim()) problems.push(`${lvl}.label: missing`);
  for (const k of ['toAcaps', 'toPeers', 'warn']) {
    if (!c[k] || String(c[k]).trim().length < 20) problems.push(`${lvl}.${k}: missing or too thin to be a promise`);
  }
}

// 3: no internal id survives attribution, at any level
const fixture = { expertId: 'e-SECRET-001', name: 'Test Person', country: 'TCD', text: 'x', at: 'T' };
for (const lvl of levels) {
  const out = attribute(fixture, lvl, { salt: 'gate-anonymity-fixture-salt' });
  if ('expertId' in out) problems.push(`${lvl}: attribution leaks expertId`);
  if (JSON.stringify(out).includes('e-SECRET-001')) problems.push(`${lvl}: expertId survives in the payload`);
}

// 4: suppression
const { published, suppressedCells } = publicable({ a: 9, b: 10 });
if ('a' in published) problems.push('public output published a count of 9 — suppression is not working');
if (suppressedCells !== 1) problems.push('suppression did not report the cell it dropped');
if (PUBLIC.attributable !== false) problems.push('public output is marked attributable');

// 5: the default is stated, and is not "identified"
if (DEFAULT_LEVEL === LEVELS.IDENTIFIED) {
  problems.push('default anonymity level is IDENTIFIED — a default is a choice most experts never revisit');
}

// 5b: the dashboard or contribution path actually references the module
const refs = [];
const walk = (d) => {
  if (!fs.existsSync(d)) return;
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) { walk(p); continue; }
    if (/\.(js|mjs|html)$/.test(e.name) && !p.includes('/test/')) refs.push(p);
  }
};
['packages', 'scripts', 'mockups'].forEach((d) => walk(path.join(ROOT, d)));
const users = refs.filter((p) => !p.endsWith('anonymity.js') && /anonymity\.js/.test(fs.readFileSync(p, 'utf8')));
const renderer = refs.filter((p) => p.endsWith('.html') && /LEVEL_COPY/.test(fs.readFileSync(p, 'utf8')));
if (renderer.length === 0) {
  problems.push('no page renders the levels from LEVEL_COPY — the screen and the model can drift');
}
if (users.length === 0) {
  problems.push('nothing outside the test suite imports anonymity.js — built but not wired');
}

if (problems.length) {
  console.error('\n✗ ANONYMITY GATE FAILED\n');
  for (const p of problems) console.error(`  ${p}`);
  console.error('');
  process.exit(1);
}
console.log(`✓ anonymity gate passed — ${levels.length} levels, each explained, suppression at ${PUBLIC.minCount}, wired into ${users.length} module(s)`);
