/**
 * The builder's half of the two-way binding (0.3.0 phase 10).
 *
 * The page has to work in both directions: dropdowns and checkboxes that
 * write an expression, and a typed expression that writes the dropdowns back.
 * The second direction is where a builder normally gives up and resets what
 * you typed — so the shape of a field is READ here, and a field whose shape
 * has no control (`1-5/2,30`, and anything else genuinely free-form) reports
 * itself as `custom` and keeps its text untouched rather than being flattened
 * into something the controls can draw.
 */
import { FIELDS, parseField, type FieldName } from './parse';

export type FieldMode = 'every' | 'step' | 'list' | 'range' | 'custom';

export interface FieldDraft {
  mode: FieldMode;
  /** For 'step'. */
  step: number;
  /** For 'list'. */
  values: number[];
  /** For 'range'. */
  from: number;
  to: number;
  /** The text, authoritative when mode is 'custom'. */
  source: string;
}

export const MODE_LABELS: Record<FieldMode, string> = {
  every: 'Every',
  step: 'Every N',
  list: 'Specific',
  range: 'Range',
  custom: 'As typed',
};

/** Read a field's text into the controls that can draw it. */
export function draftFromSource(name: FieldName, source: string): FieldDraft {
  const spec = FIELDS[name];
  const text = source.trim();
  const base: FieldDraft = {
    mode: 'custom',
    step: 2,
    values: [],
    from: spec.min,
    to: spec.max,
    source: text,
  };

  if (text === '*') return { ...base, mode: 'every' };

  const step = /^\*\/(\d+)$/.exec(text);
  if (step) return { ...base, mode: 'step', step: Number(step[1]) };

  const range = /^(\d+)-(\d+)$/.exec(text);
  if (range) {
    return { ...base, mode: 'range', from: Number(range[1]), to: Number(range[2]) };
  }

  if (/^\d+(,\d+)*$/.test(text)) {
    try {
      return { ...base, mode: 'list', values: parseField(name, text).values };
    } catch {
      return base;
    }
  }

  return base;
}

/** Write the controls back out as field text. */
export function sourceFromDraft(name: FieldName, draft: FieldDraft): string {
  const spec = FIELDS[name];
  switch (draft.mode) {
    case 'every':
      return '*';
    case 'step':
      return `*/${Math.max(1, Math.round(draft.step))}`;
    case 'range':
      return `${clamp(draft.from, spec.min, spec.max)}-${clamp(draft.to, spec.min, spec.max)}`;
    case 'list': {
      const values = [...new Set(draft.values)].sort((a, b) => a - b);
      // An empty selection is not an expression. Falling back to `*` keeps the
      // line valid while someone is still clicking, rather than painting an
      // error over a half-made choice.
      return values.length === 0 ? '*' : values.join(',');
    }
    default:
      return draft.source || '*';
  }
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Math.round(n)));

/** Toggle one value in a 'list' draft. */
export function toggleValue(draft: FieldDraft, value: number): FieldDraft {
  const values = draft.values.includes(value)
    ? draft.values.filter((v) => v !== value)
    : [...draft.values, value].sort((a, b) => a - b);
  return { ...draft, values };
}
