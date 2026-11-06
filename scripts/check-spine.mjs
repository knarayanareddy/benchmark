#!/usr/bin/env node
/**
 * Verify the shared spine has not been edited in place.
 *
 * `packages/shared/` is distributed by copying, not by a package registry —
 * which is what lets each repo stand alone. The cost of that choice is drift:
 * someone fixes a bug in one copy and forgets the other, and the claim that
 * both products run on one spine silently stops being true.
 *
 * A git hook cannot see across repositories. So the integrity check is local and
 * the cross-repo check is a committed hash. This script does the local half:
 * every file must match .fingerprint.json. Run the cross-repo half by comparing
 * the two .fingerprint.json files — REPOS.md has the one-liner.
 *
 * If you edited a shared file on purpose: run this script with --write, then
 * copy the whole directory to the other repo, then commit both.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const dir = new URL('../packages/shared/', import.meta.url);
const manifest = path.join(dir.pathname, '.fingerprint.json');
const doc = JSON.parse(fs.readFileSync(manifest, 'utf8'));
const write = process.argv.includes('--write');

const hash = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const files = fs.readdirSync(dir.pathname).filter((f) => f.endsWith('.js') || f === 'README.md');

let bad = 0;
const next = {};
for (const f of files.sort()) {
  const h = hash(path.join(dir.pathname, f));
  next[f] = h;
  const want = doc.files[f];
  if (!want) console.log(`  + ${f}  (new, not in fingerprint)`);
  else if (want !== h) { console.log(`  ✗ ${f}  drifted`); bad++; }
}
for (const f of Object.keys(doc.files)) {
  if (!files.includes(f)) { console.log(`  - ${f}  listed but missing`); bad++; }
}

if (write) {
  doc.files = next;
  fs.writeFileSync(manifest, JSON.stringify(doc, null, 2) + '\n');
  console.log(`✓ fingerprint rewritten — now copy packages/shared/ to the other repo`);
  process.exit(0);
}
if (bad) {
  console.error(`\n${bad} shared file(s) changed. That is fine if it was deliberate —`);
  console.error('but the copy in the other repo is now stale, and both blueprints');
  console.error('claim one spine. Run: node scripts/check-spine.mjs --write');
  console.error('then:  cp -r packages/shared/. ../<other-repo>/packages/shared/');
  process.exit(1);
}
console.log(`✓ shared spine intact — ${files.length} files match the fingerprint`);
