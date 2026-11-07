// Tests for the judgement-call register (power-spec §R, §F WP8b). Deterministic: no clock, no randomness.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ASSUMPTIONS_PATH, loadAssumptions, listKeys } from '../src/assumptions.js';
import {
  renderRegister, checkRegister, PLAIN_BANNED, HEADER_TEXT, DOC_PATH,
} from '../src/register.js';
import { BANNER } from '../src/label.js';

const REAL = JSON.parse(readFileSync(ASSUMPTIONS_PATH, 'utf8'));
const clone = (x) => structuredClone(x);
const entryOf = (data, id) => data.entries.find((e) => e.id === id);

/** Writes a modified copy of assumptions.json to a temp dir and loads it through the real loader. */
function loadCopy(mutate) {
  const dir = mkdtempSync(join(tmpdir(), 'register-'));
  const data = clone(REAL);
  mutate(data);
  const file = join(dir, 'assumptions.json');
  writeFileSync(file, JSON.stringify(data));
  return { assumptions: loadAssumptions(file), dir };
}

/** Phrases the study must never claim (power-spec §E). Negated uses are not in the register. */
const PHRASE_BANNED = [/\bproves?\b/i, /\bwill detect\b/i, /\bno difference\b/i];

test('rendering is deterministic: the same input gives byte-identical output', () => {
  const first = renderRegister(loadAssumptions());
  const second = renderRegister(loadAssumptions());
  assert.equal(first, second);
  assert.ok(first.endsWith('\n'));
});

test('every judgement call J01 to J24 has its own block', () => {
  const text = renderRegister(loadAssumptions());
  for (let i = 1; i <= 24; i++) {
    const id = `J${String(i).padStart(2, '0')}`;
    assert.ok(new RegExp(`^## ${id}$`, 'm').test(text), `${id} has no block`);
  }
});

test('every key in assumptions.json appears in the output as a parameter line', () => {
  const text = renderRegister(loadAssumptions());
  for (const key of listKeys()) {
    assert.ok(text.includes(`Parameter \`${key}\`:`), `key ${key} is not in the register`);
  }
});

test('the summary shows the unreviewed count, in the banner and in the status line', () => {
  const text = renderRegister(loadAssumptions());
  assert.match(text, /^> 22 judgement calls not yet reviewed by ACAPS\.$/m);
  assert.match(text, /\*\*Unreviewed: 22 of 24 judgement calls not yet reviewed by ACAPS\.\*\*/);
  assert.match(text, /Reviewed so far: 2 accepted, 0 changed, 0 vetoed\./);
});

