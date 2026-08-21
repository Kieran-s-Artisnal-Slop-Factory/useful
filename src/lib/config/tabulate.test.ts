import { describe, expect, it } from 'vitest';
import { MAX_ROWS, tabulateDocument } from './tabulate';

function ok(value: unknown) {
  const result = tabulateDocument(value);
  if ('error' in result) throw new Error(result.error);
  return result;
}

describe('tabulateDocument — arrays are records', () => {
  it('flattens nested objects into dotted columns and keeps arrays as JSON text', () => {
    const t = ok([
      { name: 'Ada', address: { city: 'Toronto', geo: { lat: 1, lng: 2 } }, tags: ['a', 'b'] },
      { name: 'Grace', address: { city: 'NYC' }, extra: null },
    ]);
    expect(t.kind).toBe('records');
    expect(t.rows).toEqual([
      { name: 'Ada', 'address.city': 'Toronto', 'address.geo.lat': 1, 'address.geo.lng': 2, tags: '["a","b"]' },
      { name: 'Grace', 'address.city': 'NYC', extra: null },
    ]);
    // The union of keys, in first-seen order — not row 0's keys.
    expect(t.columns).toEqual(['name', 'address.city', 'address.geo.lat', 'address.geo.lng', 'tags', 'extra']);
    expect(t.total).toBe(2);
    expect(t.truncated).toBe(false);
  });

  it('a list of scalars (or a mixed list) is one value column', () => {
    expect(ok([1, 'two', null]).rows).toEqual([{ value: 1 }, { value: 'two' }, { value: null }]);
    // One object in a scalar list does not turn the list into records.
    const mixed = ok([1, { a: 1 }]);
    expect(mixed.columns).toEqual(['value']);
    expect(mixed.rows[1]).toEqual({ value: '{"a":1}' });
  });

  it('an empty object inside a record is a cell, not a missing column', () => {
    expect(ok([{ meta: {} }]).rows).toEqual([{ meta: '{}' }]);
  });

  it('stops flattening at the depth cap and keeps the rest as JSON', () => {
    let deep: Record<string, unknown> = { leaf: 1 };
    for (let i = 0; i < 12; i++) deep = { [`l${i}`]: deep };
    const t = ok([deep]);
    expect(t.columns).toHaveLength(1);
    expect(String(t.rows[0]![t.columns[0]!])).toContain('"leaf":1');
  });

  it('caps the rows and says so', () => {
    const many = Array.from({ length: MAX_ROWS + 5 }, (_, i) => ({ i }));
    const t = ok(many);
    expect(t.rows).toHaveLength(MAX_ROWS);
    expect(t.total).toBe(MAX_ROWS + 5);
    expect(t.truncated).toBe(true);
  });

  it('refuses an empty array with a sentence', () => {
    expect(tabulateDocument([])).toEqual({ error: expect.stringContaining('empty array') });
  });
});

describe('tabulateDocument — objects are entries', () => {
  it('lists every leaf with its path, type and value', () => {
    const t = ok({
      name: 'api',
      replicas: 3,
      ratio: 0.5,
      on: true,
      nothing: null,
      tags: ['a'],
      empty: {},
      address: { city: 'Toronto' },
    });
    expect(t.kind).toBe('entries');
    expect(t.columns).toEqual(['path', 'type', 'value']);
    expect(t.rows).toEqual([
      { path: 'name', type: 'string', value: 'api' },
      { path: 'replicas', type: 'integer', value: 3 },
      { path: 'ratio', type: 'number', value: 0.5 },
      { path: 'on', type: 'boolean', value: true },
      { path: 'nothing', type: 'null', value: null },
      { path: 'tags', type: 'array', value: '["a"]' },
      { path: 'empty', type: 'object', value: '{}' },
      { path: 'address.city', type: 'string', value: 'Toronto' },
    ]);
  });

  it('refuses a scalar root', () => {
    for (const value of [1, 'x', true, null]) {
      expect(tabulateDocument(value)).toEqual({ error: expect.stringContaining('object or an array') });
    }
  });
});
