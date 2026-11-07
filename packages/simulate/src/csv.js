/**
 * CSV writer for synthetic and real outputs (power-spec §D). Line 1 is the banner from label.js; the header row comes
 * next. Synthetic files carry a first data column `synthetic` (TRUE); REAL-* files carry FALSE and the real-data banner.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, basename } from 'node:path';
import { csvHeaderLines } from './label.js';

/** @param {unknown} v @returns {string} */
function cell(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : '';
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * The CSV text. Rows are objects; the column set is the keys of the first row (or of `columns` when given). The
 * `synthetic` column is added first and is TRUE unless the file is REAL-*.
 * @param {Array<Record<string, unknown>>} rows
 * @param {{ seed: number|string, runId: string, real?: boolean, columns?: string[] }} meta
 * @returns {string}
 */
export function csvText(rows, meta) {
  const lines = csvHeaderLines(meta);
  const keys = meta.columns ?? (rows.length ? Object.keys(rows[0]) : []);
  if (keys.includes('synthetic')) throw new RangeError('a row may not set its own synthetic column');
  const flag = meta.real ? 'FALSE' : 'TRUE';
  lines.push(['synthetic', ...keys].join(','));
  for (const row of rows) lines.push([flag, ...keys.map((k) => cell(row[k]))].join(','));
  return `${lines.join('\n')}\n`;
}

/**
 * Writes a CSV file. A file whose name starts REAL- must be written with meta.real = true, and a synthetic file with
 * a REAL- meta flag is refused (a real file cannot carry simulated rows).
 * @param {string} path
 * @param {Array<Record<string, unknown>>} rows
 * @param {{ seed: number|string, runId: string, real?: boolean, columns?: string[] }} meta
 * @returns {void}
 */
export function writeCsv(path, rows, meta) {
  const isRealName = basename(path).startsWith('REAL-');
  if (isRealName !== Boolean(meta.real)) {
    throw new RangeError(`${basename(path)}: REAL- files must be written with real=true and only real files may be`);
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, csvText(rows, meta));
}
