/**
 * Reading and writing napkin templates and calculations as JSON.
 *
 * An imported document is untrusted: it may have come from a backup someone
 * hand-edited, from another person, or from a file that was truncated. So
 * every path here validates shape and type before anything is kept, and the
 * strings it does keep are only ever rendered as text — a formula is data for
 * the Compute Engine, never something evaluated as code.
 *
 * The house rule from the sprite editor applies: **refuse a document, coerce a
 * field.** A file that is not a napkin document at all is rejected with a
 * message; a field inside a recognisably-napkin document that is the wrong
 * type falls back to its default rather than throwing, so one bad flag does
 * not cost the whole template.
 */
import type { NapkinField } from '../db/types';
import { blankField } from './model';

export const TEMPLATE_FORMAT = 'useful-napkin-template';
export const CALCULATIONS_FORMAT = 'useful-napkin-calculations';
export const FORMAT_VERSION = 1;

export interface TemplateDoc {
  name: string;
  description: string;
  formulaLatex: string;
  formulaJson: unknown;
  fields: NapkinField[];
}

export interface CalculationDoc {
  name: string;
  values: Record<string, number>;
  result: number | null;
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const asString = (value: unknown, fallback = ''): string =>
  typeof value === 'string' ? value : fallback;

/** One field, with anything unrecognised falling back to the default. */
function readField(raw: unknown, index: number): NapkinField | null {
  if (!isObject(raw)) return null;
  const name = asString(raw['name']).trim();
  // A field with no name has nothing to bind to, so it is dropped rather than
  // given a made-up one.
  if (!name) return null;
  const base = blankField(name);
  return {
    name,
    label: asString(raw['label'], name).trim() || name,
    description: asString(raw['description']),
    type: raw['type'] === 'integer' ? 'integer' : 'number',
    required: typeof raw['required'] === 'boolean' ? raw['required'] : base.required,
    sign: raw['sign'] === 'positive' ? 'positive' : 'any',
    noZero: raw['noZero'] === true,
  };
}

export class ImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImportError';
  }
}

/** Parse JSON text, with a message a person can act on. */
function parseJsonText(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw new ImportError('That is not valid JSON.');
  }
}

/** Read one template document. Throws `ImportError` with a reason. */
export function parseTemplate(text: string): TemplateDoc {
  const raw = parseJsonText(text);
  if (!isObject(raw)) throw new ImportError('A template file should be a JSON object.');
  if (raw['format'] !== TEMPLATE_FORMAT) {
    throw new ImportError('That file is not a napkin-math template.');
  }
  const name = asString(raw['name']).trim();
  if (!name) throw new ImportError('That template has no name.');
  const formulaLatex = asString(raw['formulaLatex']).trim();
  if (!formulaLatex) throw new ImportError('That template has no formula.');

  const rawFields = Array.isArray(raw['fields']) ? raw['fields'] : [];
  const fields: NapkinField[] = [];
  const seen = new Set<string>();
  for (const [index, entry] of rawFields.entries()) {
    const field = readField(entry, index);
    // Two fields for one variable would make the second unreachable.
    if (field && !seen.has(field.name)) {
      seen.add(field.name);
      fields.push(field);
    }
  }

  return {
    name,
    description: asString(raw['description']),
    formulaLatex,
    // The MathJSON is re-derived from the LaTeX on load rather than trusted,
    // so a file carrying a formulaJson that disagrees cannot mislead anything.
    formulaJson: raw['formulaJson'] ?? null,
    fields,
  };
}

/** Read a calculations document, checked against the template it claims. */
export function parseCalculations(text: string, fields: readonly NapkinField[]): CalculationDoc[] {
  const raw = parseJsonText(text);
  if (!isObject(raw)) throw new ImportError('A calculations file should be a JSON object.');
  if (raw['format'] !== CALCULATIONS_FORMAT) {
    throw new ImportError('That file is not a napkin-math calculations file.');
  }
  const list = raw['calculations'];
  if (!Array.isArray(list)) throw new ImportError('That file has no calculations in it.');

  const known = new Set(fields.map((f) => f.name));
  const out: CalculationDoc[] = [];
  for (const entry of list) {
    if (!isObject(entry)) continue;
    const values: Record<string, number> = {};
    const rawValues = isObject(entry['values']) ? entry['values'] : {};
    for (const [key, value] of Object.entries(rawValues)) {
      // A value for a variable this formula does not have would be silently
      // ignored at evaluation time, so drop it here where it can be counted.
      if (!known.has(key)) continue;
      // Only a number or a string that spells one. `Number(null)` is 0 and
      // `Number([])` is 0, so a blanket coercion would turn a missing value
      // into a real zero — which a "cannot be zero" field would then reject
      // for a reason the file never actually stated.
      const numeric =
        typeof value === 'number'
          ? value
          : typeof value === 'string' && value.trim() !== ''
            ? Number(value)
            : NaN;
      if (Number.isFinite(numeric)) values[key] = numeric;
    }
    const result = entry['result'];
    out.push({
      name: asString(entry['name'], 'Untitled').trim() || 'Untitled',
      values,
      result: typeof result === 'number' && Number.isFinite(result) ? result : null,
    });
  }
  if (out.length === 0) throw new ImportError('That file has no usable calculations in it.');
  return out;
}

/** The template as its shareable JSON — never its saved calculations. */
export function templateToJson(doc: TemplateDoc): string {
  return JSON.stringify(
    {
      format: TEMPLATE_FORMAT,
      version: FORMAT_VERSION,
      name: doc.name,
      description: doc.description,
      formulaLatex: doc.formulaLatex,
      formulaJson: doc.formulaJson,
      fields: doc.fields,
    },
    null,
    2
  );
}

/** Several templates in one file. */
export function templatesToJson(docs: readonly TemplateDoc[]): string {
  return JSON.stringify(
    {
      format: TEMPLATE_FORMAT,
      version: FORMAT_VERSION,
      templates: docs.map((doc) => ({
        name: doc.name,
        description: doc.description,
        formulaLatex: doc.formulaLatex,
        formulaJson: doc.formulaJson,
        fields: doc.fields,
      })),
    },
    null,
    2
  );
}

/** Read a file that holds either one template or many. */
export function parseTemplates(text: string): TemplateDoc[] {
  const raw = parseJsonText(text);
  if (isObject(raw) && Array.isArray(raw['templates'])) {
    if (raw['format'] !== TEMPLATE_FORMAT) {
      throw new ImportError('That file is not a napkin-math template file.');
    }
    const out: TemplateDoc[] = [];
    for (const entry of raw['templates']) {
      try {
        out.push(parseTemplate(JSON.stringify({ ...(entry as object), format: TEMPLATE_FORMAT })));
      } catch {
        // One unusable template in a bundle should not cost the others.
      }
    }
    if (out.length === 0) throw new ImportError('That file has no usable templates in it.');
    return out;
  }
  return [parseTemplate(text)];
}

export function calculationsToJson(
  templateName: string,
  calculations: readonly CalculationDoc[]
): string {
  return JSON.stringify(
    {
      format: CALCULATIONS_FORMAT,
      version: FORMAT_VERSION,
      template: templateName,
      calculations: calculations.map((c) => ({
        name: c.name,
        values: c.values,
        result: c.result,
      })),
    },
    null,
    2
  );
}
