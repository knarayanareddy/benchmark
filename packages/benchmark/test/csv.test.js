import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCsv, parseCsvObjects, toCsv } from '@benchmark/core/csv';

test('quoted fields keep commas, doubled quotes and embedded newlines', () => {
  const text = 'id,title,note\nR1,"Clashes, attacks","He said ""no""\nand left"\nR2,plain,\n';
  const rows = parseCsv(text);
  assert.equal(rows.length, 3, 'a line splitter would have made 4 rows from this');
  assert.deepEqual(rows[1], ['R1', 'Clashes, attacks', 'He said "no"\nand left']);
  assert.deepEqual(rows[2], ['R2', 'plain', '']);
});

test('CRLF, a BOM, a missing final newline and blank lines are handled', () => {
  assert.deepEqual(parseCsv('\uFEFFa,b\r\n1,2\r\n\r\n3,4'), [['a', 'b'], ['1', '2'], ['3', '4']]);
  assert.deepEqual(parseCsv(''), []);
});

test('an unterminated quote is an error, not silent truncation', () => {
  assert.throws(() => parseCsv('a,b\n1,"oops\n'), /unterminated/);
});

test('parseCsvObjects maps the header and rejects a row longer than it', () => {
  assert.deepEqual(parseCsvObjects('a,b\n1,2\n3\n'), [{ a: '1', b: '2' }, { a: '3', b: '' }]);
  assert.throws(() => parseCsvObjects('a,b\n1,2,3\n'), /row 2 has 3 fields/);
});

test('round trip: whatever toCsv writes, parseCsv reads back identically', () => {
  const header = ['id', 'text'];
  const rows = [
    { id: 'a', text: 'plain' },
    { id: 'b', text: 'has, comma' },
    { id: 'c', text: 'has "quotes"' },
    { id: 'd', text: 'two\nlines' },
    { id: 'e', text: ' leading space' },
    { id: 'f', text: '' },
  ];
  assert.deepEqual(parseCsvObjects(toCsv(header, rows)), rows);
});

test('the committed worklist survives a round trip with the real export text in it', async () => {
  const fs = await import('node:fs');
  const text = fs.readFileSync(new URL('../../../data/authoring-worklist.csv', import.meta.url), 'utf8');
  const objs = parseCsvObjects(text);
  assert.equal(objs.length, 139 + 266);
  assert.equal(toCsv(Object.keys(objs[0]), objs), text);
});
