import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateLink, wouldDuplicate, downstream, upstream } from '@benchmark/core/links';

const MECH = 'Drought cut harvests, so prices rose.';
const RIVAL = 'A currency devaluation explains the same price rise.';
const ok = (over = {}) => ({ fromCardId: 'c1', toCardId: 'c2', mechanism: MECH, rival: RIVAL, ...over });
const link = (id, fromCardId, toCardId) => ({ id, fromCardId, toCardId });

test('a complete valid link is accepted and returned trimmed', () => {
  const r = validateLink(ok({ fromCardId: ' c1 ', mechanism: `  ${MECH}  `, rival: RIVAL }));
  assert.equal(r.ok, true);
  assert.deepEqual(r.problems, []);
  assert.deepEqual(r.link, { fromCardId: 'c1', toCardId: 'c2', mechanism: MECH, rival: RIVAL });
});

test('an empty input reports every missing field at once', () => {
  const r = validateLink({});
  assert.equal(r.ok, false);
  assert.equal(r.link, null);
  assert.equal(r.problems.length, 4);
  assert.ok(r.problems.some((p) => /fromCardId/.test(p)));
  assert.ok(r.problems.some((p) => /toCardId/.test(p)));
  assert.ok(r.problems.some((p) => /mechanism/.test(p)));
  assert.ok(r.problems.some((p) => /rival/.test(p)));
});

test('a same-card link is rejected', () => {
  const r = validateLink(ok({ toCardId: 'c1' }));
  assert.equal(r.ok, false);
  assert.equal(r.problems.length, 1);
  assert.match(r.problems[0], /different/);
});

test('whitespace-only ids count as missing', () => {
  const r = validateLink(ok({ fromCardId: '   ', toCardId: '' }));
  assert.equal(r.ok, false);
  assert.equal(r.problems.filter((p) => /CardId is required/.test(p)).length, 2);
});

test('mechanism length is enforced on the trimmed text at 20 and 500', () => {
  assert.equal(validateLink(ok({ mechanism: 'x'.repeat(19) })).ok, false);
  assert.equal(validateLink(ok({ mechanism: 'x'.repeat(20) })).ok, true);
  assert.equal(validateLink(ok({ mechanism: 'x'.repeat(500) })).ok, true);
  assert.equal(validateLink(ok({ mechanism: 'x'.repeat(501) })).ok, false);
  assert.equal(validateLink(ok({ mechanism: `   ${'x'.repeat(19)}   ` })).ok, false);
});

test('the rival explanation is required and bounded the same way', () => {
  const missing = validateLink(ok({ rival: undefined }));
  assert.equal(missing.ok, false);
  assert.equal(missing.link, null);
  assert.equal(missing.problems.length, 1);
  assert.match(missing.problems[0], /rival/);
  assert.equal(validateLink(ok({ rival: 'too short' })).ok, false);
  assert.equal(validateLink(ok({ rival: '    ' })).ok, false);
  assert.equal(validateLink(ok({ rival: 'x'.repeat(20) })).ok, true);
  assert.equal(validateLink(ok({ rival: 'x'.repeat(501) })).ok, false);
});

test('every problem is reported together, not only the first', () => {
  const r = validateLink({ fromCardId: 'c1', toCardId: 'c1', mechanism: 'short', rival: '' });
  assert.equal(r.ok, false);
  assert.equal(r.problems.length, 3);
});

test('wouldDuplicate matches an ordered pair only', () => {
  const links = [link('l1', 'A', 'B')];
  assert.equal(wouldDuplicate(links, 'A', 'B'), true);
  assert.equal(wouldDuplicate(links, 'B', 'A'), false);
  assert.equal(wouldDuplicate(links, 'A', 'C'), false);
  assert.equal(wouldDuplicate([], 'A', 'B'), false);
});

test('downstream lists a chain with depth and the reaching link', () => {
  const links = [link('l1', 'A', 'B'), link('l2', 'B', 'C'), link('l3', 'C', 'D')];
  assert.deepEqual(downstream(links, 'A'), [
    { cardId: 'B', depth: 1, via: 'l1' },
    { cardId: 'C', depth: 2, via: 'l2' },
    { cardId: 'D', depth: 3, via: 'l3' },
  ]);
});

