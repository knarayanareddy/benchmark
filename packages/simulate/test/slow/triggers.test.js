// Slow Monte Carlo cases moved out of the fast test folder so `npm test` stays quick. Run them with `npm run test:slow`. Assertions are unchanged.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveParams } from '../../src/params.js';
import { makeRng } from '../../src/rng.js';
import { loadHistorical } from '../../src/data.js';
import { couplingToParams, riskOfTriggers, makeTriggerCards } from '../../src/triggers.js';
import { populationGain } from '../../src/population.js';

/** Settings outside the registered ranges (rho_lat 0 and 0.81 at the coupling dial) are built on a plain copy. */
const withOverrides = (over) => ({ ...resolveParams(), ...over });

const mean = (xs) => xs.reduce((s, x) => s + x, 0) / xs.length;

test('trigger counts per risk match the measured Active list in distribution; the list sums to 76 over 28 risks', () => {
  const P = resolveParams();
  const h = loadHistorical();
  assert.equal(P.statementsPerRisk.activeRisks, h.active.risks);
  assert.equal(P.statementsPerRisk.activeTriggers, h.active.triggers);
  assert.equal(h.active.triggers, 76);

  const groups = riskOfTriggers(P, makeRng(201), 28000);
  const N = groups.length;
  for (const v of [1, 2, 3, 4]) {
    const share = h.active.triggersPerRisk.filter((c) => c === v).length / h.active.risks;
    const observed = groups.filter((g) => g.triggers.length === v).length / N;
    const se = Math.sqrt((share * (1 - share)) / N);
    assert.ok(Math.abs(observed - share) < 3 * se, `count ${v}: ${observed} vs ${share}`);
  }
  const meanCount = groups.reduce((s, g) => s + g.triggers.length, 0) / N;
  assert.ok(Math.abs(meanCount - h.active.triggers / h.active.risks) < 0.02, `mean ${meanCount}`);
});

test('trigger base rate: 100,000 trigger outcomes average triggerBase within 0.005, also when copyShare is 0.9', () => {
  for (const copyShare of [0, 0.9]) {
    const P = withOverrides({ copyShare });
    const triggers = makeTriggerCards(P, makeRng(301).fork('triggers'), 37000);
    assert.ok(triggers.length > 99000, `only ${triggers.length} triggers`);
    const rate = mean(triggers.map((t) => t.y));
    assert.ok(Math.abs(rate - P.triggerBase) < 0.005, `copyShare ${copyShare}: rate ${rate} vs ${P.triggerBase}`);
  }
});

test('rhoD (the realised ICC of per-trigger score differences) at couplings 0, 0.5, 0.7, 0.9 is within 0.04 of the §A.6 table', () => {
  const table = { 0: 0.0, 0.5: 0.114, 0.7: 0.274, 0.9: 0.506 };
  for (const c of [0, 0.5, 0.7, 0.9]) {
    // c = 0.9 gives rho_lat 0.81, just outside the registered range; the coupling mapping is used as written in §A.6.
    const P = withOverrides({ ...couplingToParams(c), sigma: 2.36 });
    const r = populationGain(P, { benchmark: 'base_rate', k: 8, cards: 'trigger' });
    assert.ok(Math.abs(r.rhoD - table[c]) < 0.04, `coupling ${c}: rhoD ${r.rhoD} vs ${table[c]}`);
  }
});

