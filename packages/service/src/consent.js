/**
 * Versioned consent. The text an expert is shown is rendered from LEVEL_COPY and
 * from what this deployment can actually do, so the promise on screen and the
 * promise on record cannot drift, and what is stored is a hash of the exact text
 * shown at that version.
 */
import { LEVELS, LEVEL_COPY } from '@benchmark/core/anonymity';
import { sha256, toHex } from '@benchmark/core/hmac';

export const CONSENT_VERSION = '2026-11-v3';
export const RETENTION_MONTHS = 12;

/**
 * @typedef {{ breakGlass?: boolean, device?: boolean }} ConsentOptions
 * `breakGlass`: this deployment has a safety-override key configured.
 * `device`: the expert chose a device-held key (blind-signed ballots).
 */

/** @param {string} level @param {ConsentOptions} [o] */
function residualRisk(level, { breakGlass = false, device = false } = {}) {
  if (level === LEVELS.IDENTIFIED) return 'ACAPS and your colleagues can see your name next to what you say.';
  if (level === LEVELS.PSEUDONYMOUS) {
    return 'ACAPS knows who you are. Colleagues see a stable alias. Your writing style or role can still identify you to people who know you.';
  }
  if (device) {
    return 'Your answers are numbered with a key that only your device holds, so nobody at ACAPS or running the service can tell which answers are yours, and nothing can be opened for a safety concern. Two limits remain: the network can still show that your device contacted the service around the time an answer arrived, and if you lose your recovery code you cannot revise or erase those answers. Anonymous comments cannot be linked back to you, so they cannot be erased on request.';
  }
  const override = breakGlass
    ? ' Safety override: if an anonymous objection you send raises a serious safety or legal concern, two ACAPS moderators together can open the sealed note saying who sent it. You would be told afterwards, with the date and the kind of concern. Anonymous estimates (the numbers) are never opened this way.'
    : ' No safety override is configured: nobody at ACAPS can open an anonymous objection back to you.';
  return `ACAPS cannot see who you are in normal use. Anyone with server access AND the deployment secrets could in principle re-link your estimates to you.${override} Anonymous comments cannot be erased on request.`;
}

/** @param {string} level @param {ConsentOptions} [o] */
export function consentText(level, o = {}) {
  const c = LEVEL_COPY[level];
  if (!c) throw new RangeError(`no consent text for level ${JSON.stringify(level)}`);
  return [
    `Consent ${CONSENT_VERSION} - ${c.label}${o.device ? ' (device-held key)' : ''}`,
    `To ACAPS: ${c.toAcaps}`,
    `To other experts: ${c.toPeers}`,
    `Caution: ${c.warn}`,
    `Residual risk: ${residualRisk(level, o)}`,
    'Extra background: after the first round, some questions show extra background that is chosen at random, so we can learn whether it helps people forecast better or just pulls them toward one view. You can ignore it.',
    `Retention: individual answers are deleted ${RETENTION_MONTHS} months after the question resolves; only released aggregates are kept.`,
    'You can export or erase your data at any time.',
  ].join('\n');
}

/** @param {string} level @param {ConsentOptions} [o] */
export const consentHash = (level, o = {}) => toHex(sha256(consentText(level, o)));