test('downstream enforces maxDepth, default 3', () => {
  const links = [link('l1', 'A', 'B'), link('l2', 'B', 'C'), link('l3', 'C', 'D'), link('l4', 'D', 'E')];
  assert.deepEqual(downstream(links, 'A').map((x) => x.cardId), ['B', 'C', 'D']);
  assert.deepEqual(downstream(links, 'A', { maxDepth: 1 }).map((x) => x.cardId), ['B']);
  assert.deepEqual(downstream(links, 'A', { maxDepth: 0 }), []);
  assert.deepEqual(downstream(links, 'A', { maxDepth: 4 }).map((x) => x.cardId), ['B', 'C', 'D', 'E']);
});

test('downstream rejects an invalid maxDepth', () => {
  assert.throws(() => downstream([], 'A', { maxDepth: -1 }), RangeError);
  assert.throws(() => downstream([], 'A', { maxDepth: 1.5 }), RangeError);
});

test('a cycle does not loop and never returns the start card', () => {
  const links = [link('l1', 'A', 'B'), link('l2', 'B', 'A')];
  assert.deepEqual(downstream(links, 'A', { maxDepth: 10 }), [{ cardId: 'B', depth: 1, via: 'l1' }]);
  assert.deepEqual(upstream(links, 'A', { maxDepth: 10 }), [{ cardId: 'B', depth: 1, via: 'l2' }]);
});

test('a three-card cycle is walked once per card', () => {
  const links = [link('l1', 'A', 'B'), link('l2', 'B', 'C'), link('l3', 'C', 'A')];
  assert.deepEqual(downstream(links, 'A', { maxDepth: 10 }).map((x) => x.cardId), ['B', 'C']);
});

test('a diamond lists D once at its shallowest depth, via the first link reaching it', () => {
  const links = [link('l1', 'A', 'B'), link('l2', 'A', 'C'), link('l3', 'B', 'D'), link('l4', 'C', 'D')];
  const out = downstream(links, 'A');
  assert.deepEqual(out, [
    { cardId: 'B', depth: 1, via: 'l1' },
    { cardId: 'C', depth: 1, via: 'l2' },
    { cardId: 'D', depth: 2, via: 'l3' },
  ]);
});

test('a card reachable by a short and a long path keeps the shallow depth', () => {
  const links = [link('l1', 'A', 'B'), link('l2', 'B', 'C'), link('l3', 'A', 'C')];
  assert.deepEqual(downstream(links, 'A'), [
    { cardId: 'B', depth: 1, via: 'l1' },
    { cardId: 'C', depth: 1, via: 'l3' },
  ]);
});

test('upstream walks the reverse direction with the same shape', () => {
  const links = [link('l1', 'A', 'B'), link('l2', 'B', 'C'), link('l3', 'C', 'D')];
  assert.deepEqual(upstream(links, 'D'), [
    { cardId: 'C', depth: 1, via: 'l3' },
    { cardId: 'B', depth: 2, via: 'l2' },
    { cardId: 'A', depth: 3, via: 'l1' },
  ]);
  assert.deepEqual(upstream(links, 'D', { maxDepth: 1 }).map((x) => x.cardId), ['C']);
});

test('upstream on a diamond lists A once', () => {
  const links = [link('l1', 'A', 'B'), link('l2', 'A', 'C'), link('l3', 'B', 'D'), link('l4', 'C', 'D')];
  const out = upstream(links, 'D');
  assert.deepEqual(out.map((x) => x.cardId), ['B', 'C', 'A']);
  assert.equal(out[2].depth, 2);
});

test('a card with no links has an empty chain in both directions', () => {
  const links = [link('l1', 'A', 'B')];
  assert.deepEqual(downstream(links, 'Z'), []);
  assert.deepEqual(upstream(links, 'Z'), []);
});

test('property: on random graphs downstream never returns the start and never repeats a card', () => {
  let seed = 20260711;
  const rnd = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  const names = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
  for (let trial = 0; trial < 200; trial++) {
    const links = [];
    for (let i = 0; i < 14; i++) {
      const from = names[Math.floor(rnd() * names.length)];
      const to = names[Math.floor(rnd() * names.length)];
      links.push(link(`l${i}`, from, to));
    }
    for (const start of names) {
      const maxDepth = 1 + Math.floor(rnd() * 4);
      for (const walkFn of [downstream, upstream]) {
        const out = walkFn(links, start, { maxDepth });
        const ids = out.map((x) => x.cardId);
        assert.equal(ids.includes(start), false, `start ${start} returned`);
        assert.equal(new Set(ids).size, ids.length, `repeat in ${ids.join(',')}`);
        assert.ok(out.every((x) => x.depth >= 1 && x.depth <= maxDepth));
      }
    }
  }
});
