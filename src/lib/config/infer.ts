/**
 * Schema inference for the config playground: turn a parsed JSON/YAML document
 * into the ConfigField tree that the Field/Type table edits.
 *
 * Hand-rolled on purpose: the output has to be exactly the ConfigFieldType
 * vocabulary, and the interesting decisions — enum thresholds, format
 * detection, optional-vs-nullable — are policy, not plumbing. Every walker
 * carries the same MAX_DEPTH cap as model.ts because the document is pasted,
 * untrusted input.
 */
import type { ConfigField, ConfigFieldType } from '../db/types';
import { MAX_DEPTH } from './model';
import { detectFormat } from './formats';

/** Samples examined per field list; a 10k-row export infers like a 200-row one. */
const SAMPLE_CAP = 200;

/** Elements pooled across sample arrays when inferring one item type. */
const ELEMENT_CAP = 500;

/** Plain objects only (prototype Object.prototype or null) — YAML parsers can
 * hand back Dates and richer classes, and typing one as `object` would
 * "infer" an empty shape from its lack of enumerable keys. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * What a parsed document offers as samples: an object is one sample, an array
 * of objects is one sample per element. Anything else — scalars, mixed
 * arrays, an empty array — has no keys to infer fields from, so the caller
 * gets a sentence to show instead.
 */
export function documentSamples(
  doc: unknown,
): { samples: Record<string, unknown>[] } | { error: string } {
  if (isPlainObject(doc)) return { samples: [doc] };
  if (Array.isArray(doc)) {
    if (doc.length === 0) {
      return { error: 'The document is an empty array, so there are no objects to infer from.' };
    }
    if (doc.every(isPlainObject)) return { samples: [...doc] };
  }
  return { error: 'The document must be an object or an array of objects.' };
}

/**
 * Infer one field per key seen across the samples, in first-seen order.
 * `optional` = the key is missing from at least one sample; `nullable` = it
 * held null in at least one sample where present. The two never blur: a null
 * contributes nothing to the field's type, only to `nullable`.
 */
export function inferFields(samples: readonly Record<string, unknown>[]): ConfigField[] {
  return inferFieldList(samples, 0);
}

function inferFieldList(
  samples: readonly Record<string, unknown>[],
  depth: number,
): ConfigField[] {
  if (depth >= MAX_DEPTH) return [];
  const considered = samples.slice(0, SAMPLE_CAP);
  // A Map, not a record: '__proto__' is a legal document key.
  const byKey = new Map<string, { present: number; nullable: boolean; values: unknown[] }>();
  for (const sample of considered) {
    for (const key of Object.keys(sample)) {
      const value = sample[key];
      // A key holding `undefined` counts as absent: JSON could never
      // round-trip it, so "optional" is the honest reading.
      if (value === undefined) continue;
      let entry = byKey.get(key);
      if (!entry) {
        entry = { present: 0, nullable: false, values: [] };
        byKey.set(key, entry);
      }
      entry.present += 1;
      if (value === null) entry.nullable = true;
      else entry.values.push(value);
    }
  }
  const fields: ConfigField[] = [];
  for (const [key, entry] of byKey) {
    fields.push({
      key,
      type: inferTypeAt(entry.values, depth + 1),
      optional: entry.present < considered.length,
      nullable: entry.nullable,
    });
  }
  return fields;
}

/**
 * The type of a set of non-null, non-undefined values. Values are grouped by
 * JS shape; a single shape gets the per-shape rules below, mixed shapes
 * become a union of the per-group types (integer and number share the
 * 'number' shape, so they collapse before a union can form — which is also
 * why a union from this path never nests another union).
 */
export function inferType(values: readonly unknown[]): ConfigFieldType {
  return inferTypeAt(values, 0);
}

type Shape = 'boolean' | 'number' | 'string' | 'array' | 'object' | 'other';

