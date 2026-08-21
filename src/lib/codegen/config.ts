/**
 * A config schema as generated code: a parser or a sample-document generator,
 * in Python, JavaScript, Go or Rust.
 *
 * The emitted code UNROLLS the schema — every field becomes explicit, readable
 * checks or assignments, so the generated file documents the format it handles
 * and never interprets a schema at runtime. Every file is dependency-free
 * stdlib, with one documented exception: the Rust parser uses serde_json,
 * Rust's de-facto JSON stdlib. Nothing is silently wrong: a parser reports
 * every problem it finds (unknown keys included) and a generator's output is
 * deterministic for a given seed.
 *
 * CONFIG_JS_RUNTIME is the other half: hand-written JavaScript source strings
 * (the HELPER_SOURCE pattern from functions.ts) shared by the web-component
 * emitter, so there is exactly one copy of the validate/generate/YAML logic
 * that ships inside a component.
 */
import type { ConfigField, ConfigFieldKind, ConfigFieldType } from '../db/types';
import { MAX_DEPTH, typeLabel } from '../config/model';
import { FORMAT_SOURCES } from '../config/formats';
import { functionName, type Language } from './identifiers';

export interface ConfigCodeTemplate {
  name: string;
  format: 'json' | 'yaml';
  fields: readonly ConfigField[];
}

export type ConfigFlavor = 'parser' | 'generator';

/**
 * Neutralise anything in free text that could close the comment it sits in.
 * Reimplemented from functions.ts on purpose — that file is edited separately
 * and this module must not depend on its private helpers.
 */
