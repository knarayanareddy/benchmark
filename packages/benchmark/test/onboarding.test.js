import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  MAX_COUNTRIES,
  CAP_OPTIONS,
  STEPS,
  COUNTRY_NAMES,
  countryName,
  searchCountries,
  levelCards,
  recommendedLevel,
  validateStep,
  parseInvite,
} from '@benchmark/core/onboarding';
import { REGION_BY_ISO } from '@benchmark/core/taxonomy';
import { LEVELS, LEVEL_COPY, PUBLIC } from '@benchmark/core/anonymity';
import { DEFAULT_SENSITIVE_COUNTRIES } from '@benchmark/core/sensitive';
import { consentText } from '@benchmark/service/consent';

const radar = JSON.parse(readFileSync(new URL('../../../data/risk-radar.json', import.meta.url), 'utf8'));
const radarIsos = radar.flatMap((r) => String(r.iso ?? '').split(',').map((c) => c.trim()).filter(Boolean));

const ORDER = [LEVELS.IDENTIFIED, LEVELS.PSEUDONYMOUS, LEVELS.ANONYMOUS];

test('constants have the documented values and are frozen', () => {
  assert.equal(MAX_COUNTRIES, 6);
  assert.deepEqual([...CAP_OPTIONS], [1, 2, 3, 5]);
  assert.ok(Object.isFrozen(CAP_OPTIONS));
  assert.deepEqual([...STEPS], ['Invitation', 'Your expertise', 'Your visibility', 'Your rhythm']);
  assert.ok(Object.isFrozen(STEPS));
  assert.ok(Object.isFrozen(COUNTRY_NAMES));
});

test('every REGION_BY_ISO key and every radar ISO code has an English name', () => {
  for (const iso of Object.keys(REGION_BY_ISO)) {
    assert.ok(COUNTRY_NAMES[iso], `${iso} has no name`);
  }
  assert.ok(radarIsos.length > 0, 'the radar file should contribute codes');
  for (const iso of radarIsos) {
    assert.match(iso, /^[A-Z]{3}$/);
    assert.ok(COUNTRY_NAMES[iso], `radar code ${iso} has no name`);
  }
  for (const [iso, name] of Object.entries(COUNTRY_NAMES)) {
    assert.match(iso, /^[A-Z]{3}$/);
    assert.ok(name.trim() === name && name.length > 1, `${iso} has a malformed name "${name}"`);
  }
});

test('countryName resolves known codes, tolerates case and spaces, and falls back to the upper-cased code', () => {
  assert.equal(countryName('TCD'), 'Chad');
  assert.equal(countryName(' tcd '), 'Chad');
  assert.equal(countryName('xyz'), 'XYZ');
  assert.equal(countryName(''), '');
  assert.equal(countryName(null), '');
  assert.equal(countryName({}), '');
});

test('search matches by name substring, accent-insensitively, by exact ISO, and returns all for empty', () => {
  const names = (q) => searchCountries(q).map((c) => c.iso);
  assert.deepEqual(names('chad'), ['TCD']);
  assert.deepEqual(names('CONGO').sort(), ['COD', 'COG']);
  assert.deepEqual(names('sao tome'), ['STP']);
  assert.deepEqual(names('São'), ['STP']);
  assert.deepEqual(names('cod'), ['COD']);
  assert.deepEqual(names('  '), names(''));
  assert.equal(searchCountries('').length, Object.keys(COUNTRY_NAMES).length);
  assert.deepEqual(searchCountries('zzzz-no-such-country'), []);
  assert.deepEqual(searchCountries(undefined).length, Object.keys(COUNTRY_NAMES).length);
  assert.deepEqual(Object.keys(searchCountries('')[0]).sort(), ['iso', 'name']);
});

test('search results are sorted by name', () => {
  const list = searchCountries('');
  const sorted = [...list].sort((a, b) => a.name.localeCompare(b.name, 'en'));
  assert.deepEqual(list, sorted);
});

test('levelCards returns exactly three frozen cards in the order identified, pseudonymous, anonymous', () => {
  const cards = levelCards();
  assert.equal(cards.length, 3);
  assert.deepEqual(cards.map((c) => c.level), ORDER);
  assert.ok(Object.isFrozen(cards));
  for (const c of cards) assert.ok(Object.isFrozen(c));
});

test('each card label, ACAPS line, peer line and warning are the LEVEL_COPY strings', () => {
  for (const card of levelCards()) {
    const copy = LEVEL_COPY[card.level];
    assert.equal(card.label, copy.label);
    assert.equal(card.warn, copy.warn);
    const who = (w) => card.audiences.find((a) => a.who === w)?.text;
    assert.equal(who('ACAPS moderators'), copy.toAcaps);
    assert.equal(who('Circle peers'), copy.toPeers);
  }
});

