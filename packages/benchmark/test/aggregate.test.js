import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  METHODS,
  DEFAULT_METHOD,
  MIN_PANEL_SIZE,
  MIN_RELEASE_PANEL_SIZE,
  MIN_COHORT_STEP,
  MIN_SEEDS_FOR_WEIGHTING,
  MAX_ROUNDS,
  RELEASE_POLICIES,
  SKILL_CUTOFF_BRIER,
  ACAPS_MATRIX,
  aggregate,
  releaseAggregate,
  deduplicateRounds,
  seedWeights,
  extremise,
  probabilityBand,
  acapsRiskLevel,
  dispatchSignals,
} from '@benchmark/core/aggregate';
import { dispatch, DEFAULT_CAP, TYPES } from '@benchmark/core/dispatch';
import { LEVELS, PUBLIC } from '@benchmark/core/anonymity';
import { mulberry32, bootstrapBrier, paired } from '@benchmark/core/scoring';

const mkPanel = (ps, prefix = 'e') =>
  ps.map((p, i) => ({ expertId: `${prefix}${i + 1}`, p }));

// ── 1. Core pooling & mandatory uncertainty intervals (Full A1) ─────────────

test('default method is median and handles both odd and even panels accurately', () => {
  assert.equal(DEFAULT_METHOD, METHODS.MEDIAN);

  const seven = mkPanel([0.15, 0.55, 0.60, 0.62, 0.68, 0.72, 0.80]);
  const r7 = aggregate(seven);
  assert.equal(r7.suppressed, false);
  assert.equal(r7.n, 7);
  assert.equal(r7.estimate, 0.62);
  assert.ok(Math.abs(r7.spread - 0.65) < 1e-12);
  assert.equal(r7.min, 0.15);
  assert.equal(r7.max, 0.80);
  assert.equal(r7.outlierCount, 1);

  const six = mkPanel([0.15, 0.55, 0.60, 0.62, 0.68, 0.72]);
  const r6 = aggregate(six);
  assert.equal(r6.n, 6);
  assert.ok(Math.abs(r6.estimate - 0.61) < 1e-12);
});

test('mean, log_odds and outlier_weighted match exact mathematical definitions', () => {
  const ps = [0.15, 0.55, 0.60, 0.62, 0.68, 0.72, 0.80];
  const panel = mkPanel(ps);

  // 1. Linear mean
  const rMean = aggregate(panel, { method: METHODS.MEAN });
  const wantMean = ps.reduce((a, b) => a + b, 0) / ps.length;
  assert.ok(Math.abs(rMean.estimate - wantMean) < 1e-12);

  // 2. Log-odds mean (LOArMean)
  const rLo = aggregate(panel, { method: METHODS.LOG_ODDS });
  const meanLogit = ps.reduce((a, p) => a + Math.log(p / (1 - p)), 0) / ps.length;
  const wantLo = 1 / (1 + Math.exp(-meanLogit));
  assert.ok(Math.abs(rLo.estimate - wantLo) < 1e-12);

  // 3. Outlier-downweighted linear pool (aggreCAT OutWAgg)
  const rOut = aggregate(panel, { method: METHODS.OUTLIER_WEIGHTED });
  const med = 0.62;
  const sq = ps.map((p) => (p - med) ** 2);
  const maxSq = Math.max(...sq);
  const rw = sq.map((d) => 1 - d / maxSq);
  const rwSum = rw.reduce((a, b) => a + b, 0);
  const wantOut = ps.reduce((a, p, i) => a + (rw[i] / rwSum) * p, 0);
  assert.ok(Math.abs(rOut.estimate - wantOut) < 1e-12);
  assert.ok(rOut.estimate > rMean.estimate, 'down-weighting lone low outlier pulls estimate above raw mean');
});

test('log_odds and outlier_weighted never produce NaN on boundary, unanimous or bimodal panels', () => {
  // Boundary 0 and 1 in log_odds must clamp cleanly rather than produce -Inf + +Inf = NaN
  const boundary = mkPanel([0, 0.5, 1]);
  const rLo = aggregate(boundary, { method: METHODS.LOG_ODDS });
  assert.ok(Number.isFinite(rLo.estimate));
  assert.ok(Math.abs(rLo.estimate - 0.5) < 1e-9);
  assert.ok(Number.isFinite(rLo.lo) && Number.isFinite(rLo.hi));

  // Unanimous panel (maxDev === 0 in OutWAgg)
  const unanimous = mkPanel([0.65, 0.65, 0.65, 0.65, 0.65]);
  const rUnan = aggregate(unanimous, { method: METHODS.OUTLIER_WEIGHTED });
  assert.equal(rUnan.estimate, 0.65);
  assert.equal(rUnan.lo, 0.65);
  assert.equal(rUnan.hi, 0.65);
  assert.equal(rUnan.iqr, 0);

  // Symmetric bimodal tie [0.2, 0.2, 0.2, 0.8, 0.8, 0.8] where every point sits at maxDev from median 0.5
  const bimodal = mkPanel([0.2, 0.2, 0.2, 0.8, 0.8, 0.8]);
  const rBi = aggregate(bimodal, { method: METHODS.OUTLIER_WEIGHTED });
  assert.ok(Number.isFinite(rBi.estimate), 'bimodal tie must not divide 0/0 in OutWAgg');
  assert.ok(Math.abs(rBi.estimate - 0.5) < 1e-12);
  assert.equal(rBi.contested, true);
});

test('every non-suppressed aggregate carries a deterministic bootstrap interval and IQR', () => {
  const panel = mkPanel([0.30, 0.45, 0.55, 0.60, 0.75]);
  for (const method of Object.values(METHODS)) {
    const a = aggregate(panel, { method, seed: 99 });
    const b = aggregate(panel, { method, seed: 99 });
    assert.equal(a.lo, b.lo, `${method}: bootstrap lower bound must be deterministic`);
    assert.equal(a.hi, b.hi, `${method}: bootstrap upper bound must be deterministic`);
    assert.ok(a.lo <= a.estimate && a.estimate <= a.hi, `${method}: estimate must sit inside [lo, hi]`);
    assert.ok(a.min <= a.q25 && a.q25 <= a.q75 && a.q75 <= a.max);
    assert.ok(Math.abs(a.iqr - (a.q75 - a.q25)) < 1e-12);
  }
});

