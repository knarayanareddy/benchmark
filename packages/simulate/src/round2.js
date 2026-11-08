/**
 * Round 2 and the second look (power-spec §A.5, Analysis 5). Risk-level cards only: the second look is defined against
 * ACAPS's reading, which trigger cards do not have.
 *
 * Quantity: toward = |p1 − a| − |p2 − a|. Positive means the answer moved toward ACAPS's reading. Arm contrasts are
 * card-weighted (weights n_A n_B / (n_A + n_B) per card). The repo's summariseArms supplies the release floor and the
 * descriptive arm means; it has no interval by design (docs/08), so the interval here is new code.
 */
import { ARMS, assignArm, summariseArms } from '@benchmark/core/secondlook';
import { clampForecast, MIN_RELEASE_PANEL_SIZE } from '@benchmark/core/aggregate';
import { wilson } from '@benchmark/core/stats';
import { makeRng, expit, logit } from './rng.js';
import { makeRoster, makeRiskCards, drawPanel } from './model.js';

/** @param {number[]} xs */
const mean = (xs) => xs.reduce((s, x) => s + x, 0) / xs.length;

/**
 * Change toward ACAPS for one pair: positive when p2 is closer to the ACAPS reading a than p1 was.
 * @param {{ p1: number, p2: number, acapsP: number }} pair
 * @returns {number}
 */
export function towardAcaps(pair) {
  return Math.abs(pair.p1 - pair.acapsP) - Math.abs(pair.p2 - pair.acapsP);
}

/**
 * Round-2 logit: ℓ² = ℓ¹ + h(ℓ̄ − ℓ¹) + λ·opened·(ℓ(a) − ℓ¹) + ν. Not rounded: see revisedAnswer.
 * @param {{ p1: number, pool: number, a: number, herd: number, pull: number, opened: boolean, noise: number }} x
 *   pool is ℓ̄, the mean Round-1 logit of the panel
 * @returns {number}
 */
export function revisedLogit({ p1, pool, a, herd, pull, opened, noise }) {
  const l1 = logit(p1);
  return l1 + herd * (pool - l1) + (opened ? pull * (logit(a) - l1) : 0) + noise;
}

/**
 * The Round-2 answer on the same grid as Round 1: rounded to whole percents, clamped like every other forecast.
 * @param {Parameters<typeof revisedLogit>[0]} x
 * @returns {number}
 */
export function revisedAnswer(x) {
  return clampForecast(Math.round(100 * expit(revisedLogit(x))) / 100);
}

/**
 * Pull toward ACAPS's reading for an arm (J11). Only acaps_view pulls toward ACAPS; control has no pull.
 * @param {string} arm
 * @param {{ lambdaAcaps: number, lambdaBalanced: number }} params
 * @returns {number}
 */
function pullOf(arm, params) {
  if (arm === 'acaps_view') return params.lambdaAcaps;
  if (arm === 'balanced') return params.lambdaBalanced;
  return 0;
}

/** A 32-bit hex string from the stream, the input assignArm() expects. @param {import('./rng.js').Rng} rng */
function armHex(rng) {
  return Math.floor(rng.next() * 4294967296).toString(16).padStart(8, '0');
}

/**
 * Round-2 answers for every Round-1 responder of every panel. Each responder: responds with c2; is assigned an arm
 * with the repo's assignArm; opens the background with qOpen (never under control); keeps the answer with pKeep;
 * otherwise the answer is revised by revisedAnswer, with the herding weight the roster gives that expert (Expert.herd,
 * drawn by makeRoster from params.herd and herdSd).
 *
 * Output rows are the repo's Pair shape plus the card and expert ids.
 * @param {Array<{ card: import('./types.js').Card, ps: number[], experts: number[] }>} panels risk-level cards only
 * @param {Array<{ id: number }>} roster the experts the panels draw from
 * @param {import('./types.js').Params} params
 * @param {import('./rng.js').Rng} rng
 * @returns {Array<{ cardId: string, expertId: number, arm: string, p1: number, p2: number, acapsP: number, saw: boolean }>}
 */