test('the public line is built from PUBLIC.minCount', () => {
  for (const card of levelCards()) {
    const line = card.audiences.find((a) => a.who === 'The public')?.text ?? '';
    assert.ok(line.includes(String(PUBLIC.minCount)), `public line lacks ${PUBLIC.minCount}: "${line}"`);
    assert.equal(line, `Aggregates only, and only when at least ${PUBLIC.minCount} people are in a group.`);
  }
});

test('no card says ACAPS does not know who the person is', () => {
  const text = JSON.stringify(levelCards());
  assert.equal(text.includes("doesn't know who I am"), false);
  assert.equal(text.includes('does not know who I am'), false);
  assert.equal(text.includes('doesn’t know who I am'), false);
});

test('the pseudonymous card says ACAPS knows, and its safety line says so too', () => {
  const pseudo = levelCards().find((c) => c.level === LEVELS.PSEUDONYMOUS);
  assert.ok(pseudo.tagline.includes('ACAPS knows'));
  const safety = pseudo.audiences.find((a) => a.who === 'If there is a safety concern').text;
  assert.equal(safety, 'ACAPS already knows who you are.');
});

test('the anonymous safety line states both the safety override and the device-held case', () => {
  const anon = levelCards().find((c) => c.level === LEVELS.ANONYMOUS);
  const safety = anon.audiences.find((a) => a.who === 'If there is a safety concern').text;
  assert.match(safety, /two moderators together can open the sealed note/);
  assert.match(safety, /device-held key nothing can be opened/);
  assert.match(safety, /never opened/);
});

test('the identified safety line says nothing extra is needed', () => {
  const idCard = levelCards().find((c) => c.level === LEVELS.IDENTIFIED);
  assert.equal(
    idCard.audiences.find((a) => a.who === 'If there is a safety concern').text,
    'Nothing extra: your name is already visible.',
  );
});

test('cross-check: the card text is the same text consentText() accepts', () => {
  for (const level of ORDER) {
    const text = consentText(level);
    const card = levelCards().find((c) => c.level === level);
    const acaps = card.audiences.find((a) => a.who === 'ACAPS moderators').text;
    const peers = card.audiences.find((a) => a.who === 'Circle peers').text;
    assert.ok(text.includes(`To ACAPS: ${acaps}`), `${level}: consent lacks the card's ACAPS line`);
    assert.ok(text.includes(`To other experts: ${peers}`), `${level}: consent lacks the card's peer line`);
    assert.ok(text.includes(`Caution: ${card.warn}`), `${level}: consent lacks the card's warning`);
  }
  const pseudoSafety = levelCards().find((c) => c.level === LEVELS.PSEUDONYMOUS).audiences
    .find((a) => a.who === 'If there is a safety concern').text;
  assert.ok(consentText(LEVELS.PSEUDONYMOUS).includes('ACAPS knows who you are'));
  assert.ok(pseudoSafety.includes('knows who you are'));
});

test('recommendedLevel: pseudonymous by default, with the reason shown', () => {
  const r = recommendedLevel(['KEN', 'FRA']);
  assert.deepEqual(r, {
    level: LEVELS.PSEUDONYMOUS,
    reason: 'A stable alias lets colleagues follow your reasoning while keeping your name from them.',
  });
  assert.equal(recommendedLevel([]).level, LEVELS.PSEUDONYMOUS);
});

test('recommendedLevel: anonymous when any chosen country is sensitive, with the reason shown', () => {
  const r = recommendedLevel(['KEN', 'TCD', 'SDN']);
  assert.deepEqual(r, {
    level: LEVELS.ANONYMOUS,
    reason: 'You cover a context where being named can put people at risk.',
  });
  assert.equal(recommendedLevel(['SDN']).level, LEVELS.ANONYMOUS);
});

test('recommendedLevel: country codes are case and space tolerant', () => {
  assert.equal(recommendedLevel(['tcd']).level, LEVELS.ANONYMOUS);
  assert.equal(recommendedLevel([' sdn ']).level, LEVELS.ANONYMOUS);
});

test('recommendedLevel: junk input is tolerated and reads as not sensitive', () => {
  for (const junk of [undefined, null, 'TCD', 42, {}, [null, 7, {}]]) {
    assert.equal(recommendedLevel(junk).level, LEVELS.PSEUDONYMOUS, `junk ${JSON.stringify(junk)}`);
  }
});

