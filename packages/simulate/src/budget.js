/**
 * Run-time budget (power-spec §B.6): plan replicate counts so a report fits its time limit, guard a run while it is
 * going, and provide the --quick scale. Pure except for the clock, which is injectable for tests.
 */
import { performance } from 'node:perf_hooks';

/**
 * @typedef {{ id: string, costMsPerRep: number, R: number }} Section
 */

/**
 * Scale every section's replicate count so the projected total fits budgetSec. Never goes below minR, and never
 * raises a section above the count it asked for. When even minR does not fit, `fits` is false and the caller must
 * report it.
 * @param {Section[]} sections
 * @param {number} budgetSec
 * @param {number} [minR]
 * @returns {{ scale: number, R: Record<string, number>, projectedSec: number, fits: boolean, budgetSec: number, minR: number }}
 */
export function planReps(sections, budgetSec, minR = 300) {
  if (!Array.isArray(sections) || sections.length === 0) throw new TypeError('planReps needs at least one section');
  if (!(budgetSec > 0)) throw new RangeError(`budgetSec must be positive, got ${budgetSec}`);
  if (!Number.isInteger(minR) || minR < 1) throw new RangeError(`minR must be a positive integer, got ${minR}`);
  for (const s of sections) {
    if (typeof s.id !== 'string' || s.id === '') throw new TypeError('each section needs an id');
    if (!(s.costMsPerRep > 0)) throw new RangeError(`section ${s.id} needs a positive costMsPerRep`);
    if (!Number.isInteger(s.R) || s.R < 1) throw new RangeError(`section ${s.id} needs an integer R >= 1`);
  }
  const fullSec = sections.reduce((t, s) => t + (s.costMsPerRep * s.R) / 1000, 0);
  const scale = fullSec <= budgetSec ? 1 : budgetSec / fullSec;
  /** @type {Record<string, number>} */
  const R = {};
  for (const s of sections) {
    R[s.id] = scale === 1 ? s.R : Math.max(Math.min(minR, s.R), Math.floor(s.R * scale));
  }
  const projectedSec = sections.reduce((t, s) => t + (s.costMsPerRep * R[s.id]) / 1000, 0);
  return { scale, R, projectedSec, fits: projectedSec <= budgetSec, budgetSec, minR };
}

/**
 * The --quick scale: R ÷ 5, rounded, at least 1.
 * @param {number} R
 */
export function quickReps(R) {
  if (!Number.isInteger(R) || R < 1) throw new RangeError(`R must be a positive integer, got ${R}`);
  return Math.max(1, Math.round(R / 5));
}

/**
 * Wall-clock guard for a run. Call `shouldStop(where)` between units of work; once the elapsed time exceeds the
 * budget it returns true and records where the run stopped. `report()` says what happened.
 * @param {{ budgetSec: number, clock?: () => number }} opts clock returns milliseconds
 */
export function makeGuard(opts) {
  const { budgetSec } = opts;
  if (!(budgetSec > 0)) throw new RangeError(`budgetSec must be positive, got ${budgetSec}`);
  const clock = opts.clock ?? (() => performance.now());
  const start = clock();
  /** @type {string | null} */
  let stoppedAt = null;
  /** @param {number} [now] */
  const elapsed = (now = clock()) => (now - start) / 1000;
  return {
    elapsedSec: () => elapsed(),
    remainingSec: () => budgetSec - elapsed(),
    /** @param {string} where the unit of work about to start */
    shouldStop(where) {
      if (stoppedAt !== null) return true;
      if (elapsed() > budgetSec) {
        stoppedAt = where;
        return true;
      }
      return false;
    },
    report() {
      return { budgetSec, elapsedSec: elapsed(), stopped: stoppedAt !== null, stoppedAt };
    },
  };
}