export function simulateRound2(panels, roster, params, rng) {
  const expertsById = new Map(roster.map((e) => [e.id, e]));
  /** @type {Array<{ cardId: string, expertId: number, arm: string, p1: number, p2: number, acapsP: number, saw: boolean }>} */
  const pairs = [];
  for (const panel of panels) {
    const { card } = panel;
    if (card.kind !== 'risk' || typeof card.a !== 'number') {
      throw new TypeError(`second look needs a risk card with an ACAPS reading; got ${card.id} (${card.kind})`);
    }
    const pool = mean(panel.ps.map(logit));
    panel.experts.forEach((expertId, i) => {
      const expert = expertsById.get(expertId);
      if (!expert) throw new RangeError(`expert ${expertId} is not in the roster`);
      if (typeof expert.herd !== 'number') throw new TypeError(`expert ${expertId} has no herding weight`);
      const r = rng.fork(`r2:${card.id}:${expertId}`);
      const responds = r.next() < params.c2;
      if (!responds) return;
      const arm = assignArm(armHex(r));
      const openDraw = r.next();
      const keepDraw = r.next();
      const noise = params.r2Noise * r.normal();
      const opened = arm !== 'control' && openDraw < params.qOpen;
      const p1 = panel.ps[i];
      const p2 = keepDraw < params.pKeep
        ? p1
        : revisedAnswer({
          p1,
          pool,
          a: card.a,
          herd: expert.herd,
          pull: pullOf(arm, params),
          opened,
          noise,
        });
      pairs.push({ cardId: card.id, expertId, arm, p1, p2, acapsP: card.a, saw: opened });
    });
  }
  return pairs;
}

/**
 * Checks the arm names. Throws for anything that is not one of the repo's ARMS, or for the same arm twice.
 * @param {string} armA @param {string} armB
 */
function checkArms(armA, armB) {
  for (const arm of [armA, armB]) {
    if (!ARMS.includes(arm)) throw new RangeError(`unknown arm ${JSON.stringify(arm)}`);
  }
  if (armA === armB) throw new RangeError('the two arms of a contrast must differ');
}

/**
 * Toward-ACAPS values grouped by card, for the two arms. Only cards that have at least one pair in either arm appear.
 * @param {Array<{ cardId: string, arm: string, p1: number, p2: number, acapsP: number|null }>} pairs
 * @param {string} armA @param {string} armB
 * @returns {Array<{ a: number[], b: number[] }>}
 */
function cellsByCard(pairs, armA, armB) {
  /** @type {Map<string, { a: number[], b: number[] }>} */
  const byCard = new Map();
  for (const p of pairs) {
    if (p.arm !== armA && p.arm !== armB) continue;
    if (typeof p.acapsP !== 'number') throw new TypeError('a pair without an ACAPS reading cannot enter the second-look contrast');
    const cell = byCard.get(p.cardId) ?? { a: [], b: [] };
    (p.arm === armA ? cell.a : cell.b).push(towardAcaps(/** @type {any} */ (p)));
    byCard.set(p.cardId, cell);
  }
  return [...byCard.values()];
}

/**
 * Card-weighted contrast of the two arms' mean change toward ACAPS. Within each card: the mean for arm A minus the
 * mean for arm B, weighted by n_A n_B / (n_A + n_B); cards with only one arm add nothing. Withheld (no numbers) when
 * either arm has fewer than `floor` pairs, using summariseArms's rule.
 * @param {Array<{ cardId: string, arm: string, p1: number, p2: number, acapsP: number|null }>} pairs
 * @param {string} armA @param {string} armB
 * @param {{ floor?: number }} [opts] floor defaults to the release floor, MIN_RELEASE_PANEL_SIZE
 * @returns {{ est: number|null, nA: number, nB: number, cardsUsed: number, withheld: boolean }}
 */
