/**
 * The config playground's field model: helpers over the ConfigField tree that
 * types.ts defines and the `config_schemas` store persists.
 *
 * Everything here is pure and DOM-free. The tree walkers all carry a depth cap
 * because two things hand this module untrusted input: stored rows (a backup
 * is hand-editable, and the generic data suite writes an ARRAY into every json
 * column) and pasted documents.
 */
import type { ConfigField, ConfigFieldKind, ConfigFieldType } from '../db/types';

/** Deeper than anyone's real config; shallower than a stack overflow. */
export const MAX_DEPTH = 16;

/** Everything the create-mode Type dropdown offers, in display order.
 * 'enum' and 'union' are absent on purpose: they only come out of inference,
 * and a hand-built row that wants "one of these strings" can still keep an
 * inferred one. */
export const KIND_OPTIONS: readonly ConfigFieldKind[] = [
  'string',
  'integer',
  'number',
  'boolean',
  'email',
  'phone',
  'uri',
  'date',
  'date-time',
  'object',
  'array',
  'any',
];

/** Element kinds the create-mode "Array of …" dropdown offers. */
export const ITEM_KIND_OPTIONS: readonly ConfigFieldKind[] = [
  'string',
  'integer',
  'number',
  'boolean',
  'email',
  'phone',
  'uri',
  'date',
  'date-time',
  'object',
  'any',
];

const SCALAR_KINDS: readonly ConfigFieldKind[] = [
  'string',
  'integer',
  'number',
  'boolean',
  'email',
  'phone',
  'uri',
  'date',
  'date-time',
  'any',
];

export function blankField(key = ''): ConfigField {
  return { key, type: { kind: 'string' }, optional: false, nullable: false };
}

/** The Type-column label: `Array[string]`, `enum(dev | prod)`, `object`, … */
export function typeLabel(type: ConfigFieldType): string {
  switch (type.kind) {
    case 'array':
      return `Array[${type.item ? typeLabel(type.item) : 'any'}]`;
    case 'enum': {
      const values = (type.values ?? []).map((v) => String(v));
      const shown = values.slice(0, 4).join(' | ');
      return `enum(${values.length > 4 ? shown + ' | …' : shown})`;
    }
    case 'union':
      return (type.variants ?? []).map(typeLabel).join(' | ') || 'any';
    default:
      return type.kind;
  }
}

/** Total field count, nested fields included — the UI's row-count readout and
 * the sanity cap on inference output. */
export function countFields(fields: readonly ConfigField[]): number {
  let n = 0;
  for (const field of fields) {
    n += 1 + countNested(field.type);
  }
  return n;
}

function countNested(type: ConfigFieldType): number {
  if (type.kind === 'object') return countFields(type.fields ?? []);
  if (type.kind === 'array' && type.item) return countNested(type.item);
  if (type.kind === 'union') {
    return (type.variants ?? []).reduce((sum, v) => sum + countNested(v), 0);
  }
  return 0;
}

/**
 * One row of the flattened Field/Type table. `field` is a live reference into
 * the tree (under $state that is a deep proxy, so editing it edits the tree);
 * `siblings`/`index` locate it for removal; `children` is the list a new child
 * row would be appended to — the object's fields, or the element fields of an
 * array of objects — and null for anything that cannot have children.
 */
export interface FlatFieldRow {
  /** `address.city`, `workplaces[].name`, … — also the collapse key. */
  path: string;
  depth: number;
  field: ConfigField;
  siblings: ConfigField[];
  index: number;
  children: ConfigField[] | null;
}

/**
 * Flatten the tree for the table, one row per field, depth-first. Branches
 * whose path is in `collapsed` keep their row and drop their descendants.
 */
export function flattenFields(
  fields: ConfigField[],
  collapsed: ReadonlySet<string> = new Set(),
): FlatFieldRow[] {
  const rows: FlatFieldRow[] = [];
  walkFlatten(fields, '', 0, collapsed, rows);
  return rows;
}

