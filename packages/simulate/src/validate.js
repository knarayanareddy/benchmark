/**
 * Validation of the simulator itself (power-spec §C). Each check is a function that returns
 * { id, name, pass, value, expected, detail }. runValidation runs them all; renderValidation writes the table that
 * the report prints at the top. Checks take their inputs as arguments so the tests can inject a deliberately broken
 * model or rule and watch the check fail (teeth).
 *
 * Quick and full forms differ only in replicate counts and the tier used for the size check (fast z-decision or the
 * real paired() interval). The real-data check (C.5) reads the repo's own numbers by running scripts/measure-baseline.mjs
 * in a child process and by reading data/baseline-fit.json; no value is typed in here.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { brier, paired as repoPaired } from '@benchmark/core/scoring';
import { resolveParams, paramTable } from './params.js';
import { makeRng, hashSeed } from './rng.js';
import { loadHistorical } from './data.js';
import { makeRiskCards, makeRoster, drawPanel } from './model.js';
import { estimatePower } from './power.js';
import { solveSigma, populationGain } from './population.js';
import { pooledForecast, analyseAbsoluteFast, median } from './endpoint.js';
import { powerRound2 } from './round2.js';
import { fisherN, simulateCorrPower } from './crosscorr.js';
import { populationAucs, simulateSecondStage, aucDifferenceCI } from './secondstage.js';
import { arrivalsFromRadar, windowCards } from './calendar.js';

/** @typedef {{ id:string, name:string, pass:boolean, value:unknown, expected:string, detail:string }} Check */

export const ROOT_URL = new URL('../../../', import.meta.url);
export const RADAR_FILE = new URL('data/risk-radar.json', ROOT_URL);
export const BASELINE_FILE = new URL('data/baseline-fit.json', ROOT_URL);

/** Acceptance ranges (power-spec §C). Exported so the teeth tests and the report use the same numbers. */
export const RANGES = Object.freeze({
  size: [0.03, 0.07],
  correlationPower: [0.77, 0.86],
  correlationTypeI: [0.035, 0.065],
  roundTwoNull: [0.03, 0.075],
  secondStageMeanAuc: [0.47, 0.53],
  dropoutSigmas: 3,
});

const fmt = (x, d = 4) => (typeof x === 'number' ? x.toFixed(d) : String(x));

/**
 * @param {string} id @param {string} name @param {boolean} pass @param {unknown} value
 * @param {string} expected @param {string} detail
 * @returns {Check}
 */
const result = (id, name, pass, value, expected, detail) => ({ id, name, pass, value, expected, detail });

/** Exact binomial-type tail for a beta-binomial(K, a, b): P(k ≥ floorK), by the product form of the pmf. */
export function betaBinomialTail(K, a, b, floorK) {
  /** @param {number} k */
  const pmf = (k) => {
    let logp = 0;
    for (let i = 0; i < k; i++) logp += Math.log(a + i);
    for (let i = 0; i < K - k; i++) logp += Math.log(b + i);
    for (let i = 0; i < K; i++) logp -= Math.log(a + b + i);
    let c = 0;
    for (let i = 1; i <= K; i++) c += Math.log(i);
    for (let i = 1; i <= k; i++) c -= Math.log(i);
    for (let i = 1; i <= K - k; i++) c -= Math.log(i);
    return Math.exp(logp + c);
  };
  let tail = 0;
  for (let k = floorK; k <= K; k++) tail += pmf(k);
  return tail;
}

/**
 * C.1 Size. Solves σ so the population gain of the panel over ACAPS's bands is zero, then counts how often
 * the two-sided decision rejects at N cards. `rejection` maps a result row to a rejection share; the default is the
 * two-sided rule. Injecting a one-sided rule is how the teeth test breaks this check.
 * @param {{ params?: any, N?: number, R?: number, seed?: number, tier?: 'fast'|'real', M?: number,
 *   rejection?: (row: any) => number }} [opts]
 * @returns {Check}
 */
