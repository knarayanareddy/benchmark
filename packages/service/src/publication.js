/**
 * Publication credit (docs/09 Part B): one contribution at a time, offered to its author, who decides
 * whether to be named; a moderator other than the proposer reviews it; then a cooling-off period and a
 * publish. Withdrawal, and declining, erase the text and the credit.
 */
import { coarsenToDay } from '@benchmark/core/anonymity';
import { hmacSha256Hex } from '@benchmark/core/hmac';
import {
  COOLING_OFF_MS, STATUS, canTransition, validateResponse, validateReview, publicView, erasedRecord,
} from '@benchmark/core/publication';
import { ValidationError, ForbiddenError, ConflictError, NotFoundError } from './errors.js';

const KEYED = ['identified', 'pseudonymous'];
const SOURCE_KINDS = ['dissent', 'post'];
// Only an objection the analyst has acted on can be offered: the thing the person asked for is done.
const ACTIONED_DISSENT = ['actioned', 'notified', 'closed'];
// What the author still sees in their inbox. Declined and withdrawn items are gone.
const EXPERT_VISIBLE = [STATUS.PROPOSED, STATUS.CONSENTED, STATUS.APPROVED, STATUS.PUBLISHED, STATUS.REJECTED];

/** @param {unknown} v @returns {v is string} */
const isStr = (v) => typeof v === 'string' && v.trim() !== '';

