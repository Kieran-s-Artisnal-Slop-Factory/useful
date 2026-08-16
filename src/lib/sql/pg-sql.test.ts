import { describe, expect, it } from 'vitest';
import { quotePgId, quotePgString, quotePgValue, splitPgStatements } from './pg-sql';

describe('quotePgId', () => {
  it('double-quotes and doubles embedded quotes', () => {
    expect(quotePgId('users')).toBe('"users"');
    expect(quotePgId('my table')).toBe('"my table"');
    expect(quotePgId('we"ird')).toBe('"we""ird"');
  });
});

describe('quotePgString', () => {
  it('single-quotes and doubles embedded quotes', () => {
    expect(quotePgString("O'Brien")).toBe("'O''Brien'");
    expect(quotePgString('')).toBe("''");
  });
});

describe('quotePgValue', () => {
  it('renders NULL for null and undefined', () => {
    expect(quotePgValue(null)).toBe('NULL');
    expect(quotePgValue(undefined)).toBe('NULL');
  });

  it('renders booleans as keywords', () => {
    expect(quotePgValue(true)).toBe('TRUE');
    expect(quotePgValue(false)).toBe('FALSE');
  });

  it('renders finite numbers bare and non-finite ones cast', () => {
    expect(quotePgValue(42)).toBe('42');
    expect(quotePgValue(-1.5)).toBe('-1.5');
    expect(quotePgValue(NaN)).toBe("'NaN'::float8");
    expect(quotePgValue(Infinity)).toBe("'Infinity'::float8");
  });

  it('renders bigints without precision loss', () => {
    expect(quotePgValue(9007199254740993n)).toBe('9007199254740993');
  });

  it('renders numerics (which arrive as strings) as quoted literals', () => {
    expect(quotePgValue('12.34')).toBe("'12.34'");
  });

  it('renders dates as cast ISO timestamps', () => {
    expect(quotePgValue(new Date('2024-01-02T03:04:05.000Z'))).toBe(
      "'2024-01-02T03:04:05.000Z'::timestamptz"
    );
    expect(quotePgValue(new Date('nope'))).toBe('NULL');
  });

  it('renders bytea in hex input format', () => {
    expect(quotePgValue(new Uint8Array([0xde, 0xad, 0xbe, 0xef]))).toBe("'\\xdeadbeef'::bytea");
    expect(quotePgValue(new Uint8Array([0x00, 0x0f]))).toBe("'\\x000f'::bytea");
  });

  it('renders json values as cast jsonb', () => {
    expect(quotePgValue({ a: 1 })).toBe('\'{"a":1}\'::jsonb');
    expect(quotePgValue([1, 'two'])).toBe('\'[1,"two"]\'::jsonb');
  });

  it('escapes quotes inside strings and json', () => {
    expect(quotePgValue("it's")).toBe("'it''s'");
    expect(quotePgValue({ q: "it's" })).toBe('\'{"q":"it\'\'s"}\'::jsonb');
  });
});

describe('splitPgStatements', () => {
  it('splits on top-level semicolons and trims', () => {
    expect(splitPgStatements('SELECT 1; SELECT 2')).toEqual(['SELECT 1', 'SELECT 2']);
  });

  it('drops empty fragments and a trailing separator', () => {
    expect(splitPgStatements('SELECT 1;;  ;\n')).toEqual(['SELECT 1']);
    expect(splitPgStatements('')).toEqual([]);
    expect(splitPgStatements('   \n\t ')).toEqual([]);
  });

  it('ignores semicolons inside string literals', () => {
    expect(splitPgStatements("SELECT ';'; SELECT 2")).toEqual(["SELECT ';'", 'SELECT 2']);
  });

  it('handles doubled quotes inside a string literal', () => {
    expect(splitPgStatements("SELECT 'a'';b'; SELECT 2")).toEqual(["SELECT 'a'';b'", 'SELECT 2']);
  });

  it('ignores semicolons inside quoted identifiers', () => {
    expect(splitPgStatements('SELECT "we;ird"; SELECT 2')).toEqual([
      'SELECT "we;ird"',
      'SELECT 2',
    ]);
  });

  it('ignores semicolons inside dollar-quoted bodies', () => {
    const fn = `CREATE FUNCTION f() RETURNS int AS $$ BEGIN; RETURN 1; END; $$ LANGUAGE plpgsql`;
    expect(splitPgStatements(`${fn}; SELECT 2`)).toEqual([fn, 'SELECT 2']);
  });

  it('handles tagged dollar quotes', () => {
    const fn = `DO $tag$ SELECT ';'; $tag$`;
    expect(splitPgStatements(`${fn}; SELECT 2`)).toEqual([fn, 'SELECT 2']);
  });

  it('does not mistake a positional parameter for a dollar quote', () => {
    expect(splitPgStatements('SELECT $1; SELECT $2')).toEqual(['SELECT $1', 'SELECT $2']);
  });

  it('ignores semicolons in line comments', () => {
    expect(splitPgStatements('SELECT 1 -- ; not a split\n; SELECT 2')).toEqual([
      'SELECT 1 -- ; not a split',
      'SELECT 2',
    ]);
  });

  it('ignores semicolons in block comments, which nest', () => {
    expect(splitPgStatements('SELECT 1 /* ; /* ; */ ; */ ; SELECT 2')).toEqual([
      'SELECT 1 /* ; /* ; */ ; */',
      'SELECT 2',
    ]);
  });

  it('drops fragments that are only comments', () => {
    expect(splitPgStatements('-- just a note\n; SELECT 1')).toEqual(['SELECT 1']);
    expect(splitPgStatements('/* nothing here */')).toEqual([]);
  });

  it('keeps a leading comment attached to its statement', () => {
    expect(splitPgStatements('-- why\nSELECT 1')).toEqual(['-- why\nSELECT 1']);
  });

  it('treats an unterminated dollar quote as one trailing statement', () => {
    expect(splitPgStatements('SELECT 1; $$ unterminated ; body')).toEqual([
      'SELECT 1',
      '$$ unterminated ; body',
    ]);
  });
});