test('property sweep: boundedness, permutation invariance and complement symmetry across 200 random panels', () => {
  const rnd = mulberry32(20261106);
  const methods = Object.values(METHODS);

  for (let trial = 0; trial < 200; trial++) {
    const n = 3 + ((rnd() * 14) | 0); // panel sizes 3..16
    const ps = Array.from({ length: n }, () => Math.round(rnd() * 1000) / 1000);
    const panel = mkPanel(ps);

    // Deterministic Fisher-Yates shuffle of the same panel
    const shuffled = [...panel];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = (rnd() * (i + 1)) | 0;
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    const complemented = panel.map((x) => ({ ...x, p: 1 - x.p }));

    const method = methods[trial % methods.length];
    const r1 = aggregate(panel, { method, reps: 400, seed: 11 });
    const rPerm = aggregate(shuffled, { method, reps: 400, seed: 11 });
    const rComp = aggregate(complemented, { method, reps: 400, seed: 11 });

    // 1. Boundedness (log_odds clamps 0/1 by 1e-6)
    const eps = method === METHODS.LOG_ODDS ? 2e-6 : 1e-12;
    assert.ok(r1.estimate >= r1.min - eps && r1.estimate <= r1.max + eps);
    assert.ok(r1.lo <= r1.estimate && r1.estimate <= r1.hi);

    // 2. Permutation invariance of point estimate and panel dispersion
    assert.ok(Math.abs(r1.estimate - rPerm.estimate) < 1e-12, `${method} must be permutation-invariant`);
    assert.ok(Math.abs(r1.iqr - rPerm.iqr) < 1e-12);
    assert.equal(r1.outlierCount, rPerm.outlierCount);
    assert.equal(r1.contested, rPerm.contested);

    // 3. Complement symmetry: pool(1 - p) === 1 - pool(p)
    assert.ok(
      Math.abs(r1.estimate + rComp.estimate - 1) < 1e-9,
      `${method} violated complement symmetry: ${r1.estimate} + ${rComp.estimate}`
    );
  }
});

// ── 2. Small-panel privacy / differencing guard & zero ID leakage (Full A2) ─

test('panels smaller than 3 are suppressed so no participant can difference an anonymous peer', () => {
  assert.equal(MIN_PANEL_SIZE, 3);

  for (const sub of [[], [{ expertId: 'e1', p: 0.7 }], [
    { expertId: 'e1', p: 0.7, level: LEVELS.IDENTIFIED },
    { expertId: 'e2', p: 0.2, level: LEVELS.ANONYMOUS },
  ]]) {
    const out = aggregate(sub);
    assert.equal(out.suppressed, true);
    assert.equal(out.needed, 3);
    assert.equal(out.estimate, null);
    assert.equal(out.lo, null);
    assert.equal(out.hi, null);
    assert.equal(out.q25, null);
    assert.equal(out.q75, null);
    assert.equal(out.iqr, null);
    assert.equal(out.min, null);
    assert.equal(out.max, null);
    assert.equal(out.spread, null);
    assert.equal(out.outlierCount, null);
    assert.equal(out.contested, null);
  }

  // Cannot weaken the differencing floor by passing minPanel < 3
  const attempt = aggregate(mkPanel([0.2, 0.8]), { minPanel: 2 });
  assert.equal(attempt.suppressed, true);
  assert.equal(attempt.needed, 3);

  // Can tighten minPanel above 3
  const stricter = aggregate(mkPanel([0.2, 0.5, 0.8, 0.9]), { minPanel: 5 });
  assert.equal(stricter.suppressed, true);
  assert.equal(stricter.needed, 5);
});

test('public visibility enforces PUBLIC.minCount = 10 and cannot be lowered', () => {
  const nine = mkPanel([0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9]);
  const blocked = aggregate(nine, { visibility: 'public', minPanel: 3 });
  assert.equal(blocked.suppressed, true);
  assert.equal(blocked.needed, PUBLIC.minCount);
  assert.equal(blocked.estimate, null);

  const ten = mkPanel([0.1, 0.2, 0.3, 0.4, 0.5, 0.55, 0.6, 0.7, 0.8, 0.9]);
  const allowed = aggregate(ten, { visibility: 'public' });
  assert.equal(allowed.suppressed, false);
  assert.equal(allowed.n, 10);
  assert.ok(allowed.estimate !== null);
});

test('no expertId, name, country or declaration ever survives into aggregate() output', () => {
  const rich = [
    { expertId: 'e-SECRET-01', name: 'Amina Okoro', country: 'TCD', p: 0.40, declaration: { regions: ['TCD'] } },
    { expertId: 'e-SECRET-02', name: 'Bello Adamu', country: 'TCD', p: 0.55, declaration: { regions: ['TCD'] } },
    { expertId: 'e-SECRET-03', name: 'Chantal M.', country: 'TCD', p: 0.70, level: LEVELS.ANONYMOUS },
  ];
  const out = aggregate(rich, { impact: 4 });
  const serialised = JSON.stringify(out);
  for (const forbidden of ['e-SECRET', 'Amina', 'Bello', 'Chantal', 'TCD', 'declaration']) {
    assert.ok(!serialised.includes(forbidden), `aggregate payload leaked "${forbidden}"`);
  }
});

// ── 3. ACAPS Probability × Impact → Risk Level bridge (Full A3) ─────────────

test('probabilityBand aligns with ACAPS percentage bands, midpoints and /5 ordinals', () => {
  const cases = [
    [0.00, 'Very Low', 1],
    [0.10, 'Very Low', 1],
    [0.20, 'Very Low', 1],
    [0.21, 'Low', 2],
    [0.305, 'Low', 2],
    [0.40, 'Low', 2],
    [0.41, 'Medium', 3],
    [0.505, 'Medium', 3],
    [0.60, 'Medium', 3],
    [0.61, 'High', 4],
    [0.705, 'High', 4],
    [0.80, 'High', 4],
    [0.81, 'Very High', 5],
    [0.905, 'Very High', 5],
    [1.00, 'Very High', 5],
  ];
  for (const [p, wantLabel, wantOrd] of cases) {
    const b = probabilityBand(p);
    assert.equal(b.label, wantLabel, `p=${p}`);
    assert.equal(b.ordinal, wantOrd, `p=${p}`);
  }
});

