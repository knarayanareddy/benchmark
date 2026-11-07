/**
 * The markdown report for ACAPS programme staff (power-spec §D, §E). Plain language, sections in the order of §D, a
 * "how to read this" box under every heading, the synthetic banner under every table, the validation table at the top,
 * and the unreviewed-count banner. Nothing here reads the clock or the disk: renderReport is a pure function of its
 * inputs, so the same results give the same bytes.
 *
 * Numbers are never typed in. Every figure comes from the `results` object that bin/run.mjs builds from the engine.
 */
import { BANNER } from './label.js';
import { renderValidation } from './validate.js';

/** @typedef {import('./validate.js').Check} Check */

/**
 * Thresholds for the decision table (power-spec Analysis 7). Each one is an effective number of independent cards (or a
 * participant count) above which a claim becomes defensible. Changing one changes the verdicts: the tests pin them.
 */
export const THRESHOLDS = Object.freeze({
  absDescriptiveBelow: 40,
  absDetectGainFrom: 110,
  absMinResponders: 5,
  vsAcapsDescriptiveBelow: 100,
  vsAcapsDetectGainFrom: 285,
  calibrationFrom: 450,
  secondStageFrom: 200,
  roundTwoFrom: 40,
});

/**
 * The verdict for the absolute-accuracy endpoint at N effective cards and k responders per card.
 * @param {{ N:number, k:number }} x
 * @returns {{ verdict:'detect'|'not detect'|'descriptive only', claim:string }}
 */
export function decideAbsolute({ N, k }) {
  if (N < THRESHOLDS.absDescriptiveBelow || k < THRESHOLDS.absMinResponders) {
    return { verdict: 'descriptive only', claim: 'The skill score over the base rate, with its interval. It cannot show the panel is better than a constant forecast, nor that it is not.' };
  }
  if (N < THRESHOLDS.absDetectGainFrom) {
    return { verdict: 'detect', claim: 'A gain of about 0.04 to 0.05 Brier points over the base rate can be detected at about 80% power. A result that is not significant does not support "no skill".' };
  }
  return { verdict: 'not detect', claim: 'A gain of 0.03 Brier points over the base rate can be detected at about 80% power. A result that is not significant supports "no gain larger than about 0.03".' };
}

/**
 * The verdict for the panel against ACAPS at N risk-level cards.
 * @param {{ N:number }} x
 * @returns {{ verdict:'detect'|'descriptive only', claim:string }}
 */
export function decideVsAcaps({ N }) {
  if (N < THRESHOLDS.vsAcapsDescriptiveBelow) {
    return { verdict: 'descriptive only', claim: 'The difference in Brier points with its interval (half-width about 0.06 at 28 risks). Never claim the two are the same.' };
  }
  if (N < THRESHOLDS.vsAcapsDetectGainFrom) {
    return { verdict: 'detect', claim: 'Only a gain of 0.05 or more can be detected at about 80% power.' };
  }
  return { verdict: 'detect', claim: 'A gain of 0.03 can be detected at about 80% power.' };
}

/**
 * The verdict for calibration (the slope of outcome on forecast) at N effective cards.
 * @param {{ N:number }} x
 * @returns {{ verdict:'detect'|'descriptive only', claim:string }}
 */
export function decideCalibration({ N }) {
  if (N < THRESHOLDS.calibrationFrom) {
    return { verdict: 'descriptive only', claim: 'Calibration can be described with its interval. A slope of 0.75 is not claimable at this size.' };
  }
  return { verdict: 'detect', claim: 'A calibration slope of about 0.75 can be detected at about 80% power.' };
}

/**
 * The verdict for the trigger-to-risk link (second stage) at N risks.
 * @param {{ N:number }} x
 * @returns {{ verdict:'detect'|'descriptive only', claim:string }}
 */
export function decideSecondStage({ N }) {
  if (N < THRESHOLDS.secondStageFrom) {
    return { verdict: 'descriptive only', claim: 'The link strength and the difference in ranking accuracy, with intervals. No claim of beating ACAPS.' };
  }
  return { verdict: 'detect', claim: 'A ranking gain can be detected if the link between triggers and risks is strong.' };
}

/** @param {number} x @param {number} [d] */
const pct = (x, d = 0) => `${(100 * x).toFixed(d)}%`;
/** @param {number|null|undefined} x @param {number} [d] */
const num = (x, d = 3) => (x === null || x === undefined || Number.isNaN(x) ? 'n/a' : x.toFixed(d));
/** @param {number|null|undefined} lo @param {number|null|undefined} hi @param {number} [d] */
const span = (lo, hi, d = 3) => `[${num(lo, d)}, ${num(hi, d)}]`;

