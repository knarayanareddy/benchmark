/**
 * Analyst links between two cards: a moderator's stated mechanism and rival
 * explanation. Always "analyst judgement", never inferred automatically.
 *
 * Pure: no storage, no network, no clock.
 */

export const TEXT_MIN = 20;
export const TEXT_MAX = 500;
export const DEFAULT_MAX_DEPTH = 3;

const str = (v) => (typeof v === 'string' ? v.trim() : '');
const textOk = (s) => s.length >= TEXT_MIN && s.length <= TEXT_MAX;

/**
 * @param {unknown} input
 * @returns {{ ok: boolean, problems: string[], link: { fromCardId: string, toCardId: string, mechanism: string, rival: string } | null }}
 */
export function validateLink(input) {
  const src = /** @type {Record<string, unknown>} */ (input && typeof input === 'object' ? input : {});
  const fromCardId = str(src.fromCardId);
  const toCardId = str(src.toCardId);
  const mechanism = str(src.mechanism);
  const rival = str(src.rival);

  /** @type {string[]} */
  const problems = [];
  if (!fromCardId) problems.push('fromCardId is required');
  if (!toCardId) problems.push('toCardId is required');
  if (fromCardId && toCardId && fromCardId === toCardId) problems.push('a link must join two different cards');
  if (!textOk(mechanism)) problems.push(`mechanism must be ${TEXT_MIN}..${TEXT_MAX} characters`);
  if (!textOk(rival)) problems.push(`rival explanation is required: ${TEXT_MIN}..${TEXT_MAX} characters`);

  if (problems.length) return { ok: false, problems, link: null };
  return { ok: true, problems, link: { fromCardId, toCardId, mechanism, rival } };
}

/**
 * @param {Array<{ fromCardId: string, toCardId: string }>} links
 * @param {string} from
 * @param {string} to
 */
export function wouldDuplicate(links, from, to) {
  return links.some((l) => l.fromCardId === from && l.toCardId === to);
}

/**
 * Breadth-first walk over the links from `start`. Each reached card is listed
 * once at its shallowest depth, `via` is the link that first reached it, the
 * start card is never listed, and cycles cannot loop.
 *
 * @param {Array<{ id: string, fromCardId: string, toCardId: string }>} links
 * @param {'down' | 'up'} direction
 * @returns {Array<{ cardId: string, depth: number, via: string }>}
 */
function walk(links, start, maxDepth, direction) {
  const [near, far] = direction === 'down' ? ['fromCardId', 'toCardId'] : ['toCardId', 'fromCardId'];
  const seen = new Set([start]);
  const out = [];
  let frontier = [start];
  for (let depth = 1; depth <= maxDepth && frontier.length; depth++) {
    const next = [];
    for (const card of frontier) {
      for (const link of links) {
        if (link[near] !== card || seen.has(link[far])) continue;
        seen.add(link[far]);
        out.push({ cardId: link[far], depth, via: link.id });
        next.push(link[far]);
      }
    }
    frontier = next;
  }
  return out;
}

/**
 * @param {Array<{ id: string, fromCardId: string, toCardId: string }>} links
 * @param {string} cardId
 * @param {{ maxDepth?: number }} [opts]
 */
export function downstream(links, cardId, { maxDepth = DEFAULT_MAX_DEPTH } = {}) {
  checkDepth(maxDepth);
  return walk(links, cardId, maxDepth, 'down');
}

/**
 * @param {Array<{ id: string, fromCardId: string, toCardId: string }>} links
 * @param {string} cardId
 * @param {{ maxDepth?: number }} [opts]
 */
export function upstream(links, cardId, { maxDepth = DEFAULT_MAX_DEPTH } = {}) {
  checkDepth(maxDepth);
  return walk(links, cardId, maxDepth, 'up');
}

function checkDepth(maxDepth) {
  if (!Number.isInteger(maxDepth) || maxDepth < 0) {
    throw new RangeError(`maxDepth must be a non-negative integer, got ${JSON.stringify(maxDepth)}`);
  }
}
