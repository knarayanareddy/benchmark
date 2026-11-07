/**
 * Versioned consent. The text an expert is shown is rendered from LEVEL_COPY,
 * so the promise on screen and the promise on record cannot drift, and what is
 * stored is a hash of the exact text shown at that version.
 */
import { LEVELS, LEVEL_COPY } from '@benchmark/core/anonymity';
import { sha256, toHex } from '@benchmark/core/hmac';

export const CONSENT_VERSION = '2026-11-v1';
export const RETENTION_MONTHS = 12;

export const RESIDUAL_RISK = Object.freeze({
  [LEVELS.IDENTIFIED]: 'ACAPS and your colleagues can see your name next to what you say.',
  [LEVELS.PSEUDONYMOUS]:
    'ACAPS knows who you are. Colleagues see a stable alias. Your writing style or role can still identify you to people who know you.',
  [LEVELS.ANONYMOUS]:
    'ACAPS cannot see who you are in normal use. Anyone with server access AND the deployment secrets could in principle re-link your estimates to you. Anonymous comments cannot be linked back to you, so they cannot be erased on request.',
});

export function consentText(level) {
  const c = LEVEL_COPY[level];
  if (!c) throw new RangeError(`no consent text for level ${JSON.stringify(level)}`);
  return [
    `Consent ${CONSENT_VERSION} - ${c.label}`,
    `To ACAPS: ${c.toAcaps}`,
    `To other experts: ${c.toPeers}`,
    `Caution: ${c.warn}`,
    `Residual risk: ${RESIDUAL_RISK[level]}`,
    `Retention: individual answers are deleted ${RETENTION_MONTHS} months after the question resolves; only released aggregates are kept.`,
    'You can export or erase your data at any time.',
  ].join('\n');
}

export const consentHash = (level) => toHex(sha256(consentText(level)));
