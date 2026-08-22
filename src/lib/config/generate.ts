/**
 * The config playground's seeded example-data generator: documents that fit a
 * ConfigField schema, built from one PRNG stream so the same (fields, count,
 * seed) always produces the same output.
 *
 * Everything emitted validates cleanly against the schema that produced it
 * (generate.test.ts holds that property test), and nothing emitted names a
 * real person or a reachable domain — see words.ts for how the lists
 * guarantee that. Phone numbers sit in the fiction-reserved 555-01xx block.
 */
import type { ConfigField, ConfigFieldType } from '../db/types';
import { mulberry32 } from '../random';
import { MAX_DEPTH } from './model';
import { DOMAINS, FIRST_NAMES, LAST_NAMES, URI_PATHS, WORDS } from './words';

/**
 * The seeded PRNG now lives in [random.ts](../random.ts) — it grew a second
 * caller (the placeholder generators) and two copies would be two answers to
 * "what does seed 42 produce". Re-exported here so this module's callers and
 * its tests keep their import.
 */
export { mulberry32 };

/**
 * Generate `count` documents (clamped to 1-1000) for a schema. Document i is
 * a function of the single PRNG stream, so documents differ from each other
 * while the whole batch stays reproducible.
 */
export function generateDocuments(
  fields: readonly ConfigField[],
  count: number,
  seed: number,
): Record<string, unknown>[] {
  const n = Number.isFinite(count) ? Math.min(1000, Math.max(1, Math.trunc(count))) : 1;
  const rng = mulberry32(seed);
  const docs: Record<string, unknown>[] = [];
  for (let i = 0; i < n; i++) docs.push(generateObject(fields, rng, 0));
  return docs;
}

function generateObject(
  fields: readonly ConfigField[],
  rng: () => number,
  depth: number,
): Record<string, unknown> {
  const doc: Record<string, unknown> = {};
  for (const field of fields) {
    if (field.optional && rng() >= 0.8) continue; // present with p = 0.8
    if (field.nullable && rng() < 0.1) {
      // rolled AFTER presence: an optional+nullable field that shows up is
      // null 10% of the time, same as a required one
      doc[field.key] = null;
      continue;
    }
    doc[field.key] = generateValue(field.type, rng, depth);
  }
  return doc;
}

function generateValue(type: ConfigFieldType, rng: () => number, depth: number): unknown {
  // Past the cap, emit null without consulting `nullable`. That is fine:
  // inference walks documents with the same MAX_DEPTH cap, so it can never
  // produce a schema this deep — only a hand-edited or hostile schema can,
  // and the cap's job is to stop the recursion, not to satisfy it. The
  // validator accepts anything past the cap, so the round trip still holds.
  if (depth >= MAX_DEPTH) return null;
  switch (type.kind) {
    case 'string': {
      const n = int(rng, 1, 3);
      const words: string[] = [];
      for (let i = 0; i < n; i++) words.push(pick(rng, WORDS));
      return words.join(' ');
    }
    case 'integer':
      return int(rng, 0, 9999);
    case 'number':
      return Math.round(rng() * 999900) / 100; // 0-9999, two decimals
    case 'boolean':
      return rng() < 0.5;
    case 'email':
      return `${pick(rng, FIRST_NAMES)}.${pick(rng, LAST_NAMES)}@${pick(rng, DOMAINS)}`
        .toLowerCase();
    case 'phone':
      return `+1 (555) 010-${String(int(rng, 0, 9999)).padStart(4, '0')}`;
    case 'uri':
      return `https://${pick(rng, DOMAINS)}/${pick(rng, URI_PATHS)}`;
    case 'date':
      return isoDate(rng);
    case 'date-time':
      return `${isoDate(rng)}T${pad(int(rng, 0, 23))}:${pad(int(rng, 0, 59))}:${pad(
        int(rng, 0, 59),
      )}Z`;
    case 'enum': {
      const values = type.values ?? [];
      // Empty only when junk skipped normalizeType (it folds empty enums to
      // `any`); fall back to an any-style value rather than throw.
      return values.length > 0 ? pick(rng, values) : anyValue(rng);
    }
    case 'union': {
      const variants = type.variants ?? [];
      // Empty variants: same junk-only case; validate.ts treats it as `any`.
      return variants.length > 0 ? generateValue(pick(rng, variants), rng, depth) : anyValue(rng);
    }
    case 'array': {
      const item = type.item ?? { kind: 'any' as const };
      const n = int(rng, 1, 4);
      const items: unknown[] = [];
      for (let i = 0; i < n; i++) items.push(generateValue(item, rng, depth + 1));
      return items;
    }
    case 'object':
      return generateObject(type.fields ?? [], rng, depth + 1);
    case 'any':
      return anyValue(rng);
  }
}

/** What `any` produces: a scalar, so junk schemas still yield readable docs. */
function anyValue(rng: () => number): unknown {
  const roll = int(rng, 0, 2);
  if (roll === 0) return pick(rng, WORDS);
  if (roll === 1) return int(rng, 0, 9999);
  return rng() < 0.5;
}

/** A valid calendar date in 2020-2029. Days stop at 28 so every month/day
 * combination is real without a leap-year table. */
function isoDate(rng: () => number): string {
  return `${int(rng, 2020, 2029)}-${pad(int(rng, 1, 12))}-${pad(int(rng, 1, 28))}`;
}

/** Uniform integer in [min, max], inclusive on both ends. */
function int(rng: () => number, min: number, max: number): number {
  return min + Math.floor(rng() * (max - min + 1));
}

function pick<T>(rng: () => number, items: readonly T[]): T {
  return items[int(rng, 0, items.length - 1)]!;
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}
