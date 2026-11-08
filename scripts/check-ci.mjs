#!/usr/bin/env node
/**
 * The CI file must run what the repo claims it runs.
 *
 * G5: `.github/workflows/ci.yml` enumerated gates by hand while package.json
 * gained new ones, so the two diverged silently. This gate makes the divergence
 * loud: CI must call `npm run verify`, and it must not re-list gates that
 * `verify` already covers (a second list is a second thing to forget).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const ci = fs.readFileSync(path.join(ROOT, '.github/workflows/ci.yml'), 'utf8');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

const problems = [];
if (!/run:\s*npm run verify/.test(ci)) {
  problems.push('ci.yml does not run `npm run verify` — it re-lists gates and will drift again');
}

// Every gate in verify must be individually runnable, and every script file a
// gate names must exist.
const verify = pkg.scripts.verify || '';
const named = [...verify.matchAll(/(?:node\s+)?(scripts\/[\w.-]+\.mjs)/g)].map((m) => m[1]);
for (const f of new Set(named)) {
  if (!fs.existsSync(path.join(ROOT, f))) problems.push(`verify names ${f}, which does not exist`);
}
if (!/npm run test|node --test/.test(verify)) {
  problems.push('verify does not run the unit tests');
}

// G6: `node --test packages/*/test/*.test.js` relies on the *shell* expanding
// the glob. cmd.exe does not, so on Windows the documented command tests
// nothing and exits 0. Node >=20 discovers test files itself.
const testCmd = pkg.scripts.test || '';
if (/[a-z]\/\*/.test(testCmd)) {
  problems.push(`\`npm test\` is \`${testCmd}\` — a shell-expanded glob, which silently matches nothing on Windows; use \`node --test\``);
}
if (!pkg.workspaces) {
  problems.push('package.json declares no workspaces, but packages/* are separate packages');
}

// The list in the CI file must not contradict verify by naming a gate that is
// absent from package.json.
for (const m of ci.matchAll(/run:\s*npm (?:run )?([\w:-]+)/g)) {
  const [, name] = m;
  if (name === 'verify') continue;
  if (!(name in pkg.scripts)) problems.push(`ci.yml runs \`npm run ${name}\`, which package.json does not define`);
}

if (problems.length) {
  console.error('✗ CI CONFIG DRIFTED\n');
  for (const p of problems) console.error('  ' + p);
  process.exit(1);
}
console.log(`✓ CI runs \`npm run verify\` (${new Set(named).size} scripts, ${Object.keys(pkg.scripts).length} package scripts)`);