export function checkSize(opts = {}) {
  const params = opts.params ?? resolveParams({});
  const N = opts.N ?? 104;
  const R = opts.R ?? 400;
  const seed = opts.seed ?? 7;
  const tier = opts.tier ?? 'fast';
  const rejection = opts.rejection ?? ((row) => row.power + row.worse);
  const solved = solveSigma(0, params, { benchmark: 'acaps', M: opts.M ?? 8000, seed, k: 8, cards: 'risk' });
  if (!solved.attainable) {
    return result('C.1', 'Size at zero gain', false, null, `${RANGES.size[0]} to ${RANGES.size[1]}`, 'no sigma gives zero gain in the solver range');
  }
  const p = resolveParams({ ...paramValues(params), sigma: solved.sigma });
  const [row] = estimatePower(
    { params: p, N, k: 8, endpoint: 'vs_acaps', tier, cards: 'risk', scenario: 'size' },
    { R, seed },
  );
  const rate = rejection(row);
  const [lo, hi] = RANGES.size;
  return result(
    'C.1',
    'Size: rejection at zero population gain',
    rate >= lo && rate <= hi,
    rate,
    `${lo} to ${hi}`,
    `sigma ${fmt(solved.sigma, 3)} solved for zero gain; N=${N}, R=${R}, tier ${tier}; rejection ${fmt(rate, 3)}`,
  );
}

/** Every key and its current value, read from the parameter table (not only the keys read so far). @param {any} params */
function paramValues(params) {
  return Object.fromEntries(paramTable(params).map((e) => [e.key, e.value]));
}

/**
 * C.2 Planted skill recovered. Solves σ for a target gain over the base rate and checks the achieved gain is within
 * three standard errors of the target.
 * @param {{ params?: any, targets?: number[], M?: number, seed?: number }} [opts]
 * @returns {Check}
 */
export function checkPlantedSkill(opts = {}) {
  const params = opts.params ?? resolveParams({});
  const targets = opts.targets ?? [0.03];
  const seed = opts.seed ?? 7;
  const parts = [];
  let pass = true;
  for (const target of targets) {
    const s = solveSigma(target, params, { benchmark: 'base_rate', M: opts.M ?? 8000, seed, k: 8, cards: 'risk' });
    if (!s.attainable) {
      pass = false;
      parts.push(`target ${target}: unattainable`);
      continue;
    }
    const within = Math.abs(/** @type {number} */ (s.achieved) - target) <= 3 * /** @type {number} */ (s.se);
    pass = pass && within;
    parts.push(`target ${target}: achieved ${fmt(s.achieved)} (se ${fmt(s.se)}), sigma ${fmt(s.sigma, 3)}`);
  }
  return result('C.2', 'Planted skill recovered', pass, parts.length, `within 3 SE of each target`, parts.join('; '));
}

/**
 * C.3 k = 1 reproduces the single expert. With one responder per card the pooled forecast is that expert's report,
 * and the repo's brier() equals the hand mean of squared errors.
 * @param {{ params?: any, cards?: number, seed?: number, pool?: (ps: number[]) => number }} [opts]
 * @returns {Check}
 */
export function checkK1(opts = {}) {
  const params = opts.params ?? resolveParams({});
  const pool = opts.pool ?? median;
  const n = opts.cards ?? 300;
  const rng = makeRng(hashSeed(opts.seed ?? 7, 'check-k1'));
  const roster = makeRoster(params, rng);
  const cards = makeRiskCards(params, rng, n);
  /** @type {Array<{ id:string, p:number, y:number }>} */
  const pairs = [];
  let maxGap = 0;
  let manual = 0;
  for (const card of cards) {
    const panel = drawPanel(card, roster, params, rng.fork(card.id), { kFixed: 1 });
    if (!panel) continue;
    // The in-house pool (pooledForecast applies the aggregate() minimum of 3, which would drop every k = 1 panel).
    const p = pool(panel.ps);
    maxGap = Math.max(maxGap, Math.abs(p - panel.ps[0]));
    const y = /** @type {0|1} */ (card.y);
    pairs.push({ id: card.id, p, y });
    manual += (p - y) ** 2;
  }
  const hand = manual / pairs.length;
  const repo = brier(pairs.map((x) => ({ id: x.id, p: x.p, y: x.y }))).score;
  const gap = Math.abs(repo - hand);
  const pass = gap <= 1e-12 && maxGap === 0;
  return result('C.3', 'k = 1 reproduces the single expert', pass, gap, 'repo brier() equals the hand mean within 1e-12',
    `${pairs.length} cards; |repo - hand| ${gap.toExponential(2)}; pooled-vs-expert gap ${maxGap}`);
}

/**
 * C.4 Monotone. Power does not fall as N grows (tolerance: two Wilson half-widths), and the population gain does not
 * rise as σ rises (less skill).
 * @param {{ params?: any, R?: number, seed?: number, M?: number }} [opts]
 * @returns {Check}
 */
