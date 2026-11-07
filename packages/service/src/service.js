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
} from '../../core/src/anonymity.js';
import {
  releaseAggregate, clampForecast, BAND_MIDPOINT,
} from '../../core/src/aggregate.js';
import { gate } from '../../core/src/gate.js';
import { matches } from '../../core/src/dispatch.js';
import { hmacSha256Hex } from '../../core/src/hmac.js';
import {
  newDissent, route, act, notify, close, cardLedger, ACTION, STATE, KIND,
} from '../../benchmark/src/dissent.js';
import {
  ValidationError, AuthError, ForbiddenError, NotFoundError, ConflictError,
} from './errors.js';
import { can, ROLES, newToken, hashToken } from './auth.js';
import { CONSENT_VERSION, consentText, consentHash, RETENTION_MONTHS } from './consent.js';

export const RESOLUTION_SOURCES = Object.freeze(['ACLED', 'IPC', 'UNHCR', 'IMF', 'official_decree']);
const SESSION_TTL_MS = 12 * 3600 * 1000;
const INVITE_TTL_MS = 7 * 24 * 3600 * 1000;
const MIN_SECRET = 16;

const isStr = (v) => typeof v === 'string' && v.trim() !== '';
const strList = (v) => (Array.isArray(v) ? v.filter(isStr).map((s) => s.trim()) : []);

