/**
 * The risk radar: one record of the organisers' export (data/risk-radar.json) normalised for the app, and the
 * neutral view an expert may see before a risk's analysis is open to them. Pure: no storage, no clock.
 *
 * Empty strings become null for every optional text field (level, probability, impact, status, riskType, rationale,
 * trigger text). `country` and `title` stay strings ('' when missing). `outcome` is 0, 1 or null. `theme` comes from
 * the title alone: the rationale is hidden from experts, so it must not shape anything they can see.
 */
import { regionOfIsos, themeOfText } from './taxonomy.js';

/** @typedef {{ id: string, title: string | null, description: string | null }} Trigger */
/** @typedef {{ date: string | null, text: string }} RationaleUpdate */
/** @typedef {{ date: string, value: number | string }} HistoryEntry */
/**
 * The dated history ACAPS recorded, carried as source data for buildTimeline (timeline.js). Never part of neutralView.
 * @typedef {object} RiskTimeline
 * @property {string | null} riskTrend
 * @property {RationaleUpdate[]} rationaleUpdates
 * @property {{ id: string, title: string | null, description: string | null, completionHistory: HistoryEntry[], trendHistory: HistoryEntry[], dateEnteredISO: string | null, lastUpdateISO: string | null }[]} triggers
 */
/**
 * @typedef {object} Risk
 * @property {string} id
 * @property {string} title
 * @property {string} country
 * @property {string[]} isos
 * @property {string | null} region
 * @property {string} theme
 * @property {string | null} riskType
 * @property {string | null} status
 * @property {0 | 1 | null} outcome
 * @property {string | null} level
 * @property {string | null} probability
 * @property {string | null} impact
 * @property {string | null} rationale
 * @property {Trigger[]} triggers
 * @property {RiskTimeline} timeline
 */

/** @param {unknown} value @returns {string | null} */
function text(value) {
  if (typeof value !== 'string') return null;
  const t = value.trim();
  return t === '' ? null : t;
}

/**
 * The ISO codes of a record: `iso` is a comma-separated string ("COD, RWA"); an array is accepted too.
 * @param {unknown} iso @returns {string[]}
 */
function isosOf(iso) {
  const parts = Array.isArray(iso) ? iso : typeof iso === 'string' ? iso.split(',') : [];
  const codes = parts.map((p) => (typeof p === 'string' ? p.trim().toUpperCase() : '')).filter((p) => p !== '');
  return [...new Set(codes)];
}

/**
 * @param {Record<string, unknown>} raw
 * @returns {Trigger[]}
 */
function triggersOf(raw) {
  if (!Array.isArray(raw.triggerList)) return [];
  const out = [];
  for (const t of raw.triggerList) {
    if (!t || typeof t !== 'object') continue;
    const r = /** @type {Record<string, unknown>} */ (t);
    const id = text(r.triggerId);
    if (id) out.push({ id, title: text(r.title), description: text(r.description) });
  }
  return out;
}

/** @param {unknown} list @returns {Record<string, unknown>[]} */
function objectsOf(list) {
  return Array.isArray(list) ? list.filter((x) => x !== null && typeof x === 'object').map((x) => ({ ...x })) : [];
}

/**
 * @param {Record<string, unknown>} raw
 * @returns {RiskTimeline}
 */
function timelineOf(raw) {
  const triggers = [];
  for (const t of objectsOf(raw.triggerList)) {
    const id = text(t.triggerId);
    if (!id) continue;
    triggers.push({
      id,
      title: text(t.title),
      description: text(t.description),
      completionHistory: /** @type {HistoryEntry[]} */ (objectsOf(t.completionHistory)),
      trendHistory: /** @type {HistoryEntry[]} */ (objectsOf(t.trendHistory)),
      dateEnteredISO: typeof t.dateEnteredISO === 'string' ? t.dateEnteredISO : null,
      lastUpdateISO: typeof t.lastUpdateISO === 'string' ? t.lastUpdateISO : null,
    });
  }
  return {
    riskTrend: text(raw.riskTrend),
    rationaleUpdates: /** @type {RationaleUpdate[]} */ (objectsOf(raw.rationaleUpdates)),
    triggers,
  };
}

/**
 * One record of data/risk-radar.json, normalised. A record with no usable id still normalises (id ''); `loadRadar`
 * is the one that skips it.
 * @param {unknown} raw
 * @returns {Risk}
 */
export function normaliseRisk(raw) {
  const r = /** @type {Record<string, unknown>} */ (raw && typeof raw === 'object' ? raw : {});
  const isos = isosOf(r.iso);
  const title = typeof r.title === 'string' ? r.title.trim() : '';
  const rationale = text(r.rationale);
  const outcome = r.outcome === 0 || r.outcome === '0' ? 0 : r.outcome === 1 || r.outcome === '1' ? 1 : null;
  return {
    id: typeof r.id === 'string' ? r.id.trim() : '',
    title,
    country: typeof r.country === 'string' ? r.country.trim() : '',
    isos,
    region: regionOfIsos(isos),
    theme: themeOfText(title),
    riskType: text(r.riskType),
    status: text(r.status),
    outcome,
    level: text(r.riskLevel),
    probability: text(r.probability),
    impact: text(r.impact),
    rationale,
    triggers: triggersOf(r),
    timeline: timelineOf(r),
  };
}

/**
 * What an expert may see for a risk whose analysis is still held back. Exactly these seven keys; never status, outcome, level,
 * probability, impact, rationale or triggers.
 * @param {Risk} risk
 * @returns {{ id: string, title: string, country: string, isos: string[], region: string | null, theme: string, riskType: string | null }}
 */
export function neutralView(risk) {
  return {
    id: risk.id,
    title: risk.title,
    country: risk.country,
    isos: [...risk.isos],
    region: risk.region,
    theme: risk.theme,
    riskType: risk.riskType,
  };
}

/**
 * Normalise a whole export. A non-array gives an empty radar; records without an id are skipped; a repeated id keeps
 * its first record.
 * @param {unknown} rawArray
 * @returns {{ risks: Risk[], byId: Map<string, Risk> }}
 */
export function loadRadar(rawArray) {
  /** @type {Map<string, Risk>} */
  const byId = new Map();
  if (Array.isArray(rawArray)) {
    for (const raw of rawArray) {
      const risk = normaliseRisk(raw);
      if (risk.id && !byId.has(risk.id)) byId.set(risk.id, risk);
    }
  }
  const risks = [...byId.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { risks, byId };
}
