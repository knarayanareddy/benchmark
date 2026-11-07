#!/usr/bin/env node
// Runs the power study: validation, calendar, the analyses, the sensitivity sweeps, then writes the CSVs, SVG figures,
// manifest and report to packages/simulate/out/<runId>/ (git-ignored). Usage:
//   node packages/simulate/bin/run.mjs [--quick] [--seed N] [--out DIR]
// Exits 1 if any validation check fails. Prints where it stopped if the time guard trips.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolveParams, paramTable } from '../src/params.js';
import { loadAssumptions, reviewSummary } from '../src/assumptions.js';
import { loadHistorical } from '../src/data.js';
import { arrivalsFromRadar, projectCalendar, monthsToN } from '../src/calendar.js';
import { estimatePower, ciHalfWidth, n80, runAbsoluteGrid } from '../src/power.js';
import { solveSigma, headroomTable } from '../src/population.js';
import { runValidation, renderValidation, RANGES } from '../src/validate.js';
import { secondStagePower, populationAucs } from '../src/secondstage.js';
import { powerRound2 } from '../src/round2.js';
import { simulateCorrPower, fisherN } from '../src/crosscorr.js';
import { calibrationPrecision } from '../src/calibration.js';
import { strataSupply } from '../src/strata.js';
import { runSensitivity } from '../src/sensitivity.js';
import { writeCsv } from '../src/csv.js';
import { lineChartSvg, barChartSvg, calendarChartSvg, heatmapSvg } from '../src/charts.js';
import { renderReport } from '../src/report.js';
import { makeGuard } from '../src/budget.js';
import { BANNER, REAL_BANNER } from '../src/label.js';
import { wilson } from '@benchmark/core/stats';

const SIM_ROOT = fileURLToPath(new URL('..', import.meta.url));
const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const QUICK_BUDGET_SEC = 90;
const FULL_BUDGET_SEC = 540;

/** Target gains over the base rate for the absolute-accuracy grid (power-spec §A.8 and Analysis 1). */
const GAIN_TARGETS = Object.freeze([0.02, 0.03, 0.04, 0.06]);

/** @param {string[]} argv */
export function parseArgs(argv) {
  const opts = { quick: false, seed: 20261107, out: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--quick') opts.quick = true;
    else if (a === '--seed') {
      const n = Number(argv[++i]);
      if (!Number.isInteger(n)) throw new RangeError(`--seed needs an integer, got ${argv[i]}`);
      opts.seed = n;
    } else if (a === '--out') {
      opts.out = argv[++i];
      if (!opts.out) throw new RangeError('--out needs a directory');
    } else throw new RangeError(`unknown option ${a}; use [--quick] [--seed N] [--out DIR]`);
  }
  return opts;
}

/** The run folder name: YYYYMMDD-seed<seed>, with -quick for the quick form so a full run is never overwritten. */
export function runIdFor({ seed, quick }, date = new Date()) {
  const ymd = date.toISOString().slice(0, 10).replace(/-/g, '');
  return `${ymd}-seed${seed}${quick ? '-quick' : ''}`;
}

/** A hash of the simulator's source, so a manifest says which code produced it. */
function codeHash() {
  const h = createHash('sha256');
  const dir = join(SIM_ROOT, 'src');
  for (const f of ['assumptions.js', 'budget.js', 'calendar.js', 'calibration.js', 'charts.js', 'crosscorr.js', 'csv.js', 'cluster.js',
    'data.js', 'endpoint.js', 'label.js', 'model.js', 'params.js', 'population.js', 'power.js', 'report.js', 'rng.js', 'round2.js',
    'secondstage.js', 'sensitivity.js', 'strata.js', 'triggers.js', 'validate.js']) {
    try {
      h.update(f).update(readFileSync(join(dir, f)));
    } catch {
      h.update(`${f}:missing`);
    }
  }
  return h.digest('hex').slice(0, 16);
}

/**
 * Runs the whole study. Every section is guarded: once the time budget is spent the remaining sections are skipped and
 * named in the result.
 * @param {{ quick?: boolean, seed?: number, outDir?: string, budgetSec?: number, clock?: () => number, sensitivity?: typeof runSensitivity, log?: (s: string) => void }} [opts]
 */