test('acapsRiskLevel implements all 25 cells of ACAPS 5x5 matrix and Impact moves Risk Level', () => {
  // Unlike the export's lookup table (where High probability is always High Risk Level),
  // ACAPS' published 5x5 maps High probability (0.70) across Impact 1..5 to Low/Med/Med/High/High.
  assert.equal(acapsRiskLevel(0.70, 1).riskLevel, 'Low');
  assert.equal(acapsRiskLevel(0.70, 2).riskLevel, 'Medium');
  assert.equal(acapsRiskLevel(0.70, 3).riskLevel, 'Medium');
  assert.equal(acapsRiskLevel(0.70, 4).riskLevel, 'High');
  assert.equal(acapsRiskLevel(0.70, 5).riskLevel, 'High');

  // Exhaustively verify all 25 (ordinal, impact) cells
  for (let ord = 1; ord <= 5; ord++) {
    for (let imp = 1; imp <= 5; imp++) {
      const r = acapsRiskLevel(ord / 5, String(imp));
      assert.equal(r.riskLevel, ACAPS_MATRIX[ord][imp]);
      assert.equal(r.probabilityOrdinal, ord);
      assert.equal(r.impact, imp);
    }
  }
});

test('acapsRiskLevel propagates bootstrap intervals and respects small-panel suppression', () => {
  // Panel spanning Medium (0.45) to High (0.75) at Impact 4 -> loRiskLevel=Medium, hiRiskLevel=High
  const panel = mkPanel([0.42, 0.45, 0.62, 0.75, 0.78]);
  const out = aggregate(panel, { impact: 4 });
  assert.equal(out.acaps.suppressed, false);
  assert.equal(out.acaps.riskLevel, 'High');
  assert.equal(out.acaps.loRiskLevel, 'Medium');
  assert.equal(out.acaps.hiRiskLevel, 'High');
  assert.equal(out.acaps.spansRiskLevels, true);

  // Suppressed panel with impact still suppresses acaps Risk Level
  const sup = aggregate(mkPanel([0.70, 0.75]), { impact: 5 });
  assert.equal(sup.suppressed, true);
  assert.equal(sup.acaps.suppressed, true);
  assert.equal(sup.acaps.riskLevel, null);
});

test('acapsRiskLevel reproduces the 97/125 agreement count on data/risk-radar.json', () => {
  const blocks = JSON.parse(
    fs.readFileSync(new URL('../../../data/risk-radar.json', import.meta.url), 'utf8')
  );
  const ORD = { 'Very Low': 1, Low: 2, Medium: 3, High: 4, 'Very High': 5 };
  const complete = blocks.filter((b) => ORD[b.probability] && b.riskLevel && Number(b.impact) >= 1);

  assert.equal(complete.length, 125);
  let agree = 0;
  for (const b of complete) {
    const mapped = acapsRiskLevel(ORD[b.probability] / 5, b.impact);
    if (mapped.riskLevel === b.riskLevel) agree++;
  }
  assert.equal(agree, 97, 'matrix in aggregate.js must match check-methodology.mjs exactly');
});

// ── 4. Track-record Brier skill weights & >= 10 seed gate (Limited B1) ──────

test('seedWeights enforces >= 10 shared resolved seeds and weights by Murphy Brier skill above 10', () => {
  assert.equal(MIN_SEEDS_FOR_WEIGHTING, 10);
  assert.equal(SKILL_CUTOFF_BRIER, 0.25);

  const mkSeeds = (n, pWhen1, pWhen0) =>
    Array.from({ length: n }, (_, i) => {
      const y = i % 2;
      return { id: `S${i + 1}`, p: y === 1 ? pWhen1 : pWhen0, y };
    });

  // 9 shared resolved seeds -> must fall back to equal weights
  const nineHistory = {
    e1: mkSeeds(9, 0.95, 0.05),
    e2: mkSeeds(9, 0.55, 0.45),
    e3: mkSeeds(9, 0.20, 0.80),
  };
  const fb = seedWeights(nineHistory, ['e1', 'e2', 'e3']);
  assert.equal(fb.mode, 'equal_fallback');
  assert.equal(fb.sharedSeeds, 9);
  assert.ok(Math.abs(fb.weights.e1 - 1 / 3) < 1e-12);
  assert.ok(Math.abs(fb.weights.e2 - 1 / 3) < 1e-12);
  assert.ok(Math.abs(fb.weights.e3 - 1 / 3) < 1e-12);

  // 10 shared resolved seeds:
  //   e1 sharp & calibrated (Brier = 0.05^2 = 0.0025 -> skill = 0.2475)
  //   e2 modest skill      (Brier = 0.40^2 = 0.1600 -> skill = 0.0900)
  //   e3 worse than 50/50  (Brier = 0.70^2 = 0.4900 >= 0.25 -> skill = 0)
  const tenHistory = {
    e1: mkSeeds(10, 0.95, 0.05),
    e2: mkSeeds(10, 0.60, 0.40),
    e3: mkSeeds(10, 0.30, 0.70),
  };
  const sw = seedWeights(tenHistory, ['e1', 'e2', 'e3']);
  assert.equal(sw.mode, 'brier_skill');
  assert.equal(sw.sharedSeeds, 10);
  assert.equal(sw.weights.e3, 0, 'expert worse than uninformative 0.25 Brier gets zero weight');
  assert.ok(sw.weights.e1 > sw.weights.e2);
  assert.ok(Math.abs(sw.weights.e1 - 0.2475 / (0.2475 + 0.09)) < 1e-12);
  assert.ok(Math.abs(sw.weights.e1 + sw.weights.e2 + sw.weights.e3 - 1) < 1e-12);

  // Weighted aggregate shifts toward e1 across methods
  const panel = [
    { expertId: 'e1', p: 0.85 },
    { expertId: 'e2', p: 0.60 },
    { expertId: 'e3', p: 0.10 },
  ];
  const weightedMed = aggregate(panel, { seedHistory: tenHistory, method: METHODS.MEDIAN });
  assert.equal(weightedMed.weightsMode, 'brier_skill');
  assert.equal(weightedMed.estimate, 0.85, 'e1 holds >73% of weight, so weighted median is e1');

  const weightedMean = aggregate(panel, { seedHistory: tenHistory, method: METHODS.MEAN });
  const expectedMean = sw.weights.e1 * 0.85 + sw.weights.e2 * 0.60;
  assert.ok(Math.abs(weightedMean.estimate - expectedMean) < 1e-12);
});

