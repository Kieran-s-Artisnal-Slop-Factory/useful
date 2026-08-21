import { describe, expect, it } from 'vitest';
import { generateDocuments, mulberry32 } from './generate';
import { validateDocument } from './validate';
import { matchesFormat, type StringFormat } from './formats';
import { normalizeFields } from './model';
import { DOMAINS, URI_PATHS, WORDS } from './words';
import type { ConfigField, ConfigFieldKind, ConfigFieldType } from '../db/types';

const f = (
  key: string,
  type: ConfigFieldType | ConfigFieldKind,
  over: Partial<Omit<ConfigField, 'key' | 'type'>> = {},
): ConfigField => ({
  key,
  type: typeof type === 'string' ? { kind: type } : type,
  optional: false,
  nullable: false,
  ...over,
});

/** Every kind at once: scalars, all five formats, enum, union, arrays of
 * scalars and of objects, a nested object, any, and the optional/nullable
 * combinations. The round-trip property test runs against this. */
const fullSchema: ConfigField[] = [
  f('name', 'string'),
  f('age', 'integer', { optional: true }),
  f('score', 'number', { nullable: true }),
  f('active', 'boolean'),
  f('contact', 'email'),
  f('mobile', 'phone'),
  f('site', 'uri'),
  f('born', 'date'),
  f('last_seen', 'date-time', { optional: true, nullable: true }),
  f('env', { kind: 'enum', values: ['dev', 'staging', 1, true] }),
  f('id', { kind: 'union', variants: [{ kind: 'string' }, { kind: 'integer' }] }),
  f('tags', { kind: 'array', item: { kind: 'string' } }),
  f('workplaces', {
    kind: 'array',
    item: {
      kind: 'object',
      fields: [f('name', 'string'), f('size', 'integer', { optional: true })],
    },
  }),
  f('address', {
    kind: 'object',
    fields: [f('city', 'string'), f('zip', 'string', { nullable: true })],
  }),
  f('extra', 'any'),
];

describe('mulberry32', () => {
  it('produces the same stream for the same seed', () => {
    const a = mulberry32(123);
    const b = mulberry32(123);
    for (let i = 0; i < 20; i++) expect(a()).toBe(b());
  });

  it('produces different streams for different seeds', () => {
    const a = mulberry32(1);
    const b = mulberry32(2);
    const streamA = Array.from({ length: 5 }, a);
    const streamB = Array.from({ length: 5 }, b);
    expect(streamA).not.toEqual(streamB);
  });

  it('stays in [0, 1) and does not repeat itself immediately', () => {
    const rng = mulberry32(0xdeadbeef);
    const seen = new Set<number>();
    for (let i = 0; i < 1000; i++) {
      const v = rng();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
      seen.add(v);
    }
    expect(seen.size).toBeGreaterThan(990);
  });
});

describe('generateDocuments determinism', () => {
  it('returns identical output for the same (fields, count, seed)', () => {
    expect(generateDocuments(fullSchema, 10, 42)).toEqual(generateDocuments(fullSchema, 10, 42));
  });

  it('returns different output for a different seed', () => {
    const a = JSON.stringify(generateDocuments(fullSchema, 10, 42));
    const b = JSON.stringify(generateDocuments(fullSchema, 10, 43));
    expect(a).not.toBe(b);
  });

  it('makes the documents within one run differ from each other', () => {
    const docs = generateDocuments([f('id', 'integer'), f('name', 'string')], 10, 7);
    const distinct = new Set(docs.map((d) => JSON.stringify(d)));
    expect(distinct.size).toBeGreaterThan(1);
  });
});

describe('generateDocuments count clamp', () => {
  it('clamps to at least 1 and at most 1000', () => {
    expect(generateDocuments([], 0, 1)).toHaveLength(1);
    expect(generateDocuments([], -50, 1)).toHaveLength(1);
    expect(generateDocuments([], 5000, 1)).toHaveLength(1000);
  });

  it('truncates fractions and survives junk counts', () => {
    expect(generateDocuments([], 2.9, 1)).toHaveLength(2);
    expect(generateDocuments([], NaN, 1)).toHaveLength(1);
    expect(generateDocuments([], Infinity, 1)).toHaveLength(1);
  });
});

describe('optional and nullable frequencies', () => {
  it('includes an optional field about 80% of the time', () => {
    const docs = generateDocuments([f('a', 'integer', { optional: true })], 300, 9);
    const present = docs.filter((d) => 'a' in d).length;
    expect(present).toBeGreaterThan(210);
    expect(present).toBeLessThan(270);
  });

  it('nulls a nullable field about 10% of the time', () => {
    const docs = generateDocuments([f('a', 'integer', { nullable: true })], 300, 9);
    const nulls = docs.filter((d) => d.a === null).length;
    expect(nulls).toBeGreaterThan(10);
    expect(nulls).toBeLessThan(60);
  });

  it('never emits undefined for a present key', () => {
    const docs = generateDocuments(fullSchema, 50, 3);
    for (const doc of docs) {
      for (const value of Object.values(doc)) expect(value).not.toBeUndefined();
    }
  });
});

