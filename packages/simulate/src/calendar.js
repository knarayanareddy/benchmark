/**
 * Arrival calendar: when risks and triggers entered the Radar (real arrivals, counted from data/risk-radar.json), and how
 * many risk-level and trigger-level cards a pilot window can reach (a synthetic projection under the yields in
 * assumptions.json). Counts only: nothing here reads answers, outcomes or ACAPS fired-statuses.
 *
 * Arrival proxy: a risk has no creation date, so its arrival month is the month of its earliest trigger `dateEnteredISO`.
 * Risks with no dated trigger (31 of 139) predate the dated series and are excluded from rates. Validity of the proxy:
 * rank correlation between the risk id number (creation order) and that date.
 */
import { normaliseRisk } from '@benchmark/core/radar';
import { loadHistorical } from './data.js';
import { makeRng } from './rng.js';

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const RISK_ID = /^R(\d+)$/;
const QUANTILES = Object.freeze({ lo: 0.025, median: 0.5, hi: 0.975 });

/**
 * Month index (year * 12 + month0) of an ISO date, so months are consecutive integers.
 * @param {string} iso
 * @returns {number}
 */
function monthIndexOf(iso) {
  const m = ISO_DATE.exec(iso);
  const month = m ? Number(m[2]) : NaN;
  if (!m || !(month >= 1 && month <= 12) || Number.isNaN(Date.parse(iso))) {
    throw new RangeError(`not a valid ISO date: ${iso}`);
  }
  return Number(m[1]) * 12 + (month - 1);
}

/** @param {number} index @returns {string} 'YYYY-MM' */
function monthLabel(index) {
  const year = Math.floor(index / 12);
  return `${year}-${String(index - year * 12 + 1).padStart(2, '0')}`;
}

/**
 * Average ranks (ties share the mean of their positions), 1-based.
 * @param {number[]} values
 * @returns {number[]}
 */
function averageRanks(values) {
  const order = values.map((_, i) => i).sort((i, j) => values[i] - values[j]);
  const ranks = new Array(values.length);
  let start = 0;
  while (start < order.length) {
    let end = start;
    while (end + 1 < order.length && values[order[end + 1]] === values[order[start]]) end += 1;
    const avg = (start + end) / 2 + 1;
    for (let k = start; k <= end; k++) ranks[order[k]] = avg;
    start = end + 1;
  }
  return ranks;
}

/**
 * Spearman rank correlation (Pearson on average ranks).
 * @param {number[]} x @param {number[]} y
 * @returns {number}
 */
function spearman(x, y) {
  const rx = averageRanks(x);
  const ry = averageRanks(y);
  const n = rx.length;
  const mx = rx.reduce((s, v) => s + v, 0) / n;
  const my = ry.reduce((s, v) => s + v, 0) / n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    sxy += (rx[i] - mx) * (ry[i] - my);
    sxx += (rx[i] - mx) ** 2;
    syy += (ry[i] - my) ** 2;
  }
  return sxy / Math.sqrt(sxx * syy);
}

/**
 * Monthly arrivals from the raw radar records. `months` runs from the earliest to the latest dated trigger entry with no
 * gaps, so months with no arrivals appear as zeros.
 * @param {unknown[]} radarArray the parsed data/risk-radar.json array
 * @returns {{ months:string[], riskMonthly:number[], triggerMonthly:number[], rankCorrelationIdVsDate:number,
 *   undatedRisks:number, undatedTriggers:number }}
 */
export function arrivalsFromRadar(radarArray) {
  if (!Array.isArray(radarArray)) throw new TypeError('arrivalsFromRadar needs the array of radar records');
  const risks = radarArray.map(normaliseRisk).filter((r) => r.id !== '');

  /** @type {number[]} month index of every dated trigger entry */
  const triggerMonths = [];
  /** @type {{ n: number, iso: string }[]} creation-order proxy and first entry date, one per dated risk */
  const dated = [];
  let undatedRisks = 0;
  let undatedTriggers = 0;
  for (const r of risks) {
    const dates = [];
    for (const t of r.timeline.triggers) {
      if (t.dateEnteredISO === null) {
        undatedTriggers += 1;
        continue;
      }
      dates.push(t.dateEnteredISO);
      triggerMonths.push(monthIndexOf(t.dateEnteredISO));
    }
    if (dates.length === 0) {
      undatedRisks += 1;
      continue;
    }
    dates.sort();
    const m = RISK_ID.exec(r.id);
    if (!m) throw new RangeError(`risk id ${r.id} is not R<digits>`);
    dated.push({ n: Number(m[1]), iso: dates[0] });
  }

  if (triggerMonths.length === 0) throw new RangeError('no dated trigger entries in the radar');
  const firstMonth = Math.min(...triggerMonths);
  const lastMonth = Math.max(...triggerMonths);
  const span = lastMonth - firstMonth + 1;
  const riskMonthly = new Array(span).fill(0);
  const triggerMonthly = new Array(span).fill(0);
  for (const m of triggerMonths) triggerMonthly[m - firstMonth] += 1;
  for (const d of dated) riskMonthly[monthIndexOf(d.iso) - firstMonth] += 1;

  const months = Array.from({ length: span }, (_, i) => monthLabel(firstMonth + i));
  return {
    months,
    riskMonthly,
    triggerMonthly,
    rankCorrelationIdVsDate: spearman(
      dated.map((d) => d.n),
      dated.map((d) => Date.parse(d.iso)),
    ),
    undatedRisks,
    undatedTriggers,
  };
}

