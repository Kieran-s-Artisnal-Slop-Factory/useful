import { describe, expect, it } from 'vitest';
import { validateDocument, type ConfigIssue } from './validate';
import { MAX_DEPTH, normalizeFields } from './model';
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

const errors = (issues: ConfigIssue[]) => issues.filter((i) => i.severity === 'error');
const warnings = (issues: ConfigIssue[]) => issues.filter((i) => i.severity === 'warning');

/** `depth` objects named `n` wrapped around one integer leaf. */
const deepSchema = (depth: number): ConfigField[] => {
  let fields: ConfigField[] = [f('leaf', 'integer')];
  for (let i = 0; i < depth; i++) fields = [f('n', { kind: 'object', fields })];
  return fields;
};

const deepDoc = (depth: number, leaf: unknown): Record<string, unknown> => {
  let doc: Record<string, unknown> = { leaf };
  for (let i = 0; i < depth; i++) doc = { n: doc };
  return doc;
};

describe('validateDocument root shapes', () => {
  it('accepts an object and validates it against the fields', () => {
    expect(validateDocument({ a: 'x' }, [f('a', 'string')])).toEqual([]);
  });

  it('accepts an array of objects and validates each element with an [i] prefix', () => {
    const issues = validateDocument([{ a: 'x' }, { a: 5 }], [f('a', 'string')]);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.path).toBe('[1].a');
    expect(issues[0]!.severity).toBe('error');
  });

  it('flags a non-object element of a root array at its index', () => {
    const issues = validateDocument([{ a: 'x' }, 'junk'], [f('a', 'string')]);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.path).toBe('[1]');
    expect(issues[0]!.message).toMatch(/must be an object/);
  });

  it('rejects every other root with the one fixed message', () => {
    for (const doc of ['text', 42, true, null, undefined]) {
      const issues = validateDocument(doc, [f('a', 'string')]);
      expect(issues).toEqual([
        {
          path: '',
          message: 'the document must be an object or an array of objects',
          severity: 'error',
        },
      ]);
    }
  });
});

describe('presence, null, and unknown keys', () => {
  it('errors on a missing required key and says so by path', () => {
    const issues = validateDocument({}, [f('name', 'string')]);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.path).toBe('name');
    expect(issues[0]!.message).toMatch(/missing/);
    expect(issues[0]!.severity).toBe('error');
  });

  it('lets an optional key be absent, but still types it when present', () => {
    const fields = [f('nick', 'string', { optional: true })];
    expect(validateDocument({}, fields)).toEqual([]);
    expect(validateDocument({ nick: 7 }, fields)).toHaveLength(1);
  });

  it('treats null and absent as different things', () => {
    // optional allows absence, not null; nullable allows null, not absence
    const optional = [f('a', 'string', { optional: true })];
    expect(errors(validateDocument({ a: null }, optional))).toHaveLength(1);
    const nullable = [f('a', 'string', { nullable: true })];
    expect(validateDocument({ a: null }, nullable)).toEqual([]);
    expect(errors(validateDocument({}, nullable))).toHaveLength(1);
  });

  it('names null in the non-nullable error', () => {
    const issues = validateDocument({ a: null }, [f('a', 'string')]);
    expect(issues[0]!.message).toMatch(/null/);
  });

  it('treats an explicitly-undefined value as absent', () => {
    expect(validateDocument({ a: undefined }, [f('a', 'string', { optional: true })])).toEqual([]);
    expect(errors(validateDocument({ a: undefined }, [f('a', 'string')]))).toHaveLength(1);
  });

  it('warns (not errors) about a key the schema does not know', () => {
    const issues = validateDocument({ a: 'x', mystery: 1 }, [f('a', 'string')]);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toEqual({
      path: 'mystery',
      message: 'mystery is not in the schema',
      severity: 'warning',
    });
  });

  it('finds a required key even when it is named like an Object.prototype member', () => {
    const schema = [f('__proto__', 'integer'), f('toString', 'string', { optional: true })];
    const doc = JSON.parse('{"__proto__": 5}') as Record<string, unknown>;
    expect(validateDocument(doc, schema)).toEqual([]);
    // a plain {} INHERITS toString but does not own it — that is still absent
    expect(errors(validateDocument({}, [f('toString', 'string')]))).toHaveLength(1);
  });
});

