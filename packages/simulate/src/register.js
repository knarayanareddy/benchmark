// The ACAPS-facing register of judgement calls (power-spec §R, §F WP8b). Generated only from assumptions.json,
// so the register and the simulator cannot disagree. Plain language: no statistical jargon (see PLAIN_BANNED).
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { BANNER } from './label.js';
import { reviewSummary } from './assumptions.js';

/** @typedef {import('./assumptions.js').Assumptions} Assumptions */
/** @typedef {import('./assumptions.js').Entry} Entry */

export const DOC_PATH = fileURLToPath(new URL('../../../docs/15-judgement-calls.md', import.meta.url));
export const DOC_DISPLAY = 'docs/15-judgement-calls.md';
export const REGISTER_RUN_ID = 'register';
export const OUT_DIR = fileURLToPath(new URL('../out', import.meta.url));

/** The header text for docs/15, verbatim from power-spec §R. */
export const HEADER_TEXT = 'Every number in the power study that we had to choose rather than measure. These are our judgement calls, made because ACAPS cannot share its underlying records and asked us to make them. You may veto any of them. The study says what the pilot design could detect if experts behave in the way described here. It does not show that the panel is accurate.';

/** Jargon that must not appear in the register (power-spec §F WP8 lint). `Brier` is allowed only before "points" or "score". */
export const PLAIN_BANNED = Object.freeze([
  /\blogit/i,
  /\bICC\b/,
  /\bbootstrap/i,
  /\bquantile/i,
  /\bWilson\b/,
  /\bposterior/i,
  /\bheteroscedastic/i,
  /σ/,
  /β/,
  /\bBrier\b(?!\s+(?:points?|scores?)\b)/,
]);

const TAG_MEANING = {
  RAN: 'RAN: measured by running code on the pilot data or in prototype runs',
  DOC: 'DOC: taken from our own documents',
  INFERRED: 'INFERRED: worked out from a measured result',
  ASSUMED: 'ASSUMED: a judgement with no measurement behind it',
  CODE: 'CODE: fixed by existing code or the protocol',
};

/** Evidence notes in assumptions.json that mark a call as open (an unresolved source conflict, or a request for the owner to confirm). */
const OPEN_NOTE = /CONFLICT, unresolved|owner (?:should|must) (?:confirm|choose)/;

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const sentence = (s) => (/[.!?]$/.test(s) ? s : `${s}.`);

/** @param {unknown} v @returns {string} */
function fmtValue(v) {
  if (v === null) return 'blank';
  if (typeof v === 'string') return `\`${v}\``;
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'number') return String(v);
  if (Array.isArray(v)) return `[${v.map(fmtValue).join(', ')}]`;
  return Object.entries(/** @type {Record<string, unknown>} */ (v)).map(([k, x]) => `${k} ${fmtValue(x)}`).join(', ');
}

/** @param {Record<string, unknown>} range @returns {string} */
function fmtRange(range) {
  const parts = Array.isArray(range.oneOf)
    ? [`one of ${range.oneOf.map(fmtValue).join(', ')}`]
    : [`${range.min} to ${range.max}`];
  if (range.nullable === true) parts.push('blank allowed');
  return parts.join('; ');
}

/** @param {Entry['review']} review @returns {string} */
function fmtReview(review) {
  const who = review.by ?? '';
  const when = review.date ?? '';
  switch (review.state) {
    case 'accepted':
      return `Accepted by ${who} on ${when}. Note: ${sentence(review.note ?? '')}`;
    case 'changed':
      return `Changed by ${who} on ${when}. The value above is the changed value. Note: ${sentence(review.note ?? '')}`;
    case 'vetoed':
      return `Vetoed by ${who} on ${when}. The value above replaces the vetoed one. Note: ${sentence(review.note ?? '')}`;
    default:
      return 'Not yet reviewed by ACAPS (proposed).';
  }
}

/** @param {Entry} entry @returns {string} */
function renderEntry(entry) {
  const lines = [`## ${entry.id}`, ''];
  lines.push(`**What it is.** ${entry.plain}`, '');
  const options = entry.options.length > 0
    ? entry.options.join('; ')
    : 'No alternatives: fixed by existing rules.';
  lines.push(`**Options considered.** ${sentence(options)}`, '');
  lines.push('**Value chosen.**');
  for (const key of entry.keys) {
    lines.push(`- Parameter \`${key}\`: ${fmtValue(entry.value[key])} (allowed: ${fmtRange(/** @type {Record<string, unknown>} */ (entry.range[key]))})`);
  }
  lines.push('', `**Why.** ${entry.why}`, '');
  const refs = entry.evidence.refs ?? [];
  const files = refs.length > 0 ? ` Data files: ${refs.join(', ')}.` : '';
  lines.push(`**Evidence.** ${entry.evidence.tag}. Source: ${sentence(entry.evidence.source)} ${sentence(entry.evidence.note)}${files}`, '');
  if (OPEN_NOTE.test(entry.evidence.note)) lines.push('**Open: owner to choose.** The sources disagree or the owner has been asked to confirm (see the evidence above).', '');
  lines.push(`**Who may veto.** ${entry.veto}`, '');
  lines.push(`**Review state.** ${fmtReview(entry.review)}`, '');
  lines.push('**What changes if this is wrong.**');
  for (const item of entry.ifWrong) {
    lines.push(`- Setting: ${sentence(item.setting)} Result: ${sentence(item.result)} (Evidence: ${item.tag}; source: ${sentence(item.source)})`);
  }
  return lines.join('\n');
}

