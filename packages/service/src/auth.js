/**
 * Tokens, roles and permissions. No passwords anywhere: experts arrive through
 * a single-use invite bound to their Declaration; staff arrive through an
 * identity provider (SSO) that the transport layer verifies.
 */
import crypto from 'node:crypto';
import { sha256, toHex } from '@benchmark/core/hmac';

export const ROLES = Object.freeze({ EXPERT: 'expert', ANALYST: 'analyst', MODERATOR: 'moderator' });

const ANALYST = ['release.read', 'card.author', 'dissent.read', 'dissent.route', 'dissent.act', 'dissent.notify', 'dissent.close'];
export const PERMISSIONS = Object.freeze({
  [ROLES.EXPERT]: Object.freeze(['inbox.read', 'estimate.submit', 'dissent.submit', 'release.read', 'me.manage']),
  [ROLES.ANALYST]: Object.freeze(ANALYST),
  // Moderator is a SEPARATE, higher role: analysts cannot invite, close rounds,
  // resolve outcomes, read the audit log or run retention.
  [ROLES.MODERATOR]: Object.freeze([
    ...ANALYST, 'invite.create', 'round.manage', 'card.resolve', 'audit.read', 'retention.run',
  ]),
});

export const can = (actor, permission) =>
  Boolean(actor) && (PERMISSIONS[actor.role] || []).includes(permission);

export const newToken = () => crypto.randomBytes(32).toString('base64url');
/** Tokens are 256-bit random, so an unsalted SHA-256 is a sound at-rest form. */
export const hashToken = (token) => toHex(sha256(String(token)));
