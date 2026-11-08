/**
 * The roundtable: one moderated thread per card, between Round 1 and Round 2.
 *
 * Who may read or post is decided by the Round-1 row, never by a client claim. Every post
 * is pending until a moderator approves it, and a label is copied into the post when it is
 * written. Responses to experts and moderators never carry a respondent key or an expert id.
 * See docs/09-roundtable-and-credit.md, Part A.
 */
import { LEVELS, coarsenToDay, identifyingHints } from '@benchmark/core/anonymity';
import { validatePost, KINDS, MAX_POSTS_PER_RESPONDENT } from '@benchmark/core/roundtable';
import { ValidationError, ConflictError, NotFoundError } from './errors.js';

const MAX_NOTE = 300;
const LABEL_TRIES = 20;

/**
 * @param {any} ctx the shared context built by service.js
 */
export function createRoundtable(ctx) {
  const {
    answers, t, need, audit, expertOf, respondentKey, estimateKey, getCard, updateCard, checkBallot, ensureAlias, cardView, newId,
  } = ctx;

  // Posting: only once Round 1 has closed. Reading: from then on, through Round 2.
  const writeOpen = (/** @type {any} */ card) => Boolean(card.thread?.enabled) && card.status === 'closed' && card.round === 1;
  const readOpen = (/** @type {any} */ card) => Boolean(card.thread?.enabled) && (card.status === 'closed' || card.round === 2);

  const keyedExpert = async (/** @type {any} */ actor) => {
    const expert = await expertOf(actor);
    if (expert.tokenMode === 'device') throw new ConflictError('your key is held on your device: use the anonymous endpoint with your blind-signed token');
    return expert;
  };

  const requireRound1 = async (/** @type {any} */ card, /** @type {string} */ key) => {
    if (!(await answers.estimates.get(estimateKey(card.id, key, 1)))) throw new ConflictError('you did not answer round 1');
  };

  /** "Participant N": per card, by first post. The unique constraints on the table make the number unique. */
  const participantNumber = async (/** @type {string} */ cardId, /** @type {string} */ key) => {
    for (let attempt = 0; attempt < LABEL_TRIES; attempt++) {
      const have = (await answers.thread_participants.find({ cardId, respondentKey: key }))[0];
      if (have) return have.n;
      const taken = await answers.thread_participants.find({ cardId });
      const n = taken.reduce((max, r) => Math.max(max, r.n), 0) + 1;
      try {
        const id = newId('tp');
        await answers.thread_participants.insert(id, { id, cardId, respondentKey: key, n });
        return n;
      } catch (e) {
        // Another post took this number or this respondent's row: read again.
        if (!(e instanceof ConflictError)) throw e;
      }
    }
    throw new ConflictError('could not assign a participant number, please try again');
  };

  /** Identified experts are named; pseudonymous experts use their alias; everyone else is a participant number. */
  const keyedLabel = async (/** @type {any} */ card, /** @type {any} */ expert, /** @type {string} */ key) => {
    if (expert.level === LEVELS.IDENTIFIED && expert.name) return { label: String(expert.name), participant: null };
    if (expert.level === LEVELS.PSEUDONYMOUS) {
      const aliases = await ensureAlias(expert, card.country);
      return { label: String(aliases[expert.id]), participant: null };
    }
    const n = await participantNumber(card.id, key);
    return { label: `Participant ${n}`, participant: n };
  };

  /**
   * The one place a post is written. `labelFor` is called only after the window, the Round-1
   * check and the validation have passed, so a refused post never takes a participant number.
   */
  async function postAs(/** @type {any} */ card, /** @type {string} */ key, /** @type {any} */ input, /** @type {() => Promise<{ label: string, participant: number | null }>} */ labelFor) {
    if (!card.thread?.enabled) throw new ConflictError('this card has no discussion');
    if (!writeOpen(card)) throw new ConflictError('posts are accepted only while round 1 is closed');
    await requireRound1(card, key);
    const r = validatePost(input);
    if (!r.ok || !r.post) throw new ValidationError(`post cannot be saved: ${r.problems.join('; ')}`, { problems: r.problems });
    const { post } = r;
    const mine = await answers.thread_posts.find({ cardId: card.id, respondentKey: key });
    if (mine.length >= MAX_POSTS_PER_RESPONDENT) {
      throw new ConflictError(`you have reached the limit of ${MAX_POSTS_PER_RESPONDENT} posts and replies on this card`);
    }
    if (post.parentId !== null) {
      // Same message for "no such post", "another card", "not approved" and "is a reply": nothing about a hidden post leaks.
      const parent = await answers.thread_posts.get(post.parentId);
      const visible = parent && parent.cardId === card.id && parent.kind !== 'reply'
        && (parent.status === 'approved' || (parent.status === 'pending' && parent.respondentKey === key));
      if (!visible) throw new ValidationError('a reply must answer an approved top-level post on this card');
    }
    const { label, participant } = await labelFor();
    const id = newId('p');
    await answers.thread_posts.insert(id, {
      id, cardId: card.id, respondentKey: key, status: 'pending', kind: post.kind, parentId: post.parentId,
      label, text: post.text, participant, at: coarsenToDay(t()).ms, note: null, version: 0,
    });
    return { id, status: 'pending', warnings: identifyingHints(post.text) };
  }

  /** Reading: the same gate for keyed and device-held experts. Records the view once. */
  async function readAs(/** @type {any} */ card, /** @type {string} */ key) {
    if (!card.thread?.enabled) throw new ConflictError('this card has no discussion');
    if (!readOpen(card)) throw new ConflictError('the discussion is not open on this card');
    await requireRound1(card, key);
    try {
      await answers.thread_views.insert(newId('tv'), { id: newId('tv'), cardId: card.id, respondentKey: key, at: coarsenToDay(t()).ms });
    } catch (e) {
      if (!(e instanceof ConflictError)) throw e;
    }
    const all = await answers.thread_posts.find({ cardId: card.id });
    const posts = all.filter((p) => p.status === 'approved').map((p) => ({
      id: p.id, kind: p.kind, parentId: p.parentId, label: p.label, text: p.text,
      day: coarsenToDay(p.at).day, own: p.respondentKey === key,
    }));
    const mine = all.filter((p) => p.respondentKey === key && (p.status === 'pending' || p.status === 'rejected'))
      .map((p) => ({ id: p.id, kind: p.kind, text: p.text, status: p.status, note: p.note ?? null }));
    const count = all.filter((p) => p.respondentKey === key).length;
    return {
      cardId: card.id, statement: card.statement, canPost: writeOpen(card) && count < MAX_POSTS_PER_RESPONDENT,
      kinds: [...KINDS], posts, mine,
    };
  }

  // ── staff: set up ───────────────────────────────────────────────────────
  async function setThread(/** @type {any} */ actor, /** @type {{ cardId?: string, enabled?: unknown }} */ { cardId, enabled } = {}) {
    need(actor, 'roundtable.moderate');
    if (typeof enabled !== 'boolean') throw new ValidationError('enabled must be true or false');
    const card = await getCard(String(cardId));
    if (card.round !== 1) throw new ConflictError('a discussion is set up in round 1, not after round 2 opens');
    await updateCard(card, { thread: { enabled } });
    await audit(actor, enabled ? 'roundtable.enable' : 'roundtable.disable', card.id);
    return { cardId: card.id, enabled };
  }

  // ── experts: keyed and device-held ──────────────────────────────────────
  async function openThread(/** @type {any} */ actor, /** @type {{ cardId?: string }} */ { cardId } = {}) {
    need(actor, 'roundtable.read');
    const expert = await keyedExpert(actor);
    const card = await getCard(String(cardId));
    return readAs(card, respondentKey(card, expert));
  }

  async function postToThread(/** @type {any} */ actor, /** @type {{ cardId?: string, kind?: string, text?: string, parentId?: string | null }} */ { cardId, kind, text, parentId } = {}) {
    need(actor, 'roundtable.post');
    const expert = await keyedExpert(actor);
    const card = await getCard(String(cardId));
    const key = respondentKey(card, expert);
    return postAs(card, key, { kind, text, parentId }, () => keyedLabel(card, expert, key));
  }

  /** No login: the blind-signed ballot is the credential. */
  async function openAnonymousThread(/** @type {{ cardId?: string, token?: string, signature?: string }} */ { cardId, token, signature } = {}) {
    const card = await getCard(String(cardId));
    checkBallot(card.id, token, signature);
    return readAs(card, `bt:${token}`);
  }

  async function postAnonymous(/** @type {{ cardId?: string, token?: string, signature?: string, kind?: string, text?: string, parentId?: string | null }} */ { cardId, token, signature, kind, text, parentId } = {}) {
    const card = await getCard(String(cardId));
    checkBallot(card.id, token, signature);
    const key = `bt:${token}`;
    return postAs(card, key, { kind, text, parentId }, async () => {
      const n = await participantNumber(card.id, key);
      return { label: `Participant ${n}`, participant: n };
    });
  }

  // ── moderators ──────────────────────────────────────────────────────────
  async function listPending(/** @type {any} */ actor, /** @type {{ cardId?: string }} */ { cardId } = {}) {
    need(actor, 'roundtable.moderate');
    const where = cardId ? { status: 'pending', cardId: String(cardId) } : { status: 'pending' };
    const out = [];
    for (const p of await answers.thread_posts.find(where)) {
      const card = await getCard(p.cardId);
      out.push({
        id: p.id, cardId: p.cardId, statement: card.statement, kind: p.kind, parentId: p.parentId, label: p.label,
        text: p.text, hints: identifyingHints(p.text), day: coarsenToDay(p.at).day,
      });
    }
    return out;
  }

  async function moderate(/** @type {any} */ actor, /** @type {string} */ postId, /** @type {{ approve?: boolean, note?: unknown }} */ { approve, note } = {}) {
    need(actor, 'roundtable.moderate');
    const p = await answers.thread_posts.get(String(postId));
    if (!p) throw new NotFoundError('post not found');
    if (p.status !== 'pending') throw new ConflictError(`post is ${p.status}, not pending`);
    const ok = approve === true;
    const reason = String(note ?? '').trim();
    if (!ok && (reason.length < 1 || reason.length > MAX_NOTE)) {
      throw new ValidationError(`a rejection needs a note of 1 to ${MAX_NOTE} characters`);
    }
    const status = ok ? 'approved' : 'rejected';
    try {
      await answers.thread_posts.update(p.id, p.version, { ...p, status, note: ok ? null : reason, version: p.version + 1 });
    } catch (e) {
      if (e instanceof ConflictError) throw new ConflictError(`post ${p.id} was already moderated`);
      throw e;
    }
    // The audit log holds the post id only: never the text, the note or the respondent.
    await audit(actor, ok ? 'roundtable.approve' : 'roundtable.reject', p.id);
    return { id: p.id, status };
  }

  // ── gates and views used by other modules ───────────────────────────────
  /** Cards an expert may discuss now: closed in round 1 with a thread. Keyed experts only where they answered Round 1. */
  async function discussionFor(/** @type {any} */ expert) {
    const device = expert.tokenMode === 'device';
    const out = [];
    for (const card of await answers.cards.find({ status: 'closed', round: 1 })) {
      if (!card.thread?.enabled) continue;
      if (device) {
        out.push(cardView(card, { thread: { available: true }, deviceHeld: true }));
      } else if (await answers.estimates.get(estimateKey(card.id, respondentKey(card, expert), 1))) {
        out.push(cardView(card, { thread: { available: true } }));
      }
    }
    return out;
  }

  async function pendingCount(/** @type {string} */ cardId) {
    return (await answers.thread_posts.find({ cardId, status: 'pending' })).length;
  }

  async function sawThread(/** @type {string} */ cardId, /** @type {string} */ key) {
    return (await answers.thread_views.find({ cardId, respondentKey: key })).length > 0;
  }

  // ── erase, retention, export ────────────────────────────────────────────
  /** Replies to this respondent's posts are kept: they are other people's words. */
  async function eraseKey(/** @type {string} */ cardId, /** @type {string} */ key) {
    const where = { cardId, respondentKey: key };
    const removed = await answers.thread_posts.removeWhere(where);
    await answers.thread_participants.removeWhere(where);
    await answers.thread_views.removeWhere(where);
    return removed;
  }

  async function eraseCards(/** @type {string[]} */ cardIds) {
    let removed = 0;
    for (const cardId of cardIds) {
      removed += await answers.thread_posts.removeWhere({ cardId });
      await answers.thread_participants.removeWhere({ cardId });
      await answers.thread_views.removeWhere({ cardId });
    }
    return removed;
  }

  /** The expert's own posts. No labels: an anonymous label is never shown back to its author here. */
  async function exportFor(/** @type {any} */ expert) {
    const out = [];
    for (const card of await answers.cards.all()) {
      for (const p of await answers.thread_posts.find({ cardId: card.id, respondentKey: respondentKey(card, expert) })) {
        out.push({ cardId: card.id, kind: p.kind, text: p.text, status: p.status, day: coarsenToDay(p.at).day });
      }
    }
    return out;
  }

  async function eraseAnonymous(/** @type {{ cardId?: string, token?: string, signature?: string }} */ { cardId, token, signature } = {}) {
    const card = await getCard(String(cardId));
    checkBallot(card.id, token, signature);
    return { removed: await eraseKey(card.id, `bt:${token}`) };
  }

  return Object.freeze({
    setThread, openThread, postToThread, openAnonymousThread, postAnonymous,
    listPending, moderate, discussionFor, pendingCount, sawThread,
    eraseKey, eraseCards, exportFor, eraseAnonymous,
  });
}