test('weightedMedian handles exact 0.50 cumulative weight splits including IEEE-754 float drift', () => {
  // Construct 10 seeds where e1 gets skill 0.1, e2 gets 0.2, e3 gets 0.2 (total 0.5):
  // Normalised weights: e1 = 0.2, e2 = 0.3... wait: let e1=0.1/0.5=0.2, e2=0.15/0.5=0.3 -> 0.2+0.3 = 0.5,
  // or 4 experts with skills [0.05, 0.10, 0.10, 0.25] -> weights [0.1, 0.2, 0.2, 0.5], where
  // 0.1 + 0.2 + 0.2 === 0.5000000000000001 in IEEE-754!
  const brierForSkill = (s) => 0.25 - s;
  const pForError = (b) => 1 - Math.sqrt(b); // when y = 1, (p - 1)^2 = b
  const mkConst = (skill) =>
    Array.from({ length: 10 }, (_, i) => ({ id: `Q${i}`, p: pForError(brierForSkill(skill)), y: 1 }));

  const history = {
    e1: mkConst(0.05), // w = 0.1
    e2: mkConst(0.10), // w = 0.2
    e3: mkConst(0.10), // w = 0.2 -> cum = 0.1 + 0.2 + 0.2 = 0.5000000000000001
    e4: mkConst(0.25), // w = 0.5
  };
  const panel = [
    { expertId: 'e1', p: 0.10 },
    { expertId: 'e2', p: 0.20 },
    { expertId: 'e3', p: 0.40 },
    { expertId: 'e4', p: 0.80 },
  ];
  const r = aggregate(panel, { seedHistory: history, method: METHODS.MEDIAN });
  assert.equal(r.weightsMode, 'brier_skill');
  // Exact half-mass sits between 0.40 (cum 0.5) and 0.80 (cum 1.0) -> midpoint 0.60
  assert.ok(Math.abs(r.estimate - 0.60) < 1e-9, `expected 0.60, got ${r.estimate}`);
});

test('seedWeights obeys R3 (paired items), R4 (unobservable excluded) and R8 (self-declaration ignored)', () => {
  // R4: 8 resolved + 5 null (Active/unobservable) = 8 observed (< 10) -> must NOT count nulls toward 10
  const withActive = Array.from({ length: 13 }, (_, i) => ({
    id: `R${i}`,
    p: 0.9,
    y: i < 8 ? 1 : null,
  }));
  const r4 = seedWeights({ e1: withActive, e2: withActive, e3: withActive }, ['e1', 'e2', 'e3']);
  assert.equal(r4.sharedSeeds, 8);
  assert.equal(r4.mode, 'equal_fallback');

  // R3: each expert has 12 seeds, but only 7 overlap -> sharedSeeds = 7 -> equal_fallback
  const mkRange = (start, len) =>
    Array.from({ length: len }, (_, i) => ({ id: `X${start + i}`, p: 0.8, y: 1 }));
  const r3 = seedWeights(
    { e1: mkRange(0, 12), e2: mkRange(5, 12), e3: mkRange(5, 12) },
    ['e1', 'e2', 'e3']
  );
  assert.equal(r3.sharedSeeds, 7);
  assert.equal(r3.mode, 'equal_fallback');

  // All experts perform worse than coin-flip (Brier > 0.25) on 10 shared seeds -> graceful equal fallback
  const poor = Array.from({ length: 10 }, (_, i) => ({ id: `P${i}`, p: 0.1, y: 1 }));
  const noSkill = seedWeights({ e1: poor, e2: poor, e3: poor }, ['e1', 'e2', 'e3']);
  assert.equal(noSkill.mode, 'equal_no_positive_skill');
  assert.ok(Math.abs(noSkill.weights.e1 - 1 / 3) < 1e-12);

  // R8: self-declared confidence / expertise never alters aggregate
  const plain = mkPanel([0.25, 0.50, 0.85]);
  const declared = [
    { expertId: 'e1', p: 0.25, declaration: { regions: ['SDN'], selfWeight: 100 } },
    { expertId: 'e2', p: 0.50, declaration: { regions: [], selfWeight: 1 } },
    { expertId: 'e3', p: 0.85, declaration: { regions: ['SDN'], selfWeight: 1 } },
  ];
  assert.equal(
    aggregate(plain, { method: METHODS.MEAN }).estimate,
    aggregate(declared, { method: METHODS.MEAN }).estimate
  );
});

test('real corpus check: all 57 countries in risk-radar.json fall back to equal weights; cross-country types clear >=10', () => {
  const blocks = JSON.parse(
    fs.readFileSync(new URL('../../../data/risk-radar.json', import.meta.url), 'utf8')
  );
  const resolved = blocks.filter((b) => b.outcome === 0 || b.outcome === 1);

  const byCountry = new Map();
  for (const b of resolved) {
    const list = byCountry.get(b.country) || [];
    list.push(b);
    byCountry.set(b.country, list);
  }
  assert.ok(byCountry.size > 0);
  for (const [country, items] of byCountry.entries()) {
    const history = {
      e1: items.map((b) => ({ id: b.id, p: b.outcome ? 0.8 : 0.2, y: b.outcome })),
      e2: items.map((b) => ({ id: b.id, p: 0.5, y: b.outcome })),
      e3: items.map((b) => ({ id: b.id, p: 0.5, y: b.outcome })),
    };
    const sw = seedWeights(history, ['e1', 'e2', 'e3']);
    assert.equal(
      sw.mode,
      'equal_fallback',
      `${country} has ${items.length} resolved risks (<10) and must fall back to equal weights`
    );
  }

  // Cross-country riskType pool ("New emerging risk", n=57) clears >= 10 and activates brier_skill
  const emerging = resolved.filter((b) => b.riskType === 'New emerging risk');
  assert.equal(emerging.length, 57);
  const crossHistory = {
    e1: emerging.map((b) => ({ id: b.id, p: b.outcome ? 0.8 : 0.2, y: b.outcome })),
    e2: emerging.map((b) => ({ id: b.id, p: 0.5, y: b.outcome })),
    e3: emerging.map((b) => ({ id: b.id, p: 0.5, y: b.outcome })),
  };
  const crossSw = seedWeights(crossHistory, ['e1', 'e2', 'e3']);
  assert.equal(crossSw.mode, 'brier_skill');
  assert.equal(crossSw.sharedSeeds, 57);
  assert.equal(crossSw.weights.e1, 1);
  assert.equal(crossSw.weights.e2, 0);
});

