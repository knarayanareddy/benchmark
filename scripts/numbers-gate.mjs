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
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { LADDER } from '@benchmark/core/scoring';
import { gate, evaluateObservable } from '@benchmark/core/gate';

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
    ['acapsOrdinal', fit.brier.acapsOrdinal],
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
  console.log(`✓ ladder matches the fitted artefacts: ${LADDER.naiveFloor} / ${LADDER.acapsRatings} (ordinal ${LADDER.acapsOrdinal}) / ${LADDER.fourFieldLogistic}`);
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
  activeTriggers: blocks.filter((b) => b.status === 'Active').reduce((n, b) => n + (b.triggerList || []).length, 0),
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
  activeTriggers: 76,
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

// ── 4. live test counts vs README.md and BUILD.md (B5) ───────────────────────
const TEST_MAP = [
  ['packages/shared/', 'packages/shared/core.test.js'],
  ['packages/core/src/scoring.js', 'packages/benchmark/test/scoring.test.js'],
  ['packages/core/src/aggregate.js', 'packages/benchmark/test/aggregate.test.js'],
  ['packages/core/src/gate.js', 'packages/benchmark/test/gate.test.js'],
  ['packages/core/src/dispatch.js', 'packages/benchmark/test/dispatch.test.js'],
  ['packages/core/src/taxonomy.js', 'packages/benchmark/test/taxonomy.test.js'],
  ['packages/core/src/radar.js', 'packages/benchmark/test/radar.test.js'],
  ['packages/core/src/pulse.js', 'packages/benchmark/test/pulse.test.js'],
  ['packages/core/src/timeline.js', 'packages/benchmark/test/timeline.test.js'],
  ['packages/core/src/series.js', 'packages/benchmark/test/series.test.js'],
  ['packages/core/src/grid.js', 'packages/benchmark/test/grid.test.js'],
  ['packages/core/src/links.js', 'packages/benchmark/test/links.test.js'],
  ['packages/core/src/anonymity.js', 'packages/benchmark/test/anonymity.test.js'],
  ['packages/core/src/hmac.js', 'packages/benchmark/test/hmac.test.js'],
  ['packages/service/src/service.js', 'packages/service/test/flow.test.js'],
  ['packages/service/src/http.js', 'packages/service/test/http.test.js'],
  ['packages/service/src/oidc.js', 'packages/service/test/oidc.test.js'],
  ['packages/service/src/migrate.js', 'packages/service/test/migrate.test.js'],
  ['packages/service/test/breakglass.test.js', 'packages/service/test/breakglass.test.js'],
  ['packages/service/test/device.test.js', 'packages/service/test/device.test.js'],
  ['packages/service/test/blind-round1.test.js', 'packages/service/test/blind-round1.test.js'],
  ['packages/core/src/secondlook.js', 'packages/benchmark/test/secondlook.test.js'],
  ['packages/service/test/secondlook.test.js', 'packages/service/test/secondlook.test.js'],
  ['packages/core/src/blind.js', 'packages/benchmark/test/blind.test.js'],
  ['packages/core/src/roundtable.js', 'packages/benchmark/test/roundtable.test.js'],
  ['packages/core/src/publication.js', 'packages/benchmark/test/publication.test.js'],
  ['packages/core/src/sensitive.js', 'packages/benchmark/test/sensitive.test.js'],
  ['packages/core/src/onboarding.js', 'packages/benchmark/test/onboarding.test.js'],
  ['packages/service/test/roundtable.test.js', 'packages/service/test/roundtable.test.js'],
  ['packages/service/test/publication.test.js', 'packages/service/test/publication.test.js'],
  ['packages/service/test/radar.test.js', 'packages/service/test/radar.test.js'],
  ['packages/service/test/profile.test.js', 'packages/service/test/profile.test.js'],
  ['packages/service/test/pulse.test.js', 'packages/service/test/pulse.test.js'],
  ['packages/service/test/demo.test.js', 'packages/service/test/demo.test.js'],
  ['packages/service/src/evolution.js', 'packages/service/test/evolution.test.js'],
  ['packages/service/test/hardening.test.js', 'packages/service/test/hardening.test.js'],
  ['packages/service/test/answer-context.test.js', 'packages/service/test/answer-context.test.js'],
  ['packages/service/test/port-data.test.js', 'packages/service/test/port-data.test.js'],
  ['packages/service/test/release-access.test.js', 'packages/service/test/release-access.test.js'],
  ['packages/core/src/stats.js', 'packages/benchmark/test/stats.test.js'],
  ['packages/core/src/csv.js', 'packages/benchmark/test/csv.test.js'],
  ['packages/core/src/authoring.js', 'packages/benchmark/test/authoring.test.js'],
  ['packages/service/test/ui.test.js', 'packages/service/test/ui.test.js'],
  ['packages/service/db/migrations/', 'packages/service/test/schema.test.js'],
  ['packages/benchmark/src/dissent.js', 'packages/benchmark/test/dissent.test.js'],
];

