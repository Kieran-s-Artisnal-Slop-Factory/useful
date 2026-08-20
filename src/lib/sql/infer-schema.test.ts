import { describe, expect, it } from 'vitest';
import { inferSchema } from './infer-schema';
import type { ColumnSpec } from '../table/types';

const typeOf = (schema: ReturnType<typeof inferSchema>, key: string) =>
  (schema[key] as ColumnSpec).type;

describe('inferSchema', () => {
  it('takes the engine at its word when it declares a type', () => {
    // Every value is a whole number, but `numeric` is a float column — the
    // catalogue knows things the sample cannot show.
    const schema = inferSchema([{ n: 1 }, { n: 2 }], [{ name: 'n', type: 'numeric' }]);
    expect(typeOf(schema, 'n')).toBe('float');
  });

  it('sniffs when the engine declares nothing', () => {
    // SQLite never types an expression column, so it sends ''.
    const schema = inferSchema([{ n: 1 }, { n: 2 }], [{ name: 'n', type: '' }]);
    expect(typeOf(schema, 'n')).toBe('int');
  });

  it('gives an empty result set its headers from the description', () => {
    // This is the whole reason `execDescribed` exists: `where false` returns
    // no rows, and a grid with no headers looks like a broken query.
    const schema = inferSchema([], [
      { name: 'id', type: 'integer' },
      { name: 'name', type: 'text' },
    ]);
    expect(Object.keys(schema)).toEqual(['id', 'name']);
    expect(typeOf(schema, 'id')).toBe('int');
  });

  it('tells integers from floats', () => {
    expect(typeOf(inferSchema([{ n: 1 }, { n: 2 }]), 'n')).toBe('int');
    expect(typeOf(inferSchema([{ n: 1 }, { n: 2.5 }]), 'n')).toBe('float');
  });

  it('recognises booleans, dates, datetimes, uuids and json', () => {
    expect(typeOf(inferSchema([{ v: true }, { v: false }]), 'v')).toBe('bool');
    expect(typeOf(inferSchema([{ v: '2024-01-31' }]), 'v')).toBe('date');
    expect(typeOf(inferSchema([{ v: '2024-01-31T09:00:00Z' }]), 'v')).toBe('datetime');
    expect(typeOf(inferSchema([{ v: new Date() }]), 'v')).toBe('datetime');
    expect(typeOf(inferSchema([{ v: '3f2504e0-4f89-11d3-9a0c-0305e82c3301' }]), 'v')).toBe('uuid');
    expect(typeOf(inferSchema([{ v: { a: 1 } }]), 'v')).toBe('json');
    expect(typeOf(inferSchema([{ v: [1, 2] }, { v: [3] }]), 'v')).toBe('json');
  });

  it('falls back to text for a mixed column', () => {
    expect(typeOf(inferSchema([{ v: 1 }, { v: 'two' }]), 'v')).toBe('text');
    expect(typeOf(inferSchema([{ v: '2024-01-31' }, { v: 'soon' }]), 'v')).toBe('text');
  });

  it('calls an all-blank column text rather than guessing', () => {
    expect(typeOf(inferSchema([{ v: null }, { v: null }, { v: '' }]), 'v')).toBe('text');
  });

  it('ignores blanks when sniffing the rest', () => {
    expect(typeOf(inferSchema([{ v: null }, { v: 3 }, { v: 4 }]), 'v')).toBe('int');
  });

  it('unions the keys instead of trusting the first row', () => {
    // A sparse first row must not cost the result set a column.
    const schema = inferSchema([{ a: 1 }, { a: 2, b: 'x' }]);
    expect(Object.keys(schema)).toEqual(['a', 'b']);
  });

  it('returns nothing for nothing', () => {
    expect(inferSchema([])).toEqual({});
  });

  it('labels every column with its raw name', () => {
    // A database viewer shows `created_at`, not "Created at".
    const schema = inferSchema([{ created_at: '2024-01-31' }]);
    expect((schema['created_at'] as ColumnSpec).label).toBe('created_at');
  });

  it('samples the first 200 rows, not all of them', () => {
    // The cap is part of the contract, not an optimisation: a result set can
    // be a hundred thousand rows and the schema is computed on every render.
    const rows = Array.from({ length: 500 }, (_, i) => ({ v: i }));
    rows[400] = { v: 'surprise' as unknown as number };
    expect(typeOf(inferSchema(rows), 'v')).toBe('int');
  });
});