export function armContrast(pairs, armA, armB, opts = {}) {
  checkArms(armA, armB);
  const floor = opts.floor ?? MIN_RELEASE_PANEL_SIZE;
  const s = summariseArms(/** @type {any} */ (pairs), { floor });
  const nA = s[armA].n;
  const nB = s[armB].n;
  if (s[armA].suppressed || s[armB].suppressed) {
    return { est: null, nA, nB, cardsUsed: 0, withheld: true };
  }
  const contrast = weightedContrast(cellsByCard(pairs, armA, armB));
  return { ...contrast, nA, nB, withheld: contrast.est === null };
}

/**
 * @param {Array<{ a: number[], b: number[] }>} cells
 * @returns {{ est: number|null, cardsUsed: number }}
 */
function weightedContrast(cells) {
  let num = 0;
  let den = 0;
  let used = 0;
  for (const c of cells) {
    if (c.a.length === 0 || c.b.length === 0) continue;
    const w = (c.a.length * c.b.length) / (c.a.length + c.b.length);
    num += w * (mean(c.a) - mean(c.b));
    den += w;
    used += 1;
  }
  return { est: den > 0 ? num / den : null, cardsUsed: used };
}

/** Mean of m draws with replacement from xs. @param {number[]} xs @param {import('./rng.js').Rng} rng */
function resampledMean(xs, rng) {
  let s = 0;
  for (let i = 0; i < xs.length; i++) s += xs[rng.int(xs.length)];
  return s / xs.length;
}

/**
 * One bootstrap draw of the weighted contrast over the given cells, resampling experts within each cell.
 * @param {Array<{ a: number[], b: number[] }>} cells
 * @param {import('./rng.js').Rng} rng
 * @returns {number|null}
 */
function resampledContrast(cells, rng) {
  let num = 0;
  let den = 0;
  for (const c of cells) {
    if (c.a.length === 0 || c.b.length === 0) continue;
    const w = (c.a.length * c.b.length) / (c.a.length + c.b.length);
    num += w * (resampledMean(c.a, rng) - resampledMean(c.b, rng));
    den += w;
  }
  return den > 0 ? num / den : null;
}

/** @param {number[]} sorted @param {number} q */
function quantile(sorted, q) {
  const n = sorted.length;
  return sorted[Math.min(n - 1, Math.max(0, Math.floor(q * n)))];
}

/**
 * Percentile interval for the arm contrast.
 *
 * method 'card' (default): two-stage. Resample the cards with replacement, then resample the experts within each drawn
 * card's arm cells. Cards are the unit of independence, so card-to-card differences widen the interval.
 * method 'pigeonhole': cards fixed; resample experts within each card's arm cells only. It ignores card-to-card
 * variation, so it is the expert-level comparison used to check the card method.
 *
 * `significant` is true when the interval excludes zero in either direction.
 * @param {Array<{ cardId: string, arm: string, p1: number, p2: number, acapsP: number|null }>} pairs
 * @param {string} armA @param {string} armB
 * @param {{ B?: number, seed?: number|string, method?: 'card'|'pigeonhole', alpha?: number, floor?: number }} [opts]
 * @returns {{ est: number|null, lo: number|null, hi: number|null, significant: boolean, withheld: boolean, nA: number, nB: number, cardsUsed: number }}
 */
export function armContrastCI(pairs, armA, armB, opts = {}) {
  const { B = 2000, seed = 7, method = 'card', alpha = 0.05, floor } = opts;
  if (method !== 'card' && method !== 'pigeonhole') throw new RangeError(`unknown bootstrap method ${String(method)}`);
  const point = armContrast(pairs, armA, armB, { floor });
  if (point.withheld) {
    return { est: null, lo: null, hi: null, significant: false, withheld: true, nA: point.nA, nB: point.nB, cardsUsed: 0 };
  }
  const cells = cellsByCard(pairs, armA, armB);
  const rng = makeRng(seed);
  /** @type {number[]} */
  const draws = [];
  for (let b = 0; b < B; b++) {
    const picked = method === 'card'
      ? cells.map(() => cells[rng.int(cells.length)])
      : cells;
    const e = resampledContrast(picked, rng);
    if (e !== null) draws.push(e);
  }
  if (draws.length === 0) {
    return { est: point.est, lo: null, hi: null, significant: false, withheld: true, nA: point.nA, nB: point.nB, cardsUsed: point.cardsUsed };
  }
  draws.sort((x, y) => x - y);
  const lo = quantile(draws, alpha / 2);
  const hi = quantile(draws, 1 - alpha / 2);
  return {
    est: point.est,
    lo,
    hi,
    significant: lo > 0 || hi < 0,
    withheld: false,
    nA: point.nA,
    nB: point.nB,
    cardsUsed: point.cardsUsed,
  };
}
// ---- DRAFT (not yet in src/round2.js): merge when packages/simulate/src/model.js exists. ----

