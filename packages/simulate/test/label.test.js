import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BANNER,
  BANNER_UPPER,
  REAL_BANNER,
  simCardId,
  assertNotSynthetic,
  markSynthetic,
  csvHeaderLines,
} from '../src/label.js';

test('the synthetic banner is the stated sentence, and the CSV banner is the upper-case form', () => {
  assert.equal(BANNER, 'SYNTHETIC: simulation under stated assumptions, not a result');
  assert.equal(BANNER_UPPER, 'SIMULATION UNDER STATED ASSUMPTIONS, NOT A RESULT');
});

test('simulated card ids are SIM-nnnnnn for risks and SIM-Tnnnnnn for triggers', () => {
  assert.equal(simCardId(1), 'SIM-000001');
  assert.equal(simCardId(42, 'risk'), 'SIM-000042');
  assert.equal(simCardId(1, 'trigger'), 'SIM-T000001');
  assert.equal(simCardId(1234567), 'SIM-1234567');
  assert.throws(() => simCardId(0), RangeError);
  assert.throws(() => simCardId(1.5), RangeError);
  assert.throws(() => simCardId(1, 'expert'), RangeError);
});

test('assertNotSynthetic refuses an object flagged synthetic', () => {
  assert.throws(() => assertNotSynthetic({ synthetic: true, id: 'R0990' }));
});

test('assertNotSynthetic refuses a SIM- id, risk or trigger, object or bare string', () => {
  assert.throws(() => assertNotSynthetic({ id: 'SIM-T000001' }), /SIM-T000001/);
  assert.throws(() => assertNotSynthetic({ id: 'SIM-000001' }), /SIM-000001/);
  assert.throws(() => assertNotSynthetic('SIM-000001'));
});

test('assertNotSynthetic looks inside arrays', () => {
  assert.throws(() => assertNotSynthetic([{ id: 'R0990' }, { id: 'SIM-000002' }]));
  assert.throws(() => assertNotSynthetic([{ synthetic: true }]));
});

test('assertNotSynthetic accepts real-looking inputs', () => {
  assert.doesNotThrow(() => assertNotSynthetic({ id: 'R0990' }));
  assert.doesNotThrow(() => assertNotSynthetic({ id: 'R0990', synthetic: false }));
  assert.doesNotThrow(() => assertNotSynthetic({ id: 'XSIM-1' }));
  assert.doesNotThrow(() => assertNotSynthetic([{ id: 'R0990' }, { id: 'R1015' }]));
  assert.doesNotThrow(() => assertNotSynthetic(null));
  assert.doesNotThrow(() => assertNotSynthetic(42));
});

test('markSynthetic returns a flagged copy that assertNotSynthetic then refuses', () => {
  const card = { id: 'R0990', a: 0.1 };
  const marked = markSynthetic(card);
  assert.equal(marked.synthetic, true);
  assert.equal(card.synthetic, undefined, 'the original is not mutated');
  assert.throws(() => assertNotSynthetic(marked));
});

test('CSV first lines: synthetic banner with seed and run; real banner for REAL-* files', () => {
  assert.deepEqual(csvHeaderLines({ seed: 20261107, runId: '20261107-seed20261107' }), [
    '# SIMULATION UNDER STATED ASSUMPTIONS, NOT A RESULT. Seed=20261107, run=20261107-seed20261107',
  ]);
  assert.deepEqual(csvHeaderLines({ seed: 1, runId: 'r', real: true }), [REAL_BANNER]);
  assert.equal(REAL_BANNER, '# REAL DATA (historical, already resolved), not simulated.');
});
