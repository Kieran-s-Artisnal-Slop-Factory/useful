import { describe, expect, it } from 'vitest';
import { columnTypeFor, tableSchemaFrom } from './table-schema';
import { normalizeSchema } from '../table/types';

describe('columnTypeFor', () => {
  it('maps the Postgres types the engine reports', () => {
    expect(columnTypeFor('integer')).toBe('int');
    expect(columnTypeFor('bigint')).toBe('int');
    expect(columnTypeFor('numeric(4,2)')).toBe('float');
    expect(columnTypeFor('double precision')).toBe('float');
    expect(columnTypeFor('boolean')).toBe('bool');
    expect(columnTypeFor('text')).toBe('text');
    expect(columnTypeFor('character varying(255)')).toBe('text');
    expect(columnTypeFor('timestamp with time zone')).toBe('datetime');
    expect(columnTypeFor('date')).toBe('date');
    expect(columnTypeFor('time without time zone')).toBe('time');
    expect(columnTypeFor('jsonb')).toBe('json');
    expect(columnTypeFor('uuid')).toBe('uuid');
    expect(columnTypeFor('money')).toBe('currency');
  });

  it('maps the loose types SQLite declares', () => {
    expect(columnTypeFor('INTEGER')).toBe('int');
    expect(columnTypeFor('VARYING CHARACTER(255)')).toBe('text');
    expect(columnTypeFor('REAL')).toBe('float');
    expect(columnTypeFor('BOOLEAN')).toBe('bool');
    expect(columnTypeFor('DATETIME')).toBe('datetime');
    expect(columnTypeFor('CLOB')).toBe('text');
  });

  it('prefers the more specific name where two overlap', () => {
    // "timestamp" contains no "int", but "point" and "int" style overlaps
    // are what the ordering guards against.
    expect(columnTypeFor('timestamptz')).toBe('datetime');
    expect(columnTypeFor('serial')).toBe('int');
    expect(columnTypeFor('smallint')).toBe('int');
  });

  it('falls back to text for anything unrecognised or absent', () => {
    // A SQLite column can be declared with no type at all.
    expect(columnTypeFor('')).toBe('text');
    expect(columnTypeFor('BLOB')).toBe('text');
    expect(columnTypeFor('geography(Point)')).toBe('text');
  });
});

describe('tableSchemaFrom', () => {
  const columns = [
    { name: 'id', type: 'integer' },
    { name: 'created_at', type: 'timestamptz' },
    { name: 'is_active', type: 'boolean' },
  ];

  it('builds a schema DataTable can normalize', () => {
    const normalized = normalizeSchema(tableSchemaFrom(columns));
    expect(normalized.map((c) => [c.key, c.type])).toEqual([
      ['id', 'int'],
      ['created_at', 'datetime'],
      ['is_active', 'bool'],
    ]);
  });

  it('keeps the real column name as the heading', () => {
    // A database viewer should say `created_at`, not "Created at".
    expect(normalizeSchema(tableSchemaFrom(columns)).map((c) => c.label)).toEqual([
      'id',
      'created_at',
      'is_active',
    ]);
  });

  it('keeps the column order', () => {
    expect(Object.keys(tableSchemaFrom(columns))).toEqual(['id', 'created_at', 'is_active']);
  });

  it('handles a table with no columns', () => {
    expect(tableSchemaFrom([])).toEqual({});
  });
});