function commentSafe(text: string): string {
  return text
    .replace(/\r?\n/g, ' ')
    .replace(/\*\//g, '*​/')
    .replace(/"""/g, '“”“')
    .trim();
}

const capitalize = (s: string): string => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

/** Field keys are data, not identifiers: always a correctly-escaped literal.
 * JSON string syntax is a valid string literal in Python, JavaScript and Go. */
const pyStr = (s: string): string => JSON.stringify(s);
const jsStr = (s: string): string => JSON.stringify(s);
const goStr = (s: string): string => JSON.stringify(s);

/** Rust rejects JSON's \uXXXX escape (it wants \u{...}), so Rust gets its own. */
function rustStr(s: string): string {
  let out = '"';
  for (const ch of s) {
    const code = ch.codePointAt(0)!;
    if (ch === '\\') out += '\\\\';
    else if (ch === '"') out += '\\"';
    else if (ch === '\n') out += '\\n';
    else if (ch === '\r') out += '\\r';
    else if (ch === '\t') out += '\\t';
    else if (code < 0x20) out += `\\u{${code.toString(16)}}`;
    else out += ch;
  }
  return out + '"';
}

/** The words the format kinds carry in problem messages, shared by every
 * language so a schema reads the same wherever it was pasted. */
const KIND_PROBLEM: Partial<Record<ConfigFieldKind, string>> = {
  string: 'expected a string',
  integer: 'expected an integer',
  number: 'expected a number',
  boolean: 'expected a boolean',
  email: 'expected an email address',
  phone: 'expected a phone number',
  uri: 'expected a URI',
  date: 'expected a date (YYYY-MM-DD)',
  'date-time': 'expected a date-time (ISO 8601)',
  object: 'expected an object',
  array: 'expected an array',
};

type FormatKind = 'email' | 'phone' | 'uri' | 'date' | 'date-time';
const FORMAT_ORDER: readonly FormatKind[] = ['email', 'phone', 'uri', 'date', 'date-time'];

/** One pattern text per format, used verbatim by Python's re, JavaScript
 * regex literals and Go's RE2. These are the page's OWN patterns
 * (formats.ts keeps them portable for exactly this reason), so a generated
 * parser and the inference that produced its schema agree on what an email,
 * a URI or a phone number is. Rust gets hand-rolled approximations below,
 * because it has no regex in its standard library. */
const FORMAT_PATTERNS: Record<FormatKind, string> = FORMAT_SOURCES;

const FORMAT_CONST: Record<FormatKind, string> = {
  email: 'EMAIL',
  phone: 'PHONE',
  uri: 'URI',
  date: 'DATE',
  'date-time': 'DATE_TIME',
};

/** Small embedded vocabulary for generated samples. Deliberately NOT the app's
 * words.ts — an emitted file must stay self-contained. */
const WORD_BANK = {
  words: [
    'amber', 'basil', 'cedar', 'delta', 'ember', 'fjord', 'grove', 'harbor',
    'indigo', 'juniper', 'kestrel', 'lagoon', 'meadow', 'nectar', 'onyx', 'prairie',
  ],
  firstNames: ['Ada', 'Grace', 'Alan', 'Edsger', 'Barbara', 'Donald', 'Katherine', 'Niklaus'],
  lastNames: ['Lovelace', 'Hopper', 'Turing', 'Dijkstra', 'Liskov', 'Knuth', 'Johnson', 'Wirth'],
  // RFC 2606 reserved domains, so a sample never names a real host.
  domains: ['example.com', 'example.org', 'example.net'],
};

/** Every kind the tree mentions, unions and array items included. */
function collectKinds(fields: readonly ConfigField[], depth = 0, out = new Set<ConfigFieldKind>()): Set<ConfigFieldKind> {
  if (depth >= MAX_DEPTH) return out;
  for (const field of fields) collectTypeKinds(field.type, depth + 1, out);
  return out;
}

function collectTypeKinds(type: ConfigFieldType, depth: number, out: Set<ConfigFieldKind>): void {
  if (depth >= MAX_DEPTH) return;
  out.add(type.kind);
  if (type.kind === 'object') collectKinds(type.fields ?? [], depth, out);
  if (type.kind === 'array' && type.item) collectTypeKinds(type.item, depth + 1, out);
  if (type.kind === 'union') for (const v of type.variants ?? []) collectTypeKinds(v, depth + 1, out);
}

const usedFormats = (kinds: ReadonlySet<ConfigFieldKind>): FormatKind[] =>
  FORMAT_ORDER.filter((f) => kinds.has(f));

/** `path (type): required, nullable` rows for the doc comment, one per field. */
function fieldDocRows(fields: readonly ConfigField[], base = '', depth = 0, out: string[] = []): string[] {
  if (depth >= MAX_DEPTH) return out;
  for (const field of fields) {
    const flags = [field.optional ? 'optional' : 'required', ...(field.nullable ? ['nullable'] : [])];
    out.push(commentSafe(`${base}${field.key} (${typeLabel(field.type)}): ${flags.join(', ')}`));
    if (field.type.kind === 'object') {
      fieldDocRows(field.type.fields ?? [], `${base}${field.key}.`, depth + 1, out);
    }
    if (field.type.kind === 'array' && field.type.item?.kind === 'object') {
      fieldDocRows(field.type.item.fields ?? [], `${base}${field.key}[].`, depth + 1, out);
    }
  }
  return out;
}

/**
 * Where a runtime path expression comes from. `v` is null while the path is
 * still fully static (compile-time string); inside an array loop it names the
 * emitted path variable and `suffix` is the static tail beyond it.
 */
interface PathCtx {
  v: string | null;
  suffix: string;
}

const ROOT_CTX: PathCtx = { v: null, suffix: '' };

const childCtx = (ctx: PathCtx, key: string): PathCtx =>
  ctx.v === null
    ? { v: null, suffix: `${ctx.suffix}${key}.` }
    : { v: ctx.v, suffix: `${ctx.suffix}.${key}` };

/** The static text between the path variable (or the root) and `key`. */
const litPart = (ctx: PathCtx, key: string | null): string =>
  ctx.v === null ? ctx.suffix + (key ?? '') : key === null ? ctx.suffix : `${ctx.suffix}.${key}`;

const ind = (n: number): string => ' '.repeat(n);

// ---------------------------------------------------------------------------
// Python
// ---------------------------------------------------------------------------

const pyEnumLit = (v: string | number | boolean): string =>
  typeof v === 'string' ? pyStr(v) : typeof v === 'boolean' ? (v ? 'True' : 'False') : String(v);

const pyTuple = (values: string[]): string =>
  values.length === 1 ? `(${values[0]},)` : `(${values.join(', ')})`;

function pyProblem(ctx: PathCtx, key: string | null, msg: string): string {
  if (ctx.v === null) return `problems.append(${pyStr(litPart(ctx, key) + ': ' + msg)})`;
  return `problems.append(${ctx.v} + ${pyStr(litPart(ctx, key) + ': ' + msg)})`;
}

function pyFailCond(v: string, type: ConfigFieldType): string {
  switch (type.kind) {
    case 'string': return `not isinstance(${v}, str)`;
    case 'integer': return `not isinstance(${v}, int) or isinstance(${v}, bool)`;
    case 'number': return `not isinstance(${v}, (int, float)) or isinstance(${v}, bool)`;
    case 'boolean': return `not isinstance(${v}, bool)`;
    case 'enum':
      return `${v} not in ${pyTuple((type.values ?? []).map(pyEnumLit))}`;
    case 'union':
      return `not (${(type.variants ?? []).map((t) => pyVariantCond(v, t)).join(' or ')})`;
    default:
      return `not isinstance(${v}, str) or not _${FORMAT_CONST[type.kind as FormatKind]}_RE.match(${v})`;
  }
}

function pyVariantCond(v: string, type: ConfigFieldType): string {
  switch (type.kind) {
    case 'string': return `isinstance(${v}, str)`;
    case 'integer': return `(isinstance(${v}, int) and not isinstance(${v}, bool))`;
    case 'number': return `(isinstance(${v}, (int, float)) and not isinstance(${v}, bool))`;
    case 'boolean': return `isinstance(${v}, bool)`;
    case 'enum': return `${v} in ${pyTuple((type.values ?? []).map(pyEnumLit))}`;
    // Shallow on purpose: "matches at least one variant" is a shape question.
    case 'object': return `isinstance(${v}, dict)`;
    case 'array': return `isinstance(${v}, list)`;
    case 'any': return 'True';
    case 'union': return `(${(type.variants ?? []).map((t) => pyVariantCond(v, t)).join(' or ')})`;
    default:
      return `(isinstance(${v}, str) and _${FORMAT_CONST[type.kind as FormatKind]}_RE.match(${v}))`;
  }
}

function pyTypeChecks(
  v: string,
  type: ConfigFieldType,
  ctx: PathCtx,
  key: string | null,
  at: number,
  depth: number,
): string[] {
  const pad = ind(at);
  if (type.kind === 'any' || depth >= MAX_DEPTH) return [];
  if (type.kind === 'object') {
    const fields = type.fields ?? [];
    const known = fields.map((f) => f.key);
    const here = childCtx(key === null ? { v: ctx.v, suffix: ctx.suffix.replace(/\.$/, '') } : ctx, key ?? '');
    const oCtx: PathCtx = key === null ? { v: ctx.v, suffix: ctx.suffix } : childCtx(ctx, key);
    void here;
    const prefixExpr =
      oCtx.v === null
        ? oCtx.suffix ? `${pyStr(oCtx.suffix)} + ` : ''
        : `${oCtx.v} + ${pyStr(oCtx.suffix + '.')} + `;
    return [
      `${pad}if not isinstance(${v}, dict):`,
      `${pad}    ${pyProblem(ctx, key, 'expected an object')}`,
      `${pad}else:`,
      `${pad}    for _key in ${v}:`,
      `${pad}        if _key not in ${pyTuple(known.map(pyStr)) === '(,)' ? '()' : known.length === 0 ? '()' : pyTuple(known.map(pyStr))}:`,
      `${pad}            problems.append(${prefixExpr}str(_key) + ': unknown key')`,
      ...pyFieldChecks(fields, oCtx, v, at + 4, depth + 1),
    ];
  }
  if (type.kind === 'array') {
    const item = type.item;
    const head = [
      `${pad}if not isinstance(${v}, list):`,
      `${pad}    ${pyProblem(ctx, key, 'expected an array')}`,
    ];
    if (!item || item.kind === 'any') return head;
    const base = ctx.v === null ? pyStr(litPart(ctx, key)) : key === null && ctx.suffix === '' ? ctx.v : `${ctx.v} + ${pyStr(litPart(ctx, key))}`;
    const eCtx: PathCtx = { v: `_p${depth}`, suffix: '' };
    return [
      ...head,
      `${pad}else:`,
      `${pad}    for _i${depth}, _e${depth} in enumerate(${v}):`,
      `${pad}        _p${depth} = ${base} + '[' + str(_i${depth}) + ']'`,
      ...pyTypeChecks(`_e${depth}`, item, eCtx, null, at + 8, depth + 1),
    ];
  }
  const comment = type.kind === 'union'
    ? [`${pad}# union: matches at least one of ${commentSafe(typeLabel(type))}`]
    : [];
  return [
    ...comment,
    `${pad}if ${pyFailCond(v, type)}:`,
    `${pad}    ${pyProblem(ctx, key, problemFor(type))}`,
  ];
}

const problemFor = (type: ConfigFieldType): string => {
  if (type.kind === 'enum') return `expected one of ${commentSafe(typeLabel(type))}`;
  if (type.kind === 'union') return `matches none of ${commentSafe(typeLabel(type))}`;
  return KIND_PROBLEM[type.kind] ?? 'unacceptable value';
};

function pyFieldChecks(
  fields: readonly ConfigField[],
  ctx: PathCtx,
  obj: string,
  at: number,
  depth: number,
): string[] {
  const pad = ind(at);
  const lines: string[] = [];
  for (const field of fields) {
    const kl = pyStr(field.key);
    if (field.type.kind === 'any') {
      // any: whatever is present is accepted, null included.
      if (!field.optional) {
        lines.push(`${pad}if ${kl} not in ${obj}:`, `${pad}    ${pyProblem(ctx, field.key, 'missing required key')}`);
      }
      continue;
    }
    const v = `_v${depth}`;
    const body = [
      `${pad}    ${v} = ${obj}[${kl}]`,
      ...(field.nullable
        ? [
            `${pad}    if ${v} is not None:`,
            ...pyTypeChecks(v, field.type, ctx, field.key, at + 8, depth),
          ]
        : [
            `${pad}    if ${v} is None:`,
            `${pad}        ${pyProblem(ctx, field.key, 'null is not allowed')}`,
            `${pad}    else:`,
            ...pyTypeChecks(v, field.type, ctx, field.key, at + 8, depth),
          ]),
    ];
    if (field.optional) {
      lines.push(`${pad}if ${kl} in ${obj}:`, ...body);
    } else {
      lines.push(
        `${pad}if ${kl} not in ${obj}:`,
        `${pad}    ${pyProblem(ctx, field.key, 'missing required key')}`,
        `${pad}else:`,
        ...body,
      );
    }
  }
  return lines;
}

function pythonParser(template: ConfigCodeTemplate, fn: string): string {
  const formats = usedFormats(collectKinds(template.fields));
  const yaml = template.format === 'yaml';
  const docBody = [
    yaml
      ? 'Validate an already-decoded mapping and surface each field.'
      : 'Parse JSON text and validate every field of the document.',
    '',
    ...(yaml
      ? ['The stdlib has no YAML parser, so decoding is the caller\'s one line:', '``data = yaml.safe_load(text)``.', '']
      : []),
    'Parameters',
    '----------',
    yaml ? 'data : dict' : 'text : str',
    yaml ? '    The decoded document (for example from ``yaml.safe_load``).' : '    The JSON document text.',
    '',
    'Returns',
    '-------',
    'dict',
    '    The decoded document, unchanged.',
    '',
    'Raises',
    '------',
    'ValueError',
    '    When any rule below fails; the message lists every problem, one',
    '    per line. Unknown keys are reported too.',
    '',
    'Notes',
    '-----',
    'Fields (path (type): flags):',
    ...fieldDocRows(template.fields).map((row) => `  ${row}`),
    ...(formats.length > 0
      ? ['', 'Format values must match the compiled patterns at the top of this', 'module.']
      : []),
  ];
  // A stray backslash in a plain docstring is an invalid escape; raw fixes it.
  const rawPrefix = docBody.some((l) => l.includes('\\')) ? 'r' : '';
  const checks = pyFieldChecks(template.fields, ROOT_CTX, 'data', 4, 1);
  return [
    `"""${commentSafe(template.name) || 'Config'} parser. Generated by the config playground; stdlib only."""`,
    ...(yaml ? [] : ['import json']),
    ...(formats.length > 0 ? ['import re'] : []),
    ...(formats.length > 0
      ? [
          '',
          '# One compiled pattern per string format the schema uses.',
          ...formats.map((f) => `_${FORMAT_CONST[f]}_RE = re.compile(r'${FORMAT_PATTERNS[f]}')`),
        ]
      : []),
    '',
    '',
    yaml ? `def ${fn}(data) -> dict:` : `def ${fn}(text: str) -> dict:`,
    `    ${rawPrefix}"""${docBody[0]}`,
    ...docBody.slice(1).map((l) => (l ? `    ${l}` : '')),
    '    """',
    ...(yaml ? [] : ['    data = json.loads(text)']),
    `    if not isinstance(data, dict):`,
    `        raise ValueError('document: expected an object')`,
    '    problems = []',
    '    for _key in data:',
    `        if _key not in ${template.fields.length === 0 ? '()' : pyTuple(template.fields.map((f) => pyStr(f.key)))}:`,
    `            problems.append(str(_key) + ': unknown key')`,
    ...checks,
    '    if problems:',
    `        raise ValueError('\\n'.join(problems))`,
    '    return data',
    '',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// JavaScript parser
// ---------------------------------------------------------------------------

function jsProblem(ctx: PathCtx, key: string | null, msg: string): string {
  if (ctx.v === null) return `problems.push(${jsStr(litPart(ctx, key) + ': ' + msg)});`;
  return `problems.push(${ctx.v} + ${jsStr(litPart(ctx, key) + ': ' + msg)});`;
}

function jsFailCond(v: string, type: ConfigFieldType): string {
  switch (type.kind) {
    case 'string': return `typeof ${v} !== 'string'`;
    case 'integer': return `!Number.isInteger(${v})`;
    case 'number': return `typeof ${v} !== 'number'`;
    case 'boolean': return `typeof ${v} !== 'boolean'`;
    case 'enum':
      return `!(${(type.values ?? []).map((val) => `${v} === ${jsStr(String(val)) && JSON.stringify(val)}`).join(' || ')})`;
    case 'union':
      return `!(${(type.variants ?? []).map((t) => jsVariantCond(v, t)).join(' || ')})`;
    default:
      return `typeof ${v} !== 'string' || !_${FORMAT_CONST[type.kind as FormatKind]}_RE.test(${v})`;
  }
}

function jsVariantCond(v: string, type: ConfigFieldType): string {
  switch (type.kind) {
    case 'string': return `typeof ${v} === 'string'`;
    case 'integer': return `Number.isInteger(${v})`;
    case 'number': return `typeof ${v} === 'number'`;
    case 'boolean': return `typeof ${v} === 'boolean'`;
    case 'enum': return `(${(type.values ?? []).map((val) => `${v} === ${JSON.stringify(val)}`).join(' || ')})`;
    case 'object': return `(${v} !== null && typeof ${v} === 'object' && !Array.isArray(${v}))`;
    case 'array': return `Array.isArray(${v})`;
    case 'any': return 'true';
    case 'union': return `(${(type.variants ?? []).map((t) => jsVariantCond(v, t)).join(' || ')})`;
    default:
      return `(typeof ${v} === 'string' && _${FORMAT_CONST[type.kind as FormatKind]}_RE.test(${v}))`;
  }
}

function jsTypeChecks(
  v: string,
  type: ConfigFieldType,
  ctx: PathCtx,
  key: string | null,
  at: number,
  depth: number,
): string[] {
  const pad = ind(at);
  if (type.kind === 'any' || depth >= MAX_DEPTH) return [];
  if (type.kind === 'object') {
    const fields = type.fields ?? [];
    const oCtx: PathCtx = key === null ? { v: ctx.v, suffix: ctx.suffix } : childCtx(ctx, key);
    const prefixExpr =
      oCtx.v === null
        ? oCtx.suffix ? `${jsStr(oCtx.suffix)} + ` : ''
        : `${oCtx.v} + ${jsStr(oCtx.suffix + '.')} + `;
    return [
      `${pad}if (${v} === null || typeof ${v} !== 'object' || Array.isArray(${v})) {`,
      `${pad}  ${jsProblem(ctx, key, 'expected an object')}`,
      `${pad}} else {`,
      `${pad}  for (const _key of Object.keys(${v})) {`,
      `${pad}    if (![${fields.map((f) => jsStr(f.key)).join(', ')}].includes(_key)) {`,
      `${pad}      problems.push(${prefixExpr}_key + ': unknown key');`,
      `${pad}    }`,
      `${pad}  }`,
      ...jsFieldChecks(fields, oCtx, v, at + 2, depth + 1),
      `${pad}}`,
    ];
  }
  if (type.kind === 'array') {
    const item = type.item;
    const head = [
      `${pad}if (!Array.isArray(${v})) {`,
      `${pad}  ${jsProblem(ctx, key, 'expected an array')}`,
      `${pad}}`,
    ];
    if (!item || item.kind === 'any') return head;
    const base = ctx.v === null ? jsStr(litPart(ctx, key)) : key === null && ctx.suffix === '' ? ctx.v : `${ctx.v} + ${jsStr(litPart(ctx, key))}`;
    const eCtx: PathCtx = { v: `_p${depth}`, suffix: '' };
    head.pop();
    return [
      ...head,
      `${pad}} else {`,
      `${pad}  for (let _i${depth} = 0; _i${depth} < ${v}.length; _i${depth}++) {`,
      `${pad}    const _e${depth} = ${v}[_i${depth}];`,
      `${pad}    const _p${depth} = ${base} + '[' + _i${depth} + ']';`,
      ...jsTypeChecks(`_e${depth}`, item, eCtx, null, at + 4, depth + 1),
      `${pad}  }`,
      `${pad}}`,
    ];
  }
  const comment = type.kind === 'union'
    ? [`${pad}// union: matches at least one of ${commentSafe(typeLabel(type))}`]
    : [];
  return [
    ...comment,
    `${pad}if (${jsFailCond(v, type)}) {`,
    `${pad}  ${jsProblem(ctx, key, problemFor(type))}`,
    `${pad}}`,
  ];
}

function jsFieldChecks(
  fields: readonly ConfigField[],
  ctx: PathCtx,
  obj: string,
  at: number,
  depth: number,
): string[] {
  const pad = ind(at);
  const lines: string[] = [];
  for (const field of fields) {
    const kl = jsStr(field.key);
    if (field.type.kind === 'any') {
      if (!field.optional) {
        lines.push(
          `${pad}if (!(${kl} in ${obj})) {`,
          `${pad}  ${jsProblem(ctx, field.key, 'missing required key')}`,
          `${pad}}`,
        );
      }
      continue;
    }
    const v = `_v${depth}`;
    const body = [
      `${pad}  const ${v} = ${obj}[${kl}];`,
      ...(field.nullable
        ? [
            `${pad}  if (${v} !== null) {`,
            ...jsTypeChecks(v, field.type, ctx, field.key, at + 4, depth),
            `${pad}  }`,
          ]
        : [
            `${pad}  if (${v} === null) {`,
            `${pad}    ${jsProblem(ctx, field.key, 'null is not allowed')}`,
            `${pad}  } else {`,
            ...jsTypeChecks(v, field.type, ctx, field.key, at + 4, depth),
            `${pad}  }`,
          ]),
    ];
    if (field.optional) {
      lines.push(`${pad}if (${kl} in ${obj}) {`, ...body, `${pad}}`);
    } else {
      lines.push(
        `${pad}if (!(${kl} in ${obj})) {`,
        `${pad}  ${jsProblem(ctx, field.key, 'missing required key')}`,
        `${pad}} else {`,
        ...body,
        `${pad}}`,
      );
    }
  }
  return lines;
}

function javascriptParser(template: ConfigCodeTemplate, fn: string): string {
  const formats = usedFormats(collectKinds(template.fields));
  const yaml = template.format === 'yaml';
  const name = `parse${capitalize(fn)}`;
  return [
    ...(formats.length > 0
      ? [
          '// One pattern per string format the schema uses.',
          ...formats.map((f) => `const _${FORMAT_CONST[f]}_RE = /${FORMAT_PATTERNS[f]}/;`),
          '',
        ]
      : []),
    '/**',
    ` * ${commentSafe(template.name) || 'Config'}: ${yaml ? 'validate an already-decoded document' : 'parse and validate a JSON document'}.`,
    ' *',
    ...(yaml
      ? [' * JavaScript has no stdlib YAML parser, so this takes the DECODED object;', ' * decode with the YAML library of your choice first.', ' *']
      : []),
    ' * Fields (path (type): flags):',
    ...fieldDocRows(template.fields).map((row) => ` * - ${row}`),
    ' *',
    ` * @param {${yaml ? 'object' : 'string'}} ${yaml ? 'data' : 'text'} ${yaml ? 'The decoded document.' : 'JSON text of the document.'}`,
    ' * @returns {object} The decoded document, unchanged.',
    ' * @throws {Error} When any rule fails; the message lists every problem,',
    ' *   one per line. Unknown keys are reported too.',
    ' */',
    yaml ? `export function ${name}(data) {` : `export function ${name}(text) {`,
    ...(yaml ? [] : ['  const data = JSON.parse(text);']),
    `  if (data === null || typeof data !== 'object' || Array.isArray(data)) {`,
    `    throw new Error('document: expected an object');`,
    '  }',
    '  const problems = [];',
    '  for (const _key of Object.keys(data)) {',
    `    if (![${template.fields.map((f) => jsStr(f.key)).join(', ')}].includes(_key)) {`,
    `      problems.push(_key + ': unknown key');`,
    '    }',
    '  }',
    ...jsFieldChecks(template.fields, ROOT_CTX, 'data', 2, 1),
    '  if (problems.length > 0) {',
    `    throw new Error(problems.join('\\n'));`,
    '  }',
    '  return data;',
    '}',
    '',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Go parser
// ---------------------------------------------------------------------------

const goReName: Record<FormatKind, string> = {
  email: 'emailRe',
  phone: 'phoneRe',
  uri: 'uriRe',
  date: 'dateRe',
  'date-time': 'dateTimeRe',
};

const goEnumLit = (v: string | number | boolean): string => {
  if (typeof v === 'string') return goStr(v);
  if (typeof v === 'boolean') return String(v);
  // encoding/json decodes every number as float64, so compare as float64.
  return Number.isInteger(v) ? `${v}.0` : String(v);
};

function goProblem(ctx: PathCtx, key: string | null, msg: string): string {
  if (ctx.v === null) return `problems = append(problems, ${goStr(litPart(ctx, key) + ': ' + msg)})`;
  return `problems = append(problems, ${ctx.v}+${goStr(litPart(ctx, key) + ': ' + msg)})`;
}

function goTypeChecks(
  v: string,
  type: ConfigFieldType,
  ctx: PathCtx,
  key: string | null,
  at: string,
  depth: number,
): string[] {
  if (type.kind === 'any' || depth >= MAX_DEPTH) return [];
  switch (type.kind) {
    case 'string':
      return [`${at}if _, ok := ${v}.(string); !ok {`, `${at}\t${goProblem(ctx, key, problemFor(type))}`, `${at}}`];
    case 'integer':
      return [
        `${at}if f${depth}, ok := ${v}.(float64); !ok || f${depth} != float64(int64(f${depth})) {`,
        `${at}\t${goProblem(ctx, key, problemFor(type))}`,
        `${at}}`,
      ];
    case 'number':
      return [`${at}if _, ok := ${v}.(float64); !ok {`, `${at}\t${goProblem(ctx, key, problemFor(type))}`, `${at}}`];
    case 'boolean':
      return [`${at}if _, ok := ${v}.(bool); !ok {`, `${at}\t${goProblem(ctx, key, problemFor(type))}`, `${at}}`];
    case 'email':
    case 'phone':
    case 'uri':
    case 'date':
    case 'date-time':
      return [
        `${at}if s${depth}, ok := ${v}.(string); !ok || !${goReName[type.kind]}.MatchString(s${depth}) {`,
        `${at}\t${goProblem(ctx, key, problemFor(type))}`,
        `${at}}`,
      ];
    case 'enum':
      return [
        `${at}if ${(type.values ?? []).map((val) => `${v} != ${goEnumLit(val)}`).join(' && ')} {`,
        `${at}\t${goProblem(ctx, key, problemFor(type))}`,
        `${at}}`,
      ];
    case 'union': {
      const flag = `ok${depth}`;
      const setters = (type.variants ?? []).flatMap((t) => goVariantSetter(v, t, flag, at));
      return [
        `${at}// union: matches at least one of ${commentSafe(typeLabel(type))}`,
        `${at}${flag} := false`,
        ...setters,
        `${at}if !${flag} {`,
        `${at}\t${goProblem(ctx, key, problemFor(type))}`,
        `${at}}`,
      ];
    }
    case 'object': {
      const fields = type.fields ?? [];
      const oCtx: PathCtx = key === null ? { v: ctx.v, suffix: ctx.suffix } : childCtx(ctx, key);
      const prefixExpr =
        oCtx.v === null
          ? oCtx.suffix ? `${goStr(oCtx.suffix)}+` : ''
          : `${oCtx.v}+${goStr(oCtx.suffix + '.')}+`;
      const unknown =
        fields.length === 0
          ? [`${at}\tfor key := range obj${depth} {`, `${at}\t\tproblems = append(problems, ${prefixExpr}key+": unknown key")`, `${at}\t}`]
          : [
              `${at}\tfor key := range obj${depth} {`,
              `${at}\t\tif ${fields.map((f) => `key != ${goStr(f.key)}`).join(' && ')} {`,
              `${at}\t\t\tproblems = append(problems, ${prefixExpr}key+": unknown key")`,
              `${at}\t\t}`,
              `${at}\t}`,
            ];
      return [
        `${at}if obj${depth}, ok := ${v}.(map[string]any); !ok {`,
        `${at}\t${goProblem(ctx, key, 'expected an object')}`,
        `${at}} else {`,
        ...unknown,
        ...goFieldChecks(fields, oCtx, `obj${depth}`, `${at}\t`, depth + 1),
        `${at}}`,
      ];
    }
    case 'array': {
      const item = type.item;
      if (!item || item.kind === 'any') {
        return [`${at}if _, ok := ${v}.([]any); !ok {`, `${at}\t${goProblem(ctx, key, 'expected an array')}`, `${at}}`];
      }
      const base = ctx.v === null ? goStr(litPart(ctx, key)) : key === null && ctx.suffix === '' ? ctx.v : `${ctx.v}+${goStr(litPart(ctx, key))}`;
      const eCtx: PathCtx = { v: `p${depth}`, suffix: '' };
      return [
        `${at}if arr${depth}, ok := ${v}.([]any); !ok {`,
        `${at}\t${goProblem(ctx, key, 'expected an array')}`,
        `${at}} else {`,
        `${at}\tfor i${depth}, e${depth} := range arr${depth} {`,
        `${at}\t\tp${depth} := ${base} + "[" + strconv.Itoa(i${depth}) + "]"`,
        ...goTypeChecks(`e${depth}`, item, eCtx, null, `${at}\t\t`, depth + 1),
        `${at}\t}`,
        `${at}}`,
      ];
    }
  }
}

function goVariantSetter(v: string, type: ConfigFieldType, flag: string, at: string): string[] {
  switch (type.kind) {
    case 'string':
      return [`${at}if _, ok := ${v}.(string); ok {`, `${at}\t${flag} = true`, `${at}}`];
    case 'integer':
      return [`${at}if f, ok := ${v}.(float64); ok && f == float64(int64(f)) {`, `${at}\t${flag} = true`, `${at}}`];
    case 'number':
      return [`${at}if _, ok := ${v}.(float64); ok {`, `${at}\t${flag} = true`, `${at}}`];
    case 'boolean':
      return [`${at}if _, ok := ${v}.(bool); ok {`, `${at}\t${flag} = true`, `${at}}`];
    case 'enum':
      return [`${at}if ${(type.values ?? []).map((val) => `${v} == ${goEnumLit(val)}`).join(' || ')} {`, `${at}\t${flag} = true`, `${at}}`];
    case 'object':
      return [`${at}if _, ok := ${v}.(map[string]any); ok {`, `${at}\t${flag} = true`, `${at}}`];
    case 'array':
      return [`${at}if _, ok := ${v}.([]any); ok {`, `${at}\t${flag} = true`, `${at}}`];
    case 'any':
      return [`${at}${flag} = true`];
    case 'union':
      return (type.variants ?? []).flatMap((t) => goVariantSetter(v, t, flag, at));
    default:
      return [
        `${at}if s, ok := ${v}.(string); ok && ${goReName[type.kind]}.MatchString(s) {`,
        `${at}\t${flag} = true`,
        `${at}}`,
      ];
  }
}

function goFieldChecks(
  fields: readonly ConfigField[],
  ctx: PathCtx,
  obj: string,
  at: string,
  depth: number,
): string[] {
  const lines: string[] = [];
  for (const field of fields) {
    const kl = goStr(field.key);
    if (field.type.kind === 'any') {
      if (!field.optional) {
        lines.push(`${at}if _, ok := ${obj}[${kl}]; !ok {`, `${at}\t${goProblem(ctx, field.key, 'missing required key')}`, `${at}}`);
      }
      continue;
    }
    const v = `v${depth}`;
    const nullBranch = field.nullable
      ? [`${at}\tif ${v} != nil {`, ...goTypeChecks(v, field.type, ctx, field.key, `${at}\t\t`, depth), `${at}\t}`]
      : [
          `${at}\tif ${v} == nil {`,
          `${at}\t\t${goProblem(ctx, field.key, 'null is not allowed')}`,
          `${at}\t} else {`,
          ...goTypeChecks(v, field.type, ctx, field.key, `${at}\t\t`, depth),
          `${at}\t}`,
        ];
    if (field.optional) {
      lines.push(`${at}if ${v}, ok := ${obj}[${kl}]; ok {`, ...nullBranch, `${at}}`);
    } else {
      lines.push(
        `${at}if ${v}, ok := ${obj}[${kl}]; !ok {`,
        `${at}\t${goProblem(ctx, field.key, 'missing required key')}`,
        `${at}} else {`,
        ...nullBranch,
        `${at}}`,
      );
    }
  }
  return lines;
}

function goParser(template: ConfigCodeTemplate, fn: string): string {
  const kinds = collectKinds(template.fields);
  const formats = usedFormats(kinds);
  const yaml = template.format === 'yaml';
  const hasArrayLoops = goNeedsStrconv(template.fields, 0);
  const name = yaml ? `Validate${fn}` : `Parse${fn}`;
  const checks = [
    '\tfor key := range doc {',
    ...(template.fields.length === 0
      ? ['\t\tproblems = append(problems, key+": unknown key")']
      : [
          `\t\tif ${template.fields.map((f) => `key != ${goStr(f.key)}`).join(' && ')} {`,
          '\t\t\tproblems = append(problems, key+": unknown key")',
          '\t\t}',
        ]),
    '\t}',
    ...goFieldChecks(template.fields, ROOT_CTX, 'doc', '\t', 1),
  ];
  const imports = [
    ...(yaml ? [] : ['"encoding/json"']),
    '"errors"',
    ...(formats.length > 0 ? ['"regexp"'] : []),
    ...(hasArrayLoops ? ['"strconv"'] : []),
    '"strings"',
  ].sort();
  return [
    'package config',
    '',
    'import (',
    ...imports.map((i) => `\t${i}`),
    ')',
    '',
    ...(formats.length > 0
      ? [
          '// One pattern per string format the schema uses.',
          ...formats.map((f) => `var ${goReName[f]} = regexp.MustCompile(\`${FORMAT_PATTERNS[f]}\`)`),
          '',
        ]
      : []),
    `// ${name} ${yaml ? 'validates an already-decoded' : 'parses and validates a'} ${commentSafe(template.name) || 'config'} document.`,
    '//',
    ...(yaml
      ? ['// The stdlib has no YAML decoder; decode with gopkg.in/yaml.v3 first and', '// pass the resulting map. Every problem is reported, one per line, and', '// unknown keys are reported too.']
      : ['// Every problem is reported in one error, one per line, and unknown keys', '// are reported too.']),
    '//',
    '// Fields (path (type): flags):',
    ...fieldDocRows(template.fields).map((row) => `//  ${row}`),
    ...(yaml
      ? [`func ${name}(doc map[string]any) error {`]
      : [
          `func ${name}(data []byte) (map[string]any, error) {`,
          '\tvar doc map[string]any',
          '\tif err := json.Unmarshal(data, &doc); err != nil {',
          '\t\treturn nil, err',
          '\t}',
        ]),
    '\tvar problems []string',
    ...checks,
    '\tif len(problems) > 0 {',
    yaml
      ? '\t\treturn errors.New(strings.Join(problems, "\\n"))'
      : '\t\treturn nil, errors.New(strings.Join(problems, "\\n"))',
    '\t}',
    yaml ? '\treturn nil' : '\treturn doc, nil',
    '}',
    '',
  ].join('\n');
}

/** Whether any array with a checked item type exists (Go needs strconv). */
function goNeedsStrconv(fields: readonly ConfigField[], depth: number): boolean {
  if (depth >= MAX_DEPTH) return false;
  return fields.some((f) => typeNeedsStrconv(f.type, depth + 1));
}

function typeNeedsStrconv(type: ConfigFieldType, depth: number): boolean {
  if (depth >= MAX_DEPTH) return false;
  if (type.kind === 'array') return !!type.item && type.item.kind !== 'any';
  if (type.kind === 'object') return goNeedsStrconv(type.fields ?? [], depth);
  if (type.kind === 'union') return (type.variants ?? []).some((v) => typeNeedsStrconv(v, depth + 1));
  return false;
}

// ---------------------------------------------------------------------------
// Rust parser
// ---------------------------------------------------------------------------

const rustFormatFn: Record<FormatKind, string> = {
  email: 'is_email',
  phone: 'is_phone',
  uri: 'is_uri',
  date: 'is_date',
  'date-time': 'is_date_time',
};

/** Hand-rolled format checks: serde_json is the one allowed dependency, so no
 * regex crate. Lenient where a pattern would be strict, never the reverse. */
const RUST_FORMAT_HELPERS: Record<FormatKind, string> = {
  email: `fn is_email(s: &str) -> bool {
    let mut halves = s.splitn(2, '@');
    let local = halves.next().unwrap_or("");
    let domain = halves.next().unwrap_or("");
    !local.is_empty()
        && domain.contains('.')
        && !domain.starts_with('.')
        && !domain.ends_with('.')
        && !s.chars().any(|c| c.is_whitespace())
}`,
  phone: `fn is_phone(s: &str) -> bool {
    let digits = s.chars().filter(|c| c.is_ascii_digit()).count();
    digits >= 6
        && s.chars().next().map_or(false, |c| c.is_ascii_digit() || c == '+')
        && s.chars().all(|c| c.is_ascii_digit() || "+()-. ".contains(c))
}`,
  uri: `fn is_uri(s: &str) -> bool {
    match s.find(':') {
        Some(i) if i > 0 => {
            s[..i].chars().next().map_or(false, |c| c.is_ascii_alphabetic())
                && s[..i].chars().all(|c| c.is_ascii_alphanumeric() || "+.-".contains(c))
                && s.len() > i + 1
                && !s.chars().any(|c| c.is_whitespace())
        }
        _ => false,
    }
}`,
  date: `fn is_date(s: &str) -> bool {
    let b = s.as_bytes();
    b.len() == 10
        && b[4] == b'-'
        && b[7] == b'-'
        && [0usize, 1, 2, 3, 5, 6, 8, 9].iter().all(|&i| b[i].is_ascii_digit())
}`,
  'date-time': `fn is_date_time(s: &str) -> bool {
    // A date, a T or space, then at least HH:MM. Lenient about the tail
    // (seconds, fraction, zone) on purpose.
    if !s.get(..10).map_or(false, is_date) {
        return false;
    }
    let rest = s.get(10..).unwrap_or("").as_bytes();
    rest.len() >= 6
        && (rest[0] == b'T' || rest[0] == b' ')
        && rest[1].is_ascii_digit()
        && rest[2].is_ascii_digit()
        && rest[3] == b':'
        && rest[4].is_ascii_digit()
        && rest[5].is_ascii_digit()
}`,
};

function rustProblem(ctx: PathCtx, key: string | null, msg: string): string {
  if (ctx.v === null) return `problems.push(${rustStr(litPart(ctx, key) + ': ' + msg)}.to_string());`;
  return `problems.push(format!("{}{}", ${ctx.v}, ${rustStr(litPart(ctx, key) + ': ' + msg)}));`;
}

const rustF64Lit = (v: number): string => (Number.isInteger(v) ? `${v}.0` : String(v));

function rustFailCond(v: string, type: ConfigFieldType): string {
  switch (type.kind) {
    case 'string': return `!${v}.is_string()`;
    case 'integer': return `!(${v}.is_i64() || ${v}.is_u64())`;
    case 'number': return `!${v}.is_number()`;
    case 'boolean': return `!${v}.is_boolean()`;
    case 'enum': return `!(${(type.values ?? []).map((val) => rustEnumCond(v, val)).join(' || ')})`;
    case 'union': return `!(${(type.variants ?? []).map((t) => rustVariantCond(v, t)).join(' || ')})`;
    default:
      return `!${v}.as_str().map_or(false, ${rustFormatFn[type.kind as FormatKind]})`;
  }
}

const rustEnumCond = (v: string, val: string | number | boolean): string => {
  if (typeof val === 'string') return `${v}.as_str() == Some(${rustStr(val)})`;
  if (typeof val === 'boolean') return `${v}.as_bool() == Some(${val})`;
  return `${v}.as_f64() == Some(${rustF64Lit(val)})`;
};

function rustVariantCond(v: string, type: ConfigFieldType): string {
  switch (type.kind) {
    case 'string': return `${v}.is_string()`;
    case 'integer': return `(${v}.is_i64() || ${v}.is_u64())`;
    case 'number': return `${v}.is_number()`;
    case 'boolean': return `${v}.is_boolean()`;
    case 'enum': return `(${(type.values ?? []).map((val) => rustEnumCond(v, val)).join(' || ')})`;
    case 'object': return `${v}.is_object()`;
    case 'array': return `${v}.is_array()`;
    case 'any': return 'true';
    case 'union': return `(${(type.variants ?? []).map((t) => rustVariantCond(v, t)).join(' || ')})`;
    default:
      return `${v}.as_str().map_or(false, ${rustFormatFn[type.kind as FormatKind]})`;
  }
}

function rustTypeChecks(
  v: string,
  type: ConfigFieldType,
  ctx: PathCtx,
  key: string | null,
  at: number,
  depth: number,
): string[] {
  const pad = ind(at);
  if (type.kind === 'any' || depth >= MAX_DEPTH) return [];
  if (type.kind === 'object') {
    const fields = type.fields ?? [];
    const oCtx: PathCtx = key === null ? { v: ctx.v, suffix: ctx.suffix } : childCtx(ctx, key);
    const prefixArgs =
      oCtx.v === null
        ? `format!("{}{}{}", ${rustStr(oCtx.suffix)}, key, ": unknown key")`
        : `format!("{}{}{}{}", ${oCtx.v}, ${rustStr(oCtx.suffix + '.')}, key, ": unknown key")`;
    const unknown =
      fields.length === 0
        ? [`${pad}    for key in obj${depth}.keys() {`, `${pad}        problems.push(${prefixArgs});`, `${pad}    }`]
        : [
            `${pad}    for key in obj${depth}.keys() {`,
            `${pad}        if !(${fields.map((f) => `key.as_str() == ${rustStr(f.key)}`).join(' || ')}) {`,
            `${pad}            problems.push(${prefixArgs});`,
            `${pad}        }`,
            `${pad}    }`,
          ];
    return [
      `${pad}if let Some(obj${depth}) = ${v}.as_object() {`,
      ...unknown,
      ...rustFieldChecks(fields, oCtx, `obj${depth}`, at + 4, depth + 1),
      `${pad}} else {`,
      `${pad}    ${rustProblem(ctx, key, 'expected an object')}`,
      `${pad}}`,
    ];
  }
  if (type.kind === 'array') {
    const item = type.item;
    if (!item || item.kind === 'any') {
      return [
        `${pad}if !${v}.is_array() {`,
        `${pad}    ${rustProblem(ctx, key, 'expected an array')}`,
        `${pad}}`,
      ];
    }
    const base =
      ctx.v === null
        ? rustStr(litPart(ctx, key))
        : key === null && ctx.suffix === ''
          ? ctx.v
          : `format!("{}{}", ${ctx.v}, ${rustStr(litPart(ctx, key))})`;
    const eCtx: PathCtx = { v: `p${depth}`, suffix: '' };
    return [
      `${pad}if let Some(arr${depth}) = ${v}.as_array() {`,
      `${pad}    for (i${depth}, e${depth}) in arr${depth}.iter().enumerate() {`,
      `${pad}        let p${depth} = format!("{}[{}]", ${base}, i${depth});`,
      ...rustTypeChecks(`e${depth}`, item, eCtx, null, at + 8, depth + 1),
      `${pad}    }`,
      `${pad}} else {`,
      `${pad}    ${rustProblem(ctx, key, 'expected an array')}`,
      `${pad}}`,
    ];
  }
  const comment = type.kind === 'union'
    ? [`${pad}// union: matches at least one of ${commentSafe(typeLabel(type))}`]
    : [];
  return [
    ...comment,
    `${pad}if ${rustFailCond(v, type)} {`,
    `${pad}    ${rustProblem(ctx, key, problemFor(type))}`,
    `${pad}}`,
  ];
}

function rustFieldChecks(
  fields: readonly ConfigField[],
  ctx: PathCtx,
  obj: string,
  at: number,
  depth: number,
): string[] {
  const pad = ind(at);
  const lines: string[] = [];
  for (const field of fields) {
    const kl = rustStr(field.key);
    if (field.type.kind === 'any') {
      if (!field.optional) {
        lines.push(
          `${pad}if ${obj}.get(${kl}).is_none() {`,
          `${pad}    ${rustProblem(ctx, field.key, 'missing required key')}`,
          `${pad}}`,
        );
      }
      continue;
    }
    const v = `v${depth}`;
    const nullBranch = field.nullable
      ? [
          `${pad}    if !${v}.is_null() {`,
          ...rustTypeChecks(v, field.type, ctx, field.key, at + 8, depth),
          `${pad}    }`,
        ]
      : [
          `${pad}    if ${v}.is_null() {`,
          `${pad}        ${rustProblem(ctx, field.key, 'null is not allowed')}`,
          `${pad}    } else {`,
          ...rustTypeChecks(v, field.type, ctx, field.key, at + 8, depth),
          `${pad}    }`,
        ];
    if (field.optional) {
      lines.push(`${pad}if let Some(${v}) = ${obj}.get(${kl}) {`, ...nullBranch, `${pad}}`);
    } else {
      lines.push(
        `${pad}match ${obj}.get(${kl}) {`,
        `${pad}    None => ${rustProblem(ctx, field.key, 'missing required key')}`,
        `${pad}    Some(${v}) => {`,
        ...nullBranch.map((l) => `    ${l}`),
        `${pad}    }`,
        `${pad}}`,
      );
    }
  }
  return lines;
}

function rustParser(template: ConfigCodeTemplate, fn: string): string {
  const formats = usedFormats(collectKinds(template.fields));
  const yaml = template.format === 'yaml';
  const name = `parse_${fn}`;
  return [
    `// ${commentSafe(template.name) || 'Config'} parser. Generated by the config playground.`,
    '//',
    '// serde_json is the one dependency; it is Rust\'s de-facto JSON stdlib.',
    ...(yaml
      ? ['// This validates an already-decoded document: decode the YAML text with', '// serde_yaml into a serde_json::Value first and pass it here.']
      : []),
    '//',
    '// Fields (path (type): flags):',
    ...fieldDocRows(template.fields).map((row) => `//  ${row}`),
    '//',
    '// Every problem is reported, one entry per problem, and unknown keys are',
    '// reported too.',
    ...(formats.length > 0 ? ['', ...formats.map((f) => RUST_FORMAT_HELPERS[f]), ''] : ['']),
    yaml
      ? `pub fn ${name}(doc: serde_json::Value) -> Result<serde_json::Value, Vec<String>> {`
      : `pub fn ${name}(text: &str) -> Result<serde_json::Value, Vec<String>> {`,
    ...(yaml
      ? []
      : [
          '    let doc: serde_json::Value = match serde_json::from_str(text) {',
          '        Ok(value) => value,',
          '        Err(err) => return Err(vec![format!("document: {}", err)]),',
          '    };',
        ]),
    '    let mut problems: Vec<String> = Vec::new();',
    '    {',
    '        let root = match doc.as_object() {',
    '            Some(map) => map,',
    '            None => return Err(vec!["document: expected an object".to_string()]),',
    '        };',
    '        for key in root.keys() {',
    ...(template.fields.length === 0
      ? ['            problems.push(format!("{}{}", key, ": unknown key"));']
      : [
          `            if !(${template.fields.map((f) => `key.as_str() == ${rustStr(f.key)}`).join(' || ')}) {`,
          '                problems.push(format!("{}{}", key, ": unknown key"));',
          '            }',
        ]),
    '        }',
    ...rustFieldChecks(template.fields, ROOT_CTX, 'root', 8, 1),
    '    }',
    '    if problems.is_empty() {',
    '        Ok(doc)',
    '    } else {',
    '        Err(problems)',
    '    }',
    '}',
    '',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

/** Statements that produce a value, plus the expression naming it. */
interface GenValue {
  lines: string[];
  expr: string;
}

function pythonGenerator(template: ConfigCodeTemplate, fn: string): string {
  const kinds = collectKinds(template.fields);
  const formats = usedFormats(kinds);
  let counter = 0;
  const next = () => ++counter;

  const genValue = (type: ConfigFieldType, at: number, depth: number): GenValue => {
    const pad = ind(at);
    if (depth >= MAX_DEPTH) return { lines: [], expr: '_pick(rand, _WORDS)' };
    switch (type.kind) {
      case 'string':
      case 'any':
        return { lines: [], expr: '_pick(rand, _WORDS)' };
      case 'integer': return { lines: [], expr: 'int(rand() * 100)' };
      case 'number': return { lines: [], expr: 'int(rand() * 10000) / 100.0' };
      case 'boolean': return { lines: [], expr: 'rand() < 0.5' };
      case 'email': return { lines: [], expr: '_email(rand)' };
      case 'phone': return { lines: [], expr: '_phone(rand)' };
      case 'uri': return { lines: [], expr: '_uri(rand)' };
      case 'date': return { lines: [], expr: '_date(rand)' };
      case 'date-time': return { lines: [], expr: '_date_time(rand)' };
      case 'enum':
        return { lines: [], expr: `_pick(rand, [${(type.values ?? []).map(pyEnumLit).join(', ')}])` };
      case 'union': {
        const variants = type.variants ?? [];
        const n = next();
        const lines = [`${pad}_c${n} = int(rand() * ${variants.length})`];
        variants.forEach((variant, i) => {
          const head = i === 0 ? `if _c${n} == 0:` : i === variants.length - 1 ? 'else:' : `elif _c${n} == ${i}:`;
          const inner = genValue(variant, at + 4, depth + 1);
          lines.push(`${pad}${head}`, ...inner.lines, `${pad}    _t${n} = ${inner.expr}`);
        });
        return { lines, expr: `_t${n}` };
      }
      case 'object': {
        const n = next();
        const lines = [`${pad}_o${n} = {}`];
        for (const f of type.fields ?? []) lines.push(...genField(f, `_o${n}`, at, depth + 1));
        return { lines, expr: `_o${n}` };
      }
      case 'array': {
        const n = next();
        const item = genValue(type.item ?? { kind: 'any' }, at + 4, depth + 1);
        return {
          lines: [
            `${pad}_a${n} = []`,
            `${pad}for _i${n} in range(1 + int(rand() * 4)):`,
            ...item.lines,
            `${pad}    _a${n}.append(${item.expr})`,
          ],
          expr: `_a${n}`,
        };
      }
    }
  };

  const genField = (field: ConfigField, obj: string, at: number, depth: number): string[] => {
    let pad = ind(at);
    const lines: string[] = [];
    const kl = pyStr(field.key);
    let inner = at;
    if (field.optional) {
      lines.push(`${pad}if rand() < 0.8:`);
      inner += 4;
      pad = ind(inner);
    }
    if (field.nullable) {
      lines.push(`${pad}if rand() < 0.1:`, `${pad}    ${obj}[${kl}] = None`, `${pad}else:`);
      inner += 4;
    }
    const value = genValue(field.type, inner, depth);
    lines.push(...value.lines, `${ind(inner)}${obj}[${kl}] = ${value.expr}`);
    return lines;
  };

  const body = template.fields.flatMap((f) => genField(f, 'doc', 8, 1));
  return [
    `"""Deterministic sample ${commentSafe(template.name) || 'config'} documents. Generated by the config playground; stdlib only."""`,
    '',
    `_WORDS = [${WORD_BANK.words.map(pyStr).join(', ')}]`,
    `_FIRST_NAMES = [${WORD_BANK.firstNames.map(pyStr).join(', ')}]`,
    `_LAST_NAMES = [${WORD_BANK.lastNames.map(pyStr).join(', ')}]`,
    `_DOMAINS = [${WORD_BANK.domains.map(pyStr).join(', ')}]`,
    '',
    '',
    'def _mulberry32(seed):',
    '    """mulberry32, masked to 32 bits at every step; floats in [0, 1)."""',
    '    state = seed & 0xFFFFFFFF',
    '',
    '    def _next():',
    '        nonlocal state',
    '        state = (state + 0x6D2B79F5) & 0xFFFFFFFF',
    '        t = state',
    '        t = ((t ^ (t >> 15)) * (t | 1)) & 0xFFFFFFFF',
    '        t = (t ^ (t + (((t ^ (t >> 7)) * (t | 61)) & 0xFFFFFFFF))) & 0xFFFFFFFF',
    '        return ((t ^ (t >> 14)) & 0xFFFFFFFF) / 4294967296.0',
    '',
    '    return _next',
    '',
    '',
    'def _pick(rand, items):',
    '    return items[int(rand() * len(items))]',
    ...(kinds.has('email')
      ? [
          '',
          '',
          'def _email(rand):',
          "    return _pick(rand, _FIRST_NAMES).lower() + '.' + _pick(rand, _LAST_NAMES).lower() + '@' + _pick(rand, _DOMAINS)",
        ]
      : []),
    ...(kinds.has('phone')
      ? [
          '',
          '',
          'def _phone(rand):',
          '    # 555-01xx is the reserved fictional range.',
          "    return '555-01' + str(int(rand() * 10)) + str(int(rand() * 10))",
        ]
      : []),
    ...(kinds.has('uri')
      ? ['', '', 'def _uri(rand):', "    return 'https://' + _pick(rand, _DOMAINS) + '/' + _pick(rand, _WORDS)"]
      : []),
    ...(kinds.has('date') || kinds.has('date-time')
      ? [
          '',
          '',
          'def _date(rand):',
          "    return '%04d-%02d-%02d' % (2020 + int(rand() * 10), 1 + int(rand() * 12), 1 + int(rand() * 28))",
        ]
      : []),
    ...(kinds.has('date-time')
      ? [
          '',
          '',
          'def _date_time(rand):',
          "    return _date(rand) + 'T' + '%02d:%02d:%02d' % (int(rand() * 24), int(rand() * 60), int(rand() * 60)) + 'Z'",
        ]
      : []),
    '',
    '',
    `def ${fn}(count, seed):`,
    `    """Build \`count\` sample documents from \`seed\`.`,
    '',
    '    Same arguments, same documents: the PRNG is embedded, so a sample is',
    '    reproducible anywhere this file lands. Optional fields appear with',
    '    probability 0.8, nullable fields are null with probability 0.1, and',
    '    arrays carry 1-4 items.',
    '    """',
    '    rand = _mulberry32(seed)',
    '    docs = []',
    '    for _n in range(count):',
    '        doc = {}',
    ...body,
    '        docs.append(doc)',
    '    return docs',
    '',
  ].join('\n');
}

function javascriptGenerator(template: ConfigCodeTemplate, fn: string): string {
  const kinds = collectKinds(template.fields);
  let counter = 0;
  const next = () => ++counter;

  const genValue = (type: ConfigFieldType, at: number, depth: number): GenValue => {
    const pad = ind(at);
    if (depth >= MAX_DEPTH) return { lines: [], expr: '_pick(rand, _words)' };
    switch (type.kind) {
      case 'string':
      case 'any':
        return { lines: [], expr: '_pick(rand, _words)' };
      case 'integer': return { lines: [], expr: 'Math.floor(rand() * 100)' };
      case 'number': return { lines: [], expr: 'Math.floor(rand() * 10000) / 100' };
      case 'boolean': return { lines: [], expr: 'rand() < 0.5' };
      case 'email': return { lines: [], expr: '_email(rand)' };
      case 'phone': return { lines: [], expr: '_phone(rand)' };
      case 'uri': return { lines: [], expr: '_uri(rand)' };
      case 'date': return { lines: [], expr: '_date(rand)' };
      case 'date-time': return { lines: [], expr: '_dateTime(rand)' };
      case 'enum':
        return { lines: [], expr: `_pick(rand, [${(type.values ?? []).map((v) => JSON.stringify(v)).join(', ')}])` };
      case 'union': {
        const variants = type.variants ?? [];
        const n = next();
        const lines = [`${pad}let _t${n};`, `${pad}const _c${n} = Math.floor(rand() * ${variants.length});`];
        variants.forEach((variant, i) => {
          const head = i === 0 ? `if (_c${n} === 0) {` : i === variants.length - 1 ? '} else {' : `} else if (_c${n} === ${i}) {`;
          const inner = genValue(variant, at + 2, depth + 1);
          lines.push(`${pad}${head}`, ...inner.lines, `${pad}  _t${n} = ${inner.expr};`);
        });
        lines.push(`${pad}}`);
        return { lines, expr: `_t${n}` };
      }
      case 'object': {
        const n = next();
        const lines = [`${pad}const _o${n} = {};`];
        for (const f of type.fields ?? []) lines.push(...genField(f, `_o${n}`, at, depth + 1));
        return { lines, expr: `_o${n}` };
      }
      case 'array': {
        const n = next();
        const item = genValue(type.item ?? { kind: 'any' }, at + 2, depth + 1);
        return {
          lines: [
            `${pad}const _a${n} = [];`,
            `${pad}for (let _i${n} = 0, _n${n} = 1 + Math.floor(rand() * 4); _i${n} < _n${n}; _i${n}++) {`,
            ...item.lines,
            `${pad}  _a${n}.push(${item.expr});`,
            `${pad}}`,
          ],
          expr: `_a${n}`,
        };
      }
    }
  };

  const genField = (field: ConfigField, obj: string, at: number, depth: number): string[] => {
    const lines: string[] = [];
    let inner = at;
    const kl = jsStr(field.key);
    if (field.optional) {
      lines.push(`${ind(inner)}if (rand() < 0.8) {`);
      inner += 2;
    }
    if (field.nullable) {
      lines.push(`${ind(inner)}if (rand() < 0.1) {`, `${ind(inner)}  ${obj}[${kl}] = null;`, `${ind(inner)}} else {`);
      inner += 2;
    }
    const value = genValue(field.type, inner, depth);
    lines.push(...value.lines, `${ind(inner)}${obj}[${kl}] = ${value.expr};`);
    if (field.nullable) {
      inner -= 2;
      lines.push(`${ind(inner)}}`);
    }
    if (field.optional) {
      inner -= 2;
      lines.push(`${ind(inner)}}`);
    }
    return lines;
  };

  const body = template.fields.flatMap((f) => genField(f, 'doc', 4, 1));
  return [
    '/**',
    ` * Build \`count\` deterministic sample ${commentSafe(template.name) || 'config'} documents from \`seed\`.`,
    ' *',
    ' * Same arguments, same documents: the PRNG is embedded. Optional fields',
    ' * appear with probability 0.8, nullable fields are null with probability',
    ' * 0.1, and arrays carry 1-4 items.',
    ' *',
    ' * @param {number} count How many documents.',
    ' * @param {number} seed PRNG seed.',
    ' * @returns {object[]}',
    ' */',
    `export function ${fn}(count, seed) {`,
    '  const rand = _mulberry32(seed);',
    '  const docs = [];',
    '  for (let _n = 0; _n < count; _n++) {',
    '    const doc = {};',
    ...body,
    '    docs.push(doc);',
    '  }',
    '  return docs;',
    '}',
    '',
    'function _mulberry32(seed) {',
    '  // mulberry32; >>> 0 keeps every step in uint32 range.',
    '  let state = seed >>> 0;',
    '  return function () {',
    '    state = (state + 0x6d2b79f5) >>> 0;',
    '    let t = state;',
    '    t = Math.imul(t ^ (t >>> 15), t | 1) >>> 0;',
    '    t = (t ^ (t + Math.imul(t ^ (t >>> 7), t | 61))) >>> 0;',
    '    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;',
    '  };',
    '}',
    '',
    'function _pick(rand, items) {',
    '  return items[Math.floor(rand() * items.length)];',
    '}',
    '',
    `const _words = ${JSON.stringify(WORD_BANK.words)};`,
    `const _firstNames = ${JSON.stringify(WORD_BANK.firstNames)};`,
    `const _lastNames = ${JSON.stringify(WORD_BANK.lastNames)};`,
    `const _domains = ${JSON.stringify(WORD_BANK.domains)};`,
    ...(kinds.has('email')
      ? [
          '',
          'function _email(rand) {',
          "  return _pick(rand, _firstNames).toLowerCase() + '.' + _pick(rand, _lastNames).toLowerCase() + '@' + _pick(rand, _domains);",
          '}',
        ]
      : []),
    ...(kinds.has('phone')
      ? [
          '',
          'function _phone(rand) {',
          '  // 555-01xx is the reserved fictional range.',
          "  return '555-01' + Math.floor(rand() * 10) + Math.floor(rand() * 10);",
          '}',
        ]
      : []),
    ...(kinds.has('uri')
      ? ['', 'function _uri(rand) {', "  return 'https://' + _pick(rand, _domains) + '/' + _pick(rand, _words);", '}']
      : []),
    ...(kinds.has('date') || kinds.has('date-time')
      ? [
          '',
          'function _pad(n, width) {',
          "  return String(n).padStart(width, '0');",
          '}',
          '',
          'function _date(rand) {',
          "  return _pad(2020 + Math.floor(rand() * 10), 4) + '-' + _pad(1 + Math.floor(rand() * 12), 2) + '-' + _pad(1 + Math.floor(rand() * 28), 2);",
          '}',
        ]
      : []),
    ...(kinds.has('date-time')
      ? [
          '',
          'function _dateTime(rand) {',
          "  return _date(rand) + 'T' + _pad(Math.floor(rand() * 24), 2) + ':' + _pad(Math.floor(rand() * 60), 2) + ':' + _pad(Math.floor(rand() * 60), 2) + 'Z';",
          '}',
        ]
      : []),
    '',
  ].join('\n');
}

function goGenerator(template: ConfigCodeTemplate, fn: string): string {
  const kinds = collectKinds(template.fields);
  let counter = 0;
  const next = () => ++counter;

  const genValue = (type: ConfigFieldType, at: string, depth: number): GenValue => {
    if (depth >= MAX_DEPTH) return { lines: [], expr: 'pick(rand, words)' };
    switch (type.kind) {
      case 'string':
      case 'any':
        return { lines: [], expr: 'pick(rand, words)' };
      case 'integer': return { lines: [], expr: 'int(rand() * 100)' };
      case 'number': return { lines: [], expr: 'float64(int(rand()*10000)) / 100' };
      case 'boolean': return { lines: [], expr: 'rand() < 0.5' };
      case 'email': return { lines: [], expr: 'email(rand)' };
      case 'phone': return { lines: [], expr: 'phone(rand)' };
      case 'uri': return { lines: [], expr: 'uri(rand)' };
      case 'date': return { lines: [], expr: 'date(rand)' };
      case 'date-time': return { lines: [], expr: 'dateTime(rand)' };
      case 'enum': {
        const values = type.values ?? [];
        return { lines: [], expr: `[]any{${values.map(goEnumLit).join(', ')}}[int(rand()*${values.length})]` };
      }
      case 'union': {
        const variants = type.variants ?? [];
        const n = next();
        const lines = [
          `${at}var t${n} any`,
          `${at}switch int(rand() * ${variants.length}) {`,
        ];
        variants.forEach((variant, i) => {
          const inner = genValue(variant, `${at}\t`, depth + 1);
          lines.push(i === variants.length - 1 ? `${at}default:` : `${at}case ${i}:`, ...inner.lines, `${at}\tt${n} = ${inner.expr}`);
        });
        lines.push(`${at}}`);
        return { lines, expr: `t${n}` };
      }
      case 'object': {
        const n = next();
        const lines = [`${at}o${n} := map[string]any{}`];
        for (const f of type.fields ?? []) lines.push(...genField(f, `o${n}`, at, depth + 1));
        return { lines, expr: `o${n}` };
      }
      case 'array': {
        const n = next();
        const item = genValue(type.item ?? { kind: 'any' }, `${at}\t`, depth + 1);
        return {
          lines: [
            `${at}a${n} := []any{}`,
            `${at}n${n} := 1 + int(rand()*4)`,
            `${at}for i${n} := 0; i${n} < n${n}; i${n}++ {`,
            ...item.lines,
            `${at}\ta${n} = append(a${n}, ${item.expr})`,
            `${at}}`,
          ],
          expr: `a${n}`,
        };
      }
    }
  };

  const genField = (field: ConfigField, obj: string, at: string, depth: number): string[] => {
    const lines: string[] = [];
    let inner = at;
    const kl = goStr(field.key);
    if (field.optional) {
      lines.push(`${inner}if rand() < 0.8 {`);
      inner += '\t';
    }
    if (field.nullable) {
      lines.push(`${inner}if rand() < 0.1 {`, `${inner}\t${obj}[${kl}] = nil`, `${inner}} else {`);
      inner += '\t';
    }
    const value = genValue(field.type, inner, depth);
    lines.push(...value.lines, `${inner}${obj}[${kl}] = ${value.expr}`);
    if (field.nullable) {
      inner = inner.slice(0, -1);
      lines.push(`${inner}}`);
    }
    if (field.optional) {
      inner = inner.slice(0, -1);
      lines.push(`${inner}}`);
    }
    return lines;
  };

  const body = template.fields.flatMap((f) => genField(f, 'doc', '\t\t', 1));
  const needsFmt = kinds.has('date') || kinds.has('date-time');
  const needsStrings = kinds.has('email');
  const needsStrconv = kinds.has('phone');
  const imports = [
    ...(needsFmt ? ['"fmt"'] : []),
    ...(needsStrconv ? ['"strconv"'] : []),
    ...(needsStrings ? ['"strings"'] : []),
  ];
  const goList = (items: readonly string[]) => `[]string{${items.map(goStr).join(', ')}}`;
  return [
    'package config',
    '',
    ...(imports.length > 0 ? ['import (', ...imports.map((i) => `\t${i}`), ')', ''] : []),
    `var words = ${goList(WORD_BANK.words)}`,
    ...(kinds.has('email') ? [`var firstNames = ${goList(WORD_BANK.firstNames)}`, `var lastNames = ${goList(WORD_BANK.lastNames)}`] : []),
    ...(kinds.has('email') || kinds.has('uri') ? [`var domains = ${goList(WORD_BANK.domains)}`] : []),
    '',
    '// mulberry32; uint32 arithmetic wraps, which is exactly what it wants.',
    'func mulberry32(seed uint32) func() float64 {',
    '\tstate := seed',
    '\treturn func() float64 {',
    '\t\tstate += 0x6D2B79F5',
    '\t\tt := state',
    '\t\tt = (t ^ (t >> 15)) * (t | 1)',
    '\t\tt ^= t + (t^(t>>7))*(t|61)',
    '\t\treturn float64(t^(t>>14)) / 4294967296.0',
    '\t}',
    '}',
    '',
    'func pick(rand func() float64, items []string) string {',
    '\treturn items[int(rand()*float64(len(items)))]',
    '}',
    ...(kinds.has('email')
      ? [
          '',
          'func email(rand func() float64) string {',
          '\treturn strings.ToLower(pick(rand, firstNames)) + "." + strings.ToLower(pick(rand, lastNames)) + "@" + pick(rand, domains)',
          '}',
        ]
      : []),
    ...(kinds.has('phone')
      ? [
          '',
          '// phone stays in 555-01xx, the reserved fictional range.',
          'func phone(rand func() float64) string {',
          '\treturn "555-01" + strconv.Itoa(int(rand()*10)) + strconv.Itoa(int(rand()*10))',
          '}',
        ]
      : []),
    ...(kinds.has('uri')
      ? ['', 'func uri(rand func() float64) string {', '\treturn "https://" + pick(rand, domains) + "/" + pick(rand, words)', '}']
      : []),
    ...(kinds.has('date') || kinds.has('date-time')
      ? [
          '',
          'func date(rand func() float64) string {',
          '\treturn fmt.Sprintf("%04d-%02d-%02d", 2020+int(rand()*10), 1+int(rand()*12), 1+int(rand()*28))',
          '}',
        ]
      : []),
    ...(kinds.has('date-time')
      ? [
          '',
          'func dateTime(rand func() float64) string {',
          '\treturn date(rand) + fmt.Sprintf("T%02d:%02d:%02dZ", int(rand()*24), int(rand()*60), int(rand()*60))',
          '}',
        ]
      : []),
    '',
    `// ${fn} builds count deterministic sample ${commentSafe(template.name) || 'config'} documents from seed.`,
    '//',
    '// Same arguments, same documents: the PRNG is embedded. Optional fields',
    '// appear with probability 0.8, nullable fields are null with probability',
    '// 0.1, and arrays carry 1-4 items.',
    `func ${fn}(count int, seed uint32) []map[string]any {`,
    '\trand := mulberry32(seed)',
    '\tdocs := make([]map[string]any, 0, count)',
    '\tfor n := 0; n < count; n++ {',
    '\t\tdoc := map[string]any{}',
    ...body,
    '\t\tdocs = append(docs, doc)',
    '\t}',
    '\treturn docs',
    '}',
    '',
  ].join('\n');
}

function rustGenerator(template: ConfigCodeTemplate, fn: string): string {
  const kinds = collectKinds(template.fields);
  let counter = 0;
  const next = () => ++counter;

  // Every expr is a String holding JSON text; json_str escapes the data.
  const genValue = (type: ConfigFieldType, at: number, depth: number): GenValue => {
    const pad = ind(at);
    if (depth >= MAX_DEPTH) return { lines: [], expr: 'json_str(pick(&mut rand, &WORDS))' };
    switch (type.kind) {
      case 'string':
      case 'any':
        return { lines: [], expr: 'json_str(pick(&mut rand, &WORDS))' };
      case 'integer': return { lines: [], expr: '((rand() * 100.0) as i64).to_string()' };
      case 'number': return { lines: [], expr: '(((rand() * 10000.0) as i64 as f64) / 100.0).to_string()' };
      case 'boolean': return { lines: [], expr: '(rand() < 0.5).to_string()' };
      case 'email': return { lines: [], expr: 'json_str(&email(&mut rand))' };
      case 'phone': return { lines: [], expr: 'json_str(&phone(&mut rand))' };
      case 'uri': return { lines: [], expr: 'json_str(&uri(&mut rand))' };
      case 'date': return { lines: [], expr: 'json_str(&date(&mut rand))' };
      case 'date-time': return { lines: [], expr: 'json_str(&date_time(&mut rand))' };
      case 'enum': {
        // Values pre-encoded as JSON text, so a pick is just an index.
        const values = type.values ?? [];
        return {
          lines: [],
          expr: `[${values.map((v) => rustStr(JSON.stringify(v))).join(', ')}][(rand() * ${values.length}.0) as usize].to_string()`,
        };
      }
      case 'union': {
        const variants = type.variants ?? [];
        const n = next();
        const lines = [`${pad}let t${n} = match (rand() * ${variants.length}.0) as u32 {`];
        variants.forEach((variant, i) => {
          const inner = genValue(variant, at + 8, depth + 1);
          const arm = i === variants.length - 1 ? '_' : String(i);
          if (inner.lines.length === 0) {
            lines.push(`${pad}    ${arm} => ${inner.expr},`);
          } else {
            lines.push(`${pad}    ${arm} => {`, ...inner.lines, `${pad}        ${inner.expr}`, `${pad}    }`);
          }
        });
        lines.push(`${pad}};`);
        return { lines, expr: `t${n}` };
      }
      case 'object': {
        const n = next();
        const lines = [`${pad}let mut parts${n}: Vec<String> = Vec::new();`];
        for (const f of type.fields ?? []) lines.push(...genField(f, `parts${n}`, at, depth + 1));
        return { lines, expr: `format!("{{{}}}", parts${n}.join(", "))` };
      }
      case 'array': {
        const n = next();
        const item = genValue(type.item ?? { kind: 'any' }, at + 4, depth + 1);
        return {
          lines: [
            `${pad}let mut items${n}: Vec<String> = Vec::new();`,
            `${pad}let n${n} = 1 + (rand() * 4.0) as usize;`,
            `${pad}for _ in 0..n${n} {`,
            ...item.lines,
            `${pad}    items${n}.push(${item.expr});`,
            `${pad}}`,
          ],
          expr: `format!("[{}]", items${n}.join(", "))`,
        };
      }
    }
  };

  const genField = (field: ConfigField, parts: string, at: number, depth: number): string[] => {
    const lines: string[] = [];
    let inner = at;
    const kl = rustStr(field.key);
    if (field.optional) {
      lines.push(`${ind(inner)}if rand() < 0.8 {`);
      inner += 4;
    }
    if (field.nullable) {
      lines.push(
        `${ind(inner)}if rand() < 0.1 {`,
        `${ind(inner)}    ${parts}.push(format!("{}: null", json_str(${kl})));`,
        `${ind(inner)}} else {`,
      );
      inner += 4;
    }
    const value = genValue(field.type, inner, depth);
    lines.push(...value.lines, `${ind(inner)}${parts}.push(format!("{}: {}", json_str(${kl}), ${value.expr}));`);
    if (field.nullable) {
      inner -= 4;
      lines.push(`${ind(inner)}}`);
    }
    if (field.optional) {
      inner -= 4;
      lines.push(`${ind(inner)}}`);
    }
    return lines;
  };

  const body = template.fields.flatMap((f) => genField(f, 'parts', 8, 1));
  const rustList = (items: readonly string[]) =>
    `[${items.map(rustStr).join(', ')}]`;
  return [
    `// Deterministic sample ${commentSafe(template.name) || 'config'} documents as JSON text.`,
    '//',
    '// No dependencies at all: the documents are hand-built JSON strings, so',
    '// this file never needs serde. Same count and seed, same documents.',
    '// Optional fields appear with probability 0.8, nullable fields are null',
    '// with probability 0.1, and arrays carry 1-4 items.',
    '',
    `const WORDS: [&str; ${WORD_BANK.words.length}] = ${rustList(WORD_BANK.words)};`,
    ...(kinds.has('email')
      ? [
          `const FIRST_NAMES: [&str; ${WORD_BANK.firstNames.length}] = ${rustList(WORD_BANK.firstNames)};`,
          `const LAST_NAMES: [&str; ${WORD_BANK.lastNames.length}] = ${rustList(WORD_BANK.lastNames)};`,
        ]
      : []),
    ...(kinds.has('email') || kinds.has('uri')
      ? [`const DOMAINS: [&str; ${WORD_BANK.domains.length}] = ${rustList(WORD_BANK.domains)};`]
      : []),
    '',
    '/// mulberry32; wrapping_* keeps every step in u32 range.',
    'fn mulberry32(seed: u32) -> impl FnMut() -> f64 {',
    '    let mut state = seed;',
    '    move || {',
    '        state = state.wrapping_add(0x6D2B79F5);',
    '        let mut t = state;',
    '        t = (t ^ (t >> 15)).wrapping_mul(t | 1);',
    '        t ^= t.wrapping_add((t ^ (t >> 7)).wrapping_mul(t | 61));',
    '        ((t ^ (t >> 14)) as f64) / 4294967296.0',
    '    }',
    '}',
    '',
    "fn pick<'a>(rand: &mut impl FnMut() -> f64, items: &'a [&'a str]) -> &'a str {",
    '    items[(rand() * items.len() as f64) as usize]',
    '}',
    '',
    '/// A JSON string literal for `s`: quotes, backslashes and control',
    '/// characters escaped.',
    'fn json_str(s: &str) -> String {',
    '    let mut out = String::with_capacity(s.len() + 2);',
    "    out.push('\"');",
    '    for c in s.chars() {',
    '        match c {',
    '            \'"\' => out.push_str("\\\\\\""),',
    "            '\\\\' => out.push_str(\"\\\\\\\\\"),",
    "            '\\n' => out.push_str(\"\\\\n\"),",
    "            '\\r' => out.push_str(\"\\\\r\"),",
    "            '\\t' => out.push_str(\"\\\\t\"),",
    '            c if (c as u32) < 0x20 => out.push_str(&format!("\\\\u{:04x}", c as u32)),',
    '            c => out.push(c),',
    '        }',
    '    }',
    "    out.push('\"');",
    '    out',
    '}',
    ...(kinds.has('email')
      ? [
          '',
          'fn email(rand: &mut impl FnMut() -> f64) -> String {',
          '    format!(',
          '        "{}.{}@{}",',
          '        pick(rand, &FIRST_NAMES).to_lowercase(),',
          '        pick(rand, &LAST_NAMES).to_lowercase(),',
          '        pick(rand, &DOMAINS)',
          '    )',
          '}',
        ]
      : []),
    ...(kinds.has('phone')
      ? [
          '',
          '/// 555-01xx is the reserved fictional range.',
          'fn phone(rand: &mut impl FnMut() -> f64) -> String {',
          '    format!("555-01{}{}", (rand() * 10.0) as u32, (rand() * 10.0) as u32)',
          '}',
        ]
      : []),
    ...(kinds.has('uri')
      ? [
          '',
          'fn uri(rand: &mut impl FnMut() -> f64) -> String {',
          '    format!("https://{}/{}", pick(rand, &DOMAINS), pick(rand, &WORDS))',
          '}',
        ]
      : []),
    ...(kinds.has('date') || kinds.has('date-time')
      ? [
          '',
          'fn date(rand: &mut impl FnMut() -> f64) -> String {',
          '    format!(',
          '        "{:04}-{:02}-{:02}",',
          '        2020 + (rand() * 10.0) as u32,',
          '        1 + (rand() * 12.0) as u32,',
          '        1 + (rand() * 28.0) as u32',
          '    )',
          '}',
        ]
      : []),
    ...(kinds.has('date-time')
      ? [
          '',
          'fn date_time(rand: &mut impl FnMut() -> f64) -> String {',
          '    format!(',
          '        "{}T{:02}:{:02}:{:02}Z",',
          '        date(rand),',
          '        (rand() * 24.0) as u32,',
          '        (rand() * 60.0) as u32,',
          '        (rand() * 60.0) as u32',
          '    )',
          '}',
        ]
      : []),
    '',
    `pub fn ${fn}(count: usize, seed: u32) -> Vec<String> {`,
    '    let mut rand = mulberry32(seed);',
    '    let mut docs: Vec<String> = Vec::with_capacity(count);',
    '    for _ in 0..count {',
    '        let mut parts: Vec<String> = Vec::new();',
    ...body,
    '        docs.push(format!("{{{}}}", parts.join(", ")));',
    '    }',
    '    docs',
    '}',
    '',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/** Emit the whole file for one schema, language and flavor. */
export function generateConfigFunction(
  template: ConfigCodeTemplate,
  language: Language,
  flavor: ConfigFlavor,
): string {
  const fn = functionName(template.name, language);
  if (flavor === 'parser') {
    switch (language) {
      case 'python': return pythonParser(template, `parse_${fn}`);
      case 'javascript': return javascriptParser(template, fn);
      case 'go': return goParser(template, fn);
      case 'rust': return rustParser(template, fn);
    }
  }
  switch (language) {
    case 'python': return pythonGenerator(template, `generate_${fn}`);
    case 'javascript': return javascriptGenerator(template, `generate${capitalize(fn)}`);
    case 'go': return goGenerator(template, `Generate${fn}`);
    case 'rust': return rustGenerator(template, `generate_${fn}`);
  }
}

// ---------------------------------------------------------------------------
// The shared JavaScript runtime
// ---------------------------------------------------------------------------

/**
 * Hand-written JavaScript source, one exported table (the HELPER_SOURCE
 * pattern), so the web component and anything else that ships this logic
 * share ONE copy. `validate` and `generate` are data-driven interpreters over
 * the ConfigField JSON shape, mirroring src/lib/config/validate.ts and
 * generate.ts; `toYaml` is a minimal emitter for plain JSON data, documented
 * as good enough for generated samples and no more.
 */
export const CONFIG_JS_RUNTIME: {
  formats: string;
  prng: string;
  words: string;
  validate: string;
  generate: string;
  toYaml: string;
} = {
  formats: `const _FORMATS = {
  email: /${FORMAT_PATTERNS.email}/,
  phone: /${FORMAT_PATTERNS.phone}/,
  uri: /${FORMAT_PATTERNS.uri}/,
  date: /${FORMAT_PATTERNS.date}/,
  'date-time': /${FORMAT_PATTERNS['date-time']}/,
};`,

  prng: `function _mulberry32(seed) {
  // mulberry32; >>> 0 keeps every step in uint32 range.
  let state = seed >>> 0;
  return function () {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1) >>> 0;
    t = (t ^ (t + Math.imul(t ^ (t >>> 7), t | 61))) >>> 0;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}`,

  words: `const _words = ${JSON.stringify(WORD_BANK.words)};
const _firstNames = ${JSON.stringify(WORD_BANK.firstNames)};
const _lastNames = ${JSON.stringify(WORD_BANK.lastNames)};
const _domains = ${JSON.stringify(WORD_BANK.domains)};`,

  validate: `function _validate(data, fields) {
  // Issues as {path, message, severity}, mirroring the app's validate.ts:
  // unknown keys are warnings, everything else is an error.
  var issues = [];
  var push = function (path, message, severity) {
    issues.push({ path: path, message: message, severity: severity });
  };
  var matches = function (value, type) {
    switch (type.kind) {
      case 'any': return true;
      case 'string': return typeof value === 'string';
      case 'integer': return Number.isInteger(value);
      case 'number': return typeof value === 'number';
      case 'boolean': return typeof value === 'boolean';
      case 'enum': return (type.values || []).some(function (v) { return v === value; });
      case 'union': return (type.variants || []).some(function (v) { return matches(value, v); });
      case 'object': return value !== null && typeof value === 'object' && !Array.isArray(value);
      case 'array': return Array.isArray(value);
      default: return typeof value === 'string' && _FORMATS[type.kind].test(value);
    }
  };
  var checkValue = function (value, type, path, depth) {
    if (depth >= 16) return;
    if (value === null) {
      if (type.kind !== 'any') push(path, 'null is not allowed', 'error');
      return;
    }
    switch (type.kind) {
      case 'any': return;
      case 'string':
        if (typeof value !== 'string') push(path, 'expected a string', 'error');
        return;
      case 'integer':
        if (!Number.isInteger(value)) push(path, 'expected an integer', 'error');
        return;
      case 'number':
        if (typeof value !== 'number') push(path, 'expected a number', 'error');
        return;
      case 'boolean':
        if (typeof value !== 'boolean') push(path, 'expected a boolean', 'error');
        return;
      case 'email':
        if (typeof value !== 'string' || !_FORMATS.email.test(value)) push(path, 'expected an email address', 'error');
        return;
      case 'phone':
        if (typeof value !== 'string' || !_FORMATS.phone.test(value)) push(path, 'expected a phone number', 'error');
        return;
      case 'uri':
        if (typeof value !== 'string' || !_FORMATS.uri.test(value)) push(path, 'expected a URI', 'error');
        return;
      case 'date':
        if (typeof value !== 'string' || !_FORMATS.date.test(value)) push(path, 'expected a date (YYYY-MM-DD)', 'error');
        return;
      case 'date-time':
        if (typeof value !== 'string' || !_FORMATS['date-time'].test(value)) push(path, 'expected a date-time (ISO 8601)', 'error');
        return;
      case 'enum':
        if (!(type.values || []).some(function (v) { return v === value; })) push(path, 'not one of the allowed values', 'error');
        return;
      case 'union':
        if (!(type.variants || []).some(function (v) { return matches(value, v); })) push(path, 'matches no variant', 'error');
        return;
      case 'object':
        if (typeof value !== 'object' || Array.isArray(value)) {
          push(path, 'expected an object', 'error');
        } else {
          checkFields(value, type.fields || [], path + '.', depth + 1);
        }
        return;
      case 'array':
        if (!Array.isArray(value)) {
          push(path, 'expected an array', 'error');
        } else if (type.item && type.item.kind !== 'any') {
          for (var i = 0; i < value.length; i++) {
            checkValue(value[i], type.item, path + '[' + i + ']', depth + 1);
          }
        }
        return;
    }
  };
  var checkFields = function (obj, fieldList, base, depth) {
    if (depth >= 16) return;
    var known = fieldList.map(function (f) { return f.key; });
    for (var key in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, key) && known.indexOf(key) === -1) {
        push(base + key, 'unknown key', 'warning');
      }
    }
    for (var i = 0; i < fieldList.length; i++) {
      var field = fieldList[i];
      var path = base + field.key;
      if (!(field.key in obj)) {
        if (!field.optional) push(path, 'missing required key', 'error');
        continue;
      }
      var value = obj[field.key];
      if (value === null) {
        if (!field.nullable && field.type.kind !== 'any') push(path, 'null is not allowed', 'error');
        continue;
      }
      checkValue(value, field.type, path, depth);
    }
  };
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    push('', 'expected an object', 'error');
    return issues;
  }
  checkFields(data, fields, '', 0);
  return issues;
}`,

  generate: `function _generate(fields, count, seed) {
  // Deterministic sample documents, mirroring the app's generate.ts
  // probabilities: optional present at 0.8, nullable null at 0.1, arrays
  // carry 1-4 items.
  var rand = _mulberry32(seed);
  var pick = function (items) { return items[Math.floor(rand() * items.length)]; };
  var pad = function (n, width) { return String(n).padStart(width, '0'); };
  var makeDate = function () {
    return pad(2020 + Math.floor(rand() * 10), 4) + '-' + pad(1 + Math.floor(rand() * 12), 2) + '-' + pad(1 + Math.floor(rand() * 28), 2);
  };
  var value = function (type, depth) {
    if (depth >= 16) return pick(_words);
    switch (type.kind) {
      case 'integer': return Math.floor(rand() * 100);
      case 'number': return Math.floor(rand() * 10000) / 100;
      case 'boolean': return rand() < 0.5;
      case 'email': return pick(_firstNames).toLowerCase() + '.' + pick(_lastNames).toLowerCase() + '@' + pick(_domains);
      case 'phone': return '555-01' + Math.floor(rand() * 10) + Math.floor(rand() * 10);
      case 'uri': return 'https://' + pick(_domains) + '/' + pick(_words);
      case 'date': return makeDate();
      case 'date-time':
        return makeDate() + 'T' + pad(Math.floor(rand() * 24), 2) + ':' + pad(Math.floor(rand() * 60), 2) + ':' + pad(Math.floor(rand() * 60), 2) + 'Z';
      case 'enum': return pick(type.values && type.values.length ? type.values : _words);
      case 'union': return value(pick(type.variants && type.variants.length ? type.variants : [{ kind: 'any' }]), depth + 1);
      case 'object': return object(type.fields || [], depth + 1);
      case 'array': {
        var out = [];
        var n = 1 + Math.floor(rand() * 4);
        for (var i = 0; i < n; i++) out.push(value(type.item || { kind: 'any' }, depth + 1));
        return out;
      }
      default: return pick(_words);
    }
  };
  var object = function (fieldList, depth) {
    var doc = {};
    if (depth >= 16) return doc;
    for (var i = 0; i < fieldList.length; i++) {
      var field = fieldList[i];
      if (field.optional && !(rand() < 0.8)) continue;
      if (field.nullable && rand() < 0.1) {
        doc[field.key] = null;
        continue;
      }
      doc[field.key] = value(field.type, depth);
    }
    return doc;
  };
  var docs = [];
  for (var n = 0; n < count; n++) docs.push(object(fields, 0));
  return docs;
}`,

  toYaml: `function _toYaml(value) {
  // Minimal YAML for plain JSON data: scalars, maps and sequences with
  // 2-space indent. Strings that could read back as something else (booleans,
  // numbers, null, leading/trailing spaces, specials) are JSON-quoted, which
  // YAML accepts verbatim. Good enough for generated sample documents;
  // not a general-purpose emitter.
  var plain = /^[A-Za-z0-9][A-Za-z0-9_. \\/-]*$/;
  var lookalike = /^(true|false|yes|no|on|off|null|~|[-+]?[0-9][0-9_]*|[-+]?[0-9]*\\.[0-9]+([eE][-+]?[0-9]+)?|[-+]?[0-9]+[eE][-+]?[0-9]+|[-+]?\\.inf|\\.nan)$/i;
  var scalar = function (v) {
    if (v === null) return 'null';
    if (typeof v === 'boolean' || typeof v === 'number') return String(v);
    var s = String(v);
    if (plain.test(s) && !lookalike.test(s) && !/ $/.test(s)) return s;
    return JSON.stringify(s);
  };
  var lines = function (v, indent) {
    var pad = '';
    for (var i = 0; i < indent; i++) pad += '  ';
    if (Array.isArray(v)) {
      if (v.length === 0) return [pad + '[]'];
      var seq = [];
      for (var j = 0; j < v.length; j++) {
        if (v[j] !== null && typeof v[j] === 'object') {
          seq.push(pad + '-');
          seq.push.apply(seq, lines(v[j], indent + 1));
        } else {
          seq.push(pad + '- ' + scalar(v[j]));
        }
      }
      return seq;
    }
    if (v !== null && typeof v === 'object') {
      var keys = Object.keys(v);
      if (keys.length === 0) return [pad + '{}'];
      var map = [];
      for (var k = 0; k < keys.length; k++) {
        var item = v[keys[k]];
        if (item !== null && typeof item === 'object') {
          var child = lines(item, indent + 1);
          if (child.length === 1 && (child[0].trim() === '{}' || child[0].trim() === '[]')) {
            map.push(pad + scalar(keys[k]) + ': ' + child[0].trim());
          } else {
            map.push(pad + scalar(keys[k]) + ':');
            map.push.apply(map, child);
          }
        } else {
          map.push(pad + scalar(keys[k]) + ': ' + scalar(item));
        }
      }
      return map;
    }
    return [pad + scalar(v)];
  };
  return lines(value, 0).join('\\n');
}`,
};