function walkFlatten(
  fields: ConfigField[],
  basePath: string,
  depth: number,
  collapsed: ReadonlySet<string>,
  rows: FlatFieldRow[],
): void {
  if (depth >= MAX_DEPTH) return;
  fields.forEach((field, index) => {
    const path = basePath + field.key;
    const children = childListOf(field.type);
    rows.push({ path, depth, field, siblings: fields, index, children });
    if (children && !collapsed.has(path)) {
      const suffix = field.type.kind === 'array' ? '[].' : '.';
      walkFlatten(children, path + suffix, depth + 1, collapsed, rows);
    }
  });
}

/** The list a child field of `type` lives in, or null when the type has no
 * child fields. Missing lists are created on demand so "switch this row to
 * object, then add a child" works on a fresh tree. */
export function childListOf(type: ConfigFieldType): ConfigField[] | null {
  if (type.kind === 'object') {
    if (!type.fields) type.fields = [];
    return type.fields;
  }
  if (type.kind === 'array') {
    if (!type.item) type.item = { kind: 'any' };
    if (type.item.kind === 'object') {
      if (!type.item.fields) type.item.fields = [];
      return type.item.fields;
    }
  }
  return null;
}

/**
 * Re-shape the `fields` column of a stored row (or anything else untrusted)
 * into a well-formed ConfigField[]. Junk entries are dropped, junk properties
 * are coerced field by field — refuse a document, coerce a field is the house
 * rule, and here the "document" was already accepted when the row was read.
 */
export function normalizeFields(value: unknown): ConfigField[] {
  return normalizeFieldList(value, 0);
}

function normalizeFieldList(value: unknown, depth: number): ConfigField[] {
  if (!Array.isArray(value) || depth >= MAX_DEPTH) return [];
  const fields: ConfigField[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) continue;
    const record = entry as Record<string, unknown>;
    const key = typeof record.key === 'string' ? record.key : '';
    if (key === '' || seen.has(key)) continue;
    seen.add(key);
    fields.push({
      key,
      type: normalizeType(record.type, depth + 1),
      optional: record.optional === true,
      nullable: record.nullable === true,
    });
  }
  return fields;
}

/** As normalizeFields, for a single type node. Anything unrecognizable
 * becomes `any` — the type that promises nothing. */
export function normalizeType(value: unknown, depth = 0): ConfigFieldType {
  if (typeof value !== 'object' || value === null || Array.isArray(value) || depth >= MAX_DEPTH) {
    return { kind: 'any' };
  }
  const record = value as Record<string, unknown>;
  const kind = record.kind;
  if (typeof kind !== 'string') return { kind: 'any' };
  if (SCALAR_KINDS.includes(kind as ConfigFieldKind)) {
    return { kind: kind as ConfigFieldKind };
  }
  if (kind === 'enum') {
    const values = Array.isArray(record.values)
      ? record.values.filter(
          (v): v is string | number | boolean =>
            typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean',
        )
      : [];
    if (values.length === 0) return { kind: 'any' };
    return { kind: 'enum', values };
  }
  if (kind === 'array') {
    return { kind: 'array', item: normalizeType(record.item, depth + 1) };
  }
  if (kind === 'object') {
    return { kind: 'object', fields: normalizeFieldList(record.fields, depth + 1) };
  }
  if (kind === 'union') {
    const variants = Array.isArray(record.variants)
      ? record.variants.map((v) => normalizeType(v, depth + 1))
      : [];
    if (variants.length < 2) return variants[0] ?? { kind: 'any' };
    return { kind: 'union', variants };
  }
  return { kind: 'any' };
}

/** The domain half of a stored config_schemas row, normalized. */
export function normalizeSchemaRow(row: {
  name?: unknown;
  format?: unknown;
  fields?: unknown;
  source?: unknown;
}): { name: string; format: 'json' | 'yaml'; fields: ConfigField[]; source: string } {
  return {
    name: typeof row.name === 'string' ? row.name : '',
    format: row.format === 'yaml' ? 'yaml' : 'json',
    fields: normalizeFields(row.fields),
    source: typeof row.source === 'string' ? row.source : '',
  };
}

/** Deep-clone a field list (plain JSON data, so JSON round-trip is exact).
 * Used when a stored schema is opened, so edits never mutate a row object. */
export function cloneFields(fields: readonly ConfigField[]): ConfigField[] {
  return JSON.parse(JSON.stringify(fields)) as ConfigField[];
}