function shapeOf(value: unknown): Shape {
  switch (typeof value) {
    case 'boolean':
      return 'boolean';
    case 'number':
      return 'number';
    case 'string':
      return 'string';
    case 'object':
      if (Array.isArray(value)) return 'array';
      if (isPlainObject(value)) return 'object';
      return 'other';
    default:
      return 'other';
  }
}

function inferTypeAt(values: readonly unknown[], depth: number): ConfigFieldType {
  if (depth >= MAX_DEPTH) return { kind: 'any' };
  if (values.length === 0) return { kind: 'any' };
  const groups = new Map<Shape, unknown[]>();
  for (const value of values) {
    const group = groups.get(shapeOf(value));
    if (group) group.push(value);
    else groups.set(shapeOf(value), [value]);
  }
  if (groups.size > 1) {
    const variants = [...groups.values()].map((group) => inferTypeAt(group, depth + 1));
    return { kind: 'union', variants };
  }
  const [shape, group] = [...groups.entries()][0]!;
  switch (shape) {
    case 'boolean':
      // Never an enum: {true, false} IS the boolean type.
      return { kind: 'boolean' };
    case 'number':
      return numberType(group as number[]);
    case 'string':
      return stringType(group as string[]);
    case 'array':
      return arrayType(group as unknown[][], depth);
    case 'object':
      return {
        kind: 'object',
        fields: inferFieldList(group as Record<string, unknown>[], depth + 1),
      };
    case 'other':
      // Dates, Maps, functions — nothing a JSON/YAML parse should produce.
      return { kind: 'any' };
  }
}

/** Enum first (a numeric enum keeps its number values), then integer/number.
 * NaN and ±Infinity (YAML's .nan/.inf) fail Number.isInteger, so a column
 * holding one types as 'number'. */
function numberType(values: readonly number[]): ConfigFieldType {
  return enumType(values) ?? (values.every(Number.isInteger) ? { kind: 'integer' } : { kind: 'number' });
}

/** Format wins over enum: four repeated emails are an email column, not a
 * two-value enum. Every value must detect as the SAME format, so one holdout
 * (or a second format) drops the column back to enum-or-string. */
function stringType(values: readonly string[]): ConfigFieldType {
  const first = detectFormat(values[0]!);
  if (first !== null && values.every((value) => detectFormat(value) === first)) {
    return { kind: first };
  }
  return enumType(values) ?? { kind: 'string' };
}

/**
 * The three-part enum test: enough evidence (total >= 4), few enough values
 * (distinct <= 6), and real repetition (distinct * 2 <= total). Each guard
 * exists to stop free text from being called an enum off a handful of rows.
 * Distinct values keep first-seen order.
 */
function enumType(values: readonly (string | number)[]): ConfigFieldType | null {
  if (values.length < 4) return null;
  const distinct: Array<string | number> = [];
  const seen = new Set<string | number>();
  for (const value of values) {
    if (!seen.has(value)) {
      seen.add(value);
      distinct.push(value);
    }
  }
  if (distinct.length > 6 || distinct.length * 2 > values.length) return null;
  return { kind: 'enum', values: distinct };
}

/** One item type from the elements of every sample array, pooled (cap
 * ELEMENT_CAP). Item nullability is NOT modelled — ConfigFieldType has
 * nowhere to put it — so nulls are dropped from the pool; an all-null or
 * all-empty pool leaves the item at 'any'. */
function arrayType(arrays: readonly unknown[][], depth: number): ConfigFieldType {
  const pool: unknown[] = [];
  outer: for (const array of arrays) {
    for (const element of array) {
      if (element === null || element === undefined) continue;
      pool.push(element);
      if (pool.length >= ELEMENT_CAP) break outer;
    }
  }
  return { kind: 'array', item: inferTypeAt(pool, depth + 1) };
}

/** The one-call form the parse page uses: parsed document in, field tree (or
 * a sentence for the error strip) out. */
export function inferDocument(doc: unknown): { fields: ConfigField[] } | { error: string } {
  const result = documentSamples(doc);
  if ('error' in result) return result;
  return { fields: inferFields(result.samples) };
}
