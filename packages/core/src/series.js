/**
 * Panel series for one card: one point per released round, from the ledger
 * documents `answers.releases` written by service.js `cardRelease()`.
 *
 * Privacy: a release below the floor, or without a usable published snapshot,
 * is WITHHELD as `{ round }` only. The floor can be raised but never lowered
 * below MIN_RELEASE_PANEL_SIZE (5), matching aggregate.js.
 *
 * Pure: no storage, no network, no clock.
 */

import { MIN_RELEASE_PANEL_SIZE } from './aggregate.js';
import { coarsenToDay } from './anonymity.js';

const finite = (v) => typeof v === 'number' && Number.isFinite(v);

/**
 * @param {unknown[]} releases ledger documents for one card
 * @param {{ floor?: number }} [opts]
 * @returns {{ points: Array<{ round: number, day: string, n: number, estimate: number, lo: number, hi: number }>, withheld: Array<{ round: number }> }}
 */
export function buildSeries(releases, { floor = MIN_RELEASE_PANEL_SIZE } = {}) {
  if (!Array.isArray(releases)) throw new TypeError('releases must be an array');
  const effectiveFloor = Math.max(MIN_RELEASE_PANEL_SIZE, floor);

  const docs = releases
    .filter((doc) => doc && typeof doc === 'object' && finite(/** @type {any} */ (doc).round))
    .sort((a, b) => /** @type {any} */ (a).round - /** @type {any} */ (b).round);

  const points = [];
  const withheld = [];
  for (const doc of docs) {
    const d = /** @type {any} */ (doc);
    const snap = d.snapshot;
    const usable = snap && typeof snap === 'object' && snap.suppressed !== true && snap.releaseHeld !== true
      && finite(snap.estimate) && finite(snap.lo) && finite(snap.hi);
    if (!finite(d.n) || d.n < effectiveFloor || !usable) {
      withheld.push({ round: d.round });
      continue;
    }
    let day;
    try {
      day = coarsenToDay(d.at).day;
    } catch {
      withheld.push({ round: d.round });
      continue;
    }
    points.push({ round: d.round, day, n: d.n, estimate: snap.estimate, lo: snap.lo, hi: snap.hi });
  }
  return { points, withheld };
}
