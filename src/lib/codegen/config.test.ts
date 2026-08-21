import { describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';
import {
  CONFIG_JS_RUNTIME,
  generateConfigFunction,
  type ConfigCodeTemplate,
  type ConfigFlavor,
} from './config';
import type { Language } from './identifiers';
import type { ConfigField, ConfigFieldType } from '../db/types';
import { validateDocument } from '../config/validate';
import { generateDocuments } from '../config/generate';

const field = (
  key: string,
  type: ConfigFieldType,
  over: Partial<Pick<ConfigField, 'optional' | 'nullable'>> = {},
): ConfigField => ({ key, type, optional: false, nullable: false, ...over });

/** One schema that touches every kind the emitters have a rule for. */
const HOSTILE_KEY = 'needs "quotes" \\ and */ and """';
const template: ConfigCodeTemplate = {
  name: 'Deploy settings */ """ <b>',
  format: 'json',
  fields: [
    field('name', { kind: 'string' }),
    field('replicas', { kind: 'integer' }),
    field('ratio', { kind: 'number' }, { optional: true }),
    field('enabled', { kind: 'boolean' }),
    field('owner', { kind: 'email' }),
    field('phone', { kind: 'phone' }, { nullable: true }),
    field('homepage', { kind: 'uri' }),
    field('since', { kind: 'date' }),
    field('builtAt', { kind: 'date-time' }),
    field('tier', { kind: 'enum', values: ['dev', 'staging', 'prod'] }),
    field('limit', { kind: 'union', variants: [{ kind: 'integer' }, { kind: 'string' }] }),
    field('tags', { kind: 'array', item: { kind: 'string' } }),
    field('address', {
      kind: 'object',
      fields: [field('city', { kind: 'string' }), field('zip', { kind: 'string' }, { optional: true })],
    }),
    field('workplaces', {
      kind: 'array',
      item: { kind: 'object', fields: [field('name', { kind: 'string' }), field('years', { kind: 'integer' })] },
    }),
    field(HOSTILE_KEY, { kind: 'any' }),
  ],
};

const VALID_DOC = {
  name: 'api',
  replicas: 3,
  ratio: 0.5,
  enabled: true,
  owner: 'ada.lovelace@example.com',
  phone: null,
  homepage: 'https://example.org/docs',
  since: '2024-02-29',
  builtAt: '2024-02-29T12:34:56Z',
  tier: 'prod',
  limit: 'unbounded',
  tags: ['a', 'b'],
  address: { city: 'Toronto' },
  workplaces: [{ name: 'Lab', years: 4 }],
  [HOSTILE_KEY]: { anything: [1, 2] },
};

const INVALID_DOC = {
  name: 7,
  replicas: 2.5,
  enabled: 'yes',
  owner: 'not an email',
  phone: 'x',
  homepage: 'nope',
  since: '29/02/2024',
  builtAt: 'yesterday',
  tier: 'qa',
  limit: true,
  tags: ['a', 2],
  address: { city: 9 },
  workplaces: [{ name: 'Lab' }],
  extra: 1,
};

const LANGUAGES: Language[] = ['python', 'javascript', 'go', 'rust'];
const FLAVORS: ConfigFlavor[] = ['parser', 'generator'];

/** Evaluate emitted JavaScript as a module body and hand back its one export.
 * The name is read off the source: a hostile template name sanitizes to
 * whatever identifiers.ts decides, and the test should not second-guess it. */
function loadJs(source: string): (...args: unknown[]) => unknown {
  const name = source.match(/^export function (\w+)\(/m)?.[1];
  expect(name, 'an exported function').toBeTruthy();
  const body = source.replace(/^export function/gm, 'function');
  return new Function(`${body}; return ${name};`)() as (...args: unknown[]) => unknown;
}

describe('generateConfigFunction — every language and flavor', () => {
  for (const language of LANGUAGES) {
    for (const flavor of FLAVORS) {
      it(`${language} ${flavor} emits a file that names every field`, () => {
        const source = generateConfigFunction(template, language, flavor);
        expect(source.length).toBeGreaterThan(200);
        // Keys are data: each one appears as a correctly-escaped literal.
        for (const key of ['replicas', 'owner', 'workplaces', 'city']) {
          expect(source, `${language} ${flavor} names ${key}`).toContain(key);
        }
        // A hostile key never closes the comment it is documented in.
        expect(source).not.toMatch(/\/\*[^]*?\*\/[^]*?\*\/\s*"""/);
        expect(source).not.toContain('"""' + HOSTILE_KEY);
      });
    }
  }

  it('Python is stdlib only, with a docstring that lists the fields', () => {
    const parser = generateConfigFunction(template, 'python', 'parser');
    expect(parser).toMatch(/^def parse_\w+\(text: str\) -> dict:$/m);
    expect(parser).toContain('import json');
    expect(parser).toContain('raise ValueError');
    expect(parser).toContain('unknown key');
    expect(parser).not.toMatch(/^import (yaml|requests|pydantic)/m);
    const generator = generateConfigFunction(template, 'python', 'generator');
    expect(generator).toMatch(/^def generate_\w+\(/m);
    expect(generator).toContain('0xFFFFFFFF');
    expect(generator).toContain('example.');
  });

  it('a YAML-format Python parser takes decoded data and says so', () => {
    const parser = generateConfigFunction({ ...template, format: 'yaml' }, 'python', 'parser');
    expect(parser).toMatch(/^def parse_\w+\(data\) -> dict:$/m);
    expect(parser).toContain('yaml.safe_load');
    expect(parser).not.toContain('json.loads');
  });

  it('Go uses encoding/json for JSON and declares the YAML caveat otherwise', () => {
    const parser = generateConfigFunction(template, 'go', 'parser');
    expect(parser).toContain('package ');
    expect(parser).toContain('encoding/json');
    expect(parser).toMatch(/func Parse\w*\(data \[\]byte\)/);
    const yamlParser = generateConfigFunction({ ...template, format: 'yaml' }, 'go', 'parser');
    expect(yamlParser).toContain('yaml');
    expect(yamlParser).toMatch(/func Validate\w*\(/);
    const generator = generateConfigFunction(template, 'go', 'generator');
    expect(generator).toMatch(/func Generate\w*\(count int, seed uint32\)|func Generate\w*\(/);
    expect(generator).toContain('uint32');
  });

  it('Rust: the parser leans on serde_json and says so; the generator is dependency-free', () => {
    const parser = generateConfigFunction(template, 'rust', 'parser');
    expect(parser).toContain('serde_json');
    expect(parser).toMatch(/pub fn parse_\w+\(/);
    const generator = generateConfigFunction(template, 'rust', 'generator');
    expect(generator).toMatch(/pub fn generate_\w+\(/);
    // It may SAY it needs no serde; it must not use it.
    expect(generator).not.toMatch(/^use serde/m);
    expect(generator).not.toContain('serde_json::');
    expect(generator).toContain('wrapping_');
  });

  it('Rust escapes the hostile key without a \\u escape JSON would emit', () => {
    const keyed: ConfigCodeTemplate = {
      ...template,
      fields: [field('é "\\', { kind: 'string' })],
    };
    const source = generateConfigFunction(keyed, 'rust', 'parser');
    expect(source).not.toMatch(/\\u[0-9a-fA-F]{4}/);
    expect(source).toContain('\\"');
  });
});

describe('the emitted JavaScript runs', () => {
  const parserSource = generateConfigFunction(template, 'javascript', 'parser');
  const generatorSource = generateConfigFunction(template, 'javascript', 'generator');

  it('parses without syntax errors, both flavors', () => {
    for (const source of [parserSource, generatorSource]) {
      expect(() => new Function(source.replace(/^export function/gm, 'function'))).not.toThrow();
    }
  });

  it('the parser accepts a valid document and returns it', () => {
    const parse = loadJs(parserSource);
    expect(parse(JSON.stringify(VALID_DOC))).toEqual(VALID_DOC);
  });

  it('the parser reports every problem at once, unknown keys included', () => {
    const parse = loadJs(parserSource);
    let message = '';
    try {
      parse(JSON.stringify(INVALID_DOC));
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).not.toBe('');
    for (const path of [
      'name',
      'replicas',
      'enabled',
      'owner',
      'phone',
      'homepage',
      'since',
      'builtAt',
      'tier',
      'limit',
      'tags[1]',
      'address.city',
      'workplaces[0].years',
      'extra',
    ]) {
      expect(message, `reports ${path}`).toContain(path);
    }
    // One message, many lines — never a stop at the first.
    expect(message.split('\n').length).toBeGreaterThan(10);
  });

  it('the generator is deterministic per seed and its documents pass the parser', () => {
    const generate = loadJs(generatorSource);
    const parse = loadJs(parserSource);
    const a = generate(5, 42) as Record<string, unknown>[];
    const b = generate(5, 42) as Record<string, unknown>[];
    const c = generate(5, 43) as Record<string, unknown>[];
    expect(a).toHaveLength(5);
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
    for (const doc of a) {
      expect(() => parse(JSON.stringify(doc))).not.toThrow();
      // And the app's own validator agrees.
      expect(validateDocument(doc, template.fields)).toEqual([]);
    }
  });
});

describe('CONFIG_JS_RUNTIME — the one copy the web component ships', () => {
  const runtime = new Function(
    `${CONFIG_JS_RUNTIME.formats}\n${CONFIG_JS_RUNTIME.prng}\n${CONFIG_JS_RUNTIME.words}\n${CONFIG_JS_RUNTIME.validate}\n${CONFIG_JS_RUNTIME.generate}\n${CONFIG_JS_RUNTIME.toYaml}\nreturn { _validate, _generate, _toYaml, _mulberry32 };`,
  )() as {
    _validate: (data: unknown, fields: ConfigField[]) => { path: string; message: string; severity: string }[];
    _generate: (fields: ConfigField[], count: number, seed: number) => Record<string, unknown>[];
    _toYaml: (value: unknown) => string;
    _mulberry32: (seed: number) => () => number;
  };
  const fields = template.fields as ConfigField[];

  const shape = (issues: { path: string; severity: string }[]) =>
    issues.map((i) => `${i.severity}:${i.path}`).sort();

  it('validate agrees with validate.ts on what is wrong, path by path', () => {
    expect(runtime._validate(VALID_DOC, fields)).toEqual([]);
    expect(validateDocument(VALID_DOC, fields)).toEqual([]);
    expect(shape(runtime._validate(INVALID_DOC, fields))).toEqual(shape(validateDocument(INVALID_DOC, fields)));
  });

  it('validate agrees with validate.ts on null, absent and optional', () => {
    const docs = [
      { ...VALID_DOC, phone: null },
      { ...VALID_DOC, name: null },
      (({ ratio: _r, ...rest }) => rest)(VALID_DOC),
      (({ name: _n, ...rest }) => rest)(VALID_DOC),
      { ...VALID_DOC, address: { city: 'x', extra: true } },
    ];
    for (const doc of docs) {
      expect(shape(runtime._validate(doc, fields))).toEqual(shape(validateDocument(doc, fields)));
    }
  });

  it('generate is deterministic and its output validates through validate.ts', () => {
    const a = runtime._generate(fields, 50, 7);
    const b = runtime._generate(fields, 50, 7);
    expect(a).toEqual(b);
    expect(a).toHaveLength(50);
    for (const doc of a) expect(validateDocument(doc, fields)).toEqual([]);
    // The app's generator keeps the same promise, so the two can be trusted
    // to describe one schema the same way.
    for (const doc of generateDocuments(fields, 20, 7)) expect(runtime._validate(doc, fields)).toEqual([]);
  });

  it('mulberry32 matches the app for the same seed', () => {
    const ours = runtime._mulberry32(12345);
    const theirs = (async () => (await import('../config/generate')).mulberry32(12345))();
    return theirs.then((rand) => {
      for (let i = 0; i < 20; i++) expect(ours()).toBe(rand());
    });
  });

  it('toYaml round-trips plain data, quoting what would read back differently', () => {
    const value = {
      country: 'NO',
      code: '0123',
      when: '12:30',
      n: 3,
      f: 2.5,
      flag: true,
      nothing: null,
      empty: [],
      bag: {},
      list: ['a', 'yes', 1, { k: 'v' }],
      nested: { deeper: { leaf: 'x y' } },
      spaced: ' lead',
    };
    const text = runtime._toYaml(value);
    expect(parseYaml(text)).toEqual(value);
    expect(text).toContain('"NO"');
  });
});