export function checkMonotone(opts = {}) {
  const params = opts.params ?? resolveParams({});
  const R = opts.R ?? 400;
  const seed = opts.seed ?? 7;
  const rows = estimatePower(
    { params, N: [20, 50, 104], k: 8, endpoint: 'absolute', tier: 'fast', cards: 'risk', scenario: 'mono' },
    { R, seed },
  );
  let nOk = true;
  for (let i = 1; i < rows.length; i++) {
    const tol = 2 * (rows[i].halfWidth + rows[i - 1].halfWidth);
    if (rows[i].power < rows[i - 1].power - tol) nOk = false;
  }
  const sigmas = [1.0, 1.53, 2.4];
  const gains = sigmas.map((s) => populationGain({ ...paramValues(params), sigma: s }, { benchmark: 'base_rate', M: opts.M ?? 8000, seed, k: 8 }).gain);
  const gainOk = gains.every((g, i) => i === 0 || g <= gains[i - 1] + 1e-9);
  const power = rows.map((r) => fmt(r.power, 3)).join(' / ');
  return result('C.4', 'Power monotone in N; gain monotone in sigma', nOk && gainOk, { power, gains }, 'non-decreasing',
    `power at N 20/50/104: ${power}; gain at sigma 1.0/1.53/2.4: ${gains.map((g) => fmt(g, 4)).join(' / ')}`);
}

/**
 * C.5 Reproduces the repo's numbers on the real 104 resolved risks. The repo values come from data/baseline-fit.json
 * and from running scripts/measure-baseline.mjs in a child process; the simulator's own computation from the radar must
 * match them to four decimal places.
 * @param {{ runScript?: boolean, baseline?: object }} [opts] baseline defaults to data/baseline-fit.json
 * @returns {Check}
 */
export function checkRealData(opts = {}) {
  const h = loadHistorical();
  const base = opts.baseline ?? JSON.parse(readFileSync(BASELINE_FILE, 'utf8'));
  const constantPairs = h.resolved.map((r) => ({ id: r.id, p: h.base, y: r.y }));
  const acapsPairs = h.resolved.map((r) => ({ id: r.id, p: r.a ?? h.base, y: r.y }));
  const ratedPairs = h.resolved.filter((r) => r.a !== null).map((r) => ({ id: r.id, p: r.a, y: r.y }));
  const ourFloor = brier(constantPairs).score;
  const ourAcaps = brier(acapsPairs).score;
  const ourRated = brier(ratedPairs).score;
  const ourPaired = repoPaired(acapsPairs, constantPairs, { reps: 2000, seed: 7 }).diff;

  const fails = [];
  const check4 = (label, a, b) => {
    if (Math.abs(a - b) >= 0.00005) fails.push(`${label}: ${fmt(a)} vs ${fmt(b)}`);
  };
  check4('naive floor vs baseline-fit.json', ourFloor, base.brier.constant);
  check4('ACAPS midpoint vs baseline-fit.json', ourAcaps, base.brier.acaps);
  check4('base rate', h.base, base.brier.baseRate);
  if (h.n !== 104 || h.rated !== 99) fails.push(`counts: n ${h.n}, rated ${h.rated}`);

  let child = 'not run';
  if (opts.runScript !== false) {
    const run = spawnSync(process.execPath, ['scripts/measure-baseline.mjs'], { cwd: fileURLToPath(ROOT_URL), encoding: 'utf8' });
    if (run.status !== 0) {
      fails.push(`scripts/measure-baseline.mjs exited ${run.status}`);
    } else {
      const floor = /naive floor\s*:\s*([\d.]+)/.exec(run.stdout);
      const acaps = /ACAPS band midpoint:\s*([\d.]+)/.exec(run.stdout);
      const pairedLine = /paired vs floor\s*:\s*(-?[\d.]+)/.exec(run.stdout);
      if (!floor || !acaps || !pairedLine) fails.push('could not read the numbers from measure-baseline.mjs');
      else {
        check4('naive floor vs measure-baseline.mjs', ourFloor, Number(floor[1]));
        check4('ACAPS midpoint vs measure-baseline.mjs', ourAcaps, Number(acaps[1]));
        check4('paired vs floor vs measure-baseline.mjs', ourPaired, Number(pairedLine[1]));
      }
      child = 'ran';
    }
  }
  return result(
    'C.5',
    'Repo numbers reproduced on the real 104 resolved risks',
    fails.length === 0,
    { floor: ourFloor, acaps: ourAcaps, rated: ourRated, paired: ourPaired },
    'floor 0.2425, ACAPS 0.2171, rated 0.2124, to 4 dp',
    `REAL DATA (historical, already resolved), not simulated. floor ${fmt(ourFloor)}, ACAPS ${fmt(ourAcaps)}, rated-99 ${fmt(ourRated)}, paired ${fmt(ourPaired)}; measure-baseline ${child}${fails.length ? `; differences: ${fails.join('; ')}` : ''}`,
  );
}

