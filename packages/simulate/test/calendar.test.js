// SYNTHETIC projection on real arrival counts. Nothing here is a pilot result.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { arrivalsFromRadar, windowCards, projectCalendar, monthsToN } from '../src/calendar.js';
import { resolveParams } from '../src/params.js';

const RADAR_FILE = new URL('../../../data/risk-radar.json', import.meta.url);

/** A radar record with the given dated trigger entries (ISO dates). Only the fields the arrival proxy reads. */
function record(id, dates) {
  return {
    id,
    title: 'fixture',
    country: 'X',
    iso: 'AFG',
    status: 'Active',
    outcome: null,
    probability: 'Medium',
    triggerList: dates.map((d, i) => ({ triggerId: `${id}-T${i}`, title: 't', dateEnteredISO: d })),
  };
}

/*
 * Hand-computed fixture. Dated risks and their first entry:
 *   R0001 triggers 2024-02-29, 2024-02-28 → first Feb 2024 (Feb 28); 2 triggers, both Feb.
 *   R0002 trigger  2024-04-01             → first Apr 2024.
 *   R0003 no triggers                     → undated, excluded from rates.
 *   R0004 triggers 2024-06-02, 2024-04-30 → first Apr 2024 (Apr 30); triggers Apr and Jun.
 *   R0005 trigger  2024-03-01             → first Mar 2024 (leap-day boundary: Feb 29 is Feb, Mar 1 is Mar).
 * Months Feb..Jun 2024 (5 months).
 * Risk arrivals   Feb 1, Mar 1, Apr 2, May 0, Jun 0  → sum 4.
 * Trigger entries Feb 2, Mar 1, Apr 2, May 0, Jun 1  → sum 6.
 * Rank correlation: ids 1,2,4,5 vs first dates Feb28, Apr1, Apr30, Mar1 → ranks [1,3,4,2] against [1,2,3,4]:
 *   Pearson = 2 / 5 = 0.4.
 */
const FIXTURE = [
  record('R0001', ['2024-02-29', '2024-02-28']),
  record('R0002', ['2024-04-01']),
  record('R0003', []),
  record('R0004', ['2024-06-02', '2024-04-30']),
  record('R0005', ['2024-03-01']),
];

test('fixture: monthly risk and trigger counts equal the hand computation', () => {
  const a = arrivalsFromRadar(FIXTURE);
  assert.deepEqual(a.months, ['2024-02', '2024-03', '2024-04', '2024-05', '2024-06']);
  assert.deepEqual(a.riskMonthly, [1, 1, 2, 0, 0]);
  assert.deepEqual(a.triggerMonthly, [2, 1, 2, 0, 1]);
  assert.equal(a.undatedRisks, 1);
  assert.equal(a.undatedTriggers, 0);
});

test('fixture: rank correlation of id order with first entry date equals the hand value 0.4', () => {
  assert.ok(Math.abs(arrivalsFromRadar(FIXTURE).rankCorrelationIdVsDate - 0.4) < 1e-12);
});

test('fixture: an impossible ISO date (month 13) is malformed input and throws', () => {
  const bad = [record('R0009', ['2024-13-01'])];
  assert.throws(() => arrivalsFromRadar(bad), /not a valid ISO date/);
});

test('real radar: 33 months, 108 dated risks, 266 triggers; rates and rank correlation within tolerance of the spec', () => {
  const raw = JSON.parse(readFileSync(RADAR_FILE, 'utf8'));
  const a = arrivalsFromRadar(raw);
  const sum = (xs) => xs.reduce((s, x) => s + x, 0);
  const last12 = (xs) => sum(xs.slice(-12));

  assert.equal(a.months.length, 33);
  assert.equal(a.months[0], '2024-02');
  assert.equal(a.months.at(-1), '2026-10');
  assert.equal(sum(a.riskMonthly), 108);
  assert.equal(sum(a.triggerMonthly), 266);
  assert.equal(a.undatedRisks, 31);
  assert.equal(last12(a.riskMonthly), 49);
  assert.equal(last12(a.triggerMonthly), 129);

  const rates = {
    risksPerMonth: sum(a.riskMonthly) / 33,
    risksPerMonthLast12: last12(a.riskMonthly) / 12,
    triggersPerMonth: sum(a.triggerMonthly) / 33,
    triggersPerMonthLast12: last12(a.triggerMonthly) / 12,
    rankCorrelation: a.rankCorrelationIdVsDate,
  };
  // Spec §2 (RAN, prototype rate.mjs / rate2.mjs): 3.27, 4.08, 8.06, 10.75, Spearman 0.952.
  const spec = { risksPerMonth: 3.27, risksPerMonthLast12: 4.08, triggersPerMonth: 8.06, triggersPerMonthLast12: 10.75, rankCorrelation: 0.952 };
  for (const key of Object.keys(spec)) {
    const tol = key === 'rankCorrelation' ? 0.01 : 0.005;
    assert.ok(Math.abs(rates[key] - spec[key]) <= tol, `${key}: recomputed ${rates[key]} vs spec ${spec[key]}`);
  }
  console.log(
    `real arrivals: risks/month ${rates.risksPerMonth.toFixed(4)} (last 12 ${rates.risksPerMonthLast12.toFixed(4)}); ` +
      `triggers/month ${rates.triggersPerMonth.toFixed(4)} (last 12 ${rates.triggersPerMonthLast12.toFixed(4)}); ` +
      `rank correlation ${rates.rankCorrelation.toFixed(4)}`,
  );
});

