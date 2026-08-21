import { describe, expect, it } from 'vitest';
import { documentSamples, inferDocument, inferFields, inferType } from './infer';
import { MAX_DEPTH } from './model';
import type { ConfigField } from '../db/types';

describe('documentSamples', () => {
  it('treats a plain object as a single sample', () => {
    const doc = { a: 1 };
    expect(documentSamples(doc)).toEqual({ samples: [doc] });
  });

  it('treats an array of objects as one sample per element', () => {
    const doc = [{ a: 1 }, { b: 2 }];
    expect(documentSamples(doc)).toEqual({ samples: [{ a: 1 }, { b: 2 }] });
  });

  it('rejects an empty array — there is nothing to infer from', () => {
    const result = documentSamples([]);
    expect(result).toHaveProperty('error');
    if ('error' in result) expect(result.error).toMatch(/empty array/);
  });

  it('rejects arrays with any non-object element', () => {
    expect(documentSamples([1, 2])).toHaveProperty('error');
    expect(documentSamples([{ a: 1 }, 5])).toHaveProperty('error');
    expect(documentSamples([{ a: 1 }, null])).toHaveProperty('error');
    expect(documentSamples([[1], [2]])).toHaveProperty('error');
  });

  it('rejects scalars, null, and undefined with a human sentence', () => {
    for (const doc of ['str', 42, true, null, undefined]) {
      const result = documentSamples(doc);
      expect(result).toHaveProperty('error');
      if ('error' in result) expect(result.error).toMatch(/object or an array of objects/);
    }
  });

  it('rejects class instances — a Date is not a plain object', () => {
    expect(documentSamples(new Date())).toHaveProperty('error');
    expect(documentSamples([new Date()])).toHaveProperty('error');
  });
});

describe('inferType: scalars', () => {
  it('types an empty value set as any', () => {
    expect(inferType([])).toEqual({ kind: 'any' });
  });

  it('types booleans as boolean, never as an enum', () => {
    expect(inferType([true])).toEqual({ kind: 'boolean' });
    expect(inferType([true, false, true, false, true, false])).toEqual({ kind: 'boolean' });
  });

  it('types whole numbers as integer and any fraction as number', () => {
    expect(inferType([1, 2, 3])).toEqual({ kind: 'integer' });
    expect(inferType([-5])).toEqual({ kind: 'integer' });
    expect(inferType([1, 2, 2.5])).toEqual({ kind: 'number' });
    expect(inferType([0.1])).toEqual({ kind: 'number' });
  });

  it('types non-finite numbers (YAML .nan/.inf) as number', () => {
    expect(inferType([1, NaN, 2])).toEqual({ kind: 'number' });
    expect(inferType([Infinity])).toEqual({ kind: 'number' });
    expect(inferType([-Infinity, 3])).toEqual({ kind: 'number' });
  });

  it('types values a parser should never produce as any', () => {
    expect(inferType([new Date()])).toEqual({ kind: 'any' });
    expect(inferType([() => 0])).toEqual({ kind: 'any' });
    expect(inferType([Symbol('x')])).toEqual({ kind: 'any' });
  });
});