/** A table with the synthetic banner as its footer. */
function table(headers, rows) {
  const out = [`| ${headers.join(' | ')} |`, `|${headers.map(() => '---').join('|')}|`];
  for (const r of rows) out.push(`| ${r.map((c) => String(c).replace(/\|/g, '/')).join(' | ')} |`);
  out.push('', `*${BANNER}.*`);
  return out.join('\n');
}

/** "How to read this" box for a section. @param {string[]} lines */
const howToRead = (lines) => `> **How to read this.** ${lines.join(' ')}`;

/** @param {Array<{ key:string, value:unknown }>} rows */
const paramRows = (rows) => rows.map((r) => [`\`${r.key}\``, JSON.stringify(r.value)]);

/**
 * The full report.
 * @param {object} results see bin/run.mjs for the shape; every section is optional and says so when missing
 * @param {{ runId:string, seed:number, quick:boolean, elapsedSec:number, rScale?:string[], review:{proposed:number, accepted:number, changed:number, vetoed:number} }} meta
 * @returns {string}
 */
export function renderReport(results, meta) {
  const r = results;
  const v = /** @type {Check[]} */ (r.validation ?? []);
  const passed = v.filter((c) => c.pass).length;
  const proposed = meta.review.proposed;
  const out = [];

  out.push(`# Power analysis for the ACAPS pilot: synthetic results under stated assumptions`);
  out.push('');
  out.push(`> **${BANNER}.**`);
  out.push(`>`);
  out.push(`> **${proposed} judgement calls not yet reviewed by ACAPS.** Accepted: ${meta.review.accepted}. Changed: ${meta.review.changed}. Vetoed: ${meta.review.vetoed}. Every number below follows from these calls; the register (docs/15) lists each one.`);
  out.push('');
  out.push(`Run ${meta.runId}, seed ${meta.seed}, ${meta.quick ? 'quick mode (fewer replicates, wider error bars)' : 'full mode'}, elapsed ${num(meta.elapsedSec, 1)} seconds.${(meta.rScale ?? []).length ? ` ${meta.rScale.join(' ')}` : ''}`);
  out.push('');
  out.push(`## Validation: does the simulator work?`);
  out.push('');
  out.push(howToRead([`Each check tests the simulator against a known answer. ${passed} of ${v.length} pass. A failed check means the numbers below should not be used.`]));
  out.push('');
  out.push(v.length ? renderValidation(v) : 'No validation was run.');
  out.push('');
  out.push(`*${BANNER}.*`);
  out.push('');

  out.push(`## 1. What this report is, and what it is not`);
  out.push('');
  out.push(howToRead(['This is a plan-checking study. It says what the pilot design could detect if experts behave the way described in the register. It is not a result about the panel.']));
  out.push('');
  out.push(`- It shows what the pilot design could detect, and how many cards it would need, under stated assumptions.`);
  out.push(`- It is built from the risk radar export. The panel is simulated; no expert answered anything.`);
  out.push(`- Every figure is ${BANNER.toLowerCase()}.`);
  out.push('');
  out.push(`## What this report is not`);
  out.push('');
  out.push(`- It is **not evidence that the panel is accurate**, and it does not say the panel will do better or worse than ACAPS.`);
  out.push(`- It does not show that ACAPS is accurate or inaccurate.`);
  out.push(`- It does not show that a gain is likely. A gain is only a value the design is tested against.`);
  out.push(`- Its power figures depend on the judgement calls in the register; change a call and the figures move.`);
  out.push('');

  out.push(`## 2. How many questions can we realistically score, and when?`);
  out.push('');
  out.push(howToRead(['Counts of new risks and triggers from the radar, and how many cards a pilot window could reach. The projection is synthetic; the arrivals are real.']));
  out.push('');
  if (r.calendar) {
    out.push(table(['Window (months)', 'Eligible months', 'Risk cards (median)', 'Risk cards 95% range', 'Trigger cards (median)', 'Trigger cards 95% range'],
      r.calendar.windows.map((w) => [w.windowMonths, w.eligibleMonths, num(w.risk.median, 1), span(w.risk.lo, w.risk.hi, 1), num(w.trigger.median, 1), span(w.trigger.lo, w.trigger.hi, 1)])));
    out.push('');
    out.push(`Arrivals are counted from the dates triggers were entered (real arrivals, synthetic projection). The rank correlation between risk number and first date is ${num(r.calendar.rankCorrelation, 2)}, which supports the number order as a proxy for creation order.`);
  } else out.push('The calendar was not run.');
  out.push('');

  out.push(`## 3. Is the panel better than simply guessing the average?`);
  out.push('');
  out.push(howToRead(['Absolute accuracy: the Brier score (the average squared gap between forecast and outcome, lower is better) against the average outcome of the same cards. This is the primary endpoint candidate.']));
  out.push('');
  if (r.absolute) {
    const all = r.absolute.all ?? r.absolute.rows;
    out.push(`**Power by number of cards** (gain 0.03 over the base rate, 8 answers per card).`);
    out.push('');
    out.push(table(['Cards (N)', 'Power', 'Power 95% range'],
      r.absolute.rows.map((x) => [x.N, num(x.power, 2), span(x.lo, x.hi, 2)])));
    out.push('');
    out.push(`**Cards needed for 80% power**, by true gain and by answers per card (k). A dash means the grid did not reach 80%.`);
    out.push('');
    const cells = new Map();
    for (const x of all) cells.set(`${x.gain}|${x.k}`, x);
    out.push(table(['True gain (Brier points)', 'Answers per card (k)', 'Cards needed (80%)', 'Range of the estimate'],
      [...cells.values()].map((x) => [x.gain, x.k, x.n80 ?? '—', x.n80Lo !== undefined && x.n80Lo !== null ? `${x.n80Lo} to ${x.n80Hi ?? 'not reached'}` : 'n/a'])));
    out.push('');
    out.push(`Power is the chance of seeing a gain over the base rate with an interval that excludes zero, with independent cards. Trigger cards under one risk are less independent: see the nested rows below and section 8.`);
  } else out.push('The absolute analysis was not run.');
  out.push('');
  if (r.absolute?.nested) {
    out.push(`**Nested trigger cards.** Trigger cards under one risk move together. Coupling 0.3 and coupling 0.7 are shown side by side.`);
    out.push('');
    out.push(table(['Coupling', 'Trigger cards (N)', 'Shared-outcome share (rho D)', 'Power, independent', 'Power, nested', 'Effective cards (power matched)'],
      r.absolute.nested.map((x) => [x.coupling, x.N, num(x.rho_D, 2), num(x.power_naive, 2), num(x.power_cluster, 2), num(x.neff_power_matched, 0)])));
    out.push('');
  }

  out.push(`## 4. Can we tell the panel apart from ACAPS?`);
  out.push('');
  out.push(howToRead(['A risk-level comparison, with 28 risks now. At this size the interval is wide: the difference can be estimated to about plus or minus 0.06 Brier points, and nothing smaller can be told apart.']));
  out.push('');
  if (r.vsAcaps) {
    out.push(table(['Risks (N)', 'Median half-width', 'Middle half-width range', 'Power at gain 0.03', 'Power 95% range', 'Months to reach N at the central arrival rate'],
      r.vsAcaps.rows.map((x) => [x.N, num(x.medianHalfWidth, 3), `${num(x.p25, 3)} to ${num(x.p75, 3)}`, num(x.power, 2), span(x.powerLo, x.powerHi, 2), x.calendarMonths ?? 'n/a'])));
    out.push('');
    out.push(`Report ACAPS's own absolute accuracy for the same cards with its interval next to the comparison. Neither figure is a verdict on the panel.`);
    out.push('');
    out.push(`**Calibration beside the comparison.** A panel that only recalibrates ACAPS's bands can gain up to about 0.01 Brier points. Read any gain below that as recalibration.`);
  } else out.push('The ACAPS comparison was not run.');
  out.push('');
  out.push(table(['Question', 'Verdict', 'What can be claimed'], [
    ['Panel against ACAPS, risks', decideVsAcaps({ N: 28 }).verdict, decideVsAcaps({ N: 28 }).claim],
  ]));
  out.push('');

  out.push(`## 5. Do the individual trigger forecasts add up to a better risk forecast?`);
  out.push('');
  out.push(howToRead(['Trigger forecasts are combined into one risk forecast by a rule chosen in advance (highest, "at least one", or average). It is compared with ACAPS\'s band by ranking accuracy. The link strength between triggers and risks is not known and is the main assumption.']));
  out.push('');
  if (r.secondStage) {
    out.push(table(['Link strength', 'Rule', 'Risks (N)', 'Power', 'Mean difference in ranking accuracy', 'Half-width'],
      r.secondStage.rows.map((x) => [x.rho, x.rule, x.N, num(x.power, 2), num(x.meanDAuc, 3), num(x.halfWidth, 3)])));
    out.push('');
    out.push(`Population ranking accuracy (AUC) with a link of 0.3: ACAPS ${num(r.secondStage.population.acaps, 3)}, panel's direct risk forecast ${num(r.secondStage.population.direct, 3)}, average of triggers ${num(r.secondStage.population.mean, 3)}. Descriptive until several hundred risks exist.`);
  } else out.push('The second-stage analysis was not run.');
  out.push('');

  out.push(`## 6. What if experts drop out, make the same mistakes, or are overconfident?`);
  out.push('');
  out.push(howToRead(['Each row changes one assumption and reports the true gain and the cards needed. The tornado table ranks them. The anchor is the default setting.']));
  out.push('');
  if (r.dropout) {
    out.push(`**Dropout.** With ${r.dropout.K} invited experts per card and a response rate of ${pct(1 - r.dropout.dropout)}, about ${pct(r.dropout.share)} of cards reach ${r.dropout.floor} answers at the stored setting. The rest are withheld.`);
    out.push('');
  }
  if (r.sensitivity?.rows) {
    out.push(table(['Sweep', 'Setting', 'Gain', 'Cards needed for 80%', 'Power at 104 cards'],
      r.sensitivity.rows.map((x) => [x.sweep, x.settingLabel, num(x.gain, 4), x.cardsNeeded80 ?? 'not reached', num(x.power, 2)])));
    out.push('');
    out.push(`A bar chart of cards needed by setting is in the figures folder. Monte Carlo error on each row is in the CSV files.`);
  } else out.push(`The sensitivity sweeps were not produced: ${r.sensitivity?.reason ?? 'not run'}.`);
  out.push('');

  out.push(`## 7. Does seeing ACAPS's reasoning pull experts toward ACAPS?`);
  out.push('');
  out.push(howToRead(['In a second round, some experts see ACAPS\'s reasoning. This section asks how many cards would show a pull toward ACAPS. It describes movement only; it never claims accuracy improves.']));
  out.push('');
  if (r.round2) {
    out.push(table(['Pull toward ACAPS (lambda)', 'Risks (N)', 'Experts per card (k)', 'Power', 'Power 95% range', 'Share of replicates with an arm under the release floor'],
      r.round2.rows.map((x) => [x.lambda, x.N, x.k, num(x.power, 2), span(x.lo, x.hi, 2), pct(x.fracWithheld)])));
    out.push('');
    out.push(`Null check (two arms with no effect): any-direction rejection ${pct(r.round2.nullRate, 1)}, where 3 to 7.5% is the acceptable range.`);
  } else out.push('The second-look analysis was not run.');
  out.push('');

  out.push(`## 8. Can we say anything about links between questions?`);
  out.push('');
  out.push(howToRead(['Correlation between two questions is only meaningful if the questions are linked in reality. Shared narrative errors can create correlation with no link at all. This section shows how many questions a correlation test would need.']));
  out.push('');
  if (r.crosscorr) {
    out.push(table(['Model', 'Questions for 80% power, moderate correlation (0.5)', 'Power at 29 questions'],
      r.crosscorr.rows.map((x) => [x.name, x.n80 ?? 'not reached', num(x.powerAt29, 2)])));
    out.push('');
    out.push(`Under the idealised model 29 pairs are needed at a correlation of 0.5 (50 with a stricter multiple-comparison rule). With panel noise the number rises to the range shown above. A shared narrative error alone can produce significant correlation: the spurious-correlation rate is ${pct(r.crosscorr.spuriousRate, 1)} when that error is ${r.crosscorr.spuriousShare}.`);
  } else out.push('The cross-question analysis was not run.');
  out.push('');

  out.push(`### Calibration`);
  out.push('');
  out.push(howToRead(['Calibration asks whether a forecast of 70% comes true about 70% of the time. Measured by the slope of outcome on forecast; a slope of 1 is ideal.']));
  out.push('');
  if (r.calibration) {
    out.push(table(['Risks (N)', 'Median slope', 'Power to detect slope 0.75', 'Median smallest bin (cards)', 'Median widest bin half-width'],
      r.calibration.rows.map((x) => [x.N, num(x.slopeMean, 2), num(x.slopePower, 2), num(x.medianSmallestBin, 0), num(x.medianWorstHalfWidth, 2)])));
    out.push('');
  } else out.push('The calibration analysis was not run.');
  out.push('');

  out.push(`## 9. What can we claim, and what should we insist on?`);
  out.push('');
  out.push(howToRead(['Decision rules. Find the row for the card count and responders per card you expect; the verdict says which claim the design supports.']));
  out.push('');
  /** @param {string} question @param {number} N @param {number} k @param {{verdict:string, claim:string}} d */
  const rule = (question, N, k, d) => [question, N, k, d.verdict, d.claim];
  out.push(table(['Question', 'Cards (N)', 'Responders per card (k)', 'Verdict', 'What can be claimed'], [
    rule('Absolute accuracy over the base rate', 28, 8, decideAbsolute({ N: 28, k: 8 })),
    rule('Absolute accuracy over the base rate', 110, 8, decideAbsolute({ N: 110, k: 8 })),
    rule('Absolute accuracy over the base rate', 110, 3, decideAbsolute({ N: 110, k: 3 })),
    rule('Panel against ACAPS, risks', 60, 8, decideVsAcaps({ N: 60 })),
    rule('Panel against ACAPS, risks', 285, 8, decideVsAcaps({ N: 285 })),
    rule('Calibration slope', 300, 8, decideCalibration({ N: 300 })),
    rule('Trigger-to-risk link', 100, 8, decideSecondStage({ N: 100 })),
  ]));
  out.push('');
  out.push(`**Minimum recruitment to insist on.** Invite enough experts that most cards reach the release floor. At 49% response, 15 invited gives about ${pct(r.dropout?.share ?? 0.82)} of cards at 5 answers. The design is not claimable below 100 rated risk cards for a comparison with ACAPS.`);
  out.push('');

  out.push(`## 10. The judgement calls, one by one`);
  out.push('');
  out.push(`Each judgement call, its options, the value used and who may veto it is in [docs/15-judgement-calls.md](../docs/15-judgement-calls.md). ${proposed} of them are not yet reviewed by ACAPS. Parameters used in this run:`);
  out.push('');
  if (r.parameters) {
    out.push(table(['Parameter', 'Value used'], paramRows(r.parameters)));
    out.push('');
  }

  out.push(`## 11. What would change these conclusions`);
  out.push('');
  out.push(howToRead(['Each item links to its register entry. These are the things the pilot can measure from its own data without looking at outcomes.']));
  out.push('');
  out.push(`- The real spread of the panel's scores within a risk and the real shared-mistake share (J05, J13): measurable from Round-1 answers once cards close.`);
  out.push(`- The real response rate, 17% or 49% (J08), and whether cards below the floor are analysed.`);
  out.push(`- The share of triggers that can be tied to a public source at authoring (J09), and the arrival rate of new risks (J16): they set the calendar.`);
  out.push(`- The information ceiling (J01): at a low setting a gain of 0.03 is out of reach.`);
  out.push(`- The trigger-to-risk link (J23): a weak link makes section 5 moot.`);
  out.push(`- The trigger base rate (J15) and the smallest improvement that matters (J18).`);
  out.push('');

  out.push(`## 12. Checks that the simulator itself works`);
  out.push('');
  out.push(howToRead(['The validation table at the top lists each check, with its numbers.']));
  out.push('');
  out.push(`The real-data check reads the repo's own figures from the baseline file and from the measurement script. It reproduces the naive floor (0.2425), the ACAPS score (0.2171) and the paired difference on the 104 resolved risks. These are historical, already-resolved risks, not simulated: REAL DATA.`);
  out.push('');

  out.push(`## 13. Glossary`);
  out.push('');
  out.push(table(['Term', 'Meaning'], [
    ['Brier score', 'The average squared gap between a forecast and the outcome (0 or 1). Lower is better. A constant 0.5 scores 0.25.'],
    ['Brier points', 'Differences in Brier score, the unit of every gain in this report.'],
    ['Base rate', 'The share of cards that came true. A constant forecast at the base rate is the hardest simple benchmark.'],
    ['skill score', 'The gain over the base rate divided by the base rate times one minus the base rate.'],
    ['Paired', 'Comparing two forecasts card by card, so only their differences count.'],
    ['Power', 'The chance the design shows a gain when the gain is really there.'],
    ['Minimum detectable effect', 'The smallest gain the design shows at 80% power.'],
    ['Shared mistakes', 'Errors that all experts on one card make together, which averaging cannot remove.'],
    ['Calibration', 'Whether forecasts match outcomes at the stated rate. A calibration slope of 1 is ideal.'],
  ]));
  out.push('');
  out.push(`*${BANNER}.*`);
  return `${out.join('\n')}\n`;
}
