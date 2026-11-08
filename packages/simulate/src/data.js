/**
 * The only file in the simulator that reads repository data: the organisers' risk radar export, through the repo's own
 * normaliser. Everything here is counted from that file; nothing is typed in.
 */
import { readFileSync } from 'node:fs';
import { normaliseRisk } from '@benchmark/core/radar';
import { ACAPS_BANDS, BAND_MIDPOINT } from '@benchmark/core/aggregate';
import { expit } from './rng.js';

const DEFAULT_FILE = new URL('../../../data/risk-radar.json', import.meta.url);

/**
 * Band index (0 = Very Low … 4 = Very High) of a rating label, or null when the rating is blank.
 * @param {string | null} label
 * @returns {0|1|2|3|4|null}
 */
function bandIndex(label) {
  if (label === null) return null;
  const i = ACAPS_BANDS.findIndex((b) => b.label === label);
  if (i < 0) throw new RangeError(`unknown ACAPS rating ${label}`);
  return /** @type {0|1|2|3|4} */ (i);
}

/**
 * @param {string | URL} file
 * @returns {ReturnType<typeof normaliseRisk>[]}
 */
function readRisks(file) {
  const raw = JSON.parse(readFileSync(file, 'utf8'));
  if (!Array.isArray(raw)) throw new TypeError(`${file} must hold an array of radar records`);
  return raw.map(normaliseRisk).filter((r) => r.id !== '');
}

/**
 * Counts from the radar export. `resolved` has one entry per risk with an outcome (104); `band` and `a` are null for
 * the resolved risks that carry no rating (5). Band counts, hits and rates use only the rated ones (99).
 * @param {string | URL} [file] defaults to data/risk-radar.json
 */
export function loadHistorical(file = DEFAULT_FILE) {
  const risks = readRisks(file);
  const resolvedRisks = risks.filter((r) => r.outcome !== null);

  /** @type {Array<{ id: string, band: 0|1|2|3|4|null, a: number|null, y: 0|1 }>} */
  const resolved = resolvedRisks.map((r) => {
    const band = bandIndex(r.probability);
    return {
      id: r.id,
      band,
      a: band === null ? null : BAND_MIDPOINT[ACAPS_BANDS[band].label],
      y: /** @type {0|1} */ (r.outcome),
    };
  });

  const bandCounts = [0, 0, 0, 0, 0];
  const bandHits = [0, 0, 0, 0, 0];
  for (const r of resolved) {
    if (r.band === null) continue;
    bandCounts[r.band] += 1;
    bandHits[r.band] += r.y;
  }
  const rated = bandCounts.reduce((s, c) => s + c, 0);
  const materialised = resolved.reduce((s, r) => s + r.y, 0);

  const activeRisks = risks.filter((r) => r.status === 'Active');
  const activeMix = [0, 0, 0, 0, 0];
  for (const r of activeRisks) {
    const band = bandIndex(r.probability);
    if (band !== null) activeMix[band] += 1;
  }
  const triggersPerRisk = activeRisks.map((r) => r.triggers.length);

  return {
    total: risks.length,
    n: resolved.length,
    materialised,
    rated,
    base: materialised / resolved.length,
    bandCounts,
    bandHits,
    bandRates: bandCounts.map((c, b) => bandHits[b] / c),
    activeMix,
    active: {
      risks: activeRisks.length,
      triggers: triggersPerRisk.reduce((s, c) => s + c, 0),
      triggersPerRisk,
    },
    resolved,
  };
}

/** Standard-normal quadrature: trapezoid on [-12, 12]. Converges very fast for a Gaussian-weighted smooth integrand. */
const Z_GRID = (() => {
  const lo = -12;
  const hi = 12;
  const m = 4800;
  const h = (hi - lo) / m;
  const zs = [];
  const ws = [];
  for (let i = 0; i <= m; i++) {
    const z = lo + i * h;
    zs.push(z);
    const endpoint = i === 0 || i === m ? 0.5 : 1;
    ws.push((endpoint * h * Math.exp(-0.5 * z * z)) / Math.sqrt(2 * Math.PI));
  }
  return { zs, ws };
})();

/**
 * E[σ(o + τZ)] for Z ~ 𝒩(0,1), by quadrature.
 * @param {number} o @param {number} tau
 */
function meanExpit(o, tau) {
  let s = 0;
  for (let i = 0; i < Z_GRID.zs.length; i++) s += Z_GRID.ws[i] * expit(o + tau * Z_GRID.zs[i]);
  return s;
}

/**
 * Offsets o_b with E[σ(o_b + τZ)] = rate_b for each band, so the band's hit rate is reproduced exactly. `shift` is added
 * to every offset afterwards (a target base rate moves all bands together; the midpoints do not move).
 * @param {number[]} rates each strictly inside (0, 1)
 * @param {number} tau latent spread, > 0
 * @param {number} [shift]
 * @returns {number[]}
 */
export function bandOffsets(rates, tau, shift = 0) {
  if (!(tau > 0)) throw new RangeError(`tau must be positive, got ${tau}`);
  return rates.map((rate) => {
    if (!(rate > 0 && rate < 1)) throw new RangeError(`rate must be strictly inside (0, 1), got ${rate}`);
    let lo = -40;
    let hi = 40;
    for (let it = 0; it < 80; it++) {
      const mid = (lo + hi) / 2;
      if (meanExpit(mid, tau) < rate) lo = mid;
      else hi = mid;
    }
    return (lo + hi) / 2 + shift;
  });
}

/**
 * Mean and variance of L = o_b + τZ when the band b has probability w_b (weights are normalised here).
 * Var(L) = τ² + between-band variance (law of total variance).
 * @param {number[]} w
 * @param {number[]} offsets
 * @param {number} tau
 * @returns {{ mean:number, variance:number }}
 */
export function latentMoments(w, offsets, tau) {
  if (w.length !== offsets.length) throw new RangeError('weights and offsets must have the same length');
  const total = w.reduce((s, x) => s + x, 0);
  const p = w.map((x) => x / total);
  const mean = p.reduce((s, pb, b) => s + pb * offsets[b], 0);
  const between = p.reduce((s, pb, b) => s + pb * (offsets[b] - mean) ** 2, 0);
  return { mean, variance: tau * tau + between };
}

/**
 * Trigger-scale intercept μ with E[σ(μ + spread·Z)] = base.
 * @param {number} base strictly inside (0, 1)
 * @param {number} spread > 0
 * @returns {number}
 */
export function muForBase(base, spread) {
  return bandOffsets([base], spread)[0];
}