/**
 * C.6 Fast path equals the real code: the median pooled in-house equals aggregate()'s estimate on every panel.
 * @param {{ params?: any, cards?: number, seed?: number }} [opts]
 * @returns {Check}
 */
export function checkFastEqualsReal(opts = {}) {
  const params = opts.params ?? resolveParams({});
  const n = opts.cards ?? 200;
  const rng = makeRng(hashSeed(opts.seed ?? 7, 'check-c6'));
  const roster = makeRoster(params, rng);
  let compared = 0;
  let mismatches = 0;
  for (const card of makeRiskCards(params, rng, n)) {
    const panel = drawPanel(card, roster, params, rng.fork(card.id), { kFixed: 5 });
    if (!panel) continue;
    const fast = pooledForecast(panel, { method: 'median', extremiseD: 1, floor: 3, viaAggregate: false });
    const real = pooledForecast(panel, { method: 'median', extremiseD: 1, floor: 3, viaAggregate: true });
    compared += 1;
    if (fast !== real) mismatches += 1;
  }
  return result('C.6', 'Fast median equals aggregate()', mismatches === 0 && compared > 0, mismatches,
    '0 mismatches', `${mismatches} mismatches in ${compared} panels`);
}

/**
 * C.7 Dropout and floor. The share of invited cards whose responders reach the floor matches the exact
 * beta-binomial tail within three standard errors; and no analysed panel is below the floor.
 * @param {{ params?: any, cards?: number, seed?: number }} [opts]
 * @returns {Check}
 */
export function checkDropout(opts = {}) {
  const params = opts.params ?? resolveParams({});
  const n = opts.cards ?? 3000;
  const rng = makeRng(hashSeed(opts.seed ?? 7, 'check-c7'));
  const roster = makeRoster(params, rng);
  const m = 1 - params.dropout;
  const kappa = params.dropoutKappa;
  const expected = betaBinomialTail(params.K, m * kappa, (1 - m) * kappa, params.floor);
  let analysable = 0;
  let belowFloor = 0;
  for (let i = 0; i < n; i++) {
    const card = makeRiskCards(params, rng.fork(`c${i}`), 1)[0];
    const panel = drawPanel(card, roster, params, rng.fork(`p${i}`));
    if (panel) {
      analysable += 1;
      if (panel.ps.length < params.floor) belowFloor += 1;
    }
  }
  const share = analysable / n;
  const se = Math.sqrt((expected * (1 - expected)) / n);
  const pass = Math.abs(share - expected) <= RANGES.dropoutSigmas * se && belowFloor === 0;
  return result('C.7', 'Dropout and floor', pass, share, `${fmt(expected, 3)} ± ${RANGES.dropoutSigmas} SE`,
    `analysable ${fmt(share, 3)} of ${n} (beta-binomial ${fmt(expected, 3)}, K=${params.K}, dropout ${params.dropout}); below floor ${belowFloor}`);
}

/**
 * C.8 Determinism. The same seed gives the identical power table.
 * @param {{ params?: any, R?: number, seed?: number }} [opts]
 * @returns {Check}
 */
export function checkDeterminism(opts = {}) {
  const params = opts.params ?? resolveParams({});
  const spec = { params, N: [30, 60], k: 8, endpoint: 'absolute', tier: 'fast', cards: 'risk', scenario: 'det' };
  const a = JSON.stringify(estimatePower(spec, { R: opts.R ?? 100, seed: opts.seed ?? 7 }));
  const b = JSON.stringify(estimatePower(spec, { R: opts.R ?? 100, seed: opts.seed ?? 7 }));
  return result('C.8', 'Determinism', a === b, a === b, 'identical output for the same seed',
    a === b ? 'two runs with seed 7 are identical' : 'two runs with the same seed differ');
}

/**
 * C.9 Null for the Round-2 estimator. Two arms with the same effect (balanced and control, both λ = 0) must reject at
 * a rate in the size range.
 * @param {{ params?: any, R?: number, B?: number, seed?: number, method?: string }} [opts]
 * @returns {Check}
 */