export async function runAll(opts = {}) {
  const quick = opts.quick === true;
  const seed = opts.seed ?? 20261107;
  const budgetSec = opts.budgetSec ?? (quick ? QUICK_BUDGET_SEC : FULL_BUDGET_SEC);
  const log = opts.log ?? ((s) => console.log(s));
  const runId = runIdFor({ seed, quick });
  const outDir = opts.outDir ?? join(SIM_ROOT, 'out', runId);
  const guard = makeGuard({ budgetSec, clock: opts.clock });
  const assumptions = loadAssumptions();
  const review = reviewSummary(assumptions);
  const params = resolveParams({});
  const R = quick ? 60 : 400;
  /** @type {Record<string, unknown>} */
  const results = { parameters: paramTable(params).map((e) => ({ key: e.key, value: e.value })) };
  /** @type {string[]} */
  const skipped = [];
  /** @type {Record<string, number>} */
  const replicates = {};
  const startSec = guard.elapsedSec();

  /** @param {string} name @param {() => any} fn */
  const section = (name, fn) => {
    if (guard.shouldStop(name)) {
      skipped.push(name);
      log(`  skipped ${name}: time budget of ${budgetSec} s spent`);
      return undefined;
    }
    const t = guard.elapsedSec();
    const out = fn();
    log(`  ${name}: ${(guard.elapsedSec() - t).toFixed(1)} s`);
    return out;
  };

  log(`Run ${runId}${quick ? ' (quick)' : ''}, seed ${seed}, budget ${budgetSec} s`);

  // 1. Validation (its own counts; the full form uses the real paired() interval for the size check).
  const validation = section('validation', () => runValidation({ quick, seed }));
  results.validation = validation ?? [];

  // 2. Calendar: real arrivals, synthetic projection.
  const radar = JSON.parse(readFileSync(join(REPO_ROOT, 'data/risk-radar.json'), 'utf8'));
  const arrivals = arrivalsFromRadar(radar);
  const hist = loadHistorical();
  section('calendar', () => {
    const windows = projectCalendar(params, arrivals, { B: quick ? 4000 : 20000, seed });
    results.calendar = { windows, rankCorrelation: arrivals.rankCorrelationIdVsDate, arrivals, activeRisks: hist.active.risks };
    replicates.calendar = quick ? 4000 : 20000;
  });

  // 3. Absolute accuracy (Analysis 1): iid risk cards with a gain-targeted sigma per (gain, k). k = 8 for every gain;
  // k = 3 and 15 at gain 0.03 only, to keep the quick run inside its budget.
  section('absolute', () => {
    const Ns = [20, 30, 50, 76, 104, 150, 200];
    const cells = [...GAIN_TARGETS.map((g) => [g, 8]), [0.03, 3], [0.03, 15]];
    const rows = [];
    for (const [gain, k] of cells) {
      const s = solveSigma(gain, params, { benchmark: 'base_rate', M: quick ? 4000 : 20000, seed, k, cards: 'risk' });
      if (!s.attainable) continue;
      const p = resolveParams({ ...Object.fromEntries(paramTable(params).map((e) => [e.key, e.value])), sigma: s.sigma });
      const curve = estimatePower({ params: p, N: Ns, k, endpoint: 'absolute', tier: 'fast', cards: 'risk', benchmark: 'in_sample_base_rate', scenario: `abs-g${gain}-k${k}` }, { R, seed });
      const n = n80(curve.map((r) => ({ N: r.N, power: r.power, lo: r.lo, hi: r.hi })));
      for (const r of curve) rows.push({ gain, k, N: r.N, sigma: s.sigma, power: r.power, lo: r.lo, hi: r.hi, n80: n.n80 === null ? null : Math.ceil(n.n80), n80Lo: n.lo === null ? null : Math.ceil(n.lo), n80Hi: n.hi === null ? null : Math.ceil(n.hi), R });
    }
    replicates.absolute = R;
    results.absolute = { rows: rows.filter((r) => r.gain === 0.03 && r.k === 8), all: rows };
  });
  // Nested trigger cards at coupling 0.3 and 0.7, gain 0.03, k = 8 (fixed-skill sigma, §B.3b).
  section('nested', () => {
    const grid = runAbsoluteGrid(params, { gains: [0.03], ks: [8], Ns: [76, 149], couplings: [0.3, 0.7] }, {
      R: quick ? 60 : 300,
      seed,
      sigmaFor: () => params.sigmaRefTrigger,
    });
    results.absolute = { ...(results.absolute ?? {}), nested: grid };
    replicates.nested = quick ? 60 : 300;
  });

  // 4. Panel against ACAPS (Analysis 2): fixed-skill power curve and the real-interval half-widths.
  section('vsAcaps', () => {
    const Ns = [24, 28, 39, 58, 104];
    const p = resolveParams({ ...Object.fromEntries(paramTable(params).map((e) => [e.key, e.value])), sigma: params.sigmaRef });
    const hw = ciHalfWidth({ params: p, k: 8 }, Ns, { R: quick ? 40 : 400, seed, reps: quick ? 2000 : 10000 });
    const rows = hw.map((x) => ({
      N: x.N,
      medianHalfWidth: x.medianHalfWidth,
      p25: x.p25,
      p75: x.p75,
      power: x.power,
      powerLo: wilson(Math.round(x.power * (quick ? 40 : 400)), quick ? 40 : 400)?.lo ?? null,
      powerHi: wilson(Math.round(x.power * (quick ? 40 : 400)), quick ? 40 : 400)?.hi ?? null,
      calendarMonths: monthsToN(x.N, { yield: params.yieldRisk, current: hist.active.risks, ratePerMonth: 4.1 }),
    }));
    results.vsAcaps = { rows };
    replicates.vsAcaps = quick ? 40 : 400;
  });

  // 5. Second stage (Analysis 3): trigger forecasts combined into a risk forecast.
  section('secondStage', () => {
    const rows = [];
    const Rs = quick ? 15 : 200;
    const B2 = quick ? 100 : 200;
    for (const rho of [0.1, 0.3, 0.5, 0.8]) {
      for (const rule of ['max', 'noisy_or', 'mean']) {
        for (const N of [28, 100]) {
          const pp = resolveParams({ rhoLatent: rho });
          const out = secondStagePower({ params: pp, G: N, rule }, { R: Rs, B: B2, seed });
          rows.push({ rho, rule, N, power: out.power, meanDAuc: out.meanDAuc, halfWidth: out.halfWidth });
        }
      }
    }
    const pop = populationAucs(resolveParams({ rhoLatent: 0.3 }), { G: quick ? 10000 : 30000, seed });
    results.secondStage = { rows, population: { acaps: pop.acaps, direct: pop.direct, mean: pop.mean } };
    replicates.secondStage = Rs;
  });

  // 6. Sensitivity sweeps S1 to S12 (Analysis 4). Its own guard scales the replicate counts.
  const sensitivityRun = section('sensitivity', () => {
    const run = opts.sensitivity ?? runSensitivity;
    const out = run({}, { quick, R: quick ? 50 : 1000, seed, budgetSec: Math.max(5, budgetSec - (guard.elapsedSec() - startSec) - 10) });
    results.sensitivity = { rows: out.rows, scale: out.plan.scale, skipped: out.skipped };
    replicates.sensitivity = out.plan.requestedR;
    return out;
  });
  if (sensitivityRun === undefined) results.sensitivity = { reason: 'the time budget was spent before the sweeps' };

  // 7. Round 2 and the second look (Analysis 5).
  section('round2', () => {
    const rows = [];
    const Rr = quick ? 60 : 300;
    for (const lambda of [0.15, 0.3]) {
      for (const N of [20, 40, 80]) {
        const out = powerRound2({ params: resolveParams({ lambdaAcaps: lambda }), N, k: 8, armA: 'acaps_view', armB: 'control' }, { R: Rr, B: 200, seed });
        rows.push({ lambda, N, k: 8, power: out.power, lo: out.lo, hi: out.hi, fracWithheld: out.fracWithheld });
      }
    }
    const nul = powerRound2({ params, N: 40, k: 8, armA: 'balanced', armB: 'control' }, { R: quick ? 300 : 1000, B: 200, seed });
    results.round2 = { rows, nullRate: nul.anySignificant };
    replicates.round2 = Rr;
  });

  // 8. Cross-question correlation (Analysis 6): idealised and noisy panels, plus the spurious-correlation null.
  section('crosscorr', () => {
    const Rc = quick ? 1000 : 4000;
    const Ns = [29, 37, 50, 58, 80, 105, 112, 150];
    const models = [
      { name: 'Idealised: independent pairs', noise: null, reliability: 1 },
      { name: 'Panel noise, reliability 0.89', noise: 0.89 },
      { name: 'Panel noise, reliability 0.72', noise: 0.72 },
      { name: 'Panel noise, reliability 0.53', noise: 0.53 },
    ];
    const rows = models.map((m) => {
      const curve = Ns.map((n) => {
        const spec = { n, rho: 0.5, alpha: 0.05 };
        if (m.noise !== null) {
          // Reliability R = 1 / (1 + σ²(icc + (1 − icc)/k)) for latent variance 1 (Analysis 6 model 1).
          const icc = params.icc;
          const sigma = Math.sqrt((1 / m.noise - 1) / (icc + (1 - icc) / 8));
          spec.noise = { sigma, icc, k: 8 };
        }
        return { N: n, power: simulateCorrPower(spec, { R: Rc, seed }).power };
      });
      const hit = curve.find((c) => c.power >= 0.8);
      return { name: m.name, n80: hit ? hit.N : null, powerAt29: curve[0].power, curve };
    });
    // Spurious null: no link, but a shared narrative error (rhoShared 0.4) in noisy panel forecasts (Analysis 6 model 2).
    // The shared term only acts when panel noise is on, so the null carries a reliability-0.72 noise model.
    const spurSigma = Math.sqrt((1 / 0.72 - 1) / (params.icc + (1 - params.icc) / 8));
    const spur = simulateCorrPower({ n: 60, rho: 0, alpha: 0.05, rhoShared: 0.4, noise: { sigma: spurSigma, icc: params.icc, k: 8 } }, { R: Rc, seed });
    results.crosscorr = { rows, fisher: { n80: fisherN(0.5, 0.05, 0.8), n80Multiple: fisherN(0.5, 0.05 / 15, 0.8) }, spuriousRate: spur.power, spuriousShare: 0.4 };
    replicates.crosscorr = Rc;
  });

  // 9. Calibration (folded into Analysis 1).
  section('calibration', () => {
    const rows = [];
    const Rk = quick ? 30 : 200;
    for (const N of [100, 200, 400, 800]) {
      const out = calibrationPrecision({ params: resolveParams({ sigma: params.sigmaRef }), N, k: 8 }, { R: Rk, seed });
      rows.push({ N, slopeMean: out.slopeMean, slopePower: out.slopePower, medianSmallestBin: out.medianSmallestBin, medianWorstHalfWidth: out.medianWorstHalfWidth });
    }
    results.calibration = { rows };
    replicates.calibration = Rk;
  });

  // 10. Strata and the headroom table.
  section('strata', () => {
    results.strata = strataSupply(radar);
    results.headroom = headroomTable(params, [0.75, 1, 1.25, 1.5]);
  });

  // Derived figures for the report.
  results.dropout = {
    K: params.K,
    dropout: params.dropout,
    floor: params.floor,
    share: betaBinomialShare(params),
  };

  // Write everything.
  const meta = { seed, runId, quick };
  const written = [];
  mkdirSync(outDir, { recursive: true });
  const csv = (name, rows, real = false) => {
    const file = join(outDir, name);
    writeCsv(file, rows, { ...meta, real });
    written.push(name);
  };
  csv('SYNTHETIC-validation.csv', validation.map((c) => ({ id: c.id, name: c.name, pass: c.pass, expected: c.expected, detail: c.detail })));
  writeFileSync(join(outDir, 'SYNTHETIC-validation.md'), `${renderValidation(validation)}\n`);
  written.push('SYNTHETIC-validation.md');
  if (results.calendar) {
    csv('SYNTHETIC-calendar.csv', results.calendar.windows.map((w) => ({
      windowMonths: w.windowMonths, eligibleMonths: w.eligibleMonths,
      risk_median: w.risk.median, risk_lo: w.risk.lo, risk_hi: w.risk.hi,
      trigger_median: w.trigger.median, trigger_lo: w.trigger.lo, trigger_hi: w.trigger.hi,
    })));
    csv('REAL-arrivals.csv', arrivals.months.map((m, i) => ({ month: m, newRisks: arrivals.riskMonthly[i], newTriggers: arrivals.triggerMonthly[i] })), true);
  }
  if (results.absolute) {
    csv('SYNTHETIC-absolute-grid.csv', results.absolute.all.map((r) => ({ gain_target: r.gain, k: r.k, N: r.N, sigma: r.sigma, power: r.power, lo: r.lo, hi: r.hi, n80: r.n80, R: r.R })));
    if (results.absolute.nested) csv('SYNTHETIC-absolute-nested.csv', results.absolute.nested);
  }
  if (results.vsAcaps) csv('SYNTHETIC-vs-acaps-halfwidth.csv', results.vsAcaps.rows);
  if (results.secondStage) csv('SYNTHETIC-second-stage.csv', results.secondStage.rows);
  if (results.sensitivity?.rows) csv('SYNTHETIC-sensitivity.csv', results.sensitivity.rows.map(({ label, synthetic, ...rest }) => rest));
  if (results.round2) csv('SYNTHETIC-round2-grid.csv', results.round2.rows);
  if (results.crosscorr) csv('SYNTHETIC-crosscorr.csv', results.crosscorr.rows.map((x) => ({ name: x.name, n80: x.n80, powerAt29: x.powerAt29 })));
  if (results.calibration) csv('SYNTHETIC-calibration.csv', results.calibration.rows);
  if (results.headroom) csv('SYNTHETIC-headroom.csv', results.headroom);
  if (results.strata) csv('REAL-strata-supply.csv', results.strata.byRegionTheme.map((c) => ({ region: c.region, theme: c.theme, risks: c.risks, active: c.active, activeTriggers: c.activeTriggers })), true);
  csv('REAL-historical-bins.csv', hist.bandCounts.map((n, b) => {
    const w = wilson(hist.bandHits[b], n);
    return { band: b, rated: n, materialised: hist.bandHits[b], rate: hist.bandRates[b], lo: w.lo, hi: w.hi };
  }), true);

  // Figures.
  const figs = [];
  const fig = (name, svg) => {
    writeFileSync(join(outDir, name), `${svg}\n`);
    figs.push(name);
    written.push(name);
  };
  if (results.absolute?.rows?.length) {
    fig('SYNTHETIC-fig-absolute-power.svg', lineChartSvg({
      title: 'Power against cards, absolute accuracy over the base rate (8 answers per card)',
      desc: 'Chance of detecting a gain of 0.03 Brier points over the base rate, rising with the number of cards, with Monte Carlo bands.',
      xLabel: 'Risk cards (N)', yLabel: 'Power',
      series: [{ name: 'gain 0.03', points: results.absolute.rows.map((r) => ({ x: r.N, y: r.power, lo: r.lo, hi: r.hi })) }],
      yMin: 0, yMax: 1,
    }));
  }
  if (results.calendar) {
    fig('SYNTHETIC-fig-calendar.svg', calendarChartSvg({
      title: 'Risk cards reachable by window length',
      desc: 'Median and 95 per cent range of risk cards for 6, 12 and 24 month windows, from real arrivals with a synthetic projection.',
      yLabel: 'Risk cards',
      months: results.calendar.windows.map((w) => ({ label: `${w.windowMonths} months`, median: w.risk.median, lo: w.risk.lo, hi: w.risk.hi })),
    }));
  }
  if (sensitivityRun?.rows?.length) {
    fig('SYNTHETIC-fig-sensitivity.svg', barChartSvg({
      title: 'Cards needed for 80% power, by sensitivity setting',
      desc: 'One bar per sweep setting; a missing bar means the setting does not reach 80% in the grid.',
      yLabel: 'Cards needed',
      bars: sensitivityRun.rows.map((r) => ({ label: `${r.sweep} ${r.settingLabel}`, value: r.cardsNeeded80 ?? null, lo: r.n80Lo ?? null, hi: r.n80Hi ?? null })),
    }));
  }
  if (results.strata) {
    const regions = [...new Set(results.strata.byRegionTheme.map((c) => c.region))];
    const themes = [...new Set(results.strata.byRegionTheme.map((c) => c.theme))];
    fig('REAL-fig-strata.svg', heatmapSvg({
      title: 'Risks by region and theme (historical radar counts)',
      desc: 'Count of risks in each region and theme cell, from the radar export. Real counts, not simulated.',
      rows: regions, cols: themes, banner: REAL_BANNER,
      cells: results.strata.byRegionTheme.map((c) => ({ row: c.region, col: c.theme, count: c.risks })),
    }));
  }
  if (results.vsAcaps?.rows?.length) {
    fig('SYNTHETIC-fig-vs-acaps-halfwidth.svg', lineChartSvg({
      title: 'Half-width of the panel-against-ACAPS interval, by risk cards',
      desc: 'Median 95 per cent half-width of the paired Brier difference, with the middle half of replicates as the band.',
      xLabel: 'Risk cards (N)', yLabel: 'Half-width (Brier points)',
      series: [{ name: 'median half-width', points: results.vsAcaps.rows.map((r) => ({ x: r.N, y: r.medianHalfWidth, lo: r.p25, hi: r.p75 })) }],
    }));
  }

  // Report and manifest.
  const elapsedSec = guard.elapsedSec();
  const rScale = [];
  if (sensitivityRun?.plan && sensitivityRun.plan.scale < 1) rScale.push(`Sensitivity replicates reduced by the time guard (scale ${sensitivityRun.plan.scale.toFixed(2)}); error bars widened.`);
  if (skipped.length) rScale.push(`Sections skipped because the time budget was spent: ${skipped.join(', ')}.`);
  const reportText = renderReport(results, { runId, seed, quick, elapsedSec, review, rScale });
  writeFileSync(join(outDir, 'SYNTHETIC-report.md'), reportText);
  written.push('SYNTHETIC-report.md');
  const manifest = {
    label: BANNER,
    runId,
    seed,
    quick,
    codeHash: codeHash(),
    elapsedSec,
    budgetSec,
    guard: guard.report(),
    skipped,
    replicates,
    review,
    parameters: paramTable(params).map((e) => {
      const entry = assumptions.byKey.get(e.key);
      return { key: e.key, value: e.value, default: e.default, status: e.status, register: e.register, reviewState: entry?.review.state ?? null };
    }),
    validation: validation.map((c) => ({ id: c.id, pass: c.pass, value: c.value, expected: c.expected })),
    rangesUsed: RANGES,
    outputs: written,
    figures: figs,
  };
  writeFileSync(join(outDir, 'SYNTHETIC-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  written.push('SYNTHETIC-manifest.json');

  const failed = validation.filter((c) => !c.pass);
  log(`Wrote ${written.length} files to ${outDir}`);
  log(`Validation: ${validation.length - failed.length} of ${validation.length} checks pass.`);
  if (skipped.length) log(`Stopped early: sections skipped after the time budget: ${skipped.join(', ')}.`);
  log(`Elapsed ${elapsedSec.toFixed(1)} s (budget ${budgetSec} s).`);
  return { outDir, elapsedSec, failed: failed.map((c) => c.id), skipped, runId, written };
}

/** The share of cards whose responders reach the floor, from the beta-binomial in params (exact, C.7). */
function betaBinomialShare(params) {
  const m = 1 - params.dropout;
  const a = m * params.dropoutKappa;
  const b = (1 - m) * params.dropoutKappa;
  const K = params.K;
  let total = 0;
  for (let k = params.floor; k <= K; k++) {
    let logp = 0;
    for (let i = 0; i < k; i++) logp += Math.log(a + i);
    for (let i = 0; i < K - k; i++) logp += Math.log(b + i);
    for (let i = 0; i < K; i++) logp -= Math.log(a + b + i);
    let c = 0;
    for (let i = 1; i <= K; i++) c += Math.log(i);
    for (let i = 1; i <= k; i++) c -= Math.log(i);
    for (let i = 1; i <= K - k; i++) c -= Math.log(i);
    total += Math.exp(logp + c);
  }
  return total;
}

// Command line. Importing this file (as the tests do) does not run the study.
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(/** @type {Error} */ (err).message);
    process.exit(2);
  }
  const outDir = opts.out ? resolve(opts.out) : undefined;
  runAll({ ...opts, outDir })
    .then((r) => {
      if (r.failed.length > 0) {
        console.error(`Validation failed: ${r.failed.join(', ')}. See ${join(r.outDir, 'SYNTHETIC-validation.md')}.`);
        process.exit(1);
      }
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}

