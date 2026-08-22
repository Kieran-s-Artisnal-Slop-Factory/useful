import { describe, expect, it } from 'vitest';
import {
  conversionWarnings,
  convertDocument,
  csvCellValue,
  csvEscape,
  parseAs,
  parseCsv,
  parseCsvRows,
  serializeAs,
  toCsv,
} from './convert';

describe('parseCsvRows', () => {
  it('reads plain rows', () => {
    expect(parseCsvRows('a,b\n1,2\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('keeps commas, newlines and doubled quotes inside a quoted cell', () => {
    expect(parseCsvRows('a,b\n"x,y","line1\nline2"\n')).toEqual([
      ['a', 'b'],
      ['x,y', 'line1\nline2'],
    ]);
    expect(parseCsvRows('q\n"he said ""hi"""\n')).toEqual([['q'], ['he said "hi"']]);
  });

  it('normalises CRLF and CR, and does not invent a trailing row', () => {
    expect(parseCsvRows('a,b\r\n1,2\r\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
    expect(parseCsvRows('a\r1\r')).toEqual([['a'], ['1']]);
    expect(parseCsvRows('a,b\n1,2')).toHaveLength(2);
  });

  it('keeps empty cells, including a trailing one', () => {
    expect(parseCsvRows('a,b,c\n1,,3\n')).toEqual([
      ['a', 'b', 'c'],
      ['1', '', '3'],
    ]);
    expect(parseCsvRows('a,b\n1,\n')).toEqual([
      ['a', 'b'],
      ['1', ''],
    ]);
  });

  it('is empty for empty text', () => {
    expect(parseCsvRows('')).toEqual([]);
  });
});

describe('csvCellValue', () => {
  it('converts only what round-trips exactly', () => {
    expect(csvCellValue('42')).toBe(42);
    expect(csvCellValue('-1.5')).toBe(-1.5);
    expect(csvCellValue('true')).toBe(true);
    expect(csvCellValue('false')).toBe(false);
    // A zip code, a version, a padded number and a plus sign all keep their
    // spelling — converting them would be lossy, not helpful.
    expect(csvCellValue('007')).toBe('007');
    expect(csvCellValue('1.0')).toBe('1.0');
    expect(csvCellValue('+1')).toBe('+1');
    expect(csvCellValue('')).toBe('');
    expect(csvCellValue('hello')).toBe('hello');
    // Not a number, however much it looks like one.
    expect(csvCellValue('Infinity')).toBe('Infinity');
    expect(csvCellValue('NaN')).toBe('NaN');
  });
});

describe('parseCsv', () => {
  it('keys records by the header row', () => {
    expect(parseCsv('name,port\napi,8080\nweb,443\n')).toEqual([
      { name: 'api', port: 8080 },
      { name: 'web', port: 443 },
    ]);
  });

  it('names an unnamed column after its position, and pads short rows', () => {
    expect(parseCsv('a,,c\n1,2\n')).toEqual([{ a: 1, column2: 2, c: '' }]);
  });
});

describe('csvEscape / toCsv', () => {
  it('quotes only what needs it', () => {
    expect(csvEscape('plain')).toBe('plain');
    expect(csvEscape('a,b')).toBe('"a,b"');
    expect(csvEscape('say "hi"')).toBe('"say ""hi"""');
    expect(csvEscape('two\nlines')).toBe('"two\nlines"');
  });

  it('writes the header first and one line per row', () => {
    const csv = toCsv(['a', 'b'], [{ a: 1, b: 'x,y' }, { a: null, b: undefined }]);
    expect(csv).toBe('a,b\n1,"x,y"\n,\n');
  });

  it('round-trips through parseCsv', () => {
    const rows = [{ name: 'a "quoted" one', note: 'has, comma\nand newline' }];
    expect(parseCsv(toCsv(['name', 'note'], rows))).toEqual(rows);
  });
});

describe('parseAs / serializeAs', () => {
  it('refuses empty text rather than returning nothing', async () => {
    expect(await parseAs('   ', 'json')).toEqual({ ok: false, message: 'There is nothing to convert.' });
  });

  it('reports a parse error as a sentence', async () => {
    const out = await parseAs('{oops', 'json');
    expect(out.ok).toBe(false);
  });

  it('reads and writes every format', async () => {
    const value = { name: 'api', port: 8080, debug: false };
    for (const format of ['json', 'yaml', 'toml'] as const) {
      const written = await serializeAs(value, format);
      expect(written.ok, format).toBe(true);
      const read = await parseAs((written as { text: string }).text, format);
      expect(read, format).toEqual({ ok: true, value });
    }
  });

  it('refuses TOML for a root that is not a table, and says which', async () => {
    const out = await serializeAs([1, 2], 'toml');
    expect(out.ok).toBe(false);
    expect((out as { message: string }).message).toContain('an array');
  });

  it('refuses CSV for a document with no rows to make', async () => {
    const out = await serializeAs([], 'csv');
    expect(out.ok).toBe(false);
    expect((out as { message: string }).message).toContain('empty array');
  });
});

describe('convertDocument', () => {
  it('JSON to YAML to TOML keeps the values', async () => {
    const json = '{"server":{"host":"localhost","port":8080},"debug":true}';
    const yaml = await convertDocument(json, 'json', 'yaml');
    expect(yaml.ok).toBe(true);
    const toml = await convertDocument((yaml as { text: string }).text, 'yaml', 'toml');
    expect(toml.ok).toBe(true);
    const back = await convertDocument((toml as { text: string }).text, 'toml', 'json');
    expect(JSON.parse((back as { text: string }).text)).toEqual(JSON.parse(json));
  });

  it('a list of records becomes a CSV table and comes back', async () => {
    const json = '[{"name":"api","port":8080},{"name":"web","port":443}]';
    const csv = await convertDocument(json, 'json', 'csv');
    expect((csv as { text: string }).text).toBe('name,port\napi,8080\nweb,443\n');
    const back = await convertDocument((csv as { text: string }).text, 'csv', 'json');
    expect(JSON.parse((back as { text: string }).text)).toEqual(JSON.parse(json));
  });

  it('an object becomes the path/type/value view, as the Data card draws it', async () => {
    const csv = await convertDocument('{"a":{"b":1}}', 'json', 'csv');
    expect((csv as { text: string }).text).toBe('path,type,value\na.b,integer,1\n');
  });

  it('names the format that could not be read', async () => {
    const out = await convertDocument('nope: [', 'yaml', 'json');
    expect(out.ok).toBe(false);
    expect((out as { message: string }).message).toContain('as YAML');
  });

  it('a TOML date leaves as an ISO string, and says so', async () => {
    const out = await convertDocument('when = 1979-05-27T07:32:00Z', 'toml', 'json');
    expect(JSON.parse((out as { text: string }).text)).toEqual({ when: '1979-05-27T07:32:00.000Z' });
    expect((out as { warnings: string[] }).warnings.join(' ')).toContain('ISO-8601');
  });
});

describe('conversionWarnings', () => {
  it('warns about comments leaving a commented format, and not otherwise', () => {
    expect(conversionWarnings('yaml', 'json').join(' ')).toContain('Comments');
    expect(conversionWarnings('json', 'yaml').join(' ')).not.toContain('Comments');
  });

  it('warns about flattening into CSV and about CSV having no types', () => {
    expect(conversionWarnings('json', 'csv').join(' ')).toContain('dotted columns');
    expect(conversionWarnings('csv', 'json').join(' ')).toContain('no types');
  });
});