export function checkRoundTwoNull(opts = {}) {
  const params = opts.params ?? resolveParams({});
  const out = powerRound2(
    { params, N: 40, k: 8, armA: 'balanced', armB: 'control' },
    { R: opts.R ?? 400, B: opts.B ?? 200, seed: opts.seed ?? 7 },
  );
  const rate = out.anySignificant;
  const [lo, hi] = RANGES.roundTwoNull;
  return result('C.9', 'Round-2 null: equal arms reject at the nominal rate', rate >= lo && rate <= hi, rate,
    `${lo} to ${hi}`, `two arms with no effect: any-direction rejection ${fmt(rate, 3)} (R=${out.R}, B=${out.B})`);
}

/**
 * C.10 Correlation machinery. fisherN gives 29 at α = 0.05 and 50 at α = 0.05/15; simulated power at 29 cards is in
 * range; the type-I rate at ρ = 0 is in range.
 * @param {{ R?: number, seed?: number }} [opts]
 * @returns {Check}
 */
export function checkCorrelation(opts = {}) {
  const R = opts.R ?? 4000;
  const seed = opts.seed ?? 7;
  const n29 = fisherN(0.5, 0.05, 0.8);
  const n50 = fisherN(0.5, 0.05 / 15, 0.8);
  const power = simulateCorrPower({ n: 29, rho: 0.5, alpha: 0.05 }, { R, seed }).power;
  const typeI = simulateCorrPower({ n: 29, rho: 0, alpha: 0.05 }, { R, seed }).power;
  const [pLo, pHi] = RANGES.correlationPower;
  const [tLo, tHi] = RANGES.correlationTypeI;
  const pass = n29 === 29 && n50 === 50 && power >= pLo && power <= pHi && typeI >= tLo && typeI <= tHi;
  return result('C.10', 'Correlation machinery', pass, { n29, n50, power, typeI }, `29, 50, power ${pLo}-${pHi}, type I ${tLo}-${tHi}`,
    `fisherN ${n29} and ${n50}; power at 29 ${fmt(power, 3)}; type I ${fmt(typeI, 3)}`);
}

/**
 * C.11 Second stage. With no link the mean rule's AUC is near 0.5; comparing a forecast with itself gives ΔAUC = 0 and
 * the interval [0, 0].
 * @param {{ G?: number, seed?: number }} [opts]
 * @returns {Check}
 */
export function checkSecondStage(opts = {}) {
  const G = opts.G ?? 20000;
  const seed = opts.seed ?? 7;
  const flat = resolveParams({ rhoLatent: 0 });
  const aucs = populationAucs(flat, { G, seed });
  const [lo, hi] = RANGES.secondStageMeanAuc;
  const inRange = aucs.mean >= lo && aucs.mean <= hi;
  const rows = simulateSecondStage(resolveParams({}), { G: 300, seed, rules: ['mean'] });
  const same = aucDifferenceCI(rows, 'a', { B: 50, seed });
  const identical = same.dAuc === 0 && same.lo === 0 && same.hi === 0;
  return result('C.11', 'Second stage: null AUC and identical-scores interval', inRange && identical,
    { meanAuc: aucs.mean, identical: same }, `mean rule AUC ${lo}-${hi} at rho 0; ΔAUC 0 with [0, 0]`,
    `mean rule AUC at rho 0: ${fmt(aucs.mean, 3)}; identical-scores ΔAUC ${same.dAuc}, interval [${same.lo}, ${same.hi}]`);
}

/**
 * C.12 Absolute endpoint. A constant panel forecast equal to the in-sample base rate gives a gain of exactly zero on
 * the analysed cards, so it can never be called better.
 * @param {{ params?: any, cards?: number, seed?: number }} [opts]
 * @returns {Check}
 */
export function checkAbsoluteConstant(opts = {}) {
  const params = opts.params ?? resolveParams({});
  const n = opts.cards ?? 400;
  const rng = makeRng(hashSeed(opts.seed ?? 7, 'check-c12'));
  const roster = makeRoster(params, rng);
  const cards = makeRiskCards(params, rng, n);
  const panels = [];
  for (const card of cards) {
    const panel = drawPanel(card, roster, params, rng.fork(card.id), { kFixed: 5 });
    if (panel) panels.push(panel);
  }
  const base = panels.reduce((s, p) => s + p.card.y, 0) / panels.length;
  const constant = panels.map((p) => ({ ...p, ps: p.ps.map(() => base) }));
  const r = analyseAbsoluteFast(constant, { floor: 5, benchmark: 'in_sample_base_rate', alpha: 0.05 });
  const pass = Math.abs(r.gain ?? 1) < 1e-12 && r.better === false;
  return result('C.12', 'Absolute endpoint: constant forecast cannot be better', pass, r.gain, 'gain 0, better false',
    `constant at the in-sample base ${fmt(base, 3)}: gain ${r.gain}, better ${r.better}`);
}

