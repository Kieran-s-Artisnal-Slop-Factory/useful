import { describe, expect, it } from 'vitest';
import {
  blankField,
  checkValue,
  checkValues,
  describeConstraint,
  orphanedFields,
  reconcileFields,
} from './model';
import {
  calculationsToJson,
  CALCULATIONS_FORMAT,
  ImportError,
  parseCalculations,
  parseTemplate,
  parseTemplates,
  templatesToJson,
  templateToJson,
  TEMPLATE_FORMAT,
} from './transfer';
import type { NapkinField } from '../db/types';

const field = (name: string, over: Partial<NapkinField> = {}): NapkinField => ({
  ...blankField(name),
  ...over,
});

describe('reconcileFields', () => {
  it('keeps the settings of a variable that survived a formula edit', () => {
    // Adding `+ tax` to a formula must not reset the other five fields.
    const before = [field('count', { type: 'integer', sign: 'positive' }), field('price')];
    const after = reconcileFields(['count', 'price', 'tax'], before);
    expect(after).toHaveLength(3);
    expect(after[0]).toEqual(before[0]);
    expect(after[2]!.name).toBe('tax');
    expect(after[2]!.type).toBe('number');
  });

  it('drops a field whose variable the formula no longer mentions', () => {
    const after = reconcileFields(['a'], [field('a'), field('gone')]);
    expect(after.map((f) => f.name)).toEqual(['a']);
  });

  it('follows the formula’s order, not the old list’s', () => {
    const after = reconcileFields(['b', 'a'], [field('a'), field('b')]);
    expect(after.map((f) => f.name)).toEqual(['b', 'a']);
  });

  it('reports what was dropped, so the editor can say so', () => {
    const orphans = orphanedFields(['a'], [field('a'), field('gone'), field('also')]);
    expect(orphans.map((f) => f.name)).toEqual(['gone', 'also']);
  });

  it('is a no-op when nothing changed', () => {
    const fields = [field('a'), field('b')];
    expect(reconcileFields(['a', 'b'], fields)).toEqual(fields);
  });
});

describe('checkValue', () => {
  it('requires a value only when the field says so', () => {
    expect(checkValue(field('a'), null)).toMatch(/required/);
    expect(checkValue(field('a', { required: false }), null)).toBeNull();
  });

  it('rejects a fraction in a whole-number field', () => {
    expect(checkValue(field('n', { type: 'integer' }), 2.5)).toMatch(/whole number/);
    expect(checkValue(field('n', { type: 'integer' }), 2)).toBeNull();
  });

  it('treats the sign and the zero rule as independent', () => {
    // "positive" and "not zero" are two different constraints, which is why
    // the editor offers them as two controls rather than three options.
    const positive = field('n', { sign: 'positive' });
    expect(checkValue(positive, -1)).toMatch(/negative/);
    expect(checkValue(positive, 0)).toBeNull();

    const nonZero = field('n', { noZero: true });
    expect(checkValue(nonZero, 0)).toMatch(/zero/);
    expect(checkValue(nonZero, -1)).toBeNull();

    const both = field('n', { sign: 'positive', noZero: true });
    expect(checkValue(both, 0)).toMatch(/zero/);
    expect(checkValue(both, -1)).toMatch(/negative/);
    expect(checkValue(both, 1)).toBeNull();
  });

  it('rejects infinity and NaN', () => {
    expect(checkValue(field('a'), Infinity)).toMatch(/finite/);
    expect(checkValue(field('a'), NaN)).toMatch(/required/);
  });

  it('collects every problem at once, keyed by field', () => {
    const problems = checkValues(
      [field('a', { sign: 'positive' }), field('b', { noZero: true }), field('c')],
      { a: -1, b: 0, c: 5 }
    );
    expect(Object.keys(problems).sort()).toEqual(['a', 'b']);
  });

  it('describes a constraint in the words the generated code uses', () => {
    expect(describeConstraint(field('a'))).toBe('number');
    expect(describeConstraint(field('a', { type: 'integer', sign: 'positive', noZero: true }))).toBe(
      'whole number, not negative, not zero'
    );
    expect(describeConstraint(field('a', { required: false }))).toBe('number, optional');
  });
});