describe('inferType: enum detection', () => {
  it('calls a small repeating string set an enum, values in first-seen order', () => {
    expect(inferType(['prod', 'dev', 'prod', 'dev'])).toEqual({
      kind: 'enum',
      values: ['prod', 'dev'],
    });
  });

  it('calls a small repeating number set an enum, keeping number values', () => {
    expect(inferType([2, 1, 2, 1])).toEqual({ kind: 'enum', values: [2, 1] });
    expect(inferType([1.5, 2.5, 1.5, 2.5])).toEqual({ kind: 'enum', values: [1.5, 2.5] });
  });

  it('needs at least 4 values in total', () => {
    // Same distinct set, one value short.
    expect(inferType(['a', 'b', 'a'])).toEqual({ kind: 'string' });
    expect(inferType(['a', 'b', 'a', 'b'])).toEqual({ kind: 'enum', values: ['a', 'b'] });
    expect(inferType([1, 2, 1])).toEqual({ kind: 'integer' });
  });

  it('needs at most 6 distinct values', () => {
    const six = ['a', 'b', 'c', 'd', 'e', 'f'];
    const seven = [...six, 'g'];
    expect(inferType([...six, ...six])).toEqual({ kind: 'enum', values: six });
    expect(inferType([...seven, ...seven])).toEqual({ kind: 'string' });
    expect(inferType([...Array(7).keys(), ...Array(7).keys()])).toEqual({ kind: 'integer' });
  });

  it('needs distinct * 2 <= total — real repetition, not four one-offs', () => {
    expect(inferType(['a', 'b', 'c', 'd'])).toEqual({ kind: 'string' });
    expect(inferType(['a', 'b', 'c', 'd', 'a', 'b', 'c', 'd'])).toEqual({
      kind: 'enum',
      values: ['a', 'b', 'c', 'd'],
    });
    // 3 distinct over 5 values: 6 > 5, just misses.
    expect(inferType(['a', 'b', 'c', 'a', 'b'])).toEqual({ kind: 'string' });
    // 3 distinct over 6 values: 6 <= 6, just makes it.
    expect(inferType(['a', 'b', 'c', 'a', 'b', 'c'])).toEqual({
      kind: 'enum',
      values: ['a', 'b', 'c'],
    });
    expect(inferType([1, 2, 3, 4])).toEqual({ kind: 'integer' });
  });

  it('never builds an enum from a single scalar', () => {
    expect(inferType(['dev'])).toEqual({ kind: 'string' });
    expect(inferType([7])).toEqual({ kind: 'integer' });
  });

  it('survives hostile enum values like __proto__', () => {
    expect(inferType(['__proto__', 'constructor', '__proto__', 'constructor'])).toEqual({
      kind: 'enum',
      values: ['__proto__', 'constructor'],
    });
  });
});

describe('inferType: string formats', () => {
  it('types a column where every value detects as one format', () => {
    expect(inferType(['a@b.com'])).toEqual({ kind: 'email' });
    expect(inferType(['a@b.com', 'c@d.org', 'e@f.io'])).toEqual({ kind: 'email' });
    expect(inferType(['https://a.com', 'ftp://b.org'])).toEqual({ kind: 'uri' });
    expect(inferType(['2024-01-02', '1999-12-31'])).toEqual({ kind: 'date' });
    expect(inferType(['2024-01-02T03:04Z'])).toEqual({ kind: 'date-time' });
    expect(inferType(['+1 555 123 4567', '555-987-6543'])).toEqual({ kind: 'phone' });
  });

  it('drops to string when one value breaks the format', () => {
    expect(inferType(['a@b.com', 'not an email'])).toEqual({ kind: 'string' });
  });

  it('drops to string when two formats disagree', () => {
    expect(inferType(['a@b.com', 'https://a.com'])).toEqual({ kind: 'string' });
  });

  it('prefers a common format over an enum of the same values', () => {
    expect(inferType(['a@b.com', 'c@d.org', 'a@b.com', 'c@d.org'])).toEqual({ kind: 'email' });
  });

  it('falls back to the enum test when the format check fails', () => {
    expect(inferType(['a@b.com', 'nope', 'a@b.com', 'nope'])).toEqual({
      kind: 'enum',
      values: ['a@b.com', 'nope'],
    });
  });
});

