/**
 * The napkin-math model: what a template is, how its fields come out of its
 * formula, and how a value is checked against a field.
 *
 * Everything here is a pure function over plain data. The Compute Engine is
 * reached through the small surface in `engine.ts`, so this module is
 * unit-testable without loading 37 MB of maths library.
 */
import type { NapkinField } from '../db/types';

export type { NapkinField };

/** A template as the editor holds it, before it becomes a row. */
export interface TemplateDraft {
  name: string;
  description: string;
  formulaLatex: string;
  formulaJson: unknown;
  fields: NapkinField[];
}

export function blankField(name: string): NapkinField {
  return {
    name,
    label: name,
    description: '',
    type: 'number',
    required: true,
    sign: 'any',
    noZero: false,
  };
}

/**
 * Fill in anything a stored field is missing.
 *
 * `fields` is a JSON blob, so a template saved before a property existed comes
 * back without it. Reading one straight into the editor would bind an input to
 * `undefined` and write it back that way.
 */
export function normalizeField(field: NapkinField): NapkinField {
  return { ...blankField(field.name), ...field, description: field.description ?? '' };
}

export function blankDraft(): TemplateDraft {
  return { name: '', description: '', formulaLatex: '', formulaJson: null, fields: [] };
}

/**
 * Rebuild the field list for a formula's variables, keeping what the author
 * already said about the ones that survived.
 *
 * Editing a formula must not cost the settings on every other field — adding
 * `+ tax` to a five-variable formula should leave those five alone. Fields for
 * variables the formula no longer mentions are dropped, because a field with
 * nothing to bind to would be asked for and then ignored.
 */
export function reconcileFields(
  variables: readonly string[],
  existing: readonly NapkinField[]
): NapkinField[] {
  const byName = new Map(existing.map((field) => [field.name, field]));
  return variables.map((name) => byName.get(name) ?? blankField(name));
}

/** Which fields the author had that the formula has dropped. */
export function orphanedFields(
  variables: readonly string[],
  existing: readonly NapkinField[]
): NapkinField[] {
  const wanted = new Set(variables);
  return existing.filter((field) => !wanted.has(field.name));
}

/**
 * Why a value is not acceptable for a field, or null when it is.
 *
 * The same rules run on typed input, on an imported calculation, and as a
 * guard clause in the generated code — one definition, three consumers, so a
 * generated function cannot be laxer than the tool that wrote it.
 */
export function checkValue(field: NapkinField, value: number | null): string | null {
  if (value === null || Number.isNaN(value)) {
    return field.required ? `${field.label} is required` : null;
  }
  if (!Number.isFinite(value)) return `${field.label} must be a finite number`;
  if (field.type === 'integer' && !Number.isInteger(value)) {
    return `${field.label} must be a whole number`;
  }
  if (field.sign === 'positive' && value < 0) return `${field.label} cannot be negative`;
  if (field.noZero && value === 0) return `${field.label} cannot be zero`;
  return null;
}

/** Every problem with a set of values, keyed by field name. */
export function checkValues(
  fields: readonly NapkinField[],
  values: Readonly<Record<string, number | null>>
): Record<string, string> {
  const problems: Record<string, string> = {};
  for (const field of fields) {
    const problem = checkValue(field, values[field.name] ?? null);
    if (problem) problems[field.name] = problem;
  }
  return problems;
}

/** A one-line description of a field's constraint, for the UI and the docs. */
export function describeConstraint(field: NapkinField): string {
  const parts: string[] = [field.type === 'integer' ? 'whole number' : 'number'];
  if (field.sign === 'positive') parts.push('not negative');
  if (field.noZero) parts.push('not zero');
  if (!field.required) parts.push('optional');
  return parts.join(', ');
}