describe('template import', () => {
  const good = {
    format: TEMPLATE_FORMAT,
    version: 1,
    name: 'Margin',
    description: 'per unit',
    formulaLatex: '\\mathrm{a}+\\mathrm{b}',
    formulaJson: ['Add', 'a', 'b'],
    fields: [blankField('a'), blankField('b')],
  };

  it('round-trips a template', () => {
    const doc = parseTemplate(templateToJson(good));
    expect(doc.name).toBe('Margin');
    expect(doc.fields.map((f) => f.name)).toEqual(['a', 'b']);
  });

  it('refuses anything that is not a napkin template', () => {
    expect(() => parseTemplate('not json')).toThrow(/valid JSON/);
    expect(() => parseTemplate('[]')).toThrow(/JSON object/);
    expect(() => parseTemplate('{"format":"something-else"}')).toThrow(/not a napkin-math template/);
    expect(() => parseTemplate(JSON.stringify({ ...good, name: '  ' }))).toThrow(/no name/);
    expect(() => parseTemplate(JSON.stringify({ ...good, formulaLatex: '' }))).toThrow(/no formula/);
    expect(() => parseTemplate('{}')).toThrow(ImportError);
  });

  it('coerces a wrong-typed field rather than losing the template', () => {
    // Refuse a document, coerce a field: one bad flag should not cost the rest.
    const doc = parseTemplate(
      JSON.stringify({
        ...good,
        fields: [{ name: 'a', type: 'colour', required: 'yes', sign: 'sideways', noZero: 1 }],
      })
    );
    expect(doc.fields[0]).toEqual({
      name: 'a',
      label: 'a',
      type: 'number',
      required: true,
      sign: 'any',
      noZero: false,
    });
  });

  it('drops a nameless field and a duplicate one', () => {
    const doc = parseTemplate(
      JSON.stringify({
        ...good,
        fields: [{ name: 'a' }, { name: '' }, 'nonsense', { name: 'a', label: 'second' }],
      })
    );
    expect(doc.fields.map((f) => f.name)).toEqual(['a']);
    expect(doc.fields[0]!.label).toBe('a');
  });

  it('keeps a hostile string as a string', () => {
    // It is rendered as text and parsed as LaTeX; it is never code.
    const doc = parseTemplate(
      JSON.stringify({ ...good, description: '<script>alert(1)</script>', name: '"; drop table;' })
    );
    expect(doc.description).toBe('<script>alert(1)</script>');
    expect(doc.name).toBe('"; drop table;');
  });

  it('reads a bundle of templates, skipping the unusable ones', () => {
    const bundle = templatesToJson([good, { ...good, name: 'Second' }]);
    expect(parseTemplates(bundle).map((t) => t.name)).toEqual(['Margin', 'Second']);

    const mixed = JSON.stringify({
      format: TEMPLATE_FORMAT,
      templates: [good, { name: '' }, { ...good, name: 'Third' }],
    });
    expect(parseTemplates(mixed).map((t) => t.name)).toEqual(['Margin', 'Third']);

    const allBad = JSON.stringify({ format: TEMPLATE_FORMAT, templates: [{ name: '' }] });
    expect(() => parseTemplates(allBad)).toThrow(/no usable templates/);
  });

  it('reads a single-template file through the same entry point', () => {
    expect(parseTemplates(templateToJson(good))).toHaveLength(1);
  });
});

describe('calculation import', () => {
  const fields = [blankField('a'), blankField('b')];
  const file = calculationsToJson('Margin', [
    { name: 'first', values: { a: 1, b: 2 }, result: 3 },
    { name: 'second', values: { a: 5, b: 5 }, result: 10 },
  ]);

  it('round-trips calculations', () => {
    const docs = parseCalculations(file, fields);
    expect(docs.map((c) => c.name)).toEqual(['first', 'second']);
    expect(docs[0]!.values).toEqual({ a: 1, b: 2 });
    expect(docs[0]!.result).toBe(3);
  });

  it('drops a value for a variable this formula does not have', () => {
    const stray = JSON.stringify({
      format: CALCULATIONS_FORMAT,
      calculations: [{ name: 'x', values: { a: 1, nope: 9 } }],
    });
    expect(parseCalculations(stray, fields)[0]!.values).toEqual({ a: 1 });
  });

  it('drops a value that is not a finite number', () => {
    const bad = JSON.stringify({
      format: CALCULATIONS_FORMAT,
      calculations: [{ name: 'x', values: { a: 'abc', b: null } }],
    });
    expect(parseCalculations(bad, fields)[0]!.values).toEqual({});
  });

  it('reads a numeric string, because JSON round trips lose types', () => {
    const stringy = JSON.stringify({
      format: CALCULATIONS_FORMAT,
      calculations: [{ name: 'x', values: { a: '42' } }],
    });
    expect(parseCalculations(stringy, fields)[0]!.values).toEqual({ a: 42 });
  });

  it('refuses a file that is the wrong kind or has nothing in it', () => {
    expect(() => parseCalculations('{}', fields)).toThrow(/not a napkin-math calculations file/);
    expect(() =>
      parseCalculations(JSON.stringify({ format: CALCULATIONS_FORMAT }), fields)
    ).toThrow(/no calculations/);
    expect(() =>
      parseCalculations(JSON.stringify({ format: CALCULATIONS_FORMAT, calculations: [] }), fields)
    ).toThrow(/no usable calculations/);
  });

  it('never carries calculations inside a template file', () => {
    // The two are separate exports on purpose: a shared template should not
    // leak the numbers someone ran through it.
    const json = templateToJson({
      name: 'Margin',
      description: '',
      formulaLatex: 'a+b',
      formulaJson: null,
      fields,
    });
    expect(json).not.toContain('calculations');
    expect(JSON.parse(json)).not.toHaveProperty('calculations');
  });
});