describe('generated value shapes', () => {
  const docs = generateDocuments(fullSchema, 50, 11);

  it('emits integers in 0-9999 and numbers with at most two decimals', () => {
    for (const doc of docs) {
      if ('age' in doc) {
        expect(Number.isInteger(doc.age)).toBe(true);
        expect(doc.age as number).toBeGreaterThanOrEqual(0);
        expect(doc.age as number).toBeLessThanOrEqual(9999);
      }
      if (typeof doc.score === 'number') {
        expect(Math.round(doc.score * 100) / 100).toBe(doc.score);
        expect(doc.score).toBeLessThanOrEqual(9999);
      }
    }
  });

  it('builds strings from 1-3 words off the curated list', () => {
    for (const doc of docs) {
      const words = (doc.name as string).split(' ');
      expect(words.length).toBeGreaterThanOrEqual(1);
      expect(words.length).toBeLessThanOrEqual(3);
      for (const word of words) expect(WORDS).toContain(word);
    }
  });

  it('emits emails, phones, and uris only over the reserved fakery', () => {
    for (const doc of docs) {
      const email = doc.contact as string;
      expect(email).toMatch(/^[a-z]+\.[a-z]+@/);
      expect(DOMAINS.some((d) => email.endsWith(`@${d}`))).toBe(true);
      expect(doc.mobile).toMatch(/^\+1 \(555\) 010-\d{4}$/);
      const uri = doc.site as string;
      expect(uri.startsWith('https://')).toBe(true);
      expect(DOMAINS.some((d) => uri.startsWith(`https://${d}/`))).toBe(true);
      expect(URI_PATHS).toContain(uri.slice(uri.lastIndexOf('/') + 1));
    }
  });

  it('emits real calendar dates in 2020-2029', () => {
    for (const doc of docs) {
      const date = doc.born as string;
      expect(date).toMatch(/^202\d-\d{2}-\d{2}$/);
      const parsed = new Date(`${date}T00:00:00Z`);
      expect(parsed.toISOString().slice(0, 10)).toBe(date);
      if (typeof doc.last_seen === 'string') {
        expect(doc.last_seen).toMatch(/^202\d-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
      }
    }
  });

  it('picks enum values from the list and union values from a variant', () => {
    for (const doc of docs) {
      expect(['dev', 'staging', 1, true]).toContain(doc.env);
      expect(['string', 'number']).toContain(typeof doc.id);
      if (typeof doc.id === 'number') expect(Number.isInteger(doc.id)).toBe(true);
    }
  });

  it('sizes arrays 1-4 and recurses into element objects', () => {
    for (const doc of docs) {
      const tags = doc.tags as unknown[];
      expect(tags.length).toBeGreaterThanOrEqual(1);
      expect(tags.length).toBeLessThanOrEqual(4);
      const workplaces = doc.workplaces as Array<Record<string, unknown>>;
      expect(workplaces.length).toBeGreaterThanOrEqual(1);
      expect(workplaces.length).toBeLessThanOrEqual(4);
      for (const place of workplaces) expect(typeof place.name).toBe('string');
    }
  });

  it('emits a scalar for any', () => {
    for (const doc of docs) {
      expect(['string', 'number', 'boolean']).toContain(typeof doc.extra);
    }
  });

  it('treats a missing array item type as any', () => {
    const bare = generateDocuments([f('list', { kind: 'array' })], 5, 1);
    for (const doc of bare) {
      for (const item of doc.list as unknown[]) {
        expect(['string', 'number', 'boolean']).toContain(typeof item);
      }
    }
  });
});

describe('every emitted format value passes matchesFormat', () => {
  it('agrees with the validator on all five formats', () => {
    const schema: ConfigField[] = (
      ['email', 'phone', 'uri', 'date', 'date-time'] as const
    ).map((kind) => f(kind, kind));
    const docs = generateDocuments(schema, 50, 21);
    for (const doc of docs) {
      for (const [key, value] of Object.entries(doc)) {
        expect(typeof value).toBe('string');
        expect(matchesFormat(value as string, key as StringFormat)).toBe(true);
      }
    }
  });
});

describe('depth cap and junk schemas', () => {
  /** `depth` objects named `n` wrapped around one integer leaf. */
  const deepSchema = (depth: number): ConfigField[] => {
    let fields: ConfigField[] = [f('leaf', 'integer')];
    for (let i = 0; i < depth; i++) fields = [f('n', { kind: 'object', fields })];
    return fields;
  };

  it('emits null past MAX_DEPTH instead of recursing forever', () => {
    const docs = generateDocuments(deepSchema(20), 1, 5);
    // the object at nesting level 16 is the last one built; its child is the
    // capped null, so the 17th step down the chain lands on it
    let node: unknown = docs[0];
    for (let i = 0; i < 17; i++) {
      expect(node).toBeTypeOf('object');
      expect(node).not.toBeNull();
      node = (node as Record<string, unknown>).n;
    }
    expect(node).toBeNull();
  });

  it('never throws on schemas normalized from garbage', () => {
    const fields = normalizeFields([null, 'x', 42, { key: 'ok', type: { kind: 'wat' } }]);
    expect(() => generateDocuments(fields, 3, 1)).not.toThrow();
  });

  it('survives junk type nodes that skipped normalization', () => {
    const junk: ConfigField[] = [
      f('u', { kind: 'union' }), // no variants
      f('e', { kind: 'enum' }), // no values
      f('o', { kind: 'object' }), // no fields
      f('a', { kind: 'array' }), // no item
    ];
    const docs = generateDocuments(junk, 5, 1);
    expect(docs).toHaveLength(5);
    for (const doc of docs) {
      expect(typeof doc.o).toBe('object');
      expect(Array.isArray(doc.a)).toBe(true);
    }
  });
});

describe('the round-trip property', () => {
  it('generates 100 documents that all validate with zero issues of any severity', () => {
    const docs = generateDocuments(fullSchema, 100, 7);
    expect(docs).toHaveLength(100);
    for (const doc of docs) {
      expect(validateDocument(doc, fullSchema)).toEqual([]);
    }
    // and the whole batch also validates as a root array
    expect(validateDocument(docs, fullSchema)).toEqual([]);
  });
});