test('constant monthly series: window cards are exactly (active + new) × yield, new = eligible months × monthly count', () => {
  const flat = (v) => [v, v, v, v];
  // W = 6, lag 3: 3 eligible months, 2 risks and 5 triggers a month → 6 new risks, 15 new triggers.
  const spec = {
    windowMonths: 6,
    lagMonths: 3,
    yieldRisk: 0.6,
    yieldTrigger: 0.5,
    activeRisks: 28,
    activeTriggers: 76,
    riskMonthly: flat(2),
    triggerMonthly: flat(5),
  };
  const r = windowCards(spec, { B: 200, seed: 1 });
  assert.equal(r.newRisks.median, 6);
  assert.equal(r.newTriggers.median, 15);
  assert.ok(Math.abs(r.risk.median - (28 + 6) * 0.6) < 1e-12);
  assert.ok(Math.abs(r.trigger.median - (76 + 15) * 0.5) < 1e-12);
  assert.equal(r.risk.lo, r.risk.hi);
});

test('yield multiplies the cards: doubling the risk yield doubles the risk cards', () => {
  const base = {
    windowMonths: 12,
    lagMonths: 3,
    yieldRisk: 0.3,
    yieldTrigger: 0.5,
    activeRisks: 28,
    activeTriggers: 76,
    riskMonthly: [3, 3, 3, 3],
    triggerMonthly: [9, 9, 9, 9],
  };
  const low = windowCards(base, { B: 50, seed: 2 });
  const high = windowCards({ ...base, yieldRisk: 0.6 }, { B: 50, seed: 2 });
  assert.ok(Math.abs(high.risk.median - 2 * low.risk.median) < 1e-9);
  // Trigger cards keep their own yield: unchanged by yieldRisk.
  assert.equal(high.trigger.median, low.trigger.median);
});

test('every extra lag month lowers the cards (constant series: exactly 0.6 × 4 fewer cards per month of lag)', () => {
  const spec = (lag) => ({
    windowMonths: 12,
    lagMonths: lag,
    yieldRisk: 0.6,
    yieldTrigger: 0.5,
    activeRisks: 28,
    activeTriggers: 76,
    riskMonthly: [3, 3, 3, 3],
    triggerMonthly: [9, 9, 9, 9],
  });
  const lag3 = windowCards(spec(3), { B: 20, seed: 3 }).risk.median;
  const lag4 = windowCards(spec(4), { B: 20, seed: 3 }).risk.median;
  assert.ok(Math.abs(lag3 - (28 + 27) * 0.6) < 1e-12);
  assert.ok(Math.abs(lag4 - (28 + 24) * 0.6) < 1e-12);
  assert.ok(lag4 < lag3);
});

test('month-bootstrap is reproducible: same seed gives identical bounds, another seed differs', () => {
  const raw = JSON.parse(readFileSync(RADAR_FILE, 'utf8'));
  const a = arrivalsFromRadar(raw);
  const spec = {
    windowMonths: 12,
    lagMonths: 3,
    yieldRisk: 0.6,
    yieldTrigger: 0.5,
    activeRisks: 28,
    activeTriggers: 76,
    riskMonthly: a.riskMonthly,
    triggerMonthly: a.triggerMonthly,
  };
  const first = windowCards(spec, { B: 2000, seed: 7 });
  assert.deepEqual(windowCards(spec, { B: 2000, seed: 7 }), first);
  assert.notDeepEqual(windowCards(spec, { B: 2000, seed: 8 }), first);
});