/** @param {any} ctx */
export function createPublication(ctx) {
  const { roster, answers, secrets, t, need, audit, getCard, isSensitive, newId } = ctx;
  const store = roster.publications;
  const today = () => coarsenToDay(t()).day;

  /** The audit log names an expert only by the same hashed handle the erase path uses. */
  const auditor = (/** @type {any} */ actor) => (actor.role === 'expert'
    ? { id: hmacSha256Hex(secrets.alias, `audit:${actor.expertId}`).slice(0, 16), role: 'expert' }
    : actor);

  const get = async (/** @type {unknown} */ id) => {
    const p = await store.get(String(id));
    if (!p) throw new NotFoundError(`publication ${id} not found`);
    return p;
  };

  /** Only a named or pseudonymous expert can consent. Device-held and anonymous ones cannot, by design. */
  const canConsent = async (/** @type {string} */ expertId) => {
    const e = await roster.experts.get(expertId);
    return Boolean(e && KEYED.includes(e.level) && e.tokenMode !== 'device');
  };

  /**
   * @param {any} actor
   * @param {{ sourceKind?: string, sourceId?: string }} [input]
   */
  async function propose(actor, { sourceKind, sourceId } = {}) {
    need(actor, 'publication.propose');
    if (!SOURCE_KINDS.includes(/** @type {string} */ (sourceKind))) throw new ValidationError('sourceKind must be dissent or post');
    if (!isStr(sourceId)) throw new ValidationError('sourceId is required');
    const id = sourceId.trim();

    let expertId;
    let cardId;
    let text;
    if (sourceKind === 'dissent') {
      const d = await answers.dissents.get(id);
      if (!d) throw new NotFoundError(`objection ${id} not found`);
      if (!ACTIONED_DISSENT.includes(d.status)) throw new ConflictError('only an actioned objection can be offered for credit');
      // Anonymous objections have no expert id by construction, so there is no one to ask.
      if (!d.expert) throw new ConflictError('an anonymous objection cannot be offered for credit: its author cannot be asked to consent');
      expertId = d.expert;
      cardId = d.cardId;
      text = d.text;
    } else {
      const p = await answers.thread_posts.get(id);
      if (!p) throw new NotFoundError(`post ${id} not found`);
      if (p.status !== 'approved') throw new ConflictError('only an approved discussion post can be offered for credit');
      // Only keyed respondents carry `id:`; device-held and service-held anonymous ones carry a ballot token.
      if (!String(p.respondentKey).startsWith('id:')) throw new ConflictError('an anonymous or device-held post cannot be offered for credit: its author cannot be asked to consent');
      expertId = String(p.respondentKey).slice(3);
      cardId = p.cardId;
      text = p.text;
    }
    if (!(await canConsent(expertId))) throw new ConflictError('the author did not choose an identified or pseudonymous level, so they cannot consent');
    if (!isStr(text)) throw new ValidationError('the contribution has no text to offer');

    const card = await getCard(cardId);
    const pub = {
      id: newId('pub'), version: 0, status: STATUS.PROPOSED,
      sourceKind, sourceId: id, expertId, cardId: card.id,
      country: card.country, cardStatement: card.statement, sensitive: isSensitive(card.country),
      proposer: actor.id, reviewer: null, originalText: text, text, credit: null, note: null, publishAfter: null, day: null,
    };
    try {
      await store.insert(pub.id, pub);
    } catch (e) {
      if (e instanceof ConflictError) throw new ConflictError('this contribution has already been offered for credit');
      throw e;
    }
    await audit(auditor(actor), 'publication.propose', pub.id);
    return { id: pub.id, status: pub.status };
  }

  /**
   * The author, and only the author, answers the proposal.
   * @param {any} actor @param {string} id @param {Record<string, any>} [input]
   */
  async function respond(actor, id, input = {}) {
    need(actor, 'publication.respond');
    const pub = await get(id);
    if (pub.expertId !== actor.expertId) throw new ForbiddenError('only the author of this contribution may respond to it');
    if (!canTransition(pub.status, STATUS.CONSENTED)) throw new ConflictError(`publication is ${pub.status}, not proposed`);
    const r = validateResponse(input, { sensitive: isSensitive(pub.country) });
    const v = r.value;
    if (!r.ok || v === null) throw new ValidationError(`cannot save: ${r.problems.join('; ')}`, { problems: r.problems });

    const declined = v.credit === null;
    const next = declined
      ? erasedRecord(pub, { status: STATUS.DECLINED, day: today(), version: pub.version + 1 })
      : { ...pub, status: STATUS.CONSENTED, version: pub.version + 1, text: v.text, credit: v.credit };
    await store.update(pub.id, pub.version, next);
    await audit(auditor(actor), declined ? 'publication.decline' : 'publication.consent', pub.id);
    return { id: pub.id, status: next.status };
  }

  /**
   * A moderator other than the proposer decides. Approval starts the cooling-off period.
   * @param {any} actor @param {string} id @param {Record<string, any>} [input]
   */
  async function review(actor, id, input = {}) {
    need(actor, 'publication.review');
    const pub = await get(id);
    if (pub.proposer === actor.id) throw new ForbiddenError('the moderator who proposed this cannot review it: a second moderator must');
    const r = validateReview(input);
    const v = r.value;
    if (!r.ok || v === null) throw new ValidationError(`cannot save: ${r.problems.join('; ')}`, { problems: r.problems });
    const status = v.approve ? STATUS.APPROVED : STATUS.REJECTED;
    if (!canTransition(pub.status, status)) throw new ConflictError(`publication is ${pub.status}, not consented`);
    // A rejected item is never published, so the author's words and name are not kept either. The author keeps
    // the question and the reviewer's note, which is all they need to understand what happened.
    const next = v.approve
      ? { ...pub, version: pub.version + 1, status, reviewer: actor.id, note: null, publishAfter: t() + COOLING_OFF_MS }
      : {
        ...erasedRecord(pub, { status, day: today(), version: pub.version + 1 }),
        reviewer: actor.id, note: v.note, cardStatement: pub.cardStatement, country: pub.country, sensitive: pub.sensitive,
      };
    await store.update(pub.id, pub.version, next);
    await audit(actor, v.approve ? 'publication.approve' : 'publication.reject', pub.id);
    return { id: pub.id, status };
  }

  /** @param {any} actor @param {string} id */
  async function publish(actor, id) {
    need(actor, 'publication.publish');
    const pub = await get(id);
    if (!canTransition(pub.status, STATUS.PUBLISHED)) throw new ConflictError(`publication is ${pub.status}, not approved`);
    if (t() < pub.publishAfter) throw new ConflictError('the cooling-off period has not ended');
    await store.update(pub.id, pub.version, { ...pub, status: STATUS.PUBLISHED, version: pub.version + 1, day: today() });
    await audit(actor, 'publication.publish', pub.id);
    return { id: pub.id, status: STATUS.PUBLISHED };
  }

  /** The author may withdraw at any live stage. Copies taken by others cannot be recalled. @param {any} actor @param {string} id */
  async function withdraw(actor, id) {
    need(actor, 'publication.respond');
    const pub = await get(id);
    if (pub.expertId !== actor.expertId) throw new ForbiddenError('only the author of this contribution may withdraw it');
    if (!canTransition(pub.status, STATUS.WITHDRAWN)) throw new ConflictError(`publication is already ${pub.status}`);
    await store.update(pub.id, pub.version, erasedRecord(pub, { status: STATUS.WITHDRAWN, day: today(), version: pub.version + 1 }));
    await audit(auditor(actor), 'publication.withdraw', pub.id);
    return { id: pub.id, status: STATUS.WITHDRAWN };
  }

  /** @param {any} actor */
  async function listForStaff(actor) {
    need(actor, 'publication.read');
    return (await store.all()).map((p) => ({
      id: p.id, status: p.status, sourceKind: p.sourceKind, cardId: p.cardId, country: p.country ?? null,
      proposer: p.proposer, reviewer: p.reviewer ?? null, text: p.text ?? null,
      creditMode: p.credit?.mode ?? null,
      displayName: p.credit?.mode === 'credited' ? p.credit.displayName : null,
      publishAfter: p.publishAfter ?? null, version: p.version,
    }));
  }

  /**
   * What a moderator could offer right now: actioned objections and approved posts whose author can be asked
   * and that have not been offered before. No expert id and no respondent key leaves here.
   * @param {any} actor
   */
  async function listOfferable(actor) {
    need(actor, 'publication.propose');
    const offered = new Set((await store.all()).map((p) => `${p.sourceKind}:${p.sourceId}`));
    const out = [];
    const statements = new Map();
    const statementOf = async (/** @type {string} */ cardId) => {
      if (!statements.has(cardId)) statements.set(cardId, (await getCard(cardId)).statement);
      return statements.get(cardId);
    };
    for (const d of await answers.dissents.all()) {
      if (!ACTIONED_DISSENT.includes(d.status) || !d.expert || offered.has(`dissent:${d.id}`) || !isStr(d.text)) continue;
      if (!(await canConsent(d.expert))) continue;
      out.push({ sourceKind: 'dissent', sourceId: d.id, cardId: d.cardId, statement: await statementOf(d.cardId), kind: d.kind, label: null, text: d.text });
    }
    for (const p of await answers.thread_posts.all()) {
      if (p.status !== 'approved' || !String(p.respondentKey).startsWith('id:') || offered.has(`post:${p.id}`)) continue;
      if (!(await canConsent(String(p.respondentKey).slice(3)))) continue;
      out.push({ sourceKind: 'post', sourceId: p.id, cardId: p.cardId, statement: await statementOf(p.cardId), kind: p.kind, label: p.label, text: p.text });
    }
    return out;
  }

  /** @param {string} expertId */
  async function listForExpert(expertId) {
    return (await store.find({ expertId: String(expertId) }))
      .filter((p) => EXPERT_VISIBLE.includes(p.status))
      .map((p) => ({
        id: p.id, status: p.status, cardStatement: p.cardStatement, originalText: p.originalText, text: p.text,
        credit: p.credit, sensitive: p.sensitive, note: p.note, publishAfter: p.publishAfter,
      }));
  }

  /** No login. Nothing here names a reviewer, a proposer, an expert, a round or a count. */
  async function listPublic() {
    return (await store.find({ status: STATUS.PUBLISHED })).map(publicView);
  }

  /** @param {string} expertId */
  async function eraseExpert(expertId) {
    return store.removeWhere({ expertId: String(expertId) });
  }

  /** @param {string} expertId */
  async function exportFor(expertId) {
    return store.find({ expertId: String(expertId) });
  }

  return { propose, respond, review, publish, withdraw, listForStaff, listOfferable, listForExpert, listPublic, eraseExpert, exportFor };
}