// ── 5. Opt-in log-odds extremisation, d=1.0 default off (Limited B2) ────────

test('extremise defaults to exact identity (d=1.0) and obeys symmetry, fixed points and numerical bounds', () => {
  for (const p of [0, 1e-12, 0.15, 0.5, 0.61, 0.75, 1 - 1e-12, 1]) {
    assert.equal(extremise(p), p, 'd=1.0 default must be exact identity');
  }
  // Fixed points at 0, 0.5, 1 for any d > 0
  for (const d of [0.5, 1.5, 2.5, 8.0]) {
    assert.equal(extremise(0, { d }), 0);
    assert.equal(extremise(0.5, { d }), 0.5);
    assert.equal(extremise(1, { d }), 1);
  }
  // Pushing away from 0.5 when d > 1, toward 0.5 when d < 1, with complement symmetry
  assert.ok(extremise(0.70, { d: 1.8 }) > 0.70);
  assert.ok(extremise(0.30, { d: 1.8 }) < 0.30);
  assert.ok(extremise(0.70, { d: 0.6 }) < 0.70);
  assert.ok(Math.abs(extremise(0.73, { d: 2.1 }) + extremise(0.27, { d: 2.1 }) - 1) < 1e-12);

  // Extreme near-boundary floats never NaN or overflow
  assert.ok(Number.isFinite(extremise(1e-15, { d: 10 })));
  assert.ok(Number.isFinite(extremise(1 - 1e-15, { d: 10 })));
});

test('aggregate keeps extremisation off by default and suppresses it on contested panels unless forced', () => {
  // Tight consensus panel (IQR = 0.05 < 0.25): opt-in extremiseD > 1 activates
  const consensus = mkPanel([0.70, 0.72, 0.74, 0.75, 0.77]);
  const def = aggregate(consensus);
  assert.equal(def.extremised, false);
  assert.equal(def.estimate, 0.74);

  const ext = aggregate(consensus, { extremiseD: 1.6 });
  assert.equal(ext.extremised, true);
  assert.ok(ext.estimate > def.estimate);
  assert.ok(ext.lo <= ext.estimate && ext.estimate <= ext.hi);

  // Contested split panel (IQR = 0.50 >= 0.25): extremisation suppressed by default (BetaArMean2 safeguard)
  const contestedPanel = mkPanel([0.20, 0.25, 0.65, 0.75, 0.80]);
  const guarded = aggregate(contestedPanel, { extremiseD: 2.0 });
  assert.equal(guarded.contested, true);
  assert.equal(guarded.extremised, false);
  assert.equal(guarded.extremiseSuppressedReason, 'contested_panel');
  assert.equal(guarded.estimate, 0.65);

  const forced = aggregate(contestedPanel, {
    extremiseD: 2.0,
    suppressExtremiseOnContested: false,
  });
  assert.equal(forced.extremised, true);
  assert.ok(forced.estimate > 0.65);
});

// ── 6. Round-2 deduplication (Limited B3) & dispatch.js integration ─────────

test('deduplicateRounds keeps latest round per expert, distinguishes holding vs revising, and enforces Rule R6', () => {
  assert.equal(MAX_ROUNDS, 2);
  const raw = [
    { expertId: 'e1', p: 0.30, round: 1 },
    { expertId: 'e2', p: 0.55, round: 1 },
    { expertId: 'e3', p: 0.72, round: 1 },
    { expertId: 'e1', p: 0.50, round: 2 }, // revised
    { expertId: 'e3', p: 0.72, round: 2 }, // held at 72%
  ];
  const dedup = deduplicateRounds(raw);
  assert.equal(dedup.active.length, 3);
  assert.equal(dedup.roundsUsed, 2);
  assert.equal(dedup.round2Count, 2);
  assert.equal(dedup.revisedCount, 1, 'holding at 72% must not count as a changed answer');

  const out = aggregate(raw);
  assert.equal(out.n, 3);
  assert.equal(out.estimate, 0.55, 'e1 round-1 0.30 replaced by round-2 0.50 -> [0.50, 0.55, 0.72]');
  assert.equal(out.revisedCount, 1);
});

test('dispatchSignals feeds dispatch.js cleanly while respecting ANONYMOUS opt-out and small-panel suppression', () => {
  const card = { id: 'R1043', region: 'TCD', theme: 'conflict' };

  // Suppressed 2-person panel emits zero dispatch signals
  assert.deepEqual(dispatchSignals(mkPanel([0.10, 0.90]), { card }), []);

  // 5-person contested panel:
  //   e1 (0.10, PSEUDONYMOUS, round 1) -> outlier (|0.10 - 0.65| = 0.55 >= 0.25)
  //   e2 (0.15, ANONYMOUS, round 1)    -> outlier numerically, MUST NOT be contacted
  //   e3 (0.65, IDENTIFIED, round 1)   -> non-outlier in round 1 on contested card -> contested
  //   e4 (0.70, PSEUDONYMOUS, round 2) -> already completed round 2 -> no prompt
  //   e5 (0.85, 'unknown-lvl', round 1)-> unknown level fails closed to ANONYMOUS -> MUST NOT be contacted
  const estimates = [
    { expertId: 'e1', p: 0.10, round: 1, level: LEVELS.PSEUDONYMOUS },
    { expertId: 'e2', p: 0.15, round: 1, level: LEVELS.ANONYMOUS },
    { expertId: 'e3', p: 0.65, round: 1, level: LEVELS.IDENTIFIED },
    { expertId: 'e4', p: 0.70, round: 2, level: LEVELS.PSEUDONYMOUS },
    { expertId: 'e5', p: 0.85, round: 1, level: 'invalid-privacy-setting' },
  ];

  const signals = dispatchSignals(estimates, { card });
  assert.equal(signals.length, 2);
  assert.equal(signals.find((s) => s.expert === 'e1').type, TYPES.outlier);
  assert.equal(signals.find((s) => s.expert === 'e3').type, TYPES.contested);
  assert.equal(signals.find((s) => s.expert === 'e2'), undefined, 'ANONYMOUS expert must never receive follow-up');
  assert.equal(signals.find((s) => s.expert === 'e5'), undefined, 'unrecognised level must fail closed to ANONYMOUS');

  // Pipe directly into dispatch() from packages/core/src/dispatch.js
  const routed = dispatch(signals, DEFAULT_CAP, []);
  assert.equal(routed.length, 2);
  assert.equal(routed[0].type, TYPES.outlier, 'outlier outranks contested in dispatch()');
  assert.equal(routed[0].decision, 'send');
  assert.equal(routed[1].type, TYPES.contested);
  assert.equal(routed[1].decision, 'send');
});

