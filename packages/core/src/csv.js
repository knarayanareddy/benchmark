/**
 * RFC 4180 CSV, done properly: quoted fields may hold commas, doubled quotes and
 * newlines. (The ACAPS export has embedded newlines; a line-splitter turned 139
 * rows into 5,970 and misaligned every column, so this is a state machine and
 * is tested against exactly that.)
 */

/**
 * @param {string} text
 * @returns {string[][]}
 */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  let i = 0;
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  while (i < src.length) {
    const c = src[i];
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') { field += '"'; i += 2; continue; }
        quoted = false; i++; continue;
      }
      field += c; i++; continue;
    }
    if (c === '"' && field === '') { quoted = true; i++; continue; }
    if (c === ',') { row.push(field); field = ''; i++; continue; }
    if (c === '\r' || c === '\n') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = []; i++; continue;
    }
    field += c; i++;
  }
  if (quoted) throw new Error('csv: unterminated quoted field');
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

/**
 * Parse with a header row into objects.
 * @param {string} text
 * @returns {Record<string, string>[]}
 */
export function parseCsvObjects(text) {
  const [header, ...rest] = parseCsv(text);
  if (!header) return [];
  return rest.map((r, n) => {
    if (r.length > header.length) throw new Error(`csv: row ${n + 2} has ${r.length} fields, header has ${header.length}`);
    return Object.fromEntries(header.map((h, i) => [h, r[i] ?? '']));
  });
}

const needsQuote = /[",\r\n]|^\s|\s$/;
/** @param {unknown} v */
const cell = (v) => {
  const s = v == null ? '' : String(v);
  return needsQuote.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/**
 * @param {string[]} header
 * @param {Array<Record<string, unknown>>} rows
 */
export function toCsv(header, rows) {
  return `${[header.map(cell).join(','), ...rows.map((r) => header.map((h) => cell(r[h])).join(','))].join('\n')}\n`;
}