describe('scalar kinds', () => {
  it('checks string, boolean, number, and integer by shape', () => {
    expect(validateDocument({ a: 'x' }, [f('a', 'string')])).toEqual([]);
    expect(validateDocument({ a: 1 }, [f('a', 'string')])).toHaveLength(1);
    expect(validateDocument({ a: true }, [f('a', 'boolean')])).toEqual([]);
    expect(validateDocument({ a: 'true' }, [f('a', 'boolean')])).toHaveLength(1);
    expect(validateDocument({ a: 1.5 }, [f('a', 'number')])).toEqual([]);
    expect(validateDocument({ a: '1.5' }, [f('a', 'number')])).toHaveLength(1);
    expect(validateDocument({ a: 3 }, [f('a', 'integer')])).toEqual([]);
    expect(validateDocument({ a: 3.5 }, [f('a', 'integer')])).toHaveLength(1);
  });

  it('checks the five string formats through matchesFormat', () => {
    const good: Array<[ConfigFieldKind, string]> = [
      ['email', 'ada.lovelace@example.com'],
      ['phone', '+1 (555) 010-1234'],
      ['uri', 'https://example.com/docs'],
      ['date', '2024-03-01'],
      ['date-time', '2024-03-01T10:20:30Z'],
    ];
    for (const [kind, value] of good) {
      expect(validateDocument({ a: value }, [f('a', kind)])).toEqual([]);
    }
    for (const [kind] of good) {
      // a plainly wrong string, and a non-string, both fail
      expect(validateDocument({ a: 'definitely not it' }, [f('a', kind)])).toHaveLength(1);
      expect(validateDocument({ a: 42 }, [f('a', kind)])).toHaveLength(1);
    }
  });

  it('checks enum membership with === semantics across value types', () => {
    const fields = [f('env', { kind: 'enum', values: ['dev', 'prod', 1, true] })];
    for (const ok of ['dev', 'prod', 1, true]) {
      expect(validateDocument({ env: ok }, fields)).toEqual([]);
    }
    // '1' is not 1 and false is not true
    expect(validateDocument({ env: '1' }, fields)).toHaveLength(1);
    expect(validateDocument({ env: false }, fields)).toHaveLength(1);
    expect(validateDocument({ env: 'staging' }, fields)[0]!.message).toMatch(/dev/);
  });

  it('accepts anything but undefined for any', () => {
    const fields = [f('a', 'any')];
    for (const ok of ['x', 0, false, {}, [], { deep: [1] }]) {
      expect(validateDocument({ a: ok }, fields)).toEqual([]);
    }
    // null still goes through the field-level nullability rule
    expect(errors(validateDocument({ a: null }, fields))).toHaveLength(1);
  });
});

describe('structures and paths', () => {
  it('checks each array element against the item type at its index', () => {
    const fields = [f('tags', { kind: 'array', item: { kind: 'string' } })];
    expect(validateDocument({ tags: ['a', 'b'] }, fields)).toEqual([]);
    const issues = validateDocument({ tags: ['a', 5, 'c', false] }, fields);
    expect(issues.map((i) => i.path)).toEqual(['tags[1]', 'tags[3]']);
  });

  it('rejects a non-array where an array is expected', () => {
    const fields = [f('tags', { kind: 'array', item: { kind: 'string' } })];
    expect(validateDocument({ tags: 'a,b' }, fields)[0]!.message).toMatch(/must be an array/);
  });

  it('treats a missing item type as any', () => {
    const fields = [f('tags', { kind: 'array' })];
    expect(validateDocument({ tags: ['a', 5, true] }, fields)).toEqual([]);
  });

  it('renders nested paths like workplaces[2].name', () => {
    const fields = [
      f('workplaces', {
        kind: 'array',
        item: { kind: 'object', fields: [f('name', 'string')] },
      }),
    ];
    const doc = { workplaces: [{ name: 'a' }, { name: 'b' }, { name: 42 }] };
    const issues = validateDocument(doc, fields);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.path).toBe('workplaces[2].name');
  });

  it('recurses into objects with dotted paths, including under a root array', () => {
    const fields = [f('address', { kind: 'object', fields: [f('city', 'string')] })];
    expect(validateDocument({ address: { city: 'x' } }, fields)).toEqual([]);
    const issues = validateDocument([{ address: {} }], fields);
    expect(issues[0]!.path).toBe('[0].address.city');
  });

  it('rejects a scalar where an object is expected', () => {
    const fields = [f('address', { kind: 'object', fields: [] })];
    expect(validateDocument({ address: 'main st' }, fields)[0]!.message).toMatch(
      /must be an object/,
    );
  });
});

