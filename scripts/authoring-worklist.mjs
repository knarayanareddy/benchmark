#!/usr/bin/env node
/**
 * Build the authoring worklist: every ACAPS risk headline and trigger, triaged for
 * a human author. This does NOT write objectives. It says, per item, what is
 * missing and why, suggests a source and a split where the text allows, and
 * leaves the author's columns empty.
 *
 *   node scripts/authoring-worklist.mjs            writes data/authoring-worklist.csv and data/authoring-summary.json
 *   node scripts/authoring-worklist.mjs --import data/authoring-worklist.csv [--out data/authored-cards.json]
 *       validates the rows an author filled in with the same rule the service uses
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildWorklist, summariseWorklist, importAuthored, WORKLIST_HEADER } from '@benchmark/core/authoring';
import { toCsv, parseCsvObjects } from '@benchmark/core/csv';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const args = process.argv.slice(2);
const flag = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);

if (args.includes('--import')) {
  const file = flag('--import');
  const rows = parseCsvObjects(fs.readFileSync(path.resolve(file), 'utf8'));
  const { accepted, rejected, untouched } = importAuthored(rows);
  console.log(`${rows.length} rows: ${accepted.length} accepted, ${rejected.length} rejected, ${untouched} untouched`);
  for (const r of rejected) console.log(`  ✗ ${r.id}\n      ${r.problems.join('\n      ')}`);
  const out = flag('--out');
  if (out && accepted.length) {
    fs.writeFileSync(path.resolve(out), `${JSON.stringify(accepted, null, 2)}\n`);
    console.log(`wrote ${accepted.length} cards to ${out}`);
  }
  process.exit(rejected.length ? 1 : 0);
}

const blocks = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/risk-radar.json'), 'utf8'));
const rows = buildWorklist(blocks);
const summary = summariseWorklist(rows);
fs.writeFileSync(path.join(ROOT, 'data/authoring-worklist.csv'), toCsv([...WORKLIST_HEADER], rows));
fs.writeFileSync(path.join(ROOT, 'data/authoring-summary.json'), `${JSON.stringify(summary, null, 2)}\n`);

const line = (label, t) => `${label.padEnd(26)} ${String(t.total).padStart(4)}   rewrite ${String(t.needs_rewrite).padStart(3)}   threshold ${String(t.needs_threshold).padStart(3)}   objective ${String(t.needs_objective).padStart(3)}   source suggested ${String(t.with_source_suggestion).padStart(3)}`;
console.log(line('risk headlines', summary.risks));
console.log(line('  of which Active', summary.prospectiveRisks));
console.log(line('triggers', summary.triggers));
console.log(line('  of which Active', summary.prospectiveTriggers));
console.log('ACAPS-written trigger objectives by kind:', JSON.stringify(summary.triggerObjectiveKinds));
console.log('openable cards: 0 (a human writes the objective, window, source and resolver)');
