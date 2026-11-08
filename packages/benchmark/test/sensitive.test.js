import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SENSITIVE_COUNTRIES, isSensitiveCountry } from '@benchmark/core/sensitive';

test('the default list holds ISO 3-letter codes only, with no duplicates', () => {
  for (const c of DEFAULT_SENSITIVE_COUNTRIES) assert.match(c, /^[A-Z]{3}$/);
  assert.equal(new Set(DEFAULT_SENSITIVE_COUNTRIES).size, DEFAULT_SENSITIVE_COUNTRIES.length);
});

test('a listed country is sensitive in any case or spacing, and an unlisted one is not', () => {
  assert.equal(isSensitiveCountry('TCD'), true);
  assert.equal(isSensitiveCountry(' tcd '), true);
  assert.equal(isSensitiveCountry('KEN'), false);
});

test('a deployment list replaces the default entirely', () => {
  assert.equal(isSensitiveCountry('KEN', ['KEN']), true);
  assert.equal(isSensitiveCountry('TCD', ['KEN']), false);
});

test('missing or malformed input is not sensitive and does not throw', () => {
  for (const v of [undefined, null, '', 42, {}]) assert.equal(isSensitiveCountry(v), false);
});