const perModuleTests = new Map();
let totalTests = 0;
for (const [modLabel, relTest] of TEST_MAP) {
  const full = path.join(ROOT, relTest);
  if (!fs.existsSync(full)) {
    fail(`missing test file ${relTest} mapped to ${modLabel}`);
    continue;
  }
  const run = spawnSync(process.execPath, ['--test', '--test-reporter=tap', full], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  const m = /^# tests (\d+)$/m.exec(run.stdout || '');
  if (run.status !== 0 || !m) {
    // Say WHY: the names of the failing tests and the tail of the output, so a flaky test is diagnosable.
    const out = `${run.stdout || ''}${run.stderr || ''}`;
    const failing = [...out.matchAll(/^not ok \d+ - (.+)$/gm)].map((x) => x[1]).slice(0, 5);
    fail(`could not measure test count from ${relTest} (exit=${run.status}${run.signal ? `, signal ${run.signal}` : ''})${failing.length ? `; failing: ${failing.join(' | ')}` : ''}\n${out.trim().split('\n').slice(-12).join('\n')}`);
    continue;
  }
  const n = Number(m[1]);
  perModuleTests.set(modLabel, n);
  totalTests += n;
}

// The React apps are tested with vitest, which reports its own counts.
const WEB_MAP = [
  ['packages/web/src/lib/', 'packages/web/src/lib/lib.test.js'],
  ['packages/web/src/expert/', 'packages/web/src/expert/expert.test.jsx'],
  ['packages/web/src/staff/', 'packages/web/src/staff/staff.test.jsx'],
  ['packages/web/src/expert/roundtable.test.jsx', 'packages/web/src/expert/roundtable.test.jsx'],
  ['packages/web/src/staff/roundtable.test.jsx', 'packages/web/src/staff/roundtable.test.jsx'],
  ['packages/web/src/expert/credit.test.jsx', 'packages/web/src/expert/credit.test.jsx'],
  ['packages/web/src/staff/credit.test.jsx', 'packages/web/src/staff/credit.test.jsx'],
  ['packages/web/src/credits/credits.test.jsx', 'packages/web/src/credits/credits.test.jsx'],
  ['packages/web/src/expert/profile.test.jsx', 'packages/web/src/expert/profile.test.jsx'],
  ['packages/web/src/expert/pulse.test.jsx', 'packages/web/src/expert/pulse.test.jsx'],
  ['packages/web/src/expert/question.test.jsx', 'packages/web/src/expert/question.test.jsx'],
  ['packages/web/src/expert/picture.test.jsx', 'packages/web/src/expert/picture.test.jsx'],
  ['packages/web/src/expert/questionpage.test.jsx', 'packages/web/src/expert/questionpage.test.jsx'],
  ['packages/web/src/expert/signout.test.jsx', 'packages/web/src/expert/signout.test.jsx'],
  ['packages/web/src/lib/context.test.js', 'packages/web/src/lib/context.test.js'],
  ['packages/web/src/lib/signout.test.js', 'packages/web/src/lib/signout.test.js'],
  ['packages/web/src/expert/risks.test.jsx', 'packages/web/src/expert/risks.test.jsx'],
  ['packages/web/src/staff/dispatch.test.jsx', 'packages/web/src/staff/dispatch.test.jsx'],
  ['packages/web/src/demo.test.jsx', 'packages/web/src/demo.test.jsx'],
  ['packages/web/src/expert/join.test.jsx', 'packages/web/src/expert/join.test.jsx'],
  ['packages/web/src/components/chips.test.jsx', 'packages/web/src/components/chips.test.jsx'],
  ['packages/web/src/staff/evolution.test.jsx', 'packages/web/src/staff/evolution.test.jsx'],
  ['packages/web/src/components/stepchart.test.jsx', 'packages/web/src/components/stepchart.test.jsx'],
  ['packages/web/src/components/timeline.test.jsx', 'packages/web/src/components/timeline.test.jsx'],
];
{
  const out = path.join(ROOT, 'packages/web/.vitest-count.json');
  const run = spawnSync('npx', ['vitest', 'run', '--reporter=json', `--outputFile=${out}`], { cwd: path.join(ROOT, 'packages/web'), encoding: 'utf8' });
  if (run.status !== 0 || !fs.existsSync(out)) {
    fail(`could not run the web tests to count them (exit=${run.status})`);
  } else {
    const rep = JSON.parse(fs.readFileSync(out, 'utf8'));
    fs.rmSync(out);
    for (const [modLabel, rel] of WEB_MAP) {
      const f = rep.testResults.find((r) => r.name.endsWith(rel.replace('packages/web/', '')));
      const n = f ? f.assertionResults.length : 0;
      if (!f || n === 0) { fail(`vitest reported no tests for ${rel}`); continue; }
      perModuleTests.set(modLabel, n);
      totalTests += n;
    }
  }
}

const readmeSrc = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');
const buildSrc = fs.readFileSync(path.join(ROOT, 'BUILD.md'), 'utf8');

for (const m of readmeSrc.matchAll(/\b(\d+)\s+tests\b/g)) {
  const claimed = Number(m[1]);
  const ctx = readmeSrc.slice(Math.max(0, m.index - 120), m.index + 40);
  const want = /gate:anonymity/.test(ctx)
    ? perModuleTests.get('packages/core/src/anonymity.js')
    : totalTests;
  if (claimed !== want) {
    fail(`README.md claims "${m[0]}" in "${ctx.trim().replace(/\s+/g, ' ')}" — actual count is ${want}`);
  }
}

const bannerMatch = /✓\s*(\d+)\s+unit tests pass/.exec(buildSrc);
if (!bannerMatch || Number(bannerMatch[1]) !== totalTests) {
  fail(`BUILD.md banner claims ${bannerMatch?.[1] ?? 'missing'} unit tests — actual suite has ${totalTests}`);
}

for (const [modLabel, want] of perModuleTests.entries()) {
  const escaped = modLabel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const rowRe = new RegExp(`\\|\\s*\`${escaped}\`\\s*\\|[^\\n]*?(\\d+)\\s+tests`);
  const rowMatch = rowRe.exec(buildSrc);
  if (!rowMatch) {
    fail(`BUILD.md module table has no test count for ${modLabel}`);
  } else if (Number(rowMatch[1]) !== want) {
    fail(`BUILD.md claims ${rowMatch[1]} tests for ${modLabel} — actual file has ${want}`);
  }
}

// ── 5. gate export & 50-item observable precision vs BUILD.md / README.md ────
const titledBlocks = blocks.filter((b) => b.title);
const gateRuns = titledBlocks.map((b) => gate({ statement: b.title }));
const textClean = gateRuns.filter((g) =>
  g.results.filter((r) => r.check !== 'window').every((r) => r.ok)
).length;
const textBlocked = gateRuns.filter((g) =>
  g.blockers.some((b) => b.check !== 'window')
).length;
const obsWarnCount = gateRuns.filter((g) =>
  g.warnings.some((w) => w.check === 'observable')
).length;
const labelled50 = JSON.parse(
  fs.readFileSync(
    path.join(ROOT, 'packages/benchmark/test/fixtures/observable-labelled-50.json'),
    'utf8'
  )
);
const obsEval = evaluateObservable(labelled50);
const wantWarnPct = `${(obsEval.warnPrecision * 100).toFixed(1)}%`;

if (!buildSrc.includes(`${textClean}/139`) || !buildSrc.includes(`${textBlocked}/139`) || !buildSrc.includes(`${obsWarnCount}/139`)) {
  fail(
    `BUILD.md gate counts drifted — measured ${textClean}/139 clean, ${textBlocked}/139 structural blockers, ${obsWarnCount}/139 observable warnings`
  );
}
if (!buildSrc.includes(wantWarnPct) || !readmeSrc.includes(wantWarnPct)) {
  fail(`prose observable warn precision drifted — measured ${wantWarnPct} on n=${obsEval.n}`);
}

if (!failures) {
  console.log(
    `✓ prose test & gate counts match: ${totalTests} total tests (${[...perModuleTests.values()].join('+')} across ${TEST_MAP.length} suites), ${wantWarnPct} observable warn precision (n=${obsEval.n})`
  );
}

if (failures) {
  console.error(`\n${failures} problem(s). A number without a script attached is how this repo`);
  console.error('got its baseline backwards. Fix the claim, or add the script that proves it.');
  process.exit(1);
}
console.log('\n✓ every published figure is either measured or marked.');
