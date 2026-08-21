/**
 * The config playground's document validator: a pasted or generated document
 * checked against a ConfigField schema, producing a flat list of issues.
 *
 * This is a small recursive interpreter on purpose — ajv compiles schemas with
 * `new Function`, which a strict CSP forbids, and fourteen kinds do not need a
 * compiler. Severity has two levels: schema violations are errors; keys the
 * schema does not know about are warnings, because extra keys usually mean the
 * schema is incomplete, not that the document is wrong.
 */
import type { ConfigField, ConfigFieldType } from '../db/types';
import { MAX_DEPTH, typeLabel } from './model';
import { matchesFormat, type StringFormat } from './formats';

export interface ConfigIssue {
  path: string;
  message: string;
  severity: 'error' | 'warning';
}

/** What a scalar kind's error message says it wanted. */
const EXPECTED: Partial<Record<string, string>> = {
  string: 'a string',
  integer: 'an integer',
  number: 'a number',
  boolean: 'a boolean',
  email: 'an email address',
  phone: 'a phone number',
  uri: 'a URI',
  date: 'a date (YYYY-MM-DD)',
  'date-time': 'a date-time (ISO 8601)',
};

/**
 * Validate a document against a schema's root fields. The root may be one
 * object or an array of objects (a config file or a list of records); anything
 * else is rejected outright.
 */
export function validateDocument(doc: unknown, fields: readonly ConfigField[]): ConfigIssue[] {
  const issues: ConfigIssue[] = [];
  if (isPlainObject(doc)) {
    checkObject(doc, fields, '', 0, issues);
  } else if (Array.isArray(doc)) {
    doc.forEach((entry, i) => {
      if (isPlainObject(entry)) {
        checkObject(entry, fields, `[${i}]`, 0, issues);
      } else {
        error(issues, `[${i}]`, `[${i}] must be an object, got ${show(entry)}`);
      }
    });
  } else {
    error(issues, '', 'the document must be an object or an array of objects');
  }
  return issues;
}

/** One object level: presence, nullability, then the type of each known key,
 * and a warning for each key the schema does not mention. */
function checkObject(
  value: Record<string, unknown>,
  fields: readonly ConfigField[],
  prefix: string,
  depth: number,
  issues: ConfigIssue[],
): void {
  // Past the cap we accept silently: the cap protects the walker from junk
  // (a hand-edited backup, a hostile paste), not the user from their data —
  // a complaint about level 17 of a document nobody can author honestly
  // would only confuse.
  if (depth >= MAX_DEPTH) return;
  for (const field of fields) {
    const path = prefix === '' ? field.key : `${prefix}.${field.key}`;
    const present =
      Object.prototype.hasOwnProperty.call(value, field.key) && value[field.key] !== undefined;
    if (!present) {
      if (!field.optional) error(issues, path, `${path} is missing`);
      continue;
    }
    const item = value[field.key];
    if (item === null) {
      if (!field.nullable) {
        error(issues, path, `${path} is null, but the schema does not allow null`);
      }
      continue;
    }
    checkValue(item, field.type, path, depth, issues);
  }
  const known = new Set(fields.map((f) => f.key));
  for (const key of Object.keys(value)) {
    if (known.has(key)) continue;
    const path = prefix === '' ? key : `${prefix}.${key}`;
    issues.push({ path, message: `${path} is not in the schema`, severity: 'warning' });
  }
}

/** One value against one type node. `value` is never null/undefined here for
 * object fields (checkObject handles those), but array elements and union
 * probes can still hand us anything. */
function checkValue(
  value: unknown,
  type: ConfigFieldType,
  path: string,
  depth: number,
  issues: ConfigIssue[],
): void {
  if (depth >= MAX_DEPTH) return; // same silent acceptance as checkObject
  switch (type.kind) {
    case 'string':
      if (typeof value !== 'string') fail(issues, path, type, value);
      return;
    case 'boolean':
      if (typeof value !== 'boolean') fail(issues, path, type, value);
      return;
    case 'number':
      if (typeof value !== 'number') fail(issues, path, type, value);
      return;
    case 'integer':
      if (typeof value !== 'number' || !Number.isInteger(value)) fail(issues, path, type, value);
      return;
    case 'email':
    case 'phone':
    case 'uri':
    case 'date':
    case 'date-time':
      if (typeof value !== 'string' || !matchesFormat(value, type.kind as StringFormat)) {
        fail(issues, path, type, value);
      }
      return;
    case 'enum': {
      const values = type.values ?? [];
      if (!values.some((v) => v === value)) {
        error(issues, path, `${path} must be ${typeLabel(type)}, got ${show(value)}`);
      }
      return;
    }
    case 'array': {
      if (!Array.isArray(value)) {
        error(issues, path, `${path} must be an array, got ${show(value)}`);
        return;
      }
      const item = type.item ?? { kind: 'any' as const };
      value.forEach((entry, i) => checkValue(entry, item, `${path}[${i}]`, depth + 1, issues));
      return;
    }
    case 'object':
      if (!isPlainObject(value)) {
        error(issues, path, `${path} must be an object, got ${show(value)}`);
        return;
      }
      checkObject(value, type.fields ?? [], path, depth + 1, issues);
      return;
    case 'union': {
      const variants = type.variants ?? [];
      // A union with no variants only comes from junk that skipped
      // normalizeType; treat it as `any` rather than reject everything.
      if (variants.length === 0) return;
      for (const variant of variants) {
        const probe: ConfigIssue[] = [];
        checkValue(value, variant, path, depth, probe);
        if (!probe.some((issue) => issue.severity === 'error')) {
          issues.push(...probe); // matched: keep its warnings (extra keys, etc.)
          return;
        }
      }
      const allowed = variants.map(typeLabel).join(' or ');
      error(issues, path, `${path} must be ${allowed}, got ${show(value)}`);
      return;
    }
    case 'any':
      // `any` promises nothing, but undefined is not a JSON value at all.
      if (value === undefined) error(issues, path, `${path} must not be undefined`);
      return;
  }
}

function fail(issues: ConfigIssue[], path: string, type: ConfigFieldType, value: unknown): void {
  const expected = EXPECTED[type.kind] ?? type.kind;
  error(issues, path, `${path} must be ${expected}, got ${show(value)}`);
}

function error(issues: ConfigIssue[], path: string, message: string): void {
  issues.push({ path, message, severity: 'error' });
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Render a value for a message: scalars via JSON.stringify capped at ~40
 * chars, structures as a tag — a hostile 10 MB string must not become a
 * 10 MB issue message. */
function show(value: unknown): string {
  if (Array.isArray(value)) return '[array]';
  if (typeof value === 'object' && value !== null) return '[object]';
  const text = JSON.stringify(value) ?? String(value); // undefined has no JSON
  return text.length > 40 ? `${text.slice(0, 39)}…` : text;
}