/**
 * Median and 95% percentile interval (linear interpolation) of a sample.
 * @param {number[]} xs
 * @returns {{ median:number, lo:number, hi:number }}
 */
function summarise(xs) {
  const sorted = [...xs].sort((a, b) => a - b);
  const at = (q) => {
    const pos = q * (sorted.length - 1);
    const i = Math.floor(pos);
    const frac = pos - i;
    return i + 1 < sorted.length ? sorted[i] * (1 - frac) + sorted[i + 1] * frac : sorted[i];
  };
  return { median: at(QUANTILES.median), lo: at(QUANTILES.lo), hi: at(QUANTILES.hi) };
}

/**
 * Cards a window can reach. A window of W months scores only arrivals in its first W − lag months, because a card
 * published in the last `lag` months cannot be resolved in time. Months are drawn with replacement from the observed
 * months (a month-bootstrap). A drawn month brings its risk count and its trigger count together, so bursts are kept.
 *   risk cards    = (activeRisks + new risks in eligible months) × yieldRisk
 *   trigger cards = (activeTriggers + new triggers in eligible months) × yieldTrigger
 * @param {{ windowMonths:number, lagMonths:number, yieldRisk:number, yieldTrigger:number, activeRisks:number,
 *   activeTriggers:number, riskMonthly:number[], triggerMonthly:number[] }} spec
 * @param {{ B:number, seed:number|string }} opts
 */
export function windowCards(spec, opts) {
  const { windowMonths, lagMonths, yieldRisk, yieldTrigger, activeRisks, activeTriggers, riskMonthly, triggerMonthly } =
    spec;
  if (!Number.isInteger(windowMonths) || windowMonths < 0) throw new RangeError('windowMonths must be an integer >= 0');
  if (!Number.isInteger(lagMonths) || lagMonths < 0) throw new RangeError('lagMonths must be an integer >= 0');
  if (!(yieldRisk > 0 && yieldRisk <= 1) || !(yieldTrigger > 0 && yieldTrigger <= 1)) {
    throw new RangeError('yields must be in (0, 1]');
  }
  if (riskMonthly.length === 0 || riskMonthly.length !== triggerMonthly.length) {
    throw new RangeError('riskMonthly and triggerMonthly must be non-empty and equally long');
  }
  if (!Number.isInteger(opts.B) || opts.B < 1) throw new RangeError('B must be a positive integer');

  const eligible = Math.max(0, windowMonths - lagMonths);
  const rng = makeRng(opts.seed);
  const cardsRisk = [];
  const cardsTrigger = [];
  const newRisks = [];
  const newTriggers = [];
  for (let b = 0; b < opts.B; b++) {
    let nr = 0;
    let nt = 0;
    for (let j = 0; j < eligible; j++) {
      const m = rng.int(riskMonthly.length);
      nr += riskMonthly[m];
      nt += triggerMonthly[m];
    }
    newRisks.push(nr);
    newTriggers.push(nt);
    cardsRisk.push((activeRisks + nr) * yieldRisk);
    cardsTrigger.push((activeTriggers + nt) * yieldTrigger);
  }
  return {
    risk: summarise(cardsRisk),
    trigger: summarise(cardsTrigger),
    newRisks: summarise(newRisks),
    newTriggers: summarise(newTriggers),
  };
}

/**
 * Projection for a pilot that starts now: the window at 6, 12 and 24 months, with the lag and yields from
 * assumptions.json and the active counts from the radar. Synthetic projection on real arrivals.
 * @param {{ resolutionLagMonths:number, yieldRisk:number, yieldTrigger:number }} params
 * @param {{ riskMonthly:number[], triggerMonthly:number[] }} arrivals from arrivalsFromRadar
 * @param {{ B:number, seed:number|string }} opts
 */
export function projectCalendar(params, arrivals, opts) {
  const active = loadHistorical().active;
  return [6, 12, 24].map((windowMonths) => ({
    windowMonths,
    eligibleMonths: Math.max(0, windowMonths - params.resolutionLagMonths),
    ...windowCards(
      {
        windowMonths,
        lagMonths: params.resolutionLagMonths,
        yieldRisk: params.yieldRisk,
        yieldTrigger: params.yieldTrigger,
        activeRisks: active.risks,
        activeTriggers: active.triggers,
        riskMonthly: arrivals.riskMonthly,
        triggerMonthly: arrivals.triggerMonthly,
      },
      opts,
    ),
  }));
}

/**
 * Months until the pilot reaches N comparable cards, at a constant arrival rate. Raw risks needed are N / yield; the
 * `current` raw risks (active now) are already on the Radar.
 * @param {number} N target comparable cards
 * @param {{ yield:number, current:number, ratePerMonth:number }} spec
 * @returns {number} whole months, 0 if already reached
 */
export function monthsToN(N, spec) {
  if (!(N > 0) || !(spec.yield > 0 && spec.yield <= 1) || !(spec.ratePerMonth > 0)) {
    throw new RangeError('monthsToN needs N > 0, yield in (0, 1] and a positive rate');
  }
  const need = N / spec.yield - spec.current;
  return need <= 0 ? 0 : Math.ceil(need / spec.ratePerMonth);
}
