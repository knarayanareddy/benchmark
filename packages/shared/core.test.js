import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCard, validate, mount, VARIANTS } from './card.js';
import { strict, suppress, rate } from './validate.js';
import { compose, latency, LOOP_KIND } from './loop.js';
import { longSentences, trapFocus, MAX_SENTENCE_WORDS } from './a11y.js';

/* ---------- card ---------- */

test('a secondary action without a label is refused, not rendered as "undefined" (C12)', () => {
  assert.throws(
    () => buildCard({ headline: 'h', primary: { label: 'Go' }, secondary: {} }),
    /secondary action/
  );
  assert.throws(
    () => buildCard({ headline: 'h', primary: { label: 'Go' }, secondary: { label: '   ' } }),
    /secondary action/
  );
  const ok = buildCard({ headline: 'h', primary: { label: 'Go' }, secondary: { label: 'Not now' } });
  assert.equal(ok.secondary.label, 'Not now');
});

test('a valid card builds', () => {
  const c = buildCard({ headline: 'Help exists', primary: { label: 'See help' } });
  assert.equal(c.variant, 'card');
  assert.equal(c.headline, 'Help exists');
});

test('a card with no primary action is refused', () => {
  assert.throws(() => buildCard({ headline: 'x' }), /primary action/);
});

test('a headline that will not fit 320px is refused', () => {
  assert.throws(() => buildCard({ headline: 'x'.repeat(91), primary: { label: 'Go' } }), /90 chars/);
});

test('a body that would need scrolling is refused', () => {
  assert.throws(() => buildCard({ headline: 'h', body: 'y'.repeat(421), primary: { label: 'Go' } }), /scrolling/);
});

test('every variant is accepted', () => {
  for (const v of VARIANTS) {
    const c = buildCard({ variant: v, headline: 'h', primary: { label: 'Go' } });
    assert.equal(c.variant, v);
  }
});

test('validation reports every problem, not just the first', () => {
  const v = validate({ variant: 'nope', headline: '', primary: null });
  assert.ok(v.errors.length >= 3, JSON.stringify(v.errors));
});

/* ---------- validate ---------- */

const SCHEMA = { i: (v) => typeof v === 'string' };

test('an unknown key is rejected, never stripped', () => {
  const r = strict(SCHEMA, { i: 'a', session: 'x' });
  assert.equal(r.ok, false);
  assert.match(r.errors.join(), /unknown field: session/);
});

test('a payload with no unknown keys passes through intact', () => {
  const r = strict(SCHEMA, { i: 'a' });
  assert.equal(r.ok, true);
  assert.equal(r.payload.i, 'a');
});

test('a null or array payload returns errors instead of throwing (C14)', () => {
  // Object.keys(null) is a TypeError: a validator that crashes on its worst
  // input is not a validator.
  assert.deepEqual(strict(SCHEMA, null).ok, false);
  assert.match(strict(SCHEMA, null).errors.join(), /plain object/);
  assert.deepEqual(strict(SCHEMA, [1]).ok, false);
  assert.deepEqual(strict(SCHEMA, 'x').ok, false);
});

test('cells below k are suppressed rather than rounded', () => {
  const out = suppress([{ count: 4 }, { count: 10 }], 10);
  assert.equal(out[0].count, null);
  assert.equal(out[0].suppressed, true);
  assert.equal(out[1].count, 10);
});

test('a cell with no count is suppressed, not published (C3)', () => {
  // `undefined < 10` is false, so the naive comparison passed the cell through
  // untouched — and an uncountable cell is the one most likely to be a person.
  for (const row of [{ country: 'TCD' }, { country: 'TCD', count: undefined },
                     { country: 'TCD', count: null }, { country: 'TCD', count: 'twelve' },
                     { country: 'TCD', count: Number.NaN }]) {
    const [out] = suppress([row], 10);
    assert.equal(out.count, null, `${JSON.stringify(row)} must be suppressed`);
    assert.equal(out.suppressed, true);
  }
  const [missing] = suppress([{ country: 'TCD' }], 10);
  assert.equal(missing.why, 'no count', 'and it says why, so a zero is not confused with a gap');
  // A numeric string from a CSV is a count, not a gap.
  assert.equal(suppress([{ count: '12' }], 10)[0].count, '12');
  assert.equal(suppress([{ count: '3' }], 10)[0].count, null);
  // k is validated: 0 would switch the rule off entirely.
  assert.throws(() => suppress([{ count: 1 }], 0), RangeError);
});

test('a rate always carries its denominator and flags small n', () => {
  const r = rate(1, 20);
  assert.equal(r.denominator, 20);
  assert.match(r.note, /small denominator/);
  assert.equal(rate(1, 0).value, null);
});

test('a negative numerator or denominator is refused, not returned as -20% (C13)', () => {
  assert.throws(() => rate(1, -5), RangeError);
  assert.throws(() => rate(-1, 5), RangeError);
  assert.throws(() => rate(Number.NaN, 5), RangeError);
});

/* ---------- loop ---------- */

test('every loop kind composes without naming a person', () => {
  for (const k of Object.values(LOOP_KIND)) {
    const m = compose(k, { service: 'Offlimits', count: 3, count2: 1 });
    assert.equal(typeof m.body, 'string');
    assert.ok(m.body.length > 0);
    assert.ok(!/^You (?:searched|viewed)/i.test(m.body), k + ' must not address the person behaviourally');
  }
});

test('the dissent message is the one that retains, and it names the action', () => {
  const m = compose(LOOP_KIND.SPLIT, { count: 2 });
  assert.match(m.body, /two risks/);
  assert.match(m.body, /split into 2/);
});

test('a non-causal arrival claim is labelled as association', () => {
  const m = compose(LOOP_KIND.ARRIVED, { count: 68, service: 'Stop It Now', causal: false });
  assert.equal(m.honesty, 'association, not attribution');
});

test('an unknown loop kind throws rather than inventing a message', () => {
  assert.throws(() => compose('nonsense'), /unknown loop kind/);
});

test('latency is never negative', () => {
  assert.equal(latency(1000, 500), 0);
  assert.equal(latency(1000, 1500), 500);
  assert.equal(latency(null), null);
});

/* ---------- a11y ---------- */

test('plain-language rule catches long sentences', () => {
  const long = 'This sentence has a great many words in it and it keeps going past the limit that we have set here for plain language so it is caught.';
  assert.ok(longSentences(long).length === 1);
  assert.equal(longSentences('Short one. Also short.').length, 0);
  assert.equal(MAX_SENTENCE_WORDS, 20);
});

test('mount validates before touching the DOM', () => {
  let appended = false;
  const fakeDoc = { createElement: () => ({}), body: { appendChild: () => { appended = true; } } };
  assert.throws(() => mount({ variant: 'card', headline: '', primary: null }, { doc: fakeDoc }), /invalid card/);
  assert.equal(appended, false);
});

test('trapFocus wraps forward Tab on an HTMLElement whose activeElement lives on getRootNode()', () => {
  let focused = null;
  const b0 = { disabled: false, focus: () => { focused = 'b0'; } };
  const b1 = { disabled: false, focus: () => { focused = 'b1'; } };
  let handler = null;
  const root = {
    querySelectorAll: () => [b0, b1],
    getRootNode: () => ({ activeElement: b1 }),
    addEventListener: (_ev, fn) => { handler = fn; },
    removeEventListener: () => {},
  };
  trapFocus(root);
  let prevented = false;
  handler({ key: 'Tab', shiftKey: false, preventDefault: () => { prevented = true; } });
  assert.equal(prevented, true);
  assert.equal(focused, 'b0');
});