/** @param {number[]} xs @param {number} q */
function quantileOf(xs, q) {
  const s = [...xs].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.max(0, Math.floor(q * s.length)))];
}

/**
 * Power for the second-look arm contrast: the share of replicates whose interval lies above zero, the direction the
 * design expects (armA more toward ACAPS than armB). Each replicate draws a fresh roster, N risk cards with k
 * responders each (kFixed bypasses dropout and the floor), the Round-2 answers, and the card-bootstrap interval.
 * A replicate with an arm under the release floor counts as not detected and in fracWithheld.
 * @param {{ params: import('./types.js').Params, N: number, k: number, armA: string, armB: string }} spec
 * @param {{ R: number, B: number, seed?: number|string }} opts
 */
export function powerRound2(spec, opts) {
  const { params, N, k, armA, armB } = spec;
  const { R, B, seed = params.analysisSeed } = opts;
  const root = makeRng(seed);
  let detected = 0;
  let anySig = 0;
  let withheld = 0;
  /** @type {number[]} */
  const ests = [];
  /** @type {number[]} */
  const armAMeans = [];
  /** @type {number[]} */
  const armCounts = [];
  for (let r = 0; r < R; r++) {
    const rr = root.fork(`rep:${r}`);
    const roster = makeRoster(params, rr.fork('roster'));
    const cards = makeRiskCards(params, rr.fork('cards'), N);
    /** @type {Array<{ card: import('./types.js').Card, ps: number[], experts: number[] }>} */
    const panels = [];
    cards.forEach((card, i) => {
      const panel = drawPanel(card, roster, params, rr.fork(`panel:${i}`), { kFixed: k });
      if (panel) panels.push(panel);
    });
    const pairs = simulateRound2(panels, roster, params, rr.fork('r2'));
    const nA = pairs.filter((p) => p.arm === armA).length;
    const nB = pairs.filter((p) => p.arm === armB).length;
    armCounts.push(nA, nB);
    if (nA > 0) armAMeans.push(pairs.filter((p) => p.arm === armA).reduce((s, p) => s + towardAcaps(p), 0) / nA);
    const ci = armContrastCI(pairs, armA, armB, {
      B,
      seed: rr.fork('boot').int(4294967296),
      method: 'card',
      alpha: params.alpha,
      floor: params.releaseFloor,
    });
    if (ci.withheld) {
      withheld += 1;
      continue;
    }
    ests.push(/** @type {number} */ (ci.est));
    if (ci.significant) anySig += 1;
    if (/** @type {number} */ (ci.lo) > 0) detected += 1;
  }
  const w = wilson(detected, R);
  const meanSd = armAMeans.length > 1
    ? Math.sqrt(armAMeans.reduce((s, x) => s + (x - mean(armAMeans)) ** 2, 0) / (armAMeans.length - 1))
    : null;
  return {
    power: detected / R,
    lo: w ? w.lo : null,
    hi: w ? w.hi : null,
    meanContrast: ests.length ? mean(ests) : null,
    pairsPerArmMean: armCounts.length ? mean(armCounts) : null,
    pairsPerArmP05: armCounts.length ? quantileOf(armCounts, 0.05) : null,
    fracWithheld: withheld / R,
    armMeanSd: meanSd,
    anySignificant: anySig / R,
    R,
    B,
  };
}
