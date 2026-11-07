// The report (power-spec §D, §E): banner, unreviewed count, the required headings in order, plain language, banned claims,
// the decision thresholds, and the separation rules. Uses a hand-built results object, so it runs in milliseconds.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderReport, decideAbsolute, decideVsAcaps, decideCalibration, decideSecondStage, THRESHOLDS } from '../src/report.js';
import { PLAIN_BANNED } from '../src/register.js';
import { BANNER } from '../src/label.js';
import { assertNotSynthetic, markSynthetic } from '../src/label.js';
import { makeRng } from '../src/rng.js';
import { resolveParams } from '../src/params.js';
import { makeRiskCards } from '../src/model.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const SIM_SRC = join(HERE, '..', 'src');
const SIM_BIN = join(HERE, '..', 'bin');

const CHECK = (id, pass) => ({ id, name: `check ${id}`, pass, value: 1, expected: 'x', detail: 'd' });

/** A small results object that exercises every section. */
function fixture() {
  return {
    validation: [CHECK('C.1', true), CHECK('C.2', false)],
    calendar: {
      windows: [6, 12, 24].map((w) => ({ windowMonths: w, eligibleMonths: w - 3, risk: { median: w, lo: w - 3, hi: w + 3 }, trigger: { median: 2 * w, lo: w, hi: 3 * w } })),
      rankCorrelation: 0.95,
    },
    absolute: {
      rows: [3, 5, 8].map((k) => ({ k, N: 110, power: 0.8, lo: 0.77, hi: 0.83, n80: 110 })),
      nested: [
        { coupling: 0.3, N: 149, rho_D: 0.11, power_naive: 0.8, power_cluster: 0.6, neff_power_matched: 120 },
        { coupling: 0.7, N: 149, rho_D: 0.27, power_naive: 0.6, power_cluster: 0.4, neff_power_matched: 62 },
      ],
    },
    vsAcaps: { rows: [{ N: 28, medianHalfWidth: 0.063, p25: 0.055, p75: 0.07, power: 0.2, calendarMonths: 6 }] },
    secondStage: { rows: [{ rho: 0.3, rule: 'mean', N: 28, power: 0.1, meanDAuc: 0.01, halfWidth: 0.2 }], population: { acaps: 0.7, direct: 0.8, mean: 0.7 } },
    dropout: { K: 15, dropout: 0.51, floor: 5, share: 0.823 },
    sensitivity: { rows: [{ sweep: 'S1', settingLabel: '3 answers per card', gain: 0.02, cardsNeeded80: 351, power: 0.3 }] },
    round2: { rows: [{ lambda: 0.3, N: 40, k: 8, power: 0.7, lo: 0.6, hi: 0.8, fracWithheld: 0.01 }], nullRate: 0.05 },
    crosscorr: {
      rows: [{ name: 'Idealised', n80: 29, powerAt29: 0.8, curve: [] }],
      spuriousRate: 0.25, spuriousShare: 0.4,
    },
    calibration: { rows: [{ N: 100, slopeMean: 1.2, slopePower: 0.1, medianSmallestBin: 3, medianWorstHalfWidth: 0.3 }] },
    parameters: [{ key: 'tau', value: 1.25 }],
  };
}
const META = { runId: '20261107-seed7-quick', seed: 7, quick: true, elapsedSec: 42.5, review: { proposed: 22, accepted: 2, changed: 0, vetoed: 0 } };
const TEXT = renderReport(fixture(), META);

/** The headings the report must carry, in the order of power-spec §D. */
const HEADINGS = [
  '## Validation: does the simulator work?',
  '## 1. What this report is, and what it is not',
  '## What this report is not',
  '## 2. How many questions can we realistically score, and when?',
  '## 3. Is the panel better than simply guessing the average?',
  '## 4. Can we tell the panel apart from ACAPS?',
  '## 5. Do the individual trigger forecasts add up to a better risk forecast?',
  '## 6. What if experts drop out, make the same mistakes, or are overconfident?',
  '## 7. Does seeing ACAPS\'s reasoning pull experts toward ACAPS?',
  '## 8. Can we say anything about links between questions?',
  '### Calibration',
  '## 9. What can we claim, and what should we insist on?',
  '## 10. The judgement calls, one by one',
  '## 11. What would change these conclusions',
  '## 12. Checks that the simulator itself works',
  '## 13. Glossary',
];

test('the report opens with the synthetic banner and the unreviewed count', () => {
  assert.ok(TEXT.split('\n')[0].startsWith('# '));
  assert.ok(TEXT.includes(`> **${BANNER}.**`));
  assert.match(TEXT, /\*\*22 judgement calls not yet reviewed by ACAPS\.\*\*/);
});

test('the banner appears under every table and at the top: count is at least tables plus one', () => {
  const tables = (TEXT.match(/^\|---/gm) ?? []).length;
  const banners = TEXT.split(BANNER).length - 1;
  assert.ok(tables >= 5, `expected several tables, found ${tables}`);
  assert.ok(banners >= tables + 1, `banners ${banners} < tables ${tables} + 1`);
});

test('every heading of power-spec §D is present, in order', () => {
  let at = -1;
  for (const h of HEADINGS) {
    const i = TEXT.indexOf(`\n${h}\n`);
    assert.ok(i > at, `heading missing or out of order: ${h}`);
    at = i;
  }
});

test('the validation table is printed at the top, before section 1', () => {
  assert.ok(TEXT.indexOf('Validation: 1 of 2 checks pass.') < TEXT.indexOf('## 1. What this report is'));
  assert.match(TEXT, /\| C\.2 \| check C\.2 \| FAIL \|/);
});

