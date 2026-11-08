import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { REGIONS, THEMES, REGION_BY_ISO, THEME_KEYWORDS, regionOfIso, regionOfIsos, themeOfText } from '@benchmark/core/taxonomy';

const radar = JSON.parse(readFileSync(new URL('../../../data/risk-radar.json', import.meta.url), 'utf8'));

/** Every ISO code in the export, split on commas ("COD, RWA" lists two). */
const exportIsos = [...new Set(radar.flatMap((r) => r.iso.split(',').map((s) => s.trim()).filter(Boolean)))];

test('every ISO code in the radar export has a region', () => {
  assert.ok(exportIsos.length > 50, 'the export should list many countries');
  const missing = exportIsos.filter((iso) => regionOfIso(iso) === null);
  assert.deepEqual(missing, [], `no region for: ${missing.join(', ')}`);
});

test('the six regions are the only values, and each is used', () => {
  const values = new Set(Object.values(REGION_BY_ISO));
  for (const v of values) assert.ok(REGIONS.includes(v), `${v} is not one of REGIONS`);
  assert.equal(values.size, REGIONS.length, 'every region should have at least one country');
});

test('the mapping covers about 110 countries and is frozen', () => {
  const n = Object.keys(REGION_BY_ISO).length;
  assert.ok(n >= 100 && n <= 120, `expected about 110 countries, got ${n}`);
  assert.ok(Object.isFrozen(REGION_BY_ISO));
  assert.ok(Object.isFrozen(THEME_KEYWORDS));
});

test('regionOfIso is case and space tolerant and null when unknown', () => {
  assert.equal(regionOfIso('TCD'), 'Sahel & West/Central Africa');
  assert.equal(regionOfIso(' tcd '), 'Sahel & West/Central Africa');
  assert.equal(regionOfIso('XXX'), null);
  assert.equal(regionOfIso(''), null);
  assert.equal(regionOfIso(undefined), null);
  assert.equal(regionOfIso('constructor'), null, 'prototype keys are not countries');
});

test('regionOfIsos takes the first code that has a mapping', () => {
  assert.equal(regionOfIsos(['XXX', 'SDN']), 'East & Southern Africa');
  assert.equal(regionOfIsos(['BDI', 'COD', 'RWA']), 'East & Southern Africa');
  assert.equal(regionOfIsos(['COD', 'RWA']), 'Sahel & West/Central Africa');
  assert.equal(regionOfIsos([]), null);
  assert.equal(regionOfIsos(['XXX']), null);
  assert.equal(regionOfIsos('SDN'), null, 'a bare string is not a list');
});

test('the agreed regions for the two codes listed in both the export and the prototype', () => {
  assert.equal(regionOfIso('COD'), 'Sahel & West/Central Africa');
  assert.equal(regionOfIso('RWA'), 'East & Southern Africa');
});

test('themeOfText assigns each theme from its wording', () => {
  const cases = [
    ['Taliban attacks on provincial capitals lead to civil war violence', 'conflict'],
    ['Armed clashes force the closure of the main road into the city', 'conflict'],
    ['Failed harvest and rising wheat prices push households into hunger', 'food'],
    ['Famine declared as livelihoods collapse in the drylands', 'food'],
    ['Refugees and returnees arrive faster than shelters can be built', 'displacement'],
    ['Mass displacement and forced migration of families in the north', 'displacement'],
    ['Cholera outbreak spreads through camps with weak health services', 'health'],
    ['Measles and malaria surge as vaccination campaigns stall', 'health'],
    ['Severe flooding and a drought cycle damage farmland', 'climate'],
    ['Cyclone and heatwave risk rises for coastal districts', 'climate'],
    ['Currency collapse and inflation hit government budgets', 'political_economic'],
    ['Donor funding cuts and sanctions weaken the economy', 'political_economic'],
  ];
  for (const [text, theme] of cases) {
    assert.equal(themeOfText(text), theme, text);
  }
});

test('themeOfText falls back to political_economic when no keyword matches', () => {
  assert.equal(themeOfText('A quiet week in the capital with nothing to report'), 'political_economic');
  assert.equal(themeOfText(''), 'political_economic');
  assert.equal(themeOfText(undefined), 'political_economic');
});

test('themeOfText ties go to the theme listed first, and every result is a THEMES key', () => {
  // one conflict word and one health word: conflict is listed first in THEMES
  assert.equal(themeOfText('Attacks on health facilities'), 'conflict');
  for (const text of ['war', 'food', 'flood', 'government', '']) {
    assert.ok(Object.hasOwn(THEMES, themeOfText(text)));
  }
});

test('keyword matching respects word starts, so "waterfall" is not conflict', () => {
  assert.equal(themeOfText('A waterfall tourism plan'), 'political_economic');
  assert.equal(themeOfText('A war ends'), 'conflict');
  assert.equal(themeOfText('Forward planning'), 'political_economic', 'war\\b must not match "forward"');
});