// ── 7. Strict input validation & adversarial error paths ────────────────────

test('invalid probabilities, rounds, seed histories, impacts and options throw explicit errors', () => {
  // Probabilities outside [0, 1] (e.g. passing 72 instead of 0.72) or non-numbers
  assert.throws(() => aggregate([{ expertId: 'e1', p: 72 }, { expertId: 'e2', p: 0.5 }, { expertId: 'e3', p: 0.5 }]), RangeError);
  assert.throws(() => aggregate([{ expertId: 'e1', p: -0.01 }, { expertId: 'e2', p: 0.5 }, { expertId: 'e3', p: 0.5 }]), RangeError);
  assert.throws(() => aggregate([{ expertId: 'e1', p: Number.NaN }, { expertId: 'e2', p: 0.5 }, { expertId: 'e3', p: 0.5 }]), RangeError);
  assert.throws(() => aggregate([{ expertId: 'e1', p: '0.5' }, { expertId: 'e2', p: 0.5 }, { expertId: 'e3', p: 0.5 }]), RangeError);
  assert.throws(() => aggregate('not-an-array'), TypeError);

  // Rounds: Rule R6 allows only 1 or 2; no duplicate same-round votes; no unkeyed round 2
  assert.throws(() => deduplicateRounds([{ expertId: 'e1', p: 0.5, round: 3 }]), /Rule R6/);
  assert.throws(() => deduplicateRounds([{ expertId: 'e1', p: 0.5, round: 0 }]), /Rule R6/);
  assert.throws(
    () => deduplicateRounds([{ expertId: 'e1', p: 0.4, round: 1 }, { expertId: 'e1', p: 0.6, round: 1 }]),
    /duplicate estimate/
  );
  assert.throws(() => deduplicateRounds([{ p: 0.5, round: 2 }], { requireBallotKey: false }), /without an expertId/);

  // Seed history invariants: minSeeds >= 10, labelled items, consistent outcomes, no duplicate IDs
  assert.throws(() => seedWeights({}, ['e1', 'e2'], { minSeeds: 5 }), RangeError);
  assert.throws(() => seedWeights({}, ['e1', 'e1']), /duplicate expertIds/);
  assert.throws(
    () => seedWeights({ e1: [{ p: 0.5, y: 1 }], e2: [{ id: 's1', p: 0.5, y: 1 }] }, ['e1', 'e2']),
    /requires an id/
  );
  assert.throws(
    () => seedWeights({ e1: [{ id: 's1', p: 0.5, y: 1 }], e2: [{ id: 's1', p: 0.5, y: 0 }] }, ['e1', 'e2']),
    /different outcomes/
  );
  assert.throws(
    () => seedWeights({ e1: [{ id: 's1', p: 0.5, y: 1 }, { id: 's1', p: 0.6, y: 1 }], e2: [] }, ['e1', 'e2']),
    /duplicate seed id/
  );

  // Extremise & options & impact validation
  assert.throws(() => extremise(0.5, { d: 0 }), RangeError);
  assert.throws(() => extremise(0.5, { d: -1.5 }), RangeError);
  assert.throws(() => aggregate(mkPanel([0.2, 0.5, 0.8]), { method: 'cooke_cdf' }), RangeError);
  assert.throws(() => aggregate(mkPanel([0.2, 0.5, 0.8]), { visibility: 'internal' }), RangeError);
  assert.throws(() => acapsRiskLevel(0.5, 0), RangeError);
  assert.throws(() => acapsRiskLevel(0.5, 6), RangeError);
  assert.throws(() => acapsRiskLevel(0.5, 2.5), RangeError);
  assert.throws(() => acapsRiskLevel(0.5, ''), RangeError);
  assert.throws(() => acapsRiskLevel(0.5, true), RangeError);
});

// ── 8. Numerical stability, zero-weight invariance & scoring.js pipeline ────

test('bimodal float symmetry holds across all k/100 pairs (k=0..50) and all methods', () => {
  for (let k = 0; k <= 50; k++) {
    const lo = k / 100;
    const hi = (100 - k) / 100;
    const panel = mkPanel([lo, lo, lo, hi, hi, hi]);
    for (const method of Object.values(METHODS)) {
      const r = aggregate(panel, { method, reps: 100 });
      assert.ok(
        Math.abs(r.estimate - 0.5) < 1e-9,
        `k=${k} (${lo}/${hi}) under ${method} drifted from 0.5 to ${r.estimate}`
      );
    }
  }
});

test('OutWAgg on bimodal tie preserves track-record Brier skill weights rather than resetting to uniform', () => {
  const mkConst = (p) => Array.from({ length: 10 }, (_, i) => ({ id: `B${i}`, p, y: 1 }));
  // e1..e3 have mod skill (p=0.60 -> Brier 0.16 -> skill 0.09 each),
  // e4..e6 have high skill (p=0.90 -> Brier 0.01 -> skill 0.24 each)
  const history = new Map([
    ['e1', mkConst(0.60)],
    ['e2', mkConst(0.60)],
    ['e3', mkConst(0.60)],
    ['e4', mkConst(0.90)],
    ['e5', mkConst(0.90)],
    ['e6', mkConst(0.90)],
  ]);
  // Bimodal equidistant panel [0.2, 0.2, 0.2, 0.8, 0.8, 0.8] using { expert } alias
  const panel = [
    { expert: 'e1', p: 0.20 },
    { expert: 'e2', p: 0.20 },
    { expert: 'e3', p: 0.20 },
    { expert: 'e4', p: 0.80 },
    { expert: 'e5', p: 0.80 },
    { expert: 'e6', p: 0.80 },
  ];
  const r = aggregate(panel, { seedHistory: history, method: METHODS.OUTLIER_WEIGHTED });
  assert.equal(r.weightsMode, 'brier_skill');
  // High-skill group at 0.80 holds 0.72 / (0.27 + 0.72) = 8/11 of total weight:
  // expected = (3/11)*0.20 + (8/11)*0.80 = 7.0 / 11
  assert.ok(Math.abs(r.estimate - 7 / 11) < 1e-12);
});