describe('unions', () => {
  const idField = f('id', { kind: 'union', variants: [{ kind: 'string' }, { kind: 'integer' }] });

  it('passes when any variant accepts the value', () => {
    expect(validateDocument({ id: 'abc' }, [idField])).toEqual([]);
    expect(validateDocument({ id: 42 }, [idField])).toEqual([]);
  });

  it('emits exactly ONE error naming the allowed variants when all fail', () => {
    const issues = validateDocument({ id: true }, [idField]);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.message).toMatch(/string or integer/);
  });

  it('keeps the warnings of the variant that matched', () => {
    const fields = [
      f('u', {
        kind: 'union',
        variants: [{ kind: 'object', fields: [f('a', 'string')] }, { kind: 'integer' }],
      }),
    ];
    const issues = validateDocument({ u: { a: 'x', extra: 1 } }, fields);
    expect(errors(issues)).toEqual([]);
    expect(warnings(issues).map((i) => i.path)).toEqual(['u.extra']);
  });
});

describe('depth cap', () => {
  it('accepts silently past MAX_DEPTH — the cap protects the walker, not the user', () => {
    const depth = MAX_DEPTH + 4;
    // the leaf violates its type AND a deep required key is missing; both are
    // beyond the cap, so neither is reported
    expect(validateDocument(deepDoc(depth, 'not an integer'), deepSchema(depth))).toEqual([]);
    expect(validateDocument(deepDoc(depth - 1, 0), deepSchema(depth))).toEqual([]);
  });

  it('still reports violations within the cap', () => {
    const issues = validateDocument(deepDoc(5, 'oops'), deepSchema(5));
    expect(issues).toHaveLength(1);
    expect(issues[0]!.path).toBe('n.n.n.n.n.leaf');
  });
});

describe('hostile input', () => {
  it('never throws on schemas normalized from garbage', () => {
    const garbage = [null, 42, 'x', [], { key: '' }, { key: 'ok', type: { kind: 'wat' } }];
    const fields = normalizeFields(garbage);
    for (const doc of [{}, { ok: 1 }, [{ ok: null }], 'nope', [[]]]) {
      expect(() => validateDocument(doc, fields)).not.toThrow();
    }
  });

  it('survives junk type nodes that skipped normalization', () => {
    const junk: ConfigField[] = [
      f('u', { kind: 'union' }), // no variants: treated as any
      f('e', { kind: 'enum' }), // no values: nothing can match
      f('o', { kind: 'object' }), // no fields
      f('a', { kind: 'array' }), // no item
    ];
    const doc = { u: 'anything', e: 'x', o: {}, a: [1, 'two'] };
    const issues = validateDocument(doc, junk);
    expect(errors(issues).map((i) => i.path)).toEqual(['e']);
  });

  it('caps the rendering of a hostile value in messages', () => {
    const long = 'a'.repeat(10_000);
    const issues = validateDocument({ n: long }, [f('n', 'integer')]);
    expect(issues[0]!.message.length).toBeLessThan(120);
    expect(issues[0]!.message).toMatch(/…/);
  });

  it('renders structures as tags, not their contents', () => {
    const fields = [f('s', 'string')];
    expect(validateDocument({ s: { huge: 'x'.repeat(9999) } }, fields)[0]!.message).toMatch(
      /\[object\]$/,
    );
    expect(validateDocument({ s: [1, 2, 3] }, fields)[0]!.message).toMatch(/\[array\]$/);
  });
});