test('the report says what it is not, and never claims the panel is accurate', () => {
  const section = TEXT.split('## What this report is not')[1].split('## 2.')[0];
  assert.match(section, /not evidence that the panel is accurate/);
});

test('the report contains no statistical jargon (the register lint, applied to the report)', () => {
  for (const pattern of PLAIN_BANNED) {
    assert.doesNotMatch(TEXT, pattern, `banned term ${pattern} appears in the report`);
  }
});

test('the report makes none of the banned claims', () => {
  assert.doesNotMatch(TEXT, /\bproves?\b/i);
  assert.doesNotMatch(TEXT, /\bwill detect\b/i);
  assert.doesNotMatch(TEXT, /\bno difference\b/i);
});

test('the report never offers the banned options: band-rate uncertainty or outlier-weighted pooling', () => {
  assert.doesNotMatch(TEXT, /bandRateUncertainty|outlier|down-weight/i);
});

test('coupling 0.3 and coupling 0.7 are reported side by side', () => {
  const nested = TEXT.split('**Nested trigger cards.**')[1].split('## 4.')[0];
  assert.match(nested, /^\| 0\.3 \|/m);
  assert.match(nested, /^\| 0\.7 \|/m);
});

test('the dropout line says about 82% of cards reach 5 answers at the stored setting', () => {
  assert.match(TEXT, /about 82% of cards reach 5 answers/);
});

test('the report lists the second-look false-alarm figure only as the check it was measured in, and the null rate', () => {
  assert.match(TEXT, /Null check \(two arms with no effect\): any-direction rejection 5\.0%/);
});

test('decision rules: the absolute-accuracy verdict flips at the thresholds (teeth for the table)', () => {
  assert.equal(decideAbsolute({ N: THRESHOLDS.absDescriptiveBelow - 1, k: 8 }).verdict, 'descriptive only');
  assert.equal(decideAbsolute({ N: THRESHOLDS.absDescriptiveBelow, k: 8 }).verdict, 'detect');
  assert.equal(decideAbsolute({ N: 109, k: 8 }).verdict, 'detect');
  assert.equal(decideAbsolute({ N: 110, k: 8 }).verdict, 'not detect');
  assert.equal(decideAbsolute({ N: 300, k: 4 }).verdict, 'descriptive only', 'too few responders per card');
});

test('decision rules: the ACAPS comparison is descriptive below 100 risks, and detects a gain from 100 on', () => {
  assert.equal(decideVsAcaps({ N: 99 }).verdict, 'descriptive only');
  assert.equal(decideVsAcaps({ N: 100 }).verdict, 'detect');
  assert.match(decideVsAcaps({ N: 100 }).claim, /0\.05/);
  assert.match(decideVsAcaps({ N: 285 }).claim, /0\.03/);
});

test('decision rules: calibration and the second stage are not claimable at pilot sizes', () => {
  assert.equal(decideCalibration({ N: 449 }).verdict, 'descriptive only');
  assert.equal(decideCalibration({ N: 450 }).verdict, 'detect');
  assert.equal(decideSecondStage({ N: THRESHOLDS.secondStageFrom - 1 }).verdict, 'descriptive only');
});

test('the decision table in section 9 is generated from the same thresholds', () => {
  const section = TEXT.split('## 9. What can we claim')[1].split('## 10.')[0];
  assert.match(section, /\| Absolute accuracy over the base rate \| 110 \| 8 \| not detect \|/);
  assert.match(section, /\| Panel against ACAPS, risks \| 60 \| 8 \| descriptive only \|/);
});

test('the report is deterministic: the same input gives the same bytes', () => {
  assert.equal(renderReport(fixture(), META), TEXT);
});

test('the review summary is shown with each state, and the glossary defines the terms', () => {
  assert.match(TEXT, /Accepted: 2\. Changed: 0\. Vetoed: 0\./);
  for (const term of ['Brier score', 'Base rate', 'Power', 'Minimum detectable effect', 'Shared mistakes', 'Calibration']) {
    assert.ok(TEXT.includes(`| ${term} |`), `glossary lacks ${term}`);
  }
});

test('separation: no simulator source or script imports the service, a store, or a database driver', () => {
  const files = [...readdirSync(SIM_SRC).map((f) => join(SIM_SRC, f)), ...readdirSync(SIM_BIN).map((f) => join(SIM_BIN, f))];
  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    assert.doesNotMatch(text, /from ['"]@benchmark\/service/, `${file} imports @benchmark/service`);
    assert.doesNotMatch(text, /from ['"](pg|pglite|@electric-sql)/, `${file} imports a database driver`);
    assert.doesNotMatch(text, /packages\/service/, `${file} reads a path under packages/service`);
  }
});

test('separation: the simulator reads no answers file and no store; only the radar export', () => {
  const data = readFileSync(join(SIM_SRC, 'data.js'), 'utf8');
  assert.match(data, /risk-radar\.json/);
  assert.doesNotMatch(data, /answers|store|sqlite/i);
});

test('assertNotSynthetic refuses the simulator\'s own cards and rows (a pilot analysis must call it)', () => {
  const params = resolveParams({});
  const cards = makeRiskCards(params, makeRng(7), 3).map((c) => markSynthetic(c));
  assert.throws(() => assertNotSynthetic(cards), /SIM-|synthetic/);
  assert.throws(() => assertNotSynthetic(cards[0]));
  assert.throws(() => assertNotSynthetic(markSynthetic({ id: 'R0990' })));
  assert.doesNotThrow(() => assertNotSynthetic({ id: 'R0990' }));
});