test('real radar: 12-month window at yield 0.6 (spec §2: 34 [25, 47]; 9 eligible months, new risks 29 [13, 50]) holds', () => {
  const a = arrivalsFromRadar(JSON.parse(readFileSync(RADAR_FILE, 'utf8')));
  const base = { lagMonths: 3, yieldRisk: 0.6, yieldTrigger: 0.5, activeRisks: 28, activeTriggers: 76, riskMonthly: a.riskMonthly, triggerMonthly: a.triggerMonthly };
  const w12 = windowCards({ ...base, windowMonths: 12 }, { B: 20000, seed: 7 });
  console.log(
    `12-month window, yield 0.6: cards median ${w12.risk.median.toFixed(1)} [${w12.risk.lo.toFixed(1)}, ${w12.risk.hi.toFixed(1)}]; ` +
      `new risks ${w12.newRisks.median} [${w12.newRisks.lo.toFixed(1)}, ${w12.newRisks.hi.toFixed(1)}]`,
  );
  assert.ok(Math.abs(w12.risk.median - 34) <= 1, `median ${w12.risk.median}`);
  assert.ok(Math.abs(w12.risk.lo - 25) <= 3, `lo ${w12.risk.lo}`);
  assert.ok(Math.abs(w12.risk.hi - 47) <= 3, `hi ${w12.risk.hi}`);
  assert.ok(Math.abs(w12.newRisks.median - 29) <= 2, `new risks median ${w12.newRisks.median}`);
  assert.ok(Math.abs(w12.newRisks.lo - 13) <= 3, `new risks lo ${w12.newRisks.lo}`);
  assert.ok(Math.abs(w12.newRisks.hi - 50) <= 3, `new risks hi ${w12.newRisks.hi}`);
});

test('projection by month 6, 12 and 24 at the assumptions.json yields (spec §2 tables, tolerance stated per cell)', () => {
  const params = resolveParams();
  const a = arrivalsFromRadar(JSON.parse(readFileSync(RADAR_FILE, 'utf8')));
  const rows = projectCalendar(params, a, { B: 20000, seed: 7 });
  const spec = {
    6: { risk: 22, riskLo: 18, riskHi: 31, trigger: 49, triggerLo: 40, triggerHi: 68 },
    12: { risk: 34, riskLo: 25, riskHi: 47, trigger: 73, triggerLo: 55, triggerHi: 101 },
    24: { risk: 58, riskLo: 43, riskHi: 76, trigger: 121, triggerLo: 90, triggerHi: 163 },
  };
  for (const row of rows) {
    const s = spec[row.windowMonths];
    console.log(
      `month ${row.windowMonths}: risk cards ${row.risk.median.toFixed(1)} [${row.risk.lo.toFixed(1)}, ${row.risk.hi.toFixed(1)}]; ` +
        `trigger cards ${row.trigger.median.toFixed(1)} [${row.trigger.lo.toFixed(1)}, ${row.trigger.hi.toFixed(1)}]; ` +
        `eligible months ${row.eligibleMonths}`,
    );
    assert.ok(Math.abs(row.risk.median - s.risk) <= 2, `risk median at ${row.windowMonths}`);
    assert.ok(Math.abs(row.risk.lo - s.riskLo) <= 3, `risk lo at ${row.windowMonths}`);
    assert.ok(Math.abs(row.risk.hi - s.riskHi) <= 3, `risk hi at ${row.windowMonths}`);
    assert.ok(Math.abs(row.trigger.median - s.trigger) <= 3, `trigger median at ${row.windowMonths}`);
    assert.ok(Math.abs(row.trigger.lo - s.triggerLo) <= 4, `trigger lo at ${row.windowMonths}`);
    assert.ok(Math.abs(row.trigger.hi - s.triggerHi) <= 6, `trigger hi at ${row.windowMonths}`);
  }
});

test('monthsToN: 100 comparable cards at yield 0.6 from 28 active take 34 months at 4.1 a month (spec: 50 / 34 / 29)', () => {
  const at = (rate) => monthsToN(100, { yield: 0.6, current: 28, ratePerMonth: rate });
  assert.ok(Math.abs(at(4.1) - 34) <= 1);
  assert.ok(Math.abs(at(2.8) - 50) <= 1);
  assert.ok(Math.abs(at(4.8) - 29) <= 1);
  assert.equal(monthsToN(10, { yield: 0.6, current: 28, ratePerMonth: 4.1 }), 0);
});