test('recommendedLevel: a supplied sensitive list replaces the default', () => {
  assert.equal(recommendedLevel(['KEN'], ['KEN']).level, LEVELS.ANONYMOUS);
  assert.equal(recommendedLevel(['TCD'], ['KEN']).level, LEVELS.PSEUDONYMOUS);
  assert.ok(DEFAULT_SENSITIVE_COUNTRIES.includes('TCD'));
});

test('validateStep 1: a token or demo mode is required', () => {
  assert.equal(validateStep(1, {}).ok, false);
  assert.equal(validateStep(1, { token: '   ' }).ok, false);
  assert.equal(validateStep(1, { token: null }).ok, false);
  assert.deepEqual(validateStep(1, { token: 'abc' }), { ok: true, problems: [] });
  assert.deepEqual(validateStep(1, { demo: true }), { ok: true, problems: [] });
});

test('validateStep 2: a valid pilot profile passes', () => {
  const r = validateStep(2, { countries: ['KEN'], themes: ['food'], roleType: 'researcher', organisation: '' });
  assert.deepEqual(r, { ok: true, problems: [] });
});

test('validateStep 2: demo needs a name of 1 to 80 characters', () => {
  const base = { demo: true, countries: ['KEN'] };
  const empty = validateStep(2, { ...base, name: '   ' });
  assert.equal(empty.ok, false);
  assert.ok(empty.problems.some((p) => /name/i.test(p)));
  assert.equal(validateStep(2, { ...base, name: 'a'.repeat(81) }).ok, false);
  assert.equal(validateStep(2, { ...base, name: 'a'.repeat(80) }).ok, true);
});

test('validateStep 2: countries must be 1 to MAX_COUNTRIES known codes', () => {
  const seven = ['KEN', 'UGA', 'TZA', 'RWA', 'BDI', 'ETH', 'SOM'];
  const tooMany = validateStep(2, { countries: seven });
  assert.equal(tooMany.ok, false);
  assert.ok(tooMany.problems.some((p) => p.includes(String(MAX_COUNTRIES))), tooMany.problems.join(' | '));
  assert.equal(validateStep(2, { countries: seven.slice(0, MAX_COUNTRIES) }).ok, true);
  assert.equal(validateStep(2, { countries: [] }).ok, false);
  assert.equal(validateStep(2, {}).ok, false);
  const unknown = validateStep(2, { countries: ['XYZ'] });
  assert.equal(unknown.ok, false);
  assert.ok(unknown.problems.some((p) => p.includes('XYZ')));
});

test('validateStep 2: themes, role and organisation are checked against their lists and limits', () => {
  assert.equal(validateStep(2, { countries: ['KEN'], themes: ['weather'] }).ok, false);
  assert.equal(validateStep(2, { countries: ['KEN'], themes: ['food', 'health'] }).ok, true);
  assert.equal(validateStep(2, { countries: ['KEN'], roleType: 'astronaut' }).ok, false);
  assert.equal(validateStep(2, { countries: ['KEN'], roleType: '' }).ok, true);
  assert.equal(validateStep(2, { countries: ['KEN'], organisation: 'x'.repeat(121) }).ok, false);
  assert.equal(validateStep(2, { countries: ['KEN'], organisation: 'x'.repeat(120) }).ok, true);
});

test('validateStep 2 reports every problem at once', () => {
  const r = validateStep(2, { demo: true, name: '', countries: ['XYZ', 'ABC', 'QQQ', 'AAA', 'BBB', 'CCC', 'DDD'], themes: ['nope'] });
  assert.equal(r.ok, false);
  assert.ok(r.problems.length >= 4, r.problems.join(' | '));
  for (const p of r.problems) assert.match(p, /[.]$/);
});

test('validateStep 3: the visibility level must be one of the three', () => {
  assert.equal(validateStep(3, {}).ok, false);
  assert.equal(validateStep(3, { level: 'known' }).ok, false);
  for (const level of ORDER) assert.equal(validateStep(3, { level }).ok, true);
});

test('validateStep 4: cap, consent and recovery rules', () => {
  const ok = { weeklyCap: 3, consentAccepted: true };
  assert.deepEqual(validateStep(4, ok), { ok: true, problems: [] });
  assert.equal(validateStep(4, { ...ok, weeklyCap: 4 }).ok, false);
  assert.equal(validateStep(4, { ...ok, weeklyCap: '3' }).ok, false);
  for (const cap of CAP_OPTIONS) assert.equal(validateStep(4, { ...ok, weeklyCap: cap }).ok, true);
  assert.equal(validateStep(4, { ...ok, consentAccepted: false }).ok, false);
  assert.equal(validateStep(4, { ...ok, device: true, recoverySaved: false }).ok, false);
  assert.equal(validateStep(4, { ...ok, device: true, recoverySaved: true }).ok, true);
});

