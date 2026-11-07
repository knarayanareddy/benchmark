/**
 * The service layer: the one place the pure core meets state.
 *
 * Every guarantee has exactly one choke point:
 *   - statistics leave ONLY through `cardRelease()`, which owns the release
 *     ledger (the memory the pure `releaseAggregate()` cannot have);
 *   - answers enter ONLY through `submitEstimate()`;
 *   - aliases are persisted per expert x country (`ensureAlias`), never
 *     recomputed, so a secret rotation cannot rename anyone;
 *   - every dissent/card transition is a compare-and-set on `version`;
 *   - every staff action is appended to the audit log.
 *
 * Secrets (ballot, alias) are passed in from the environment/KMS. They must not
 * live in either store, or "anonymous" collapses to "nobody read that table".
 */
import crypto from 'node:crypto';
import {
  LEVELS, resolveLevel, assignAliases, ballotToken, coarsenToDay, leaksBy,
} from '@benchmark/core/anonymity';
import {
  releaseAggregate, clampForecast, BAND_MIDPOINT,
} from '@benchmark/core/aggregate';
import { validateCardInput, RESOLUTION_SOURCES as SOURCES } from '@benchmark/core/authoring';
import { matches } from '@benchmark/core/dispatch';
import { hmacSha256Hex } from '@benchmark/core/hmac';
import * as blindrsa from '@benchmark/core/blind';
import {
  newDissent, route, act, notify, close, cardLedger, ACTION, KIND,
} from '@benchmark/domain/dissent';
import {
  ValidationError, AuthError, ForbiddenError, NotFoundError, ConflictError,
} from './errors.js';
import { can, ROLES, newToken, hashToken } from './auth.js';
import { CONSENT_VERSION, consentText, consentHash, RETENTION_MONTHS } from './consent.js';

export const BREAK_GLASS_CATEGORIES = Object.freeze(['safety_threat', 'safety_welfare', 'legal_obligation']);
const BREAK_GLASS_TTL_MS = 24 * 3600 * 1000;
const CATEGORY_LABEL = { safety_threat: 'a threat to someone\'s safety', safety_welfare: 'a welfare concern', legal_obligation: 'a legal obligation' };

export const RESOLUTION_SOURCES = SOURCES;
const STAFF_SESSION_TTL_MS = 12 * 3600 * 1000;
// Experts open the app now and then from a phone; a day-long session would make every visit a new invite.
const EXPERT_SESSION_TTL_MS = 30 * 24 * 3600 * 1000;
const INVITE_TTL_MS = 7 * 24 * 3600 * 1000;
const MIN_SECRET = 16;

/** @param {unknown} v @returns {v is string} */
const isStr = (v) => typeof v === 'string' && v.trim() !== '';
const strList = (v) => (Array.isArray(v) ? v.filter(isStr).map((s) => s.trim()) : []);
// A mistyped country makes a card nobody is ever told about, or an expert who is told about nothing.
const ISO3 = /^[A-Z]{3}$/;
const isoList = (v) => {
  const list = strList(v).map((s) => s.toUpperCase());
  const bad = list.filter((c) => !ISO3.test(c));
  if (bad.length) throw new ValidationError(`countries must be ISO 3-letter codes (like TCD); got ${bad.join(', ')}`);
  return list;
};

/**
 * @typedef {Record<string, any>} Doc
 * @typedef {{ id: string, role: string, kind: string, expertId?: string }} Actor
 */

/**
 * @param {{
 *   roster: any, answers: any, secrets: { ballot: string, alias: string }, now?: () => number, releasePolicy?: string,
 *   breakGlassPublicKey?: string, breakGlassPrivateKey?: string, blindKey?: string
 * }} deps
 * `breakGlassPublicKey` (RSA, PEM) turns the safety override on: an anonymous objection then carries its
 * sender's id sealed to that key. The private key is NOT needed to run the service; it is supplied at collection.
 * `blindKey` (RSA private key, PEM) turns on device-held ballots: blind-signed tokens an expert's device keeps.
 */