/**
 * C.13 Calendar. The radar gives 33 months, 108 dated risks and 266 triggers, 49 and 129 in the last 12 months; the
 * central 12-month window is 34 ± 1 cards.
 * @param {{ B?: number, seed?: number }} [opts]
 * @returns {Check}
 */
export function checkCalendar(opts = {}) {
  const radar = JSON.parse(readFileSync(RADAR_FILE, 'utf8'));
  const a = arrivalsFromRadar(radar);
  const last = (xs) => xs.slice(-12).reduce((s, x) => s + x, 0);
  const sum = (xs) => xs.reduce((s, x) => s + x, 0);
  const active = loadHistorical().active;
  const w = windowCards(
    { windowMonths: 12, lagMonths: 3, yieldRisk: 0.6, yieldTrigger: 0.5, activeRisks: active.risks, activeTriggers: active.triggers,
      riskMonthly: a.riskMonthly, triggerMonthly: a.triggerMonthly },
    { B: opts.B ?? 20000, seed: opts.seed ?? 7 },
  );
  const facts = {
    months: a.months.length, risks: sum(a.riskMonthly), triggers: sum(a.triggerMonthly),
    lastRisks: last(a.riskMonthly), lastTriggers: last(a.triggerMonthly),
  };
  const pass = facts.months === 33 && facts.risks === 108 && facts.triggers === 266 && facts.lastRisks === 49 &&
    facts.lastTriggers === 129 && Math.abs(w.risk.median - 34) <= 1;
  return result('C.13', 'Calendar matches the radar counts', pass, { ...facts, centre: w.risk.median },
    '33 months, 108 risks, 266 triggers, 49 and 129 in the last 12; 34 ± 1 cards',
    `months ${facts.months}, risks ${facts.risks}, triggers ${facts.triggers}, last 12: ${facts.lastRisks} and ${facts.lastTriggers}; 12-month window ${fmt(w.risk.median, 1)} cards`);
}

/**
 * Runs every check. Quick mode uses fewer replicates and the fast size tier; the full run uses the real paired()
 * interval for the size check and larger counts.
 * @param {{ quick?: boolean, seed?: number }} [opts]
 * @returns {Check[]}
 */
export function runValidation(opts = {}) {
  const quick = opts.quick === true;
  const seed = opts.seed ?? 7;
  const params = resolveParams({});
  const R = quick ? 300 : 1000;
  return [
    checkSize({ params, R, seed, tier: quick ? 'fast' : 'real' }),
    checkPlantedSkill({ params, seed, M: quick ? 8000 : 20000 }),
    checkK1({ params, seed }),
    checkMonotone({ params, R, seed }),
    checkRealData({ runScript: true }),
    checkFastEqualsReal({ params, seed }),
    checkDropout({ params, seed, cards: quick ? 2000 : 6000 }),
    checkDeterminism({ params, seed, R: 100 }),
    checkRoundTwoNull({ params, seed, R: quick ? 300 : 1000, B: 200 }),
    checkCorrelation({ seed, R: quick ? 2000 : 4000 }),
    checkSecondStage({ seed, G: quick ? 10000 : 20000 }),
    checkAbsoluteConstant({ params, seed }),
    checkCalendar({ seed }),
  ];
}

/**
 * Markdown table of the checks, for the top of the report and for SYNTHETIC-validation.md.
 * @param {Check[]} checks
 * @returns {string}
 */
export function renderValidation(checks) {
  const rows = checks.map((c) => `| ${c.id} | ${c.name} | ${c.pass ? 'pass' : 'FAIL'} | ${c.expected} | ${c.detail} |`);
  const passed = checks.filter((c) => c.pass).length;
  return [
    `Validation: ${passed} of ${checks.length} checks pass.`,
    '',
    '| Check | What it tests | Result | Pass criterion | Numbers |',
    '|---|---|---|---|---|',
    ...rows,
  ].join('\n');
}