describe('inferType: arrays', () => {
  it('pools elements across every sample array for one item type', () => {
    expect(inferType([[1, 2], [3]])).toEqual({ kind: 'array', item: { kind: 'integer' } });
    expect(inferType([[1], [2.5]])).toEqual({ kind: 'array', item: { kind: 'number' } });
  });

  it('types an empty pool as item any', () => {
    expect(inferType([[]])).toEqual({ kind: 'array', item: { kind: 'any' } });
    expect(inferType([[], []])).toEqual({ kind: 'array', item: { kind: 'any' } });
  });

  it('drops nulls from the pool — item nullability is not modelled', () => {
    expect(inferType([[null, 1], [2]])).toEqual({ kind: 'array', item: { kind: 'integer' } });
    expect(inferType([[null], [null]])).toEqual({ kind: 'array', item: { kind: 'any' } });
  });

  it('unions mixed element shapes', () => {
    expect(inferType([['a'], [1]])).toEqual({
      kind: 'array',
      item: { kind: 'union', variants: [{ kind: 'string' }, { kind: 'integer' }] },
    });
  });

  it('caps the pool at 500 elements', () => {
    // 500 distinct integers fill the cap; the string after it never pools.
    const big = Array.from({ length: 500 }, (_, i) => i);
    expect(inferType([big, ['x']])).toEqual({ kind: 'array', item: { kind: 'integer' } });
  });

  it('recurses into arrays of objects', () => {
    const type = inferType([[{ id: 1 }], [{ id: 2, name: 'x' }]]);
    expect(type.kind).toBe('array');
    expect(type.item?.kind).toBe('object');
    const fields = type.item?.fields ?? [];
    expect(fields.map((f) => f.key)).toEqual(['id', 'name']);
    expect(fields[1]?.optional).toBe(true);
  });
});

describe('inferType: mixed shapes', () => {
  it('unions distinct shapes in first-seen order', () => {
    expect(inferType([1, 'x'])).toEqual({
      kind: 'union',
      variants: [{ kind: 'integer' }, { kind: 'string' }],
    });
    expect(inferType(['x', 1])).toEqual({
      kind: 'union',
      variants: [{ kind: 'string' }, { kind: 'integer' }],
    });
  });

  it('collapses integer and number into one variant before unioning', () => {
    expect(inferType([1, 2.5, 'x'])).toEqual({
      kind: 'union',
      variants: [{ kind: 'number' }, { kind: 'string' }],
    });
  });

  it('gives each variant the full per-shape treatment', () => {
    expect(inferType(['a@b.com', 'c@d.org', true])).toEqual({
      kind: 'union',
      variants: [{ kind: 'email' }, { kind: 'boolean' }],
    });
    expect(inferType([1, { a: 1 }])).toEqual({
      kind: 'union',
      variants: [{ kind: 'integer' }, { kind: 'object', fields: [{ key: 'a', type: { kind: 'integer' }, optional: false, nullable: false }] }],
    });
  });

  it('turns an unrecognizable shape group into an any variant', () => {
    expect(inferType([1, new Date()])).toEqual({
      kind: 'union',
      variants: [{ kind: 'integer' }, { kind: 'any' }],
    });
  });
});

