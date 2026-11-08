import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as types from '../src/types.js';
import { simCardId } from '../src/label.js';

test('types.js exports only the frozen card-kind list at runtime', () => {
  assert.deepEqual(Object.keys(types), ['KINDS']);
  assert.ok(Object.isFrozen(types.KINDS));
  assert.deepEqual([...types.KINDS], ['risk', 'trigger']);
});

test('card kinds are the only kinds the id helper accepts', () => {
  for (const kind of types.KINDS) assert.match(simCardId(1, kind), /^SIM-T?000001$/);
  assert.throws(() => simCardId(1, 'panel'), RangeError);
});