test('zero-weight experts neither shift weightedMedian tie midpoints nor collapse bootstrap uncertainty', () => {
  const mkConst = (p) => Array.from({ length: 10 }, (_, i) => ({ id: `Z${i}`, p, y: 1 }));
  // e1 has 0 weight (p=0.40 -> Brier 0.36 >= 0.25); e2 and e3 have identical positive skill (w = 0.5 each)
  const tieHistory = {
    e1: mkConst(0.40),
    e2: mkConst(0.80),
    e3: mkConst(0.80),
  };
  const tiePanel = [
    { expertId: 'e1', p: 0.05 },
    { expertId: 'e2', p: 0.60 },
    { expertId: 'e3', p: 0.80 },
  ];
  const rTie = aggregate(tiePanel, { seedHistory: tieHistory, method: METHODS.MEDIAN });
  assert.ok(Math.abs(rTie.estimate - 0.70) < 1e-12, 'zero-weight e1 must not pull midpoint of e2/e3');

  // Single positive-skill expert (w = [1, 0, 0]) in a disagreeing 3-person panel:
  // point estimate is e1 (0.85), while bootstrap CI reflects single-expert concentration risk
  const loneHistory = {
    e1: mkConst(0.90),
    e2: mkConst(0.40),
    e3: mkConst(0.40),
  };
  const lonePanel = [
    { expertId: 'e1', p: 0.85 },
    { expertId: 'e2', p: 0.20 },
    { expertId: 'e3', p: 0.25 },
  ];
  const rLone = aggregate(lonePanel, { seedHistory: loneHistory, method: METHODS.MEAN });
  assert.equal(rLone.estimate, 0.85);
  assert.ok(rLone.hi - rLone.lo > 0.40, 'bootstrap must expose single-expert concentration uncertainty');
});

test('end-to-end backtest integration: aggregate() outputs pipe cleanly into bootstrapBrier() and paired()', () => {
  const blocks = JSON.parse(
    fs.readFileSync(new URL('../../../data/risk-radar.json', import.meta.url), 'utf8')
  );
  const resolved = blocks.filter((b) => b.outcome === 0 || b.outcome === 1);
  const ORD = { 'Very Low': 1, Low: 2, Medium: 3, High: 4, 'Very High': 5 };
  const baseRate = resolved.reduce((a, b) => a + b.outcome, 0) / resolved.length;
  const rnd = mulberry32(12345);

  const acapsPairs = [];
  const panelPairs = [];

  for (const b of resolved) {
    const anchor = ORD[b.probability] ? ORD[b.probability] / 5 : baseRate;
    const cardEstimates = Array.from({ length: 5 }, (_, j) => ({
      expertId: `exp_${j}`,
      p: Math.min(1, Math.max(0, anchor + (rnd() - 0.5) * 0.2)),
    }));
    const agg = aggregate(cardEstimates, { reps: 200, seed: 7 });
    assert.equal(agg.suppressed, false);
    acapsPairs.push({ id: b.id, p: anchor, y: b.outcome });
    panelPairs.push({ id: b.id, p: agg.estimate, y: b.outcome });
  }

  const brierOut = bootstrapBrier(panelPairs, { reps: 1000, seed: 42 });
  assert.equal(brierOut.n, 104);
  assert.ok(brierOut.lo <= brierOut.score && brierOut.score <= brierOut.hi);

  const cmp = paired(panelPairs, acapsPairs, { reps: 1000, seed: 7 });
  assert.equal(cmp.n, 104);
  assert.ok(cmp.lo <= cmp.diff && cmp.diff <= cmp.hi);
});

// ── 7. Temporal differencing guard & anonymous ballot-token dedupe (U4) ─────

