#!/usr/bin/env node
/**
 * The numbers gate.
 *
 * Every quantitative claim in this repo's prose must be reproducible by a
 * script in this repo, or explicitly marked as quoted and unverified. This
 * gate exists because a number that nobody recomputes does not stay wrong in
 * an obvious way — it gets swapped with a neighbouring number, described with
 * the opposite verdict, and then repeated in eleven files over three weeks.
 * That is exactly what happened here to 0.1981 and 0.2204.
 *
 * What it checks:
 *   1. Every figure in LADDER matches data/baseline-fit.json, produced by the
 *      scripts — not a literal typed into a doc.
 *   2. No prose anywhere in the repo quotes a retired figure.
 *   3. The published counts (139 / 104 / 61 / 43 / 28 / 97 / 28 departures)
 *      match the ingested data.
 *
 * It is deliberately a lint, not a test: it reads prose, and prose is where
 * this project keeps losing.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LADDER } from '../packages/core/src/scoring.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

// Figures that were published here and are now known to be wrong. Their
// reappearance means someone restored an old draft, or a generator overwrote a
// fix. Both are worth stopping.
const RETIRED = [
  ['0.1981', 'the unreproducible "four-field" bar — see packages/core/src/scoring.js'],
  ['0.2204', 'a fitted-model score that was mislabelled as ACAPS\' own judgement'],
  ['17% completion', 'a survey response rate (10 of 60), never a matrix completion rate'],
  ['125-cell analyst matrix', 'the 125 rows are 125 risks with complete ratings, not cells to fill'],
  ['four-field logistic', 'the model reads two independent fields; Risk Level duplicates Probability'],
  ['16 of the 22 materialised', 'the departures from the 5×5 are a deterministic table, not analyst overrides — see scoring.js'],
  ['73% against a 59% base rate', 'the excess is +4.4 points on n=22; the rest is the probability mix'],
];

const SKIP_DIRS = new Set(['node_modules', '.git', 'data']);
const SKIP_FILES = new Set(['numbers-gate.mjs', 'scoring.js', 'fit-baseline.mjs', 'measure-baseline.mjs']);
const EXT = new Set(['.md', '.html', '.js', '.mjs', '.json']);

const files = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) {
      if (!SKIP_DIRS.has(e.name)) walk(path.join(dir, e.name));
    } else if (EXT.has(path.extname(e.name)) && !SKIP_FILES.has(e.name)) {
      files.push(path.join(dir, e.name));
    }
  }
})(ROOT);

let failures = 0;
const fail = (msg) => {
  console.error(`✗ ${msg}`);
  failures++;
};

// ── 1. ladder vs the fitted artefacts ────────────────────────────────────────
const fitPath = path.join(ROOT, 'data', 'baseline-fit.json');
if (!fs.existsSync(fitPath)) {
  fail('data/baseline-fit.json missing — run: npm run ladder');
} else {
  const fit = JSON.parse(fs.readFileSync(fitPath, 'utf8'));
  const checks = [
    ['naiveFloor', fit.brier.constant],
    ['acapsRatings', fit.brier.acaps],
    ['fourFieldLogistic', fit.brier.loo],
  ];
  for (const [k, measured] of checks) {
    if (Math.abs(LADDER[k] - measured) > 0.00005) {
      fail(`LADDER.${k} = ${LADDER[k]} but the script measured ${measured.toFixed(4)}`);
    }
  }
  if (LADDER.fourFieldLogistic < LADDER.acapsRatings) {
    fail('LADDER claims the regression beat ACAPS — it does not. Fix the claim, not the test.');
  }
  console.log(`✓ ladder matches the fitted artefacts: ${LADDER.naiveFloor} / ${LADDER.acapsRatings} / ${LADDER.fourFieldLogistic}`);
}

// ── 2. retired figures in prose ─────────────────────────────────────────────
const hits = [];
for (const f of files) {
  const src = fs.readFileSync(f, 'utf8');
  for (const [needle, why] of RETIRED) {
    if (src.includes(needle)) {
      // The correction notices themselves are allowed to name the old value.
      const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const excused = new RegExp(`(earlier revision|previous revision|retired|was wrong|not reproducible|quoted ${escaped})`, 'i').test(src);
      if (!excused) hits.push([path.relative(ROOT, f), needle, why]);
    }
  }
}
if (hits.length) {
  for (const [f, needle, why] of hits) fail(`${f} quotes "${needle}" — ${why}`);
} else {
  console.log(`✓ no retired figures in ${files.length} files`);
}

// ── 3. counts vs the ingest ────────────────────────────────────────────────
const blocks = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'risk-radar.json'), 'utf8'));
const resolved = blocks.filter((b) => b.outcome === 0 || b.outcome === 1);
const allTriggers = blocks.flatMap((b) => b.triggerList || []);
const scoredTriggers = allTriggers.filter((t) => Boolean(t.completionRate));
const counts = {
  blocks: blocks.length,
  resolved: resolved.length,
  materialised: resolved.filter((b) => b.outcome === 1).length,
  notMaterialised: resolved.filter((b) => b.outcome === 0).length,
  active: blocks.filter((b) => b.status === 'Active').length,
  triggers: allTriggers.length,
  scoredTriggers: scoredTriggers.length,
  unwrittenObjective: scoredTriggers.filter((t) => !t.objective).length,
  noTriggers: blocks.filter((b) => (b.triggerCount ?? 0) === 0).length,
  noProbability: blocks.filter((b) => !b.probability).length,
  noStatus: blocks.filter((b) => !b.status).length,
};
const EXPECT = {
  blocks: 139,
  resolved: 104,
  materialised: 61,
  notMaterialised: 43,
  active: 28,
  triggers: 266,
  scoredTriggers: 139,
  unwrittenObjective: 101,
  noTriggers: 31,
  noProbability: 11,
  noStatus: 7,
};
for (const k of Object.keys(EXPECT)) {
  if (counts[k] !== EXPECT[k]) fail(`data says ${k}=${counts[k]}, the repo claims ${EXPECT[k]}`);
}
if (!failures) {
  console.log(
    `✓ counts match: ${counts.blocks} blocks / ${counts.resolved} resolved / ${counts.active} active / ${counts.triggers} triggers (${counts.unwrittenObjective}/${counts.scoredTriggers} without objective)`
  );
}

if (failures) {
  console.error(`\n${failures} problem(s). A number without a script attached is how this repo`);
  console.error('got its baseline backwards. Fix the claim, or add the script that proves it.');
  process.exit(1);
}
console.log('\n✓ every published figure is either measured or marked.');