export function createService({ roster, answers, secrets, now = Date.now, releasePolicy } = {}) {
  if (!roster || !answers) throw new TypeError('createService needs { roster, answers }');
  for (const k of ['ballot', 'alias']) {
    if (typeof secrets?.[k] !== 'string' || secrets[k].length < MIN_SECRET) {
      throw new Error(`secrets.${k} is required (>= ${MIN_SECRET} chars), held outside the database`);
    }
  }
  if (secrets.ballot === secrets.alias) throw new Error('secrets.ballot and secrets.alias must differ');
  // Fail at start-up, not on the first anonymous answer.
  ballotToken(secrets.ballot, 'startup', 'check');

  const t = () => now();
  const audit = (actor, action, target, reason = '') =>
    answers.audit.append({ at: t(), actorId: actor.id, role: actor.role, action, target, reason });
  const need = (actor, permission) => {
    if (!actor) throw new AuthError();
    if (!can(actor, permission)) throw new ForbiddenError(`${actor.role} may not ${permission}`);
  };
  const expertOf = (actor) => {
    if (actor?.role !== ROLES.EXPERT) throw new ForbiddenError('experts only');
    const e = roster.experts.get(actor.expertId);
    if (!e) throw new NotFoundError('expert not found');
    return e;
  };
  const respondentKey = (card, expert) =>
    expert.level === LEVELS.ANONYMOUS
      ? ballotToken(secrets.ballot, card.id, expert.id)
      : `id:${expert.id}`;
  const estimateKey = (cardId, key, round) => `${cardId}|${key}|${round}`;
  const getCard = (id) => {
    const c = answers.cards.get(id);
    if (!c) throw new NotFoundError(`card ${id} not found`);
    return c;
  };
  const updateCard = (card, patch) =>
    answers.cards.update(card.id, card.version, { ...card, ...patch, version: card.version + 1 });
  const getDissent = (id, expectedVersion) => {
    const d = answers.dissents.get(id);
    if (!d) throw new NotFoundError(`dissent ${id} not found`);
    if (!Number.isInteger(expectedVersion)) throw new ValidationError('expectedVersion (integer) is required');
    if (d.version !== expectedVersion) {
      throw new ConflictError(`dissent ${id} changed: you saw version ${expectedVersion}, it is now ${d.version}`);
    }
    return d;
  };
  const sessionFor = (subject) => {
    const token = newToken();
    // Sessions live in the roster store, never next to the answers.
    roster.sessions.insert(hashToken(token), { subject, expiresAt: t() + SESSION_TTL_MS });
    return token;
  };

  // ── authentication ──────────────────────────────────────────────────────
  function authenticate(token) {
    if (!isStr(token)) throw new AuthError();
    const s = roster.sessions.get(hashToken(token));
    if (!s || s.expiresAt <= t()) throw new AuthError('session invalid or expired');
    return s.subject.kind === 'expert'
      ? { kind: 'expert', role: ROLES.EXPERT, expertId: s.subject.expertId, id: s.subject.expertId }
      : { kind: 'staff', role: s.subject.role, id: s.subject.id };
  }

  /** Called by the transport AFTER the identity provider has vouched for `staff`. */
  function createStaffSession({ id, role }) {
    if (![ROLES.ANALYST, ROLES.MODERATOR].includes(role) || !isStr(id)) {
      throw new ValidationError('staff session needs an id and a role of analyst or moderator');
    }
    return sessionFor({ kind: 'staff', id, role });
  }

  function createInvite(actor, { declaration, name, ttlMs = INVITE_TTL_MS } = {}) {
    need(actor, 'invite.create');
    const countries = strList(declaration?.countries);
    if (countries.length === 0) {
      throw new ValidationError('a Declaration needs at least one country (an empty one would match every card)');
    }
    const expertId = `ex_${crypto.randomUUID()}`;
    const token = newToken();
    roster.experts.insert(expertId, {
      id: expertId,
      name: isStr(name) ? name.trim() : null,
      declaration: { countries, regions: strList(declaration.regions), themes: strList(declaration.themes) },
      level: null,
      consent: null,
      createdAt: coarsenToDay(t()).ms,
    });
    roster.invites.insert(hashToken(token), {
      expertId, expiresAt: t() + ttlMs, usedAt: null, version: 0,
    });
    audit(actor, 'invite.create', hashTarget(expertId));
    return { token, expertId, expiresAt: t() + ttlMs };
  }

  /** Single-use. The expert must pick a level and accept the exact text shown. */
  function redeemInvite(token, { level, consentVersion } = {}) {
    if (!isStr(token)) throw new AuthError('invite required');
    const key = hashToken(token);
    const inv = roster.invites.get(key);
    if (!inv) throw new AuthError('invite not recognised');
    if (inv.usedAt !== null) throw new AuthError('invite already used');
    if (inv.expiresAt <= t()) throw new AuthError('invite expired');
    const r = resolveLevel(level);
    if (!r.honoured) throw new ValidationError('choose an anonymity level: identified, pseudonymous or anonymous');
    if (consentVersion !== CONSENT_VERSION) {
      throw new ValidationError(`consent must be given to version ${CONSENT_VERSION}`, { consentText: consentText(r.level) });
    }
    // Compare-and-set makes redemption atomic: a second concurrent redeem loses.
    roster.invites.update(key, inv.version, { ...inv, usedAt: t(), version: inv.version + 1 });
    const e = roster.experts.get(inv.expertId);
    roster.experts.put(e.id, {
      ...e,
      level: r.level,
      consent: { version: CONSENT_VERSION, textHash: consentHash(r.level), at: coarsenToDay(t()).ms },
    });
    return { sessionToken: sessionFor({ kind: 'expert', expertId: e.id }), expertId: e.id, level: r.level };
  }

  // ── cards ───────────────────────────────────────────────────────────────
  function checkCardInput(input, inherited = {}) {
    const c = { ...inherited, ...input };
    if (!isStr(c.country)) throw new ValidationError('country is required');
    if (!isStr(c.resolver)) throw new ValidationError('a named resolver is required');
    if (!RESOLUTION_SOURCES.includes(c.resolutionSource)) {
      throw new ValidationError(`resolutionSource must be one of ${RESOLUTION_SOURCES.join(', ')}`);
    }
    if (!isStr(c.objective)) throw new ValidationError('a written objective (what counts as yes) is required before a card opens');
    const g = gate({ statement: c.statement, window: c.window, objective: c.objective });
    if (!g.dispatchable) {
      throw new ValidationError('card fails the gate', { problems: g.blockers.map((b) => `${b.check}: ${b.reason}`) });
    }
    return { c, warnings: g.warnings.map((w) => `${w.check}: ${w.reason}`) };
  }

  function createCard(actor, input) {
    need(actor, 'card.author');
    const { c, warnings } = checkCardInput(input);
    const id = isStr(input.id) ? input.id.trim() : `C${crypto.randomBytes(4).toString('hex')}`;
    const card = answers.cards.insert(id, {
      id, version: 0, parentId: null, status: 'open', round: 1,
      statement: c.statement.trim(), country: c.country, region: c.region ?? null, theme: c.theme ?? null,
      window: c.window, objective: c.objective.trim(), resolutionSource: c.resolutionSource, resolver: c.resolver,
      seedP: BAND_MIDPOINT[c.probability] ?? 0.5,
      createdAt: coarsenToDay(t()).ms,
    });
    audit(actor, 'card.create', id);
    return { card, warnings };
  }

  function closeRound(actor, cardId) {
    need(actor, 'round.manage');
    const card = getCard(cardId);
    if (card.status !== 'open') throw new ConflictError(`card ${cardId} is ${card.status}, not open`);
    const next = updateCard(card, { status: 'closed' });
    audit(actor, 'round.close', cardId, `round ${card.round}`);
    // Closing a round IS its release: the result is ledgered now, so Round 2 can
    // show it and no later call can publish a different one.
    cardRelease(cardId);
    return next;
  }

  function openRound2(actor, cardId) {
    need(actor, 'round.manage');
    const card = getCard(cardId);
    if (card.status !== 'closed' || card.round !== 1) throw new ConflictError('round 2 opens only on a card whose round 1 is closed');
    const next = updateCard(card, { status: 'open', round: 2 });
    audit(actor, 'round.open2', cardId);
    return next;
  }

  function resolveCard(actor, { cardId, outcome, evidenceUrl, reason = '' }) {
    need(actor, 'card.resolve');
    if (!(outcome === 0 || outcome === 1 || outcome === 'unobservable')) {
      throw new ValidationError('outcome must be 0, 1 or "unobservable"');
    }
    let url;
    try { url = new URL(String(evidenceUrl)); } catch { url = null; }
    if (!url || url.protocol !== 'https:') throw new ValidationError('an https evidenceUrl is required to resolve a card');
    const card = getCard(cardId);
    if (card.status === 'retired' || card.status === 'resolved') throw new ConflictError(`card is ${card.status}`);
    const next = updateCard(card, { status: 'resolved', outcome, evidenceUrl: url.href, resolvedAt: coarsenToDay(t()).ms });
    audit(actor, 'card.resolve', cardId, reason);
    return next;
  }

  // ── estimates ───────────────────────────────────────────────────────────
  function submitEstimate(actor, { cardId, p } = {}) {
    need(actor, 'estimate.submit');
    const expert = expertOf(actor);
    if (!expert.level || !expert.consent) throw new ForbiddenError('choose an anonymity level and consent first');
    const card = getCard(cardId);
    if (card.status !== 'open') throw new ConflictError(`card ${cardId} is not open for answers`);
    let clamped;
    try { clamped = clampForecast(p); } catch (e) { throw new ValidationError(e.message); }
    const key = respondentKey(card, expert);
    if (card.round === 2 && !answers.estimates.get(estimateKey(card.id, key, 1))) {
      throw new ConflictError('round 2 is a revision: you did not answer round 1');
    }
    const anonymous = expert.level === LEVELS.ANONYMOUS;
    try {
      answers.estimates.insert(estimateKey(card.id, key, card.round), {
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
  function cardRelease(cardId, { visibility = 'panel', round } = {}) {
    if (!['panel', 'public'].includes(visibility)) throw new ValidationError('visibility must be panel or public');
    const card = getCard(cardId);
    if (round !== undefined && round < card.round) {
      // An earlier round's published result is read from the ledger, never recomputed,
      // so a live later round cannot leak through it.
      const prior = answers.releases
        .find((x) => x.cardId === card.id && x.round === round && x.visibility === visibility && x.closed)
        .sort((a, b) => b.n - a.n)[0];
      return prior ? prior.snapshot : null;
    }
    const rows = answers.estimates.find((e) => e.cardId === card.id);
    const estimates = rows.map((r) => ({
      p: r.p, round: r.round, level: r.level,
      ...(r.expertId ? { expertId: r.expertId } : { ballotToken: r.respondentKey }),
    }));
    // Round-closed state comes from the database, never from the caller.
    const closed = card.status !== 'open';
    const ledger = answers.releases
      .find((x) => x.cardId === card.id && x.round === card.round && x.visibility === visibility)
      .sort((a, b) => a.n - b.n);
    // Re-asking must never re-draw a different interval for the same panel.
    const same = ledger.find((x) => x.n === new Set(estimates.map((e) => e.expertId ?? e.ballotToken)).size && x.closed === closed);
    if (same) return same.snapshot;
    const previousSnapshot = ledger.length ? ledger[ledger.length - 1].snapshot : null;
    const snap = releaseAggregate(estimates, {
      closed, visibility, previousSnapshot, policy: releasePolicy, requireBallotKey: true,
    });
    if (!snap.suppressed && !snap.releaseHeld) {
      answers.releases.append({
        cardId: card.id, round: card.round, visibility, n: snap.n, closed, at: t(), snapshot: snap,
      });
    }
    return snap;
  }

  // ── inbox: the pull path, so anonymous experts reach Round 2 ───────────
  function inbox(actor) {
    need(actor, 'inbox.read');
    const expert = expertOf(actor);
    const toAnswer = [];
    const openForRevision = [];
    for (const card of answers.cards.find((c) => c.status === 'open')) {
      const key = respondentKey(card, expert);
      const mine = (round) => answers.estimates.get(estimateKey(card.id, key, round));
      if (card.round === 1 && matches(card, expert.declaration) && !mine(1)) {
        toAnswer.push(cardView(card, { seedP: card.seedP }));
      } else if (card.round === 2 && mine(1) && !mine(2)) {
        openForRevision.push(cardView(card, { yourEstimate: mine(1).p, release: cardRelease(card.id, { round: 1 }) }));
      }
    }
    const notifications = answers.notifications.find((n) => n.to === expert.id);
    return { toAnswer, openForRevision, notifications };
  }

  const cardView = (c, extra = {}) => ({
    id: c.id, statement: c.statement, country: c.country, theme: c.theme, round: c.round,
    window: c.window, version: c.version, ...extra,
  });

  // ── dissent ─────────────────────────────────────────────────────────────
  function ensureAlias(expert, country) {
    const existing = {};
    for (const a of roster.aliases.find((x) => x.country === country)) existing[a.expertId] = a.alias;
    if (existing[expert.id]) return existing;
    const { aliases, added } = assignAliases(existing, [expert.id], country, { salt: secrets.alias });
    for (const [expertId, alias] of Object.entries(added)) {
      roster.aliases.insert(`${expertId}|${country}`, { expertId, country, alias });
    }
    return aliases;
  }

  function submitDissent(actor, { cardId, kind, text = '' } = {}) {
    need(actor, 'dissent.submit');
    const expert = expertOf(actor);
    if (!expert.level || !expert.consent) throw new ForbiddenError('choose an anonymity level and consent first');
    const card = getCard(cardId);
    if (!Object.values(KIND).includes(kind)) throw new ValidationError(`kind must be one of ${Object.values(KIND).join(', ')}`);
    const panelAliases = expert.level === LEVELS.PSEUDONYMOUS ? ensureAlias(expert, card.country) : undefined;
    const d = newDissent({
      cardId: card.id, expert: expert.id, name: expert.name ?? undefined, country: card.country,
      kind, text: String(text).slice(0, 2000), level: expert.level, panelAliases, now: t(),
    });
    answers.dissents.insert(d.id, d);
    // Advice for the author, never a block: see leaksBy().
    const warnings = leaksBy({ text: d.text, name: expert.name, expertId: expert.id }, []);
    return { id: d.id, version: d.version, warnings };
  }

  const staffView = (actor, d) => (actor.role === ROLES.MODERATOR ? d : { ...d, expert: undefined });

  function listDissents(actor, { status } = {}) {
    need(actor, 'dissent.read');
    return answers.dissents.find((d) => !status || d.status === status).map((d) => staffView(actor, d));
  }

  function routeDissent(actor, id, { expectedVersion, queue = 'analyst' } = {}) {
    need(actor, 'dissent.route');
    const d = getDissent(id, expectedVersion);
    const next = answers.dissents.update(id, expectedVersion, route(d, { queue, now: t() }));
    audit(actor, 'dissent.route', id);
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
  function actDissent(actor, id, { expectedVersion, action, title = '', note = '', statements = [] } = {}) {
    need(actor, 'dissent.act');
    const d = getDissent(id, expectedVersion);
    if (!Object.values(ACTION).includes(action)) throw new ValidationError(`unknown action ${action}`);
    const parent = getCard(d.cardId);
    const list = strList(statements);
    if (action === ACTION.REWRITE && list.length !== 1) throw new ValidationError('rewrite needs exactly one new statement');
    if (action === ACTION.SPLIT && list.length < 2) throw new ValidationError('split needs at least two new statements');
    if ([ACTION.RETIRE, ACTION.RESOLVE_EARLY].includes(action) && list.length) throw new ValidationError(`${action} takes no new statements`);
    if (parent.status === 'retired' || parent.status === 'resolved') throw new ConflictError(`card ${parent.id} is already ${parent.status}`);
    const inherited = {
      country: parent.country, resolver: parent.resolver, resolutionSource: parent.resolutionSource,
      objective: parent.objective, window: parent.window,
    };
    const kids = forkChildren(parent, list, inherited); // validated before anything is written
    const acted = act(d, action, { newCardIds: kids.map((k) => k.id), title, note, now: t() });
    const saved = answers.dissents.update(id, expectedVersion, acted);
    if (action !== ACTION.RESOLVE_EARLY) updateCard(getCard(parent.id), { status: 'retired', retiredBy: id });
    for (const k of kids) {
      answers.cards.insert(k.id, {
        id: k.id, version: 0, parentId: parent.id, status: 'open', round: 1, statement: k.statement,
        country: parent.country, region: parent.region, theme: parent.theme, window: parent.window,
        objective: parent.objective, resolutionSource: parent.resolutionSource, resolver: parent.resolver,
        seedP: parent.seedP, createdAt: coarsenToDay(t()).ms,
      });
    }
    audit(actor, `dissent.${action}`, id, note);
    return { dissent: staffView(actor, saved), newCards: kids.map((k) => k.id) };
  }

  function notifyDissent(actor, id, { expectedVersion } = {}) {
    need(actor, 'dissent.notify');
    const d = getDissent(id, expectedVersion);
    const n = notify(d, { now: t() });
    if (!n) return null; // anonymous or not actioned: the public ledger is their return path
    const { _next, ...message } = n;
    answers.dissents.update(id, expectedVersion, _next);
    answers.notifications.append({ ...message, at: t() });
    audit(actor, 'dissent.notify', id);
    return { sent: true };
  }

  function closeDissent(actor, id, { expectedVersion, reason = '' } = {}) {
    need(actor, 'dissent.close');
    const d = getDissent(id, expectedVersion);
    let next;
    try { next = close(d, { reason, now: t() }); } catch (e) { throw new ConflictError(e.message); }
    answers.dissents.update(id, expectedVersion, next);
    audit(actor, 'dissent.close', id, reason);
    return staffView(actor, next);
  }

  /** Addressless "you said, we did" feed. Safe to show anyone. */
  const publicLedger = (cardId) => cardLedger(answers.dissents.all(), cardId);

  // ── the expert's own data: export, erase, retention ────────────────────
  function ownedEstimates(expert) {
    const out = [];
    for (const card of answers.cards.all()) {
      for (const round of [1, 2]) {
        const r = answers.estimates.get(estimateKey(card.id, respondentKey(card, expert), round));
        if (r) out.push({ key: estimateKey(card.id, r.respondentKey, round), row: r });
      }
    }
    return out;
  }

  function setDeclaration(actor, declaration) {
    need(actor, 'me.manage');
    const e = expertOf(actor);
    const countries = strList(declaration?.countries);
    if (countries.length === 0) throw new ValidationError('a Declaration needs at least one country');
    roster.experts.put(e.id, { ...e, declaration: { countries, regions: strList(declaration.regions), themes: strList(declaration.themes) } });
    return { declaration: roster.experts.get(e.id).declaration };
  }

  function exportMe(actor) {
    need(actor, 'me.manage');
    const e = expertOf(actor);
    return {
      expert: e,
      aliases: roster.aliases.find((a) => a.expertId === e.id),
      estimates: ownedEstimates(e).map((x) => x.row),
      dissents: answers.dissents.find((d) => d.expert === e.id),
      notifications: answers.notifications.find((n) => n.to === e.id),
      note: e.level === LEVELS.ANONYMOUS ? 'Anonymous comments are unlinkable by design and are not included.' : undefined,
    };
  }

  function eraseMe(actor) {
    need(actor, 'me.manage');
    const e = expertOf(actor);
    for (const x of ownedEstimates(e)) answers.estimates.remove(x.key);
    answers.dissents.removeWhere((d) => d.expert === e.id);
    answers.notifications.removeWhere((n) => n.to === e.id);
    roster.aliases.removeWhere((a) => a.expertId === e.id);
    roster.invites.removeWhere((i) => i.expertId === e.id);
    roster.sessions.removeWhere((s) => s.subject.kind === 'expert' && s.subject.expertId === e.id);
    roster.experts.remove(e.id);
    // The log records THAT an erasure happened, not whose.
    answers.audit.append({ at: t(), actorId: hashTarget(e.id), role: 'expert', action: 'erase.self', target: '', reason: '' });
    return { erased: true };
  }

  /** Delete raw per-expert rows N months after a card resolves; released aggregates stay. */
  function applyRetention(actor, { months = RETENTION_MONTHS } = {}) {
    need(actor, 'retention.run');
    const cutoff = t() - months * 30 * 24 * 3600 * 1000;
    const stale = new Set(answers.cards.find((c) => c.status === 'resolved' && c.resolvedAt <= cutoff).map((c) => c.id));
    const removed = answers.estimates.removeWhere((e) => stale.has(e.cardId));
    audit(actor, 'retention.run', '', `${removed} rows, ${months} months`);
    return { removed, cards: [...stale] };
  }

  function readAudit(actor) {
    need(actor, 'audit.read');
    return answers.audit.all();
  }

  /** A stable, non-reversible handle for logging an expert without naming them. */
  function hashTarget(id) {
    return hmacSha256Hex(secrets.alias, `audit:${id}`).slice(0, 16);
  }

  return Object.freeze({
    authenticate, createStaffSession, createInvite, redeemInvite,
    createCard, closeRound, openRound2, resolveCard,
    submitEstimate, cardRelease, inbox,
    submitDissent, listDissents, routeDissent, actDissent, notifyDissent, closeDissent, publicLedger,
    setDeclaration, exportMe, eraseMe, applyRetention, readAudit,
  });
}