export function createService({ roster, answers, secrets, now = Date.now, releasePolicy, breakGlassPublicKey, breakGlassPrivateKey, blindKey } = /** @type {any} */ ({})) {
  if (!roster || !answers) throw new TypeError('createService needs { roster, answers }');
  for (const k of ['ballot', 'alias']) {
    if (typeof secrets?.[k] !== 'string' || secrets[k].length < MIN_SECRET) {
      throw new Error(`secrets.${k} is required (>= ${MIN_SECRET} chars), held outside the database`);
    }
  }
  if (secrets.ballot === secrets.alias) throw new Error('secrets.ballot and secrets.alias must differ');
  // Fail at start-up, not on the first anonymous answer.
  ballotToken(secrets.ballot, 'startup', 'check');
  if (breakGlassPublicKey) {
    const k = crypto.createPublicKey(breakGlassPublicKey);
    if (k.asymmetricKeyType !== 'rsa' || (k.asymmetricKeyDetails?.modulusLength ?? 0) < 2048) {
      throw new Error('breakGlassPublicKey must be an RSA key of at least 2048 bits');
    }
  }
  const sealIdentity = (/** @type {string} */ expertId) => crypto.publicEncrypt(
    { key: /** @type {string} */ (breakGlassPublicKey), padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' },
    Buffer.from(expertId)
  ).toString('base64');
  // Device-held ballots: blind RSA signatures (see @benchmark/core/blind and its warning).
  const blindPrivate = blindKey ? crypto.createPrivateKey(blindKey) : null;
  const blindJwk = blindPrivate ? crypto.createPublicKey(blindPrivate).export({ format: 'jwk' }) : null;
  if (blindPrivate && (blindPrivate.asymmetricKeyType !== 'rsa' || (blindPrivate.asymmetricKeyDetails?.modulusLength ?? 0) < 2048)) {
    throw new Error('blindKey must be an RSA key of at least 2048 bits');
  }
  const BN = blindJwk ? blindrsa.bytesToBig(Buffer.from(String(blindJwk.n), 'base64url')) : 0n;
  const BE = blindJwk ? blindrsa.bytesToBig(Buffer.from(String(blindJwk.e), 'base64url')) : 0n;
  const requireBlind = () => { if (!blindPrivate) throw new ConflictError('device-held ballots are not configured on this deployment'); };
  const HEX64 = /^[0-9a-f]{64}$/;
  /** @param {string} cardId @param {unknown} token @param {unknown} signature */
  const checkBallot = (cardId, token, signature) => {
    requireBlind();
    if (typeof token !== 'string' || !HEX64.test(token)) throw new ValidationError('token must be 64 hex characters');
    if (typeof signature !== 'string' || signature.length > blindrsa.modulusBytes(BN) * 2 || !/^[0-9a-f]+$/i.test(signature)) throw new ValidationError('signature must be hex');
    if (!blindrsa.verify(BN, BE, blindrsa.ballotMessage(cardId, token), blindrsa.bytesToBig(blindrsa.hexToBytes(signature.length % 2 ? `0${signature}` : signature)))) {
      throw new AuthError('ballot signature invalid');
    }
  };
  const consentOpts = (device = false) => ({ breakGlass: Boolean(breakGlassPublicKey), device });

  const t = () => now();
  const audit = (actor, action, target, reason = '') =>
    answers.audit.append({ at: t(), actorId: actor.id, role: actor.role, action, target, reason });
  const need = (actor, permission) => {
    if (!actor) throw new AuthError();
    if (!can(actor, permission)) throw new ForbiddenError(`${actor.role} may not ${permission}`);
  };
  const expertOf = async (actor) => {
    if (actor?.role !== ROLES.EXPERT) throw new ForbiddenError('experts only');
    const e = await roster.experts.get(actor.expertId);
    if (!e) throw new NotFoundError('expert not found');
    return e;
  };
  const respondentKey = (card, expert) =>
    expert.level === LEVELS.ANONYMOUS
      ? ballotToken(secrets.ballot, card.id, expert.id)
      : `id:${expert.id}`;
  const estimateKey = (cardId, key, round) => `${cardId}|${key}|${round}`;
  const getCard = async (id) => {
    const c = await answers.cards.get(id);
    if (!c) throw new NotFoundError(`card ${id} not found`);
    return c;
  };
  const updateCard = (card, patch) =>
    answers.cards.update(card.id, card.version, { ...card, ...patch, version: card.version + 1 });
  const getDissent = async (id, expectedVersion) => {
    const d = await answers.dissents.get(id);
    if (!d) throw new NotFoundError(`dissent ${id} not found`);
    if (!Number.isInteger(expectedVersion)) throw new ValidationError('expectedVersion (integer) is required');
    if (d.version !== expectedVersion) {
      throw new ConflictError(`dissent ${id} changed: you saw version ${expectedVersion}, it is now ${d.version}`);
    }
    return d;
  };
  const sessionFor = async (subject) => {
    const token = newToken();
    const ttl = subject.kind === 'expert' ? EXPERT_SESSION_TTL_MS : STAFF_SESSION_TTL_MS;
    // Sessions live in the roster store, never next to the answers.
    await roster.sessions.insert(hashToken(token), { subject, expiresAt: t() + ttl });
    return token;
  };
  /** A stable, non-reversible handle for logging an expert without naming them. */
  const hashTarget = (id) => hmacSha256Hex(secrets.alias, `audit:${id}`).slice(0, 16);

  // ── authentication ──────────────────────────────────────────────────────
  async function authenticate(token) {
    if (!isStr(token)) throw new AuthError();
    const s = await roster.sessions.get(hashToken(token));
    if (!s || s.expiresAt <= t()) throw new AuthError('session invalid or expired');
    return s.subject.kind === 'expert'
      ? { kind: 'expert', role: ROLES.EXPERT, expertId: s.subject.expertId, id: s.subject.expertId }
      : { kind: 'staff', role: s.subject.role, id: s.subject.id };
  }

  /** Called by the transport AFTER the identity provider has vouched for `staff`. */
  async function createStaffSession({ id, role }) {
    if (![ROLES.ANALYST, ROLES.MODERATOR].includes(role) || !isStr(id)) {
      throw new ValidationError('staff session needs an id and a role of analyst or moderator');
    }
    return sessionFor({ kind: 'staff', id, role });
  }

  /**
   * @param {Actor} actor
   * @param {{ declaration?: Doc, name?: string, ttlMs?: number }} [input]
   */
  async function createInvite(actor, { declaration, name, ttlMs = INVITE_TTL_MS } = {}) {
    need(actor, 'invite.create');
    const countries = isoList(declaration?.countries);
    if (countries.length === 0) {
      throw new ValidationError('a Declaration needs at least one country (an empty one would match every card)');
    }
    const expertId = `ex_${crypto.randomUUID()}`;
    const token = newToken();
    await roster.experts.insert(expertId, {
      id: expertId,
      name: isStr(name) ? name.trim() : null,
      declaration: { countries, regions: strList(declaration?.regions), themes: strList(declaration?.themes) },
      level: null,
      consent: null,
      createdAt: coarsenToDay(t()).ms,
    });
    await roster.invites.insert(hashToken(token), {
      expertId, expiresAt: t() + ttlMs, usedAt: null, version: 0,
    });
    await audit(actor, 'invite.create', hashTarget(expertId));
    return { token, expertId, expiresAt: t() + ttlMs };
  }

  /**
   * A fresh single-use link for an expert who already joined (new phone, expired session).
   * It changes nothing about their level or consent.
   * @param {Actor} actor @param {string} expertId
   */
  async function createReinvite(actor, expertId) {
    need(actor, 'invite.create');
    const e = await roster.experts.get(String(expertId));
    if (!e || !e.consent) throw new NotFoundError('no such expert, or they have not completed onboarding');
    const token = newToken();
    await roster.invites.insert(hashToken(token), { expertId: e.id, existing: true, expiresAt: t() + INVITE_TTL_MS, usedAt: null, version: 0 });
    await audit(actor, 'invite.reinvite', hashTarget(e.id));
    return { token, expertId: e.id, expiresAt: t() + INVITE_TTL_MS };
  }

  /** The roster as moderators need it to invite and re-invite. Level and key mode are deliberately not shown. @param {Actor} actor */
  async function listExperts(actor) {
    need(actor, 'invite.create');
    return (await roster.experts.all()).map((e) => ({
      id: e.id, name: e.name, countries: e.declaration?.countries ?? [], joined: Boolean(e.consent),
    }));
  }

  /** Single-use. The expert must pick a level and accept the exact text shown. */
  /**
   * @param {string} token
   * @param {{ level?: string, consentVersion?: string, mode?: string }} [input]
   */
  async function redeemInvite(token, { level, consentVersion, mode } = {}) {
    if (!isStr(token)) throw new AuthError('invite required');
    const key = hashToken(token);
    const inv = await roster.invites.get(key);
    if (!inv) throw new AuthError('invite not recognised');
    if (inv.usedAt !== null) throw new AuthError('invite already used');
    if (inv.expiresAt <= t()) throw new AuthError('invite expired');
    if (inv.existing) {
      // A returning expert: a fresh session for the same account. Level, consent and key mode do not change.
      try { await roster.invites.update(key, inv.version, { ...inv, usedAt: t(), version: inv.version + 1 }); } catch (e) {
        if (e instanceof ConflictError) throw new AuthError('invite already used');
        throw e;
      }
      const back = await roster.experts.get(inv.expertId);
      if (!back || !back.consent) throw new AuthError('this account no longer exists');
      return { sessionToken: await sessionFor({ kind: 'expert', expertId: back.id }), expertId: back.id, level: back.level, mode: back.tokenMode ?? 'server', returning: true };
    }
    const r = resolveLevel(level);
    if (!r.honoured) throw new ValidationError('choose an anonymity level: identified, pseudonymous or anonymous');
    const device = mode === 'device';
    if (device && r.level !== LEVELS.ANONYMOUS) throw new ValidationError('a device-held key applies to the anonymous level only');
    if (device) requireBlind();
    if (consentVersion !== CONSENT_VERSION) {
      throw new ValidationError(`consent must be given to version ${CONSENT_VERSION}`, { consentText: consentText(r.level, consentOpts(device)) });
    }
    // Compare-and-set makes redemption atomic: a second concurrent redeem loses.
    try {
      await roster.invites.update(key, inv.version, { ...inv, usedAt: t(), version: inv.version + 1 });
    } catch (e) {
      if (e instanceof ConflictError) throw new AuthError('invite already used');
      throw e;
    }
    const e = await roster.experts.get(inv.expertId);
    await roster.experts.put(e.id, {
      ...e,
      level: r.level,
      tokenMode: device ? 'device' : 'server',
      consent: { version: CONSENT_VERSION, textHash: consentHash(r.level, consentOpts(device)), at: coarsenToDay(t()).ms },
    });
    return { sessionToken: await sessionFor({ kind: 'expert', expertId: e.id }), expertId: e.id, level: r.level, mode: device ? 'device' : 'server' };
  }

  // ── cards ───────────────────────────────────────────────────────────────
  function checkCardInput(input, inherited = {}) {
    const r = validateCardInput({ ...inherited, ...input });
    if (!r.ok) throw new ValidationError(`card cannot open: ${r.problems.join('; ')}`, { problems: r.problems });
    return { c: r.card, warnings: r.warnings };
  }

  async function createCard(actor, input) {
    need(actor, 'card.author');
    const { c, warnings } = checkCardInput(input);
    const id = isStr(input.id) ? input.id.trim() : `C${crypto.randomBytes(4).toString('hex')}`;
    const card = await answers.cards.insert(id, {
      id, version: 0, parentId: null, status: 'open', round: 1,
      statement: c.statement.trim(), country: c.country, region: c.region ?? null, theme: c.theme ?? null,
      window: c.window, objective: c.objective.trim(), resolutionSource: c.resolutionSource, resolver: c.resolver,
      // ACAPS's own reading, for scoring and analysis. It is never sent to an expert before they lock Round 1.
      acapsBand: c.probability ?? null, acapsP: BAND_MIDPOINT[c.probability] ?? null,
      createdAt: coarsenToDay(t()).ms,
    });
    await audit(actor, 'card.create', id);
    return { card, warnings };
  }

  /** Staff overview. Counts are of respondents only; no answer, key or identity is returned. */
  async function listCards(actor) {
    need(actor, 'card.author');
    const out = [];
    for (const c of await answers.cards.all()) {
      const rows = await answers.estimates.find({ cardId: c.id, round: c.round });
      out.push({
        id: c.id, statement: c.statement, country: c.country, status: c.status, round: c.round,
        parentId: c.parentId, window: c.window, resolver: c.resolver, resolutionSource: c.resolutionSource,
        version: c.version, responses: rows.length,
      });
    }
    return out;
  }

  async function closeRound(actor, cardId) {
    need(actor, 'round.manage');
    const card = await getCard(cardId);
    if (card.status !== 'open') throw new ConflictError(`card ${cardId} is ${card.status}, not open`);
    const next = await updateCard(card, { status: 'closed' });
    await audit(actor, 'round.close', cardId, `round ${card.round}`);
    // Closing a round IS its release: the result is ledgered now, so Round 2 can
    // show it and no later call can publish a different one.
    await cardRelease(cardId);
    return next;
  }

  async function openRound2(actor, cardId) {
    need(actor, 'round.manage');
    const card = await getCard(cardId);
    if (card.status !== 'closed' || card.round !== 1) throw new ConflictError('round 2 opens only on a card whose round 1 is closed');
    const next = await updateCard(card, { status: 'open', round: 2 });
    await audit(actor, 'round.open2', cardId);
    return next;
  }

  async function resolveCard(actor, { cardId, outcome, evidenceUrl, reason = '' }) {
    need(actor, 'card.resolve');
    if (!(outcome === 0 || outcome === 1 || outcome === 'unobservable')) {
      throw new ValidationError('outcome must be 0, 1 or "unobservable"');
    }
    let url;
    try { url = new URL(String(evidenceUrl)); } catch { url = null; }
    if (!url || url.protocol !== 'https:') throw new ValidationError('an https evidenceUrl is required to resolve a card');
    const card = await getCard(cardId);
    if (card.status === 'retired' || card.status === 'resolved') throw new ConflictError(`card is ${card.status}`);
    const next = await updateCard(card, { status: 'resolved', outcome, evidenceUrl: url.href, resolvedAt: coarsenToDay(t()).ms });
    await audit(actor, 'card.resolve', cardId, reason);
    return next;
  }

  // ── estimates ───────────────────────────────────────────────────────────
  /**
   * @param {Actor} actor
   * @param {{ cardId?: string, p?: number }} [input]
   */
  async function submitEstimate(actor, { cardId, p } = {}) {
    need(actor, 'estimate.submit');
    const expert = await expertOf(actor);
    if (!expert.level || !expert.consent) throw new ForbiddenError('choose an anonymity level and consent first');
    if (expert.tokenMode === 'device') throw new ConflictError('your key is held on your device: submit through the anonymous endpoint with your blind-signed token');
    const card = await getCard(cardId);
    if (card.status !== 'open') throw new ConflictError(`card ${cardId} is not open for answers`);
    let clamped;
    try { clamped = clampForecast(/** @type {number} */ (p)); } catch (e) { throw new ValidationError(e instanceof Error ? e.message : String(e)); }
    const key = respondentKey(card, expert);
    if (card.round === 2 && !(await answers.estimates.get(estimateKey(card.id, key, 1)))) {
      throw new ConflictError('round 2 is a revision: you did not answer round 1');
    }
    const anonymous = expert.level === LEVELS.ANONYMOUS;
    try {
      await answers.estimates.insert(estimateKey(card.id, key, card.round), {
        cardId: card.id, respondentKey: key, round: card.round, level: expert.level, p: clamped,
        expertId: anonymous ? null : expert.id,
        at: anonymous ? coarsenToDay(t()).ms : t(),
      });
    } catch (e) {
      if (e instanceof ConflictError) throw new ConflictError('you have already answered this round');
      throw e;
    }
    return { cardId: card.id, round: card.round, p: clamped, clamped: clamped !== p };
  }

  // ── release: the single choke point for every panel statistic ──────────
  /**
   * @param {string} cardId
   * @param {{ visibility?: string, round?: number }} [opts]
   */
  async function cardRelease(cardId, { visibility = 'panel', round } = {}) {
    if (!['panel', 'public'].includes(visibility)) throw new ValidationError('visibility must be panel or public');
    const card = await getCard(cardId);
    if (round !== undefined && round < card.round) {
      // An earlier round's published result is read from the ledger, never recomputed,
      // so a live later round cannot leak through it.
      const prior = (await answers.releases.find({ cardId: card.id, round, visibility, closed: true }))
        .sort((a, b) => b.n - a.n)[0];
      return prior ? prior.snapshot : null;
    }
    const rows = await answers.estimates.find({ cardId: card.id });
    const estimates = rows.map((r) => ({
      p: r.p, round: r.round, level: r.level,
      ...(r.expertId ? { expertId: r.expertId } : { ballotToken: r.respondentKey }),
    }));
    // Round-closed state comes from the database, never from the caller.
    const closed = card.status !== 'open';
    const ledger = (await answers.releases.find({ cardId: card.id, round: card.round, visibility }))
      .sort((a, b) => a.n - b.n);
    const n = new Set(estimates.map((e) => e.expertId ?? e.ballotToken)).size;
    // Re-asking must never re-draw a different interval for the same panel.
    const same = ledger.find((x) => x.n === n && x.closed === closed);
    if (same) return same.snapshot;
    const previousSnapshot = ledger.length ? ledger[ledger.length - 1].snapshot : null;
    const snap = releaseAggregate(estimates, {
      closed, visibility, previousSnapshot, policy: releasePolicy, requireBallotKey: true,
    });
    if (!snap.suppressed && !snap.releaseHeld) {
      try {
        await answers.releases.append({
          cardId: card.id, round: card.round, visibility, n: snap.n, closed, at: t(), snapshot: snap,
        });
      } catch (e) {
        // A concurrent release won the unique (card, round, visibility, n, closed) slot: use theirs.
        if (!(e instanceof ConflictError)) throw e;
        const winner = (await answers.releases.find({ cardId: card.id, round: card.round, visibility }))
          .find((x) => x.n === snap.n && x.closed === closed);
        if (winner) return winner.snapshot;
        throw e;
      }
    }
    return snap;
  }

  // ── inbox: the pull path, so anonymous experts reach Round 2 ───────────
  const cardView = (c, extra = {}) => ({
    id: c.id, statement: c.statement, country: c.country, theme: c.theme, round: c.round,
    window: c.window, version: c.version, ...extra,
  });

  async function inbox(actor) {
    need(actor, 'inbox.read');
    const expert = await expertOf(actor);
    const toAnswer = [];
    const openForRevision = [];
    for (const card of await answers.cards.find({ status: 'open' })) {
      if (expert.tokenMode === 'device') {
        // The server cannot know which cards this device has answered; the device checks that itself.
        if (card.round === 1 && matches(card, expert.declaration)) toAnswer.push(cardView(card, { deviceHeld: true }));
        else if (card.round === 2) openForRevision.push(cardView(card, { release: await cardRelease(card.id, { round: 1 }), deviceHeld: true }));
        continue;
      }
      const key = respondentKey(card, expert);
      const mine = (round) => answers.estimates.get(estimateKey(card.id, key, round));
      if (card.round === 1 && matches(card, expert.declaration) && !(await mine(1))) {
        toAnswer.push(cardView(card));
      } else if (card.round === 2) {
        const first = await mine(1);
        if (first && !(await mine(2))) {
          openForRevision.push(cardView(card, { yourEstimate: first.p, release: await cardRelease(card.id, { round: 1 }) }));
        }
      }
    }
    const notifications = await answers.notifications.find({ to: expert.id });
    const notices = (await roster.notices.find({ expertId: expert.id })).map((n) => ({
      id: n.id, kind: n.kind, day: n.day,
      text: `On ${n.day}, two ACAPS moderators opened the sealed note on an anonymous objection you sent, because of ${CATEGORY_LABEL[n.category] ?? 'a serious concern'}.`,
    }));
    return { toAnswer, openForRevision, notifications, notices, deviceMode: expert.tokenMode === 'device' };
  }

  // ── dissent ─────────────────────────────────────────────────────────────
  async function ensureAlias(expert, country) {
    const existing = {};
    for (const a of await roster.aliases.find({ country })) existing[a.expertId] = a.alias;
    if (existing[expert.id]) return existing;
    const { aliases, added } = assignAliases(existing, [expert.id], country, { salt: secrets.alias });
    for (const [expertId, alias] of Object.entries(added)) {
      await roster.aliases.insert(`${expertId}|${country}`, { expertId, country, alias });
    }
    return aliases;
  }

  /**
   * @param {Actor} actor
   * @param {{ cardId?: string, kind?: string, text?: string }} [input]
   */
  async function submitDissent(actor, { cardId, kind, text = '' } = {}) {
    need(actor, 'dissent.submit');
    const expert = await expertOf(actor);
    if (!expert.level || !expert.consent) throw new ForbiddenError('choose an anonymity level and consent first');
    const card = await getCard(cardId);
    const dissentKind = String(kind);
    if (!(/** @type {string[]} */ (Object.values(KIND))).includes(dissentKind)) throw new ValidationError(`kind must be one of ${Object.values(KIND).join(', ')}`);
    const panelAliases = expert.level === LEVELS.PSEUDONYMOUS ? await ensureAlias(expert, card.country) : undefined;
    const d = newDissent({
      cardId: card.id, expert: expert.id, name: expert.name ?? undefined, country: card.country,
      kind: dissentKind, text: String(text).slice(0, 2000), level: expert.level, panelAliases, now: t(),
    });
    // The sealed note: who sent this, readable only with the break-glass private key and two moderators.
    if (d.level === LEVELS.ANONYMOUS && breakGlassPublicKey && expert.tokenMode !== 'device') d.sealedIdentity = sealIdentity(expert.id);
    await answers.dissents.insert(d.id, d);
    // Advice for the author, never a block: see leaksBy().
    const warnings = leaksBy({ text: d.text, name: expert.name, expertId: expert.id }, []);
    return { id: d.id, version: d.version, warnings };
  }

  const staffView = (actor, d) => {
    const out = actor.role === ROLES.MODERATOR ? { ...d, canBreakGlass: Boolean(d.sealedIdentity) } : { ...d, expert: undefined };
    delete out.sealedIdentity; // never leaves the service through a view
    return out;
  };

  /**
   * @param {Actor} actor
   * @param {{ status?: string }} [opts]
   */
  async function listDissents(actor, { status } = {}) {
    need(actor, 'dissent.read');
    return (await answers.dissents.find(status ? { status } : {})).map((d) => staffView(actor, d));
  }

  /**
   * @param {Actor} actor
   * @param {string} id
   * @param {{ expectedVersion?: number, queue?: string }} [opts]
   */
  async function routeDissent(actor, id, { expectedVersion, queue = 'analyst' } = {}) {
    need(actor, 'dissent.route');
    const d = await getDissent(id, expectedVersion);
    const next = await answers.dissents.update(id, expectedVersion, route(d, { queue, now: t() }));
    await audit(actor, 'dissent.route', id);
    return staffView(actor, next);
  }

  function forkChildren(parent, statements, inherited) {
    return statements.map((s, i) => {
      const { c } = checkCardInput({ statement: s }, inherited);
      return { statement: c.statement, id: `${parent.id}${statements.length > 1 ? String.fromCharCode(97 + i) : `.v${parent.version + 1}`}` };
    });
  }

  /**
   * Rewrite and split create NEW card versions and retire the parent. Estimates
   * already given stay scored on the parent; children start clean (rule R5).
   */
  /**
   * @param {Actor} actor
   * @param {string} id
   * @param {{ expectedVersion?: number, action?: string, title?: string, note?: string, statements?: string[] }} [opts]
   */
  async function actDissent(actor, id, { expectedVersion, action, title = '', note = '', statements = [] } = {}) {
    need(actor, 'dissent.act');
    const d = await getDissent(id, expectedVersion);
    const verb = String(action);
    if (!(/** @type {string[]} */ (Object.values(ACTION))).includes(verb)) throw new ValidationError(`unknown action ${verb}`);
    const parent = await getCard(d.cardId);
    const list = strList(statements);
    if (verb === ACTION.REWRITE && list.length !== 1) throw new ValidationError('rewrite needs exactly one new statement');
    if (verb === ACTION.SPLIT && list.length < 2) throw new ValidationError('split needs at least two new statements');
    if ((/** @type {string[]} */ ([ACTION.RETIRE, ACTION.RESOLVE_EARLY])).includes(verb) && list.length) throw new ValidationError(`${verb} takes no new statements`);
    if (parent.status === 'retired' || parent.status === 'resolved') throw new ConflictError(`card ${parent.id} is already ${parent.status}`);
    const inherited = {
      country: parent.country, resolver: parent.resolver, resolutionSource: parent.resolutionSource,
      objective: parent.objective, window: parent.window,
    };
    const kids = forkChildren(parent, list, inherited); // validated before anything is written
    const acted = act(d, verb, { newCardIds: kids.map((k) => k.id), title, note, now: t() });
    const saved = await answers.dissents.update(id, expectedVersion, acted);
    if (verb !== ACTION.RESOLVE_EARLY) await updateCard(await getCard(parent.id), { status: 'retired', retiredBy: id });
    for (const k of kids) {
      await answers.cards.insert(k.id, {
        id: k.id, version: 0, parentId: parent.id, status: 'open', round: 1, statement: k.statement,
        country: parent.country, region: parent.region, theme: parent.theme, window: parent.window,
        objective: parent.objective, resolutionSource: parent.resolutionSource, resolver: parent.resolver,
        acapsBand: parent.acapsBand ?? null, acapsP: parent.acapsP ?? null, createdAt: coarsenToDay(t()).ms,
      });
    }
    await audit(actor, `dissent.${verb}`, id, note);
    return { dissent: staffView(actor, saved), newCards: kids.map((k) => k.id) };
  }

  /**
   * @param {Actor} actor
   * @param {string} id
   * @param {{ expectedVersion?: number }} [opts]
   */
  async function notifyDissent(actor, id, { expectedVersion } = {}) {
    need(actor, 'dissent.notify');
    const d = await getDissent(id, expectedVersion);
    const n = notify(d, { now: t() });
    if (!n) return null; // anonymous or not actioned: the public ledger is their return path
    const { _next, ...message } = n;
    await answers.dissents.update(id, expectedVersion, _next);
    await answers.notifications.append({ ...message, at: t() });
    await audit(actor, 'dissent.notify', id);
    return { sent: true };
  }

  /**
   * @param {Actor} actor
   * @param {string} id
   * @param {{ expectedVersion?: number, reason?: string }} [opts]
   */
  async function closeDissent(actor, id, { expectedVersion, reason = '' } = {}) {
    need(actor, 'dissent.close');
    const d = await getDissent(id, expectedVersion);
    let next;
    try { next = close(d, { reason, now: t() }); } catch (e) { throw new ConflictError(e instanceof Error ? e.message : String(e)); }
    await answers.dissents.update(id, expectedVersion, next);
    await audit(actor, 'dissent.close', id, reason);
    return staffView(actor, next);
  }

  /** Addressless "you said, we did" feed. Safe to show anyone. */
  const publicLedger = async (cardId) => cardLedger(await answers.dissents.all(), cardId);

  // ── the expert's own data: export, erase, retention ────────────────────
  async function ownedEstimates(expert) {
    const out = [];
    for (const card of await answers.cards.all()) {
      for (const round of [1, 2]) {
        const r = await answers.estimates.get(estimateKey(card.id, respondentKey(card, expert), round));
        if (r) out.push({ key: estimateKey(card.id, r.respondentKey, round), row: r });
      }
    }
    return out;
  }

  async function setDeclaration(actor, declaration) {
    need(actor, 'me.manage');
    const e = await expertOf(actor);
    const countries = isoList(declaration?.countries);
    if (countries.length === 0) throw new ValidationError('a Declaration needs at least one country');
    const next = { ...e, declaration: { countries, regions: strList(declaration.regions), themes: strList(declaration.themes) } };
    await roster.experts.put(e.id, next);
    return { declaration: next.declaration };
  }

  async function exportMe(actor) {
    need(actor, 'me.manage');
    const e = await expertOf(actor);
    return {
      expert: e,
      aliases: await roster.aliases.find({ expertId: e.id }),
      estimates: (await ownedEstimates(e)).map((x) => x.row),
      dissents: await answers.dissents.find({ expert: e.id }),
      notifications: await answers.notifications.find({ to: e.id }),
      note: e.tokenMode === 'device'
        ? 'Your answers are held under a key only your device has. They cannot be listed or erased from here: use your device, which still holds the key. Anonymous comments are unlinkable and not included.'
        : e.level === LEVELS.ANONYMOUS ? 'Anonymous comments are unlinkable by design and are not included.' : undefined,
    };
  }

  /**
   * Idempotent and ordered so a retry after a partial failure finishes the job:
   * the expert row and the session go LAST, so the caller can still authenticate to retry.
   */
  async function eraseMe(actor) {
    need(actor, 'me.manage');
    const e = await expertOf(actor);
    for (const x of await ownedEstimates(e)) await answers.estimates.remove(x.key);
    await answers.dissents.removeWhere({ expert: e.id });
    await answers.notifications.removeWhere({ to: e.id });
    await roster.aliases.removeWhere({ expertId: e.id });
    await roster.notices.removeWhere({ expertId: e.id });
    await roster.issuances.removeWhere({ expertId: e.id });
    await roster.invites.removeWhere({ expertId: e.id });
    await roster.experts.remove(e.id);
    await roster.sessions.removeWhere({ subject: { kind: 'expert', expertId: e.id } });
    // The log records THAT an erasure happened, not whose.
    await answers.audit.append({ at: t(), actorId: hashTarget(e.id), role: 'expert', action: 'erase.self', target: '', reason: '' });
    return { erased: true };
  }

  /** Delete raw per-expert rows N months after a card resolves; released aggregates stay. */
  async function applyRetention(actor, { months = RETENTION_MONTHS } = {}) {
    need(actor, 'retention.run');
    const cutoff = t() - months * 30 * 24 * 3600 * 1000;
    const stale = await answers.cards.find({ status: 'resolved' }, (c) => c.resolvedAt <= cutoff);
    let removed = 0;
    for (const c of stale) removed += await answers.estimates.removeWhere({ cardId: c.id });
    await audit(actor, 'retention.run', '', `${removed} rows, ${months} months`);
    return { removed, cards: stale.map((c) => c.id) };
  }

  // ── device-held ballots ─────────────────────────────────────────────────
  const blindPublicKey = () => { requireBlind(); return { scheme: blindrsa.BLIND_SCHEME, n: String(blindJwk?.n), e: String(blindJwk?.e) }; };

  /**
   * An authenticated expert gets ONE blind signature per card. The same blinded value asked
   * again returns the same signature (a lost response is recoverable); a different one is refused.
   * @param {Actor} actor @param {{ cardId?: string, blinded?: string }} [input]
   */
  async function issueBlindToken(actor, { cardId, blinded } = {}) {
    need(actor, 'estimate.submit');
    requireBlind();
    const expert = await expertOf(actor);
    if (expert.tokenMode !== 'device') throw new ForbiddenError('this account did not choose a device-held key');
    const card = await getCard(String(cardId));
    if (typeof blinded !== 'string' || !/^[0-9a-f]+$/i.test(blinded) || blinded.length > blindrsa.modulusBytes(BN) * 2) throw new ValidationError('blinded must be hex');
    const b = blindrsa.bytesToBig(blindrsa.hexToBytes(blinded.length % 2 ? `0${blinded}` : blinded));
    if (b <= 0n || b >= BN) throw new ValidationError('blinded value out of range');
    const key = `${expert.id}|${card.id}`;
    const have = await roster.issuances.get(key);
    if (have) {
      if (have.blinded !== b.toString(16)) throw new ConflictError('a token was already issued to you for this card');
    } else {
      if (card.status !== 'open' || card.round !== 1) throw new ConflictError('tokens are issued while a card is open in round 1');
      try { await roster.issuances.insert(key, { expertId: expert.id, cardId: card.id, blinded: b.toString(16), at: coarsenToDay(t()).ms }); } catch (e) {
        if (e instanceof ConflictError) throw new ConflictError('a token was already issued to you for this card');
        throw e;
      }
    }
    const raw = crypto.privateEncrypt(
      { key: /** @type {crypto.KeyObject} */ (blindPrivate), padding: crypto.constants.RSA_NO_PADDING },
      Buffer.from(blindrsa.bigToBytes(b, blindrsa.modulusBytes(BN)))
    );
    return { signature: raw.toString('hex') };
  }

  /**
   * No login. The ballot is its own credential: a token the server signed blind. Nothing here
   * can tell which expert it belongs to.
   * @param {{ cardId?: string, token?: string, signature?: string, p?: number }} [input]
   */
  async function submitAnonymousEstimate({ cardId, token, signature, p } = {}) {
    const card = await getCard(String(cardId));
    checkBallot(card.id, token, signature);
    if (card.status !== 'open') throw new ConflictError(`card ${card.id} is not open for answers`);
    let clamped;
    try { clamped = clampForecast(/** @type {number} */ (p)); } catch (e) { throw new ValidationError(e instanceof Error ? e.message : String(e)); }
    const key = `bt:${token}`;
    if (card.round === 2 && !(await answers.estimates.get(estimateKey(card.id, key, 1)))) {
      throw new ConflictError('round 2 is a revision: this ballot did not answer round 1');
    }
    try {
      await answers.estimates.insert(estimateKey(card.id, key, card.round), {
        cardId: card.id, respondentKey: key, round: card.round, level: LEVELS.ANONYMOUS, p: clamped, expertId: null,
        at: coarsenToDay(t()).ms,
      });
    } catch (e) {
      if (e instanceof ConflictError) throw new ConflictError('this ballot has already answered this round');
      throw e;
    }
    return { cardId: card.id, round: card.round, p: clamped, clamped: clamped !== p };
  }

  /** What this ballot has answered, for the device that holds it. @param {{ cardId?: string, token?: string, signature?: string }} [input] */
  async function anonymousStatus({ cardId, token, signature } = {}) {
    const card = await getCard(String(cardId));
    checkBallot(card.id, token, signature);
    const get = async (/** @type {number} */ round) => (await answers.estimates.get(estimateKey(card.id, `bt:${token}`, round)))?.p ?? null;
    return { cardId: card.id, round: card.round, status: card.status, round1: await get(1), round2: await get(2) };
  }

  /** The device erases its own answers to a card. Nothing else can find them. @param {{ cardId?: string, token?: string, signature?: string }} [input] */
  async function eraseAnonymousEstimate({ cardId, token, signature } = {}) {
    const card = await getCard(String(cardId));
    checkBallot(card.id, token, signature);
    let removed = 0;
    for (const round of [1, 2]) if (await answers.estimates.remove(estimateKey(card.id, `bt:${token}`, round))) removed++;
    return { removed };
  }

  // ── break-glass: two moderators, a written reason, 24 hours, told afterwards ──
  /** @param {Record<string, any>} r */
  async function liveRequest(r) {
    if ((r.status === 'requested' || r.status === 'approved') && r.expiresAt <= t()) {
      await answers.break_glass.update(r.id, r.version, { ...r, status: 'expired', version: r.version + 1 });
      throw new ConflictError('this break-glass request has expired');
    }
    return r;
  }
  const getRequest = async (/** @type {string} */ id) => {
    const r = await answers.break_glass.get(id);
    if (!r) throw new NotFoundError(`break-glass request ${id} not found`);
    return r;
  };

  /**
   * @param {Actor} actor
   * @param {{ dissentId?: string, category?: string, reason?: string }} [input]
   */
  async function requestBreakGlass(actor, { dissentId, category, reason } = {}) {
    need(actor, 'breakglass.request');
    if (!breakGlassPublicKey) throw new ConflictError('break-glass is not configured on this deployment');
    if (!BREAK_GLASS_CATEGORIES.includes(String(category))) throw new ValidationError(`category must be one of ${BREAK_GLASS_CATEGORIES.join(', ')}`);
    if (!isStr(reason) || reason.trim().length < 20) throw new ValidationError('a written reason of at least 20 characters is required');
    const d = await answers.dissents.get(String(dissentId));
    if (!d) throw new NotFoundError('objection not found');
    if (d.level !== LEVELS.ANONYMOUS || !d.sealedIdentity) {
      throw new ConflictError('this objection has no sealed identity: it is not anonymous, or its sender chose a device-held key, which cannot be opened by design');
    }
    const live = await answers.break_glass.find({ dissentId: d.id }, (r) => r.status === 'requested' || r.status === 'approved');
    if (live.length) throw new ConflictError('a request for this objection is already open');
    const id = `bg_${crypto.randomUUID()}`;
    const r = { id, version: 0, dissentId: d.id, cardId: d.cardId, status: 'requested', category, reason: reason.trim(), requester: actor.id, approver: null, requestedAt: t(), expiresAt: t() + BREAK_GLASS_TTL_MS };
    try { await answers.break_glass.insert(id, r); } catch (e) {
      if (e instanceof ConflictError) throw new ConflictError('a request for this objection is already open');
      throw e;
    }
    await audit(actor, 'breakglass.request', id, `${category}: ${r.reason}`);
    return r;
  }

  /**
   * A DIFFERENT moderator approves or denies. The database also refuses approver = requester.
   * @param {Actor} actor @param {string} id @param {{ approve?: boolean, note?: string }} [opts]
   */
  async function decideBreakGlass(actor, id, { approve, note = '' } = {}) {
    need(actor, 'breakglass.decide');
    const r = await liveRequest(await getRequest(id));
    if (r.requester === actor.id) throw new ForbiddenError('a different moderator must decide: the requester cannot approve their own request');
    if (r.status !== 'requested') throw new ConflictError(`request is ${r.status}`);
    const next = await answers.break_glass.update(r.id, r.version, {
      ...r, version: r.version + 1, approver: actor.id, decidedAt: t(), decisionNote: String(note).slice(0, 500),
      status: approve === true ? 'approved' : 'denied', expiresAt: t() + BREAK_GLASS_TTL_MS,
    });
    await audit(actor, approve === true ? 'breakglass.approve' : 'breakglass.deny', r.id, String(note).slice(0, 500));
    return next;
  }

  /**
   * The requester opens ONE record, once. The identity is returned to them and stored nowhere;
   * the expert gets a notice in their inbox; the audit log records that it happened, not whom.
   * @param {Actor} actor @param {string} id @param {{ key?: string }} [opts]
   */
  async function collectBreakGlass(actor, id, { key } = {}) {
    need(actor, 'breakglass.collect');
    const r = await liveRequest(await getRequest(id));
    if (r.requester !== actor.id) throw new ForbiddenError('only the moderator who asked can collect');
    if (r.status !== 'approved') throw new ConflictError(`request is ${r.status}, not approved`);
    const d = await answers.dissents.get(r.dissentId);
    const pem = key || breakGlassPrivateKey;
    if (!pem) throw new ValidationError('the break-glass private key is required (it is not held by the running service)');
    let expertId;
    try {
      expertId = crypto.privateDecrypt(
        { key: pem, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' },
        Buffer.from(d.sealedIdentity, 'base64')
      ).toString();
    } catch { throw new ValidationError('could not open the sealed note: wrong key'); }
    // Mark collected BEFORE returning, so a replay or a second collector loses.
    try {
      await answers.break_glass.update(r.id, r.version, { ...r, version: r.version + 1, status: 'collected', collectedAt: t() });
    } catch (e) {
      if (e instanceof ConflictError) throw new ConflictError('this request was already collected');
      throw e;
    }
    const expert = await roster.experts.get(expertId);
    if (expert) {
      await roster.notices.append({ id: `n_${crypto.randomUUID()}`, expertId, kind: 'break_glass', day: coarsenToDay(t()).day, category: r.category, at: t() });
    }
    await audit(actor, 'breakglass.collect', r.id, 'opened once');
    return expert
      ? { expertId, name: expert.name ?? null, countries: expert.declaration?.countries ?? [], notified: true }
      : { erased: true };
  }

  /** @param {Actor} actor */
  async function listBreakGlass(actor) {
    need(actor, 'breakglass.read');
    return answers.break_glass.all();
  }

  /** The expert dismisses a notice once read. */
  async function ackNotice(/** @type {Actor} */ actor, /** @type {string} */ noticeId) {
    need(actor, 'me.manage');
    const e = await expertOf(actor);
    const mine = (await roster.notices.find({ expertId: e.id })).find((n) => n.id === noticeId);
    if (!mine) throw new NotFoundError('notice not found');
    await roster.notices.removeWhere({ expertId: e.id, id: noticeId });
    return { ok: true };
  }

  /** The exact consent text this deployment will record, so pages never carry their own copy. */
  function consentFor(/** @type {string} */ level, { device = false } = {}) {
    const r = resolveLevel(level);
    if (!r.honoured) throw new NotFoundError('unknown anonymity level');
    if (device && r.level !== LEVELS.ANONYMOUS) throw new ValidationError('a device-held key applies to the anonymous level only');
    return { version: CONSENT_VERSION, level: r.level, device, text: consentText(r.level, consentOpts(device)) };
  }

  async function readAudit(actor) {
    need(actor, 'audit.read');
    return answers.audit.all();
  }

  return Object.freeze({
    authenticate, createStaffSession, createInvite, createReinvite, listExperts, redeemInvite,
    createCard, listCards, closeRound, openRound2, resolveCard,
    submitEstimate, cardRelease, inbox,
    submitDissent, listDissents, routeDissent, actDissent, notifyDissent, closeDissent, publicLedger,
    setDeclaration, exportMe, eraseMe, applyRetention, readAudit,
    requestBreakGlass, decideBreakGlass, collectBreakGlass, listBreakGlass, ackNotice, consentFor,
    blindPublicKey, issueBlindToken, submitAnonymousEstimate, anonymousStatus, eraseAnonymousEstimate,
  });
}