describe('inferFields', () => {
  it('marks nothing optional or nullable from a single sample', () => {
    const fields = inferFields([{ a: 1, b: 'x' }]);
    expect(fields).toEqual([
      { key: 'a', type: { kind: 'integer' }, optional: false, nullable: false },
      { key: 'b', type: { kind: 'string' }, optional: false, nullable: false },
    ]);
  });

  it('unions keys across samples in first-seen order', () => {
    const fields = inferFields([{ a: 1 }, { b: 2, a: 3, c: 4 }]);
    expect(fields.map((f) => f.key)).toEqual(['a', 'b', 'c']);
  });

  it('marks a key optional when any sample lacks it', () => {
    const fields = inferFields([{ a: 1, b: 2 }, { a: 3 }]);
    expect(fields.find((f) => f.key === 'a')?.optional).toBe(false);
    expect(fields.find((f) => f.key === 'b')?.optional).toBe(true);
  });

  it('keeps optional and nullable independent', () => {
    // Null where present: nullable but NOT optional.
    const [a] = inferFields([{ a: null }, { a: 5 }]);
    expect(a).toEqual({ key: 'a', type: { kind: 'integer' }, optional: false, nullable: true });
    // Missing entirely: optional but NOT nullable.
    const [b] = inferFields([{ b: 5 }, {}]);
    expect(b).toEqual({ key: 'b', type: { kind: 'integer' }, optional: true, nullable: false });
  });

  it('types an always-null key as any', () => {
    expect(inferFields([{ a: null }])).toEqual([
      { key: 'a', type: { kind: 'any' }, optional: false, nullable: true },
    ]);
  });

  it('treats an undefined value as a missing key', () => {
    const [a] = inferFields([{ a: undefined }, { a: 1 }]);
    expect(a).toEqual({ key: 'a', type: { kind: 'integer' }, optional: true, nullable: false });
  });

  it('tracks optionality at nested levels', () => {
    const fields = inferFields([{ o: { x: 1, y: 2 } }, { o: { x: 3 } }]);
    const inner = fields[0]?.type.fields ?? [];
    expect(inner.find((f) => f.key === 'x')?.optional).toBe(false);
    expect(inner.find((f) => f.key === 'y')?.optional).toBe(true);
  });

  it('considers at most 200 samples', () => {
    // Distinct values throughout, so the enum test cannot fire and the type
    // stays a clean 'integer'.
    const samples: Record<string, unknown>[] = Array.from({ length: 200 }, (_, i) => ({ a: i }));
    // Sample 201 both lacks 'a' and introduces 'b' — neither registers.
    const fields = inferFields([...samples, { b: 2 }]);
    expect(fields).toEqual([
      { key: 'a', type: { kind: 'integer' }, optional: false, nullable: false },
    ]);
  });

  it('keeps hostile keys like __proto__ as ordinary fields', () => {
    const doc = JSON.parse('{"__proto__": true, "constructor": 1, "a": "x"}') as Record<
      string,
      unknown
    >;
    const fields = inferFields([doc]);
    expect(fields.map((f) => f.key)).toEqual(['__proto__', 'constructor', 'a']);
    expect(fields[0]?.type).toEqual({ kind: 'boolean' });
    expect(({} as Record<string, unknown>).a).toBeUndefined();
  });

  it('caps recursion depth at MAX_DEPTH on a hostile deep document', () => {
    let doc: Record<string, unknown> = { leaf: 1 };
    for (let i = 0; i < MAX_DEPTH * 3; i += 1) doc = { child: doc };
    const fields = inferFields([doc]);
    let levels = 0;
    let current: ConfigField[] = fields;
    while (current[0]?.type.kind === 'object') {
      current = current[0].type.fields ?? [];
      levels += 1;
    }
    expect(levels).toBeGreaterThan(0);
    expect(levels).toBeLessThanOrEqual(MAX_DEPTH);
    // The walk bottomed out at the cap, not at the document's real leaf.
    expect(current.some((f) => f.key === 'leaf')).toBe(false);
  });
});

describe('inferDocument', () => {
  it('infers a field tree from an object document', () => {
    const result = inferDocument({ name: 'x', port: 8080, on: true });
    expect(result).toEqual({
      fields: [
        { key: 'name', type: { kind: 'string' }, optional: false, nullable: false },
        { key: 'port', type: { kind: 'integer' }, optional: false, nullable: false },
        { key: 'on', type: { kind: 'boolean' }, optional: false, nullable: false },
      ],
    });
  });

  it('infers from an array of objects, sample by sample', () => {
    const result = inferDocument([
      { env: 'dev', debug: true },
      { env: 'prod', debug: false },
      { env: 'dev' },
      { env: 'prod' },
    ]);
    expect(result).toEqual({
      fields: [
        { key: 'env', type: { kind: 'enum', values: ['dev', 'prod'] }, optional: false, nullable: false },
        { key: 'debug', type: { kind: 'boolean' }, optional: true, nullable: false },
      ],
    });
  });

  it('passes the documentSamples error through untouched', () => {
    expect(inferDocument(42)).toEqual({
      error: 'The document must be an object or an array of objects.',
    });
    expect(inferDocument([])).toHaveProperty('error');
  });
});
