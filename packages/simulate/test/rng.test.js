import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hashSeed, makeRng, expit, logit } from '../src/rng.js';

const draws = (rng, n) => Array.from({ length: n }, () => rng.next());

test('hashSeed is FNV-1a 32-bit and separates parts', () => {
  assert.equal(hashSeed('a'), 0xe40c292c);
  assert.equal(hashSeed(''), 0x811c9dc5);
  assert.notEqual(hashSeed('1', '2'), hashSeed('12'));
  assert.notEqual(hashSeed(1, 'x'), hashSeed('1x'));
});

test('same seed gives the same stream; a string seed is hashed', () => {
  assert.deepEqual(draws(makeRng(20261107), 1000), draws(makeRng(20261107), 1000));
  assert.deepEqual(draws(makeRng('pilot'), 1000), draws(makeRng('pilot'), 1000));
  assert.notDeepEqual(draws(makeRng(1), 100), draws(makeRng(2), 100));
});

test('next() is uniform on [0, 1)', () => {
  const xs = draws(makeRng(7), 200000);
  assert.ok(xs.every((x) => x >= 0 && x < 1));
  const mean = xs.reduce((s, x) => s + x, 0) / xs.length;
  assert.ok(Math.abs(mean - 0.5) < 0.003, `mean ${mean}`);
});

test('normal(): 1e6 draws have mean within 0.005 of 0 and variance within 0.01 of 1', () => {
  const rng = makeRng(42);
  let s = 0;
  let s2 = 0;
  const n = 1e6;
  for (let i = 0; i < n; i++) {
    const z = rng.normal();
    s += z;
    s2 += z * z;
  }
  const mean = s / n;
  const variance = s2 / n - mean * mean;
  assert.ok(Math.abs(mean) < 0.005, `mean ${mean}`);
  assert.ok(Math.abs(variance - 1) < 0.01, `variance ${variance}`);
});

test('uniform, beta and bernoulli have their means and variances', () => {
  const rng = makeRng(99);
  const n = 200000;
  const mom = (f) => {
    let s = 0;
    let s2 = 0;
    for (let i = 0; i < n; i++) {
      const x = f();
      s += x;
      s2 += x * x;
    }
    const m = s / n;
    return { m, v: s2 / n - m * m };
  };
  const u = mom(() => rng.uniform(2, 5));
  assert.ok(Math.abs(u.m - 3.5) < 0.01);
  assert.ok(Math.abs(u.v - 9 / 12) < 0.01);

  // Beta(2, 5): mean 2/7, variance ab / ((a+b)^2 (a+b+1)).
  const b = mom(() => rng.beta(2, 5));
  assert.ok(Math.abs(b.m - 2 / 7) < 0.003, `beta mean ${b.m}`);
  assert.ok(Math.abs(b.v - 10 / (49 * 8)) < 0.002, `beta variance ${b.v}`);

  // Beta with shape below 1 goes through the boosted gamma path.
  const bs = mom(() => rng.beta(0.5, 0.5));
  assert.ok(Math.abs(bs.m - 0.5) < 0.003, `beta(0.5,0.5) mean ${bs.m}`);

  const be = mom(() => rng.bernoulli(0.3));
  assert.ok(Math.abs(be.m - 0.3) < 0.003, `bernoulli mean ${be.m}`);
});

test('int(n) covers 0..n-1 evenly', () => {
  const rng = makeRng(5);
  const counts = [0, 0, 0, 0, 0, 0];
  const n = 600000;
  for (let i = 0; i < n; i++) counts[rng.int(6)]++;
  for (const c of counts) assert.ok(Math.abs(c / n - 1 / 6) < 0.003, `bin ${c}`);
  assert.throws(() => rng.int(0), RangeError);
});

test('stream independence: a fork ignores how far its parent has been drawn', () => {
  const early = makeRng(11).fork('panel').next();
  const parent = makeRng(11);
  for (let i = 0; i < 12345; i++) parent.next();
  assert.equal(parent.fork('panel').next(), early);
});

test('stream independence: draws from one fork never shift a sibling or the parent', () => {
  const quiet = makeRng(11);
  const baseline = { a: draws(quiet.fork('a'), 500), b: draws(quiet.fork('b'), 500) };

  const busy = makeRng(11);
  const a = busy.fork('a');
  const b = busy.fork('b');
  draws(a, 9000); // a heavy consumer in stream a
  const bAfter = draws(b, 500);
  assert.deepEqual(bAfter, baseline.b, 'sibling stream b was shifted by draws from a');
  assert.deepEqual(busy.fork('a').next(), baseline.a[0], 'forking a again changed');
});

test('forks reproduce for the same tag and differ across tags', () => {
  const root = makeRng(3);
  assert.deepEqual(draws(root.fork('x'), 200), draws(makeRng(3).fork('x'), 200));
  assert.notDeepEqual(draws(root.fork('x'), 200), draws(root.fork('y'), 200));
  // A fork of a fork is reproducible and differs from its parent's fork.
  assert.deepEqual(draws(root.fork('x').fork('z'), 50), draws(makeRng(3).fork('x').fork('z'), 50));
  assert.notDeepEqual(draws(root.fork('x').fork('z'), 50), draws(root.fork('z'), 50));
});

test('expit and logit are inverses', () => {
  for (const p of [0.01, 0.2, 0.5, 0.87, 0.99]) assert.ok(Math.abs(expit(logit(p)) - p) < 1e-12);
  assert.equal(expit(0), 0.5);
});

test('makeRng rejects a non-integer numeric seed', () => {
  assert.throws(() => makeRng(1.5), TypeError);
});