/**
 * The register as markdown: header, how to veto, review status, a reading guide, one block per judgement call,
 * and what the register is not. Same input, same bytes: nothing here reads the clock.
 * @param {Readonly<Assumptions>} assumptions
 * @returns {string}
 */
export function renderRegister(assumptions) {
  const summary = reviewSummary(assumptions);
  const total = assumptions.entries.length;
  const blocks = [
    `> **${BANNER}**\n>\n> ${plural(summary.proposed, 'judgement call')} not yet reviewed by ACAPS.`,
    '# Judgement calls behind the ACAPS pilot power study',
    HEADER_TEXT,
    '**How to veto.** Tell the study team the call\'s id (for example J05), the value you want instead, your name or role, and the date. The change is recorded in assumptions.json with the reviewer, the date and a note. The register and every table are then regenerated from that file, and the entry shows its review state. Nothing changes until it is recorded this way.',
    `**Unreviewed: ${summary.proposed} of ${plural(total, 'judgement call')} not yet reviewed by ACAPS.** Reviewed so far: ${summary.accepted} accepted, ${summary.changed} changed, ${summary.vetoed} vetoed.`,
    `**How to read the evidence labels.** ${Object.values(TAG_MEANING).join('. ')}. RAN results come from prototype runs; the full simulator replaces them. A blank value means the simulator works it out, or that ACAPS decides (see the entry).`,
    ...assumptions.entries.map(renderEntry),
    '## What this register is not',
    'This register is not a result. It says what the pilot design could detect if experts behave the way described here, under these calls. It never says that the panel is accurate, that it will beat ACAPS, or that a gain is likely. Change a call and the conclusions move with it.',
    `> **${BANNER}**`,
  ];
  return `${blocks.join('\n\n')}\n`;
}

/**
 * Checks that every key in assumptions.json is listed under its own judgement call in the register text, and that
 * the register lists no key that the entry does not own. Plain-language problems; empty means covered.
 * @param {Readonly<Assumptions>} assumptions
 * @param {string} text register markdown (the committed doc, or a fresh render)
 * @returns {string[]}
 */
export function registerCoverage(assumptions, text) {
  /** @type {string[]} */
  const problems = [];
  const parts = text.split(/^## (J\d{2})\s*$/m);
  /** @type {Map<string, string>} */
  const blocks = new Map();
  for (let i = 1; i < parts.length; i += 2) blocks.set(parts[i], parts[i + 1]);
  const ids = new Set(assumptions.entries.map((e) => e.id));

  for (const entry of assumptions.entries) {
    const body = blocks.get(entry.id);
    if (body === undefined) {
      problems.push(`The judgement call ${entry.id} is in assumptions.json but missing from the register.`);
      continue;
    }
    const listed = [...body.matchAll(/^- Parameter `([^`]+)`/gm)].map((m) => m[1]);
    for (const key of entry.keys) {
      if (!listed.includes(key)) problems.push(`The key "${key}" (${entry.id}) is in assumptions.json but not in the register.`);
    }
    for (const key of listed) {
      if (!entry.keys.includes(key)) problems.push(`The register lists "${key}" under ${entry.id}, but ${entry.id} does not own that key in assumptions.json.`);
    }
  }
  for (const id of blocks.keys()) {
    if (!ids.has(id)) problems.push(`The register has ${id}, which is not in assumptions.json.`);
  }
  return problems;
}

const REGEN_HINT = 'Regenerate it with: node packages/simulate/bin/make-register.mjs --write-docs';

/**
 * The drift and coverage check behind bin/check-register.mjs. Returns plain-language problems; empty means it passes.
 * @param {{ assumptions: Readonly<Assumptions>, docPath?: string }} opts
 * @returns {string[]}
 */
export function checkRegister({ assumptions, docPath = DOC_PATH }) {
  if (!existsSync(docPath)) return [`${DOC_DISPLAY} is missing. ${REGEN_HINT}`];
  const committed = readFileSync(docPath, 'utf8');
  /** @type {string[]} */
  const problems = [];
  if (committed !== renderRegister(assumptions)) {
    problems.push(`${DOC_DISPLAY} differs from a fresh render of assumptions.json. ${REGEN_HINT}`);
  }
  problems.push(...registerCoverage(assumptions, committed));
  return problems;
}