test('validateStep 4 names every failing rule in one result', () => {
  const r = validateStep(4, { weeklyCap: 4, consentAccepted: false, device: true, recoverySaved: false });
  assert.equal(r.ok, false);
  assert.equal(r.problems.length, 3, r.problems.join(' | '));
});

test('validateStep rejects a step outside 1 to 4', () => {
  assert.throws(() => validateStep(0, {}), RangeError);
  assert.throws(() => validateStep(5, {}), RangeError);
});

test('parseInvite accepts a raw token, trimmed', () => {
  assert.equal(parseInvite('abc_DEF-123'), 'abc_DEF-123');
  assert.equal(parseInvite('  abc_DEF-123  '), 'abc_DEF-123');
});

test('parseInvite reads the token from a hash or query link', () => {
  assert.equal(parseInvite('https://pilot.example.org/expert#invite=abc123'), 'abc123');
  assert.equal(parseInvite('https://pilot.example.org/expert?invite=abc123&lang=en'), 'abc123');
  assert.equal(parseInvite('https://pilot.example.org/expert#lang=en&invite=abc123'), 'abc123');
  assert.equal(parseInvite('#invite=abc123'), 'abc123');
});

test('parseInvite rejects empty input and tokens with whitespace inside', () => {
  assert.equal(parseInvite(''), null);
  assert.equal(parseInvite('   '), null);
  assert.equal(parseInvite('abc 123'), null);
  assert.equal(parseInvite('https://pilot.example.org/#invite=abc 123'), null);
  assert.equal(parseInvite('https://pilot.example.org/#invite='), null);
  assert.equal(parseInvite(null), null);
  assert.equal(parseInvite(42), null);
});

test('levelCards({ breakGlass: false }): the anonymous safety line says nobody can open it, and nothing about two moderators', () => {
  const anon = levelCards({ breakGlass: false }).find((c) => c.level === LEVELS.ANONYMOUS);
  const safety = anon.audiences.find((a) => a.who === 'If there is a safety concern').text;
  assert.equal(safety, 'Nobody at ACAPS can open an anonymous objection back to you. With a device-held key nothing can be opened either.');
  assert.doesNotMatch(safety, /moderators/);
});

test('levelCards: only the anonymous safety line depends on breakGlass; every other card is unchanged', () => {
  const on = levelCards({ breakGlass: true });
  const off = levelCards({ breakGlass: false });
  assert.deepEqual(levelCards(), on, 'the default is the override wording');
  assert.deepEqual(on.map((c) => c.level), ORDER);
  assert.deepEqual(off.map((c) => c.level), ORDER);
  for (const [i, card] of on.entries()) {
    assert.deepEqual(off[i].label, card.label);
    assert.deepEqual(off[i].tagline, card.tagline);
    assert.deepEqual(off[i].warn, card.warn);
    assert.deepEqual(off[i].audiences.map((a) => a.who), card.audiences.map((a) => a.who));
    for (const [j, a] of card.audiences.entries()) {
      const same = off[i].audiences[j].text === a.text;
      assert.equal(same, a.who !== 'If there is a safety concern' || card.level !== LEVELS.ANONYMOUS, `${card.level}/${a.who}`);
    }
  }
  assert.ok(Object.isFrozen(off) && off.every((c) => Object.isFrozen(c)));
});

test('consistency with the service: each anonymous card line agrees with its consent text, for both deployments', () => {
  const pick = (bg) => levelCards({ breakGlass: bg }).find((c) => c.level === LEVELS.ANONYMOUS)
    .audiences.find((a) => a.who === 'If there is a safety concern').text;
  const overrideConsent = consentText(LEVELS.ANONYMOUS, { breakGlass: true });
  const noOverrideConsent = consentText(LEVELS.ANONYMOUS, { breakGlass: false });

  assert.match(overrideConsent, /Safety override: if an anonymous objection you send raises a serious safety or legal concern, two ACAPS moderators together can open the sealed note/);
  assert.match(pick(true), /two moderators together can open the sealed note/);
  assert.doesNotMatch(noOverrideConsent, /two ACAPS moderators/);

  assert.match(noOverrideConsent, /No safety override is configured: nobody at ACAPS can open an anonymous objection back to you\./);
  assert.match(pick(false), /^Nobody at ACAPS can open an anonymous objection back to you\./);
  assert.doesNotMatch(pick(false), /moderators/);
});
