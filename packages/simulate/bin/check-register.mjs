#!/usr/bin/env node
// Drift and coverage check for docs/15-judgement-calls.md. Exits 1 with plain messages if the committed register
// is missing, differs from a fresh render of assumptions.json, or does not cover every key.
import { loadAssumptions } from '../src/assumptions.js';
import { checkRegister, DOC_DISPLAY } from '../src/register.js';

const problems = checkRegister({ assumptions: loadAssumptions() });
if (problems.length > 0) {
  console.error(`${DOC_DISPLAY} check failed:`);
  for (const problem of problems) console.error(`- ${problem}`);
  process.exit(1);
}
console.log(`${DOC_DISPLAY} matches assumptions.json, and every key is covered.`);
