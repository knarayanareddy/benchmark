// Slow Monte Carlo cases moved out of the fast test folder so `npm test` stays quick. Run them with `npm run test:slow`. Assertions are unchanged.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bandOffsets } from '../../src/data.js';
import { makeRng } from '../../src/rng.js';

// Independent quadrature, a different grid from data.js (Simpson on [-15, 15]).
function expitIntegral(o, tau) {
  const m = 20000;
  const lo = -15;
  const h = 30 / m;
  let s = 0;
  for (let i = 0; i <= m; i++) {
    const z = lo + i * h;
    const w = i === 0 || i === m ? 1 : i % 2 === 1 ? 4 : 2;
    s += w * (1 / (1 + Math.exp(-(o + tau * z)))) * Math.exp(-0.5 * z * z);
  }
  return ((s * h) / 3) / Math.sqrt(2 * Math.PI);
}

test('bandOffsets reproduce each rate to 1e-6 on 200 random (rate, tau) pairs', () => {
  const rng = makeRng(20261107);
  for (let i = 0; i < 200; i++) {
    const rate = rng.uniform(0.02, 0.98);
    const tau = rng.uniform(0.3, 2);
    const [o] = bandOffsets([rate], tau);
    assert.ok(Math.abs(expitIntegral(o, tau) - rate) < 1e-6, `rate ${rate} tau ${tau}`);
  }
});

