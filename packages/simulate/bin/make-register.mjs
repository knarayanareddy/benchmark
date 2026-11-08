#!/usr/bin/env node
// Writes the judgement-call register. By default: out/register/SYNTHETIC-register.md (inside packages/simulate).
// With --write-docs: also writes docs/15-judgement-calls.md at the repo root (the committed copy ACAPS reads).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { loadAssumptions } from '../src/assumptions.js';
import { renderRegister, DOC_DISPLAY, DOC_PATH, OUT_DIR, REGISTER_RUN_ID } from '../src/register.js';

const SIM_ROOT = new URL('..', import.meta.url);
const OUT_IGNORE = 'out/';

/** Makes sure packages/simulate/out/ is git-ignored, adding packages/simulate/.gitignore only if nothing already covers it. */
function ensureOutIgnored() {
  const local = new URL('.gitignore', SIM_ROOT);
  const root = new URL('../../.gitignore', SIM_ROOT);
  const covers = (file) => existsSync(file) && readFileSync(file, 'utf8').split('\n').some((line) => /^\/?(packages\/simulate\/)?out\/?$/.test(line.trim()));
  if (covers(root) || covers(local)) return;
  writeFileSync(local, `${OUT_IGNORE}\n`);
}

const writeDocs = process.argv.includes('--write-docs');
const unknown = process.argv.slice(2).filter((arg) => arg !== '--write-docs');
if (unknown.length > 0) {
  console.error(`Unknown option(s): ${unknown.join(' ')}. The only option is --write-docs.`);
  process.exit(2);
}

const text = renderRegister(loadAssumptions());

const runDir = join(OUT_DIR, REGISTER_RUN_ID);
mkdirSync(runDir, { recursive: true });
ensureOutIgnored();
const outFile = join(runDir, 'SYNTHETIC-register.md');
writeFileSync(outFile, text);
console.log(`Wrote ${outFile}`);

if (writeDocs) {
  mkdirSync(dirname(DOC_PATH), { recursive: true });
  writeFileSync(DOC_PATH, text);
  console.log(`Wrote ${DOC_DISPLAY}`);
}
