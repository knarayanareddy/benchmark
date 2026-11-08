/**
 * Analyst links between two cards: a moderator's stated mechanism and rival
 * explanation. Always "analyst judgement", never inferred automatically.
 *
 * Pure: no storage, no network, no clock.
 */

export const TEXT_MIN = 20;
export const TEXT_MAX = 500;
export const DEFAULT_MAX_DEPTH = 3;

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
const textOk = (s: string): boolean => s.length >= TEXT_MIN && s.length <= TEXT_MAX;

export type ValidatedLink = {
  fromCardId: string;
  toCardId: string;
  mechanism: string;
  rival: string;
};

export function validateLink(input: unknown): {
  ok: boolean;
  problems: string[];
  link: ValidatedLink | null;
} {
  const src =
    input && typeof input === "object"
      ? (input as Record<string, unknown>)
      : {};
  const fromCardId = str(src.fromCardId);
  const toCardId = str(src.toCardId);
  const mechanism = str(src.mechanism);
  const rival = str(src.rival);

  const problems: string[] = [];
  if (!fromCardId) problems.push("fromCardId is required");
  if (!toCardId) problems.push("toCardId is required");
  if (fromCardId && toCardId && fromCardId === toCardId) {
    problems.push("a link must join two different cards");
  }
  if (!textOk(mechanism)) {
    problems.push(`mechanism must be ${TEXT_MIN}..${TEXT_MAX} characters`);
  }
  if (!textOk(rival)) {
    problems.push(`rival explanation is required: ${TEXT_MIN}..${TEXT_MAX} characters`);
  }

  if (problems.length) return { ok: false, problems, link: null };
  return { ok: true, problems, link: { fromCardId, toCardId, mechanism, rival } };
}

export function wouldDuplicate(
  links: Array<{ fromCardId: string; toCardId: string }>,
  from: string,
  to: string
): boolean {
  return links.some((l) => l.fromCardId === from && l.toCardId === to);
}

export type ChainStep = {
  cardId: string;
  depth: number;
  via: string;
  linkId: string;
  mechanism: string;
  rival: string;
};

/**
 * Breadth-first walk over the links from `start`. Each reached card is listed
 * once at its shallowest depth, `via` is the card that first reached it, the
 * start card is never listed, and cycles cannot loop.
 */
function walk(
  links: Array<{
    id: string;
    fromCardId: string;
    toCardId: string;
    mechanism?: string;
    rival?: string;
  }>,
  start: string,
  maxDepth: number,
  direction: "down" | "up"
): ChainStep[] {
  const [near, far] =
    direction === "down"
      ? (["fromCardId", "toCardId"] as const)
      : (["toCardId", "fromCardId"] as const);
  const seen = new Set<string>([start]);
  const out: ChainStep[] = [];
  let frontier = [start];
  for (let depth = 1; depth <= maxDepth && frontier.length; depth++) {
    const next: string[] = [];
    for (const card of frontier) {
      for (const link of links) {
        if (link[near] !== card || seen.has(link[far])) continue;
        seen.add(link[far]);
        out.push({
          cardId: link[far],
          depth,
          via: card,
          linkId: link.id,
          mechanism: link.mechanism ?? "",
          rival: link.rival ?? "",
        });
        next.push(link[far]);
      }
    }
    frontier = next;
  }
  return out;
}

function checkDepth(maxDepth: number) {
  if (!Number.isInteger(maxDepth) || maxDepth < 0) {
    throw new RangeError(
      `maxDepth must be a non-negative integer, got ${JSON.stringify(maxDepth)}`
    );
  }
}

export function downstream(
  links: Array<{
    id: string;
    fromCardId: string;
    toCardId: string;
    mechanism?: string;
    rival?: string;
  }>,
  cardId: string,
  { maxDepth = DEFAULT_MAX_DEPTH }: { maxDepth?: number } = {}
): ChainStep[] {
  checkDepth(maxDepth);
  return walk(links, cardId, maxDepth, "down");
}

export function upstream(
  links: Array<{
    id: string;
    fromCardId: string;
    toCardId: string;
    mechanism?: string;
    rival?: string;
  }>,
  cardId: string,
  { maxDepth = DEFAULT_MAX_DEPTH }: { maxDepth?: number } = {}
): ChainStep[] {
  checkDepth(maxDepth);
  return walk(links, cardId, maxDepth, "up");
}