test('the unreviewed count falls when a call is accepted, and the entry shows the reviewer', () => {
  const { assumptions, dir } = loadCopy((d) => {
    Object.assign(entryOf(d, 'J05').review, { state: 'accepted', by: 'Dana Reyes', date: '2026-11-02', note: 'Agreed.' });
  });
  try {
    const text = renderRegister(assumptions);
    assert.match(text, /^> 21 judgement calls not yet reviewed by ACAPS\.$/m);
    assert.match(text, /Accepted by Dana Reyes on 2026-11-02\. Note: Agreed\./);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a vetoed call shows its review state, reviewer, date, note and the replacement value', () => {
  const { assumptions, dir } = loadCopy((d) => {
    const e = entryOf(d, 'J05');
    e.value.icc = 0.4;
    Object.assign(e.review, { state: 'vetoed', by: 'Ana Ruiz', date: '2026-11-03', note: 'Our experts share more sources than that.' });
  });
  try {
    const text = renderRegister(assumptions);
    const block = text.split(/^## J05$/m)[1].split(/^## J06$/m)[0];
    assert.match(block, /Parameter `icc`: 0\.4 \(allowed: 0 to 0\.6\)/);
    assert.match(block, /Vetoed by Ana Ruiz on 2026-11-03\. The value above replaces the vetoed one\. Note: Our experts share more sources than that\./);
    assert.doesNotMatch(block, /Parameter `icc`: 0\.2 /);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a changed call shows its new value and review note', () => {
  const { assumptions, dir } = loadCopy((d) => {
    const e = entryOf(d, 'J03');
    e.value.fracUninformed = 0.2;
    Object.assign(e.review, { state: 'changed', by: 'ACAPS programme', date: '2026-11-04', note: 'Recruited by theme, so some experts are unfamiliar.' });
  });
  try {
    const text = renderRegister(assumptions);
    const block = text.split(/^## J03$/m)[1].split(/^## J04$/m)[0];
    assert.match(block, /Parameter `fracUninformed`: 0\.2/);
    assert.match(block, /Changed by ACAPS programme on 2026-11-04\. The value above is the changed value\. Note: Recruited by theme, so some experts are unfamiliar\./);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the SYNTHETIC banner is at the top and at the foot of the register', () => {
  const text = renderRegister(loadAssumptions());
  const lines = text.split('\n');
  assert.ok(lines[0].includes(BANNER), 'first line lacks the banner');
  assert.ok(text.trimEnd().endsWith(`> **${BANNER}**`), 'last line lacks the banner');
  assert.equal(text.split(BANNER).length - 1, 2);
});

test('the two open source conflicts are shown as open for the owner to choose, and no other call is', () => {
  const text = renderRegister(loadAssumptions());
  const blockOf = (id) => text.split(new RegExp(`^## ${id}$`, 'm'))[1].split(/^## J\d{2}$|^## What this/m)[0];
  assert.match(blockOf('J13'), /\*\*Open: owner to choose\.\*\*/);
  assert.match(blockOf('J04'), /\*\*Open: owner to choose\.\*\*/);
  const open = [...text.matchAll(/^## (J\d{2})$/gm)].map((m) => m[1]).filter((id) => blockOf(id).includes('Open: owner to choose'));
  assert.deepEqual(open, ['J04', 'J13']);
});

test('the header text from §R appears verbatim', () => {
  assert.ok(renderRegister(loadAssumptions()).includes(HEADER_TEXT));
  assert.match(HEADER_TEXT, /It does not show that the panel is accurate\.$/);
});

test('the "what this register is not" paragraph is present', () => {
  assert.match(renderRegister(loadAssumptions()), /^## What this register is not$/m);
});

test('the output has no statistical jargon (plain-language lint)', () => {
  const text = renderRegister(loadAssumptions());
  for (const pattern of PLAIN_BANNED) {
    assert.doesNotMatch(text, pattern, `banned term ${pattern} appears in the register`);
  }
});

test('the output makes none of the banned claims in §E', () => {
  const text = renderRegister(loadAssumptions());
  for (const pattern of PHRASE_BANNED) {
    assert.doesNotMatch(text, pattern, `banned phrase ${pattern} appears in the register`);
  }
});

test('the jargon lint catches the terms it is meant to catch, and allows "Brier points"', () => {
  for (const bad of ['a logit model', 'the ICC is 0.2', 'by bootstrap', 'a quantile', 'Wilson interval', 'the posterior', 'heteroscedastic noise', 'σ', 'β', 'a Brier of 0.2']) {
    assert.ok(PLAIN_BANNED.some((p) => p.test(bad)), `lint misses "${bad}"`);
  }
  for (const good of ['0.03 Brier points', 'a Brier score of 0.2', 'the ratings']) {
    assert.ok(!PLAIN_BANNED.some((p) => p.test(good)), `lint wrongly flags "${good}"`);
  }
});

test('the plain-language fields in assumptions.json pass the same lint', () => {
  for (const entry of REAL.entries) {
    const texts = [entry.plain, entry.why, ...entry.ifWrong.map((i) => i.result)];
    for (const text of texts) {
      for (const pattern of PLAIN_BANNED) {
        assert.doesNotMatch(text, pattern, `${entry.id} uses banned term ${pattern}`);
      }
    }
  }
});

test('docs/15-judgement-calls.md matches a fresh render of assumptions.json byte for byte', () => {
  assert.equal(readFileSync(DOC_PATH, 'utf8'), renderRegister(loadAssumptions()));
});

test('drift check passes when the doc equals the render and fails when it differs (temp dir)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'register-doc-'));
  try {
    const assumptions = loadAssumptions();
    const doc = join(dir, '15-judgement-calls.md');
    writeFileSync(doc, renderRegister(assumptions));
    assert.deepEqual(checkRegister({ assumptions, docPath: doc }), []);

    writeFileSync(doc, renderRegister(assumptions).replace('1.25', '1.5'));
    const problems = checkRegister({ assumptions, docPath: doc });
    assert.ok(problems.some((p) => /differs from a fresh render/.test(p)), problems.join('\n'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('drift check reports a missing doc in plain words', () => {
  const dir = mkdtempSync(join(tmpdir(), 'register-doc-'));
  try {
    const problems = checkRegister({ assumptions: loadAssumptions(), docPath: join(dir, 'absent.md') });
    assert.equal(problems.length, 1);
    assert.match(problems[0], /is missing/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('changing a default without regenerating the doc is caught by the drift check', () => {
  const { assumptions, dir } = loadCopy((d) => {
    entryOf(d, 'J05').value.icc = 0.4;
  });
  try {
    const doc = join(dir, 'committed.md');
    writeFileSync(doc, renderRegister(loadAssumptions()));
    const problems = checkRegister({ assumptions, docPath: doc });
    assert.ok(problems.some((p) => /differs from a fresh render/.test(p)));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