test('releaseAggregate() enforces MIN_RELEASE_PANEL_SIZE=5, suppresses <10 order statistics, and batches cohorts', () => {
  assert.equal(MIN_RELEASE_PANEL_SIZE, 5);
  assert.equal(MIN_COHORT_STEP, 3);
  const p4 = mkPanel([0.50, 0.60, 0.70, 0.90]);
  const p5 = mkPanel([0.50, 0.60, 0.70, 0.90, 0.65]);
  const p6 = mkPanel([0.50, 0.60, 0.70, 0.90, 0.65, 0.55]);
  const p7 = mkPanel([0.50, 0.60, 0.70, 0.90, 0.65, 0.55, 0.62]);
  const p8 = mkPanel([0.50, 0.60, 0.70, 0.90, 0.65, 0.55, 0.62, 0.58]);
  const p10 = mkPanel([0.20, 0.35, 0.50, 0.55, 0.60, 0.62, 0.65, 0.70, 0.80, 0.90]);

  // 0. Panels below 5 are suppressed even when closed (matching anonymity.js <5 rule)
  const blocked4 = releaseAggregate(p4, { closed: true, minPanel: 3 });
  assert.equal(blocked4.suppressed, true);
  assert.equal(blocked4.needed, 5);
  assert.equal(blocked4.estimate, null);

  // 1. Default policy is ON_CLOSE: interim snapshots while open are suppressed
  const openHold = releaseAggregate(p5, { closed: false, impact: 4 });
  assert.equal(openHold.policy, RELEASE_POLICIES.ON_CLOSE);
  assert.equal(openHold.suppressed, true);
  assert.equal(openHold.releaseHeld, true);
  assert.equal(openHold.estimate, null);
  assert.equal(openHold.acaps.suppressed, true);

  // Once closed at n=5 (<10), estimate + smoothed [lo, hi] release while quartiles/extremes stay null
  const closed5 = releaseAggregate(p5, { closed: true, impact: 4 });
  assert.equal(closed5.suppressed, false);
  assert.equal(closed5.releaseHeld, false);
  assert.equal(closed5.estimate, 0.65);
  assert.equal(closed5.q25, null, 'quartiles suppressed below n=10 to prevent linear inversion');
  assert.equal(closed5.q75, null);
  assert.equal(closed5.min, null);
  assert.equal(closed5.max, null);

  // At n=10 closed, full quartiles and extremes release
  const closed10 = releaseAggregate(p10, { closed: true });
  assert.equal(closed10.suppressed, false);
  assert.ok(closed10.q25 !== null && closed10.q75 !== null);
  assert.equal(closed10.min, 0.20);
  assert.equal(closed10.max, 0.90);

  // 2. Live BATCH mode: releases at n=5, then pins previousSnapshot across n=6
  //    and n=7 (blocking 1- and 2-person deltas) until n=8 clears MIN_COHORT_STEP=3.
  const snap5 = releaseAggregate(p5, { policy: RELEASE_POLICIES.BATCH, closed: false, minStep: 1 });
  assert.equal(snap5.suppressed, false);
  assert.equal(snap5.estimate, 0.65);
  assert.equal(snap5.min, null);
  assert.equal(snap5.max, null);
  assert.equal(snap5.q25, null);
  assert.equal(snap5.q75, null);

  const snap6 = releaseAggregate(p6, {
    policy: RELEASE_POLICIES.BATCH,
    closed: false,
    minStep: 1, // floor must clamp to MIN_COHORT_STEP = 3
    previousSnapshot: snap5,
  });
  assert.equal(snap6.estimate, snap5.estimate, '6th answer must not shift released median');
  assert.equal(snap6.n, 5, 'released count stays pinned at previous cohort');
  assert.equal(snap6.stale, true);
  assert.equal(snap6.releaseHeld, true);
  assert.equal(snap6.heldBackCount, 1);
  assert.equal(snap6.neededForNextBatch, 2);

  const snap7 = releaseAggregate(p7, {
    policy: RELEASE_POLICIES.BATCH,
    closed: false,
    previousSnapshot: snap5,
  });
  assert.equal(snap7.n, 5);
  assert.equal(snap7.heldBackCount, 2);
  assert.equal(snap7.neededForNextBatch, 1);

  const snap8 = releaseAggregate(p8, {
    policy: RELEASE_POLICIES.BATCH,
    closed: false,
    previousSnapshot: snap5,
  });
  assert.equal(snap8.n, 8, 'new cohort releases once >=3 additional respondents arrive');
  assert.equal(snap8.stale, false);
  assert.equal(snap8.releaseHeld, false);
  assert.equal(snap8.heldBackCount, 0);
  assert.equal(snap8.q25, null);
  assert.equal(snap8.max, null);

  // Regressing panel size or invalid policy throws explicitly
  assert.throws(
    () => releaseAggregate(p5, { policy: RELEASE_POLICIES.BATCH, previousSnapshot: snap8 }),
    /regressed/
  );
  assert.throws(() => releaseAggregate(p5, { policy: 'every_click' }), /unknown release policy/);
});

test('card-scoped ballotToken deduplicates anonymous Round-1/Round-2 ballots without retaining expertId', () => {
  const ballots = [
    { ballotToken: 'tok_a', p: 0.30, round: 1, level: LEVELS.ANONYMOUS },
    { ballotToken: 'tok_a', p: 0.55, round: 2, level: LEVELS.ANONYMOUS }, // replaces round 1
    { ballotToken: 'tok_b', p: 0.60, round: 1, level: LEVELS.ANONYMOUS },
    { ballotToken: 'tok_c', p: 0.70, round: 1, level: LEVELS.ANONYMOUS },
  ];
  const deduped = deduplicateRounds(ballots, { requireBallotKey: true });
  assert.equal(deduped.active.length, 3);
  assert.equal(deduped.round2Count, 1);
  assert.equal(deduped.revisedCount, 1);
  assert.ok(deduped.active.every((x) => x.expertId === null), 'expertId must stay null on anonymous ballots');

  const agg = aggregate(ballots, { requireBallotKey: true });
  assert.equal(agg.suppressed, false);
  assert.equal(agg.estimate, 0.60);
  assert.ok(!JSON.stringify(agg).includes('tok_'), 'ballotToken must never leak into aggregate() output');

  // Duplicate ballotToken in the same round throws
  assert.throws(
    () =>
      deduplicateRounds([
        { ballotToken: 'tok_dup', p: 0.4, round: 1, level: LEVELS.ANONYMOUS },
        { ballotToken: 'tok_dup', p: 0.5, round: 1, level: LEVELS.ANONYMOUS },
      ]),
    /duplicate estimate from ballot/
  );

  // requireBallotKey rejects completely unkeyed estimates so anonymous ballot stuffing cannot slip in
  assert.throws(
    () => aggregate([{ p: 0.5 }, { p: 0.6 }, { p: 0.7 }], { requireBallotKey: true }),
    /lacks both expertId and ballotToken/
  );
});



test('unkeyed estimates are rejected by default; the unsafe mode is explicit opt-in (B-06)', () => {
  const stuffed = Array.from({ length: 20 }, () => ({ p: 0.95 }));
  assert.throws(() => aggregate(stuffed), /lacks both expertId and ballotToken/);
  assert.throws(() => deduplicateRounds(stuffed), /lacks both expertId and ballotToken/);
  assert.throws(() => dispatchSignals(stuffed), /lacks both expertId and ballotToken/);
  assert.doesNotThrow(() => deduplicateRounds(stuffed, { requireBallotKey: false }));
});

test('aggregate defaults to 10,000 resamples and records the interval it used (R1)', () => {
  const est = [
    { expertId: 'a', p: 0.2, level: LEVELS.PSEUDONYMOUS },
    { expertId: 'b', p: 0.35, level: LEVELS.PSEUDONYMOUS },
    { expertId: 'c', p: 0.5, level: LEVELS.PSEUDONYMOUS },
    { expertId: 'd', p: 0.6, level: LEVELS.PSEUDONYMOUS },
    { expertId: 'e', p: 0.75, level: LEVELS.PSEUDONYMOUS },
  ];
  const r = aggregate(est, { cardId: 'card-1' });
  assert.deepEqual(r.interval, { reps: 10000, seed: 42, alpha: 0.05, method: 'smoothed_bootstrap' });
});
