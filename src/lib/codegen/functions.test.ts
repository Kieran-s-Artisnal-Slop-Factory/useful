import { describe, expect, it } from 'vitest';
import { emitExpression, UnsupportedOperator } from './expression';
import { functionName, identifierMap } from './identifiers';
import { generateFunction, type CodeTemplate } from './functions';
import type { NapkinField } from '../db/types';
import type { Language } from './expression';

const LANGUAGES: Language[] = ['python', 'javascript', 'go', 'rust'];

const field = (name: string, over: Partial<NapkinField> = {}): NapkinField => ({
  name,
  label: name,
  type: 'number',
  required: true,
  sign: 'any',
  noZero: false,
  ...over,
});

/** Emit one expression with an identity name map. */
const emit = (json: unknown, language: Language, symbols: string[] = []) =>
  emitExpression(json, language, identifierMap(symbols, language)).expression;

describe('identifierMap', () => {
  it('cleans a symbol into something every language accepts', () => {
    const map = identifierMap(['a_b', 'Δcost', '2x', 'ok'], 'python');
    expect(map.get('a_b')).toBe('a_b');
    expect(map.get('Δcost')).toBe('cost');
    expect(map.get('2x')).toBe('v2x');
    expect(map.get('ok')).toBe('ok');
  });

  it('follows each language’s casing', () => {
    expect(identifierMap(['costPerUnit'], 'python').get('costPerUnit')).toBe('cost_per_unit');
    expect(identifierMap(['cost_per_unit'], 'javascript').get('cost_per_unit')).toBe('costPerUnit');
    expect(identifierMap(['costPerUnit'], 'go').get('costPerUnit')).toBe('cost_per_unit');
  });

  it('does not hand back a reserved word', () => {
    expect(identifierMap(['class'], 'python').get('class')).toBe('class_');
    expect(identifierMap(['fn'], 'rust').get('fn')).toBe('fn_');
    // `math` is not reserved, but the emitted file imports it under that name.
    expect(identifierMap(['math'], 'python').get('math')).toBe('math_');
  });

  it('resolves collisions deterministically, first symbol keeping the plain name', () => {
    const map = identifierMap(['a-b', 'a_b', 'a.b'], 'python');
    expect([...map.values()]).toEqual(['a_b', 'a_b_2', 'a_b_3']);
    // Same input, same answer — a regenerated file must not rename parameters.
    expect([...identifierMap(['a-b', 'a_b', 'a.b'], 'python').values()]).toEqual([...map.values()]);
  });

  it('names the function from the template', () => {
    expect(functionName('Unit economics', 'python')).toBe('unit_economics');
    expect(functionName('Unit economics', 'javascript')).toBe('unitEconomics');
    expect(functionName('', 'go')).toBe('calculate');
  });
});

describe('emitExpression — precedence', () => {
  it('parenthesises a sum inside a product, and not the other way round', () => {
    const sumInProduct = ['Multiply', 2, ['Add', 'a', 'b']];
    const productInSum = ['Add', 2, ['Multiply', 'a', 'b']];
    for (const language of LANGUAGES) {
      expect(emit(sumInProduct, language, ['a', 'b'])).toContain('(a + b)');
      expect(emit(productInSum, language, ['a', 'b'])).not.toContain('(a * b)');
    }
  });

  it('keeps subtraction of a sum grouped', () => {
    // `a - (b + c)` is not `a - b + c`.
    expect(emit(['Subtract', 'a', ['Add', 'b', 'c']], 'python', ['a', 'b', 'c'])).toBe(
      'a - (b + c)'
    );
  });

  it('groups a sum under a division and under a power', () => {
    expect(emit(['Divide', ['Add', 'a', 'b'], 2], 'python', ['a', 'b'])).toBe('(a + b) / 2.0');
    expect(emit(['Power', ['Add', 'a', 'b'], 2], 'javascript', ['a', 'b'])).toBe('(a + b) ** 2');
  });
});

describe('emitExpression — the operators that differ per language', () => {
  it('writes a power the way each language spells it', () => {
    const power = ['Power', 'x', 2];
    expect(emit(power, 'python', ['x'])).toBe('x ** 2.0');
    expect(emit(power, 'javascript', ['x'])).toBe('x ** 2');
    // Go has no power operator at all.
    expect(emit(power, 'go', ['x'])).toBe('math.Pow(x, 2.0)');
    expect(emit(power, 'rust', ['x'])).toBe('(x as f64).powf(2.0)');
  });

  it('recognises e^x as the exponential, not a power of a constant', () => {
    // `\exp(x)` and `e^x` are the SAME MathJSON node.
    const expNode = ['Power', 'ExponentialE', 'x'];
    expect(emit(expNode, 'python', ['x'])).toBe('math.exp(x)');
    expect(emit(expNode, 'javascript', ['x'])).toBe('Math.exp(x)');
    expect(emit(expNode, 'rust', ['x'])).toBe('(x as f64).exp()');
  });

  it('treats a bare Log as base 10 and a two-argument Log as a change of base', () => {
    expect(emit(['Log', 'x'], 'python', ['x'])).toBe('math.log10(x)');
    expect(emit(['Log', 'x', 2], 'python', ['x'])).toBe('math.log(x) / math.log(2.0)');
    expect(emit(['Log', 'x'], 'rust', ['x'])).toBe('(x as f64).log10()');
  });

  it('folds a variadic Min into pairs where the language needs it', () => {
    const min = ['Min', 'a', 'b', 'c'];
    expect(emit(min, 'python', ['a', 'b', 'c'])).toBe('min(a, b, c)');
    expect(emit(min, 'javascript', ['a', 'b', 'c'])).toBe('Math.min(a, b, c)');
    // Go's math.Min takes exactly two.
    expect(emit(min, 'go', ['a', 'b', 'c'])).toBe('math.Min(math.Min(a, b), c)');
    expect(emit(min, 'rust', ['a', 'b', 'c'])).toBe('a.min(b).min(c)');
  });

  it('emits a helper for Mod everywhere but Python, whose % is already floored', () => {
    // The engine's Mod is floored: Mod(-7, 3) is 2, not -1.
    const mod = ['Mod', 'a', 'b'];
    expect(emit(mod, 'python', ['a', 'b'])).toBe('a % b');
    for (const language of ['javascript', 'go', 'rust'] as Language[]) {
      const out = emitExpression(mod, language, identifierMap(['a', 'b'], language));
      expect(out.expression).toBe('_mod(a, b)');
      expect(out.helpers.has('mod')).toBe(true);
    }
  });

  it('emits a helper for Round in Python and JavaScript, which round differently', () => {
    // Python's round() is banker's (2.5 -> 2); JavaScript's Math.round is half
    // UP (-2.5 -> -2). The engine rounds half away from zero either way.
    for (const language of ['python', 'javascript'] as Language[]) {
      const out = emitExpression(['Round', 'x'], language, identifierMap(['x'], language));
      expect(out.helpers.has('round'), language).toBe(true);
    }
    // Go and Rust already round half away from zero.
    const go = emitExpression(['Round', 'x'], 'go', identifierMap(['x'], 'go'));
    expect(go.expression).toBe('math.Round(x)');
    expect(go.helpers.has('round')).toBe(false);
  });

  it('needs a helper for a Round to a number of digits in every language', () => {
    for (const language of LANGUAGES) {
      const out = emitExpression(['Round', 'x', 2], language, identifierMap(['x'], language));
      expect(out.helpers.has('round'), language).toBe(true);
    }
  });
});

describe('emitExpression — refusals', () => {
  it('refuses an operator it has no rule for, by name', () => {
    // Emitting a plausible-looking guess is exactly the failure this avoids.
    expect(() => emit(['Gamma', 'x'], 'python', ['x'])).toThrow(UnsupportedOperator);
    try {
      emit(['Gamma', 'x'], 'python', ['x']);
    } catch (err) {
      expect((err as UnsupportedOperator).operator).toBe('Gamma');
      expect((err as Error).message).toContain('Gamma');
    }
  });

  it('refuses an odd root, which no target language can take of a negative', () => {
    // The engine says (-8)^(1/3) is -2; every target language says NaN.
    expect(() => emit(['Root', 'x', 3], 'python', ['x'])).toThrow(/odd root/);
    // An even root is just a fractional power, which is fine.
    expect(emit(['Root', 'x', 2], 'python', ['x'])).toContain('1 / 2.0');
  });

  it('refuses an empty formula rather than emitting an empty function', () => {
    expect(() => emit('Nothing', 'python')).toThrow(UnsupportedOperator);
  });
});

describe('generateFunction', () => {
  const template: CodeTemplate = {
    name: 'Unit economics',
    description: 'Margin per unit after the per-order cost is spread across the batch.',
    formulaLatex: '\\frac{\\mathrm{revenue} - \\mathrm{cost}}{\\mathrm{units}}',
    formulaJson: ['Divide', ['Subtract', 'revenue', 'cost'], 'units'],
    fields: [
      field('revenue'),
      field('cost'),
      field('units', { type: 'integer', sign: 'positive', noZero: true }),
    ],
  };

  it('produces Python with an import, a docstring, guards and the formula', () => {
    const out = generateFunction(template, 'python');
    expect(out).toContain('def unit_economics(revenue: float, cost: float, units: int) -> float:');
    expect(out).toContain('Margin per unit');
    expect(out).toContain('if units < 0:');
    expect(out).toContain('if units == 0:');
    expect(out).toContain('raise ValueError("units cannot be zero")');
    expect(out).toContain('return (revenue - cost) / units');
  });

  it('produces JavaScript with JSDoc and range guards', () => {
    const out = generateFunction(template, 'javascript');
    expect(out).toContain('export function unitEconomics(revenue, cost, units) {');
    expect(out).toContain('@param {number} revenue');
    expect(out).toContain('if (units === 0) throw new RangeError("units cannot be zero");');
    expect(out).toContain('return (revenue - cost) / units;');
  });

  it('produces Go that returns an error rather than a bad number', () => {
    const out = generateFunction(template, 'go');
    expect(out).toContain('package napkin');
    expect(out).toContain('"errors"');
    expect(out).toContain('func unit_economics(revenue float64, cost float64, units float64) (float64, error) {');
    expect(out).toContain('return 0, errors.New("units cannot be zero")');
    expect(out).toContain('return (revenue - cost) / units, nil');
  });

  it('produces Rust that returns a Result', () => {
    const out = generateFunction(template, 'rust');
    expect(out).toContain('pub fn unit_economics(revenue: f64, cost: f64, units: f64) -> Result<f64, String> {');
    expect(out).toContain('return Err("units cannot be zero".to_string());');
    expect(out).toContain('Ok((revenue - cost) / units)');
  });

  it('omits the guard machinery entirely when no field constrains anything', () => {
    const loose: CodeTemplate = { ...template, fields: [field('a'), field('b')] , formulaJson: ['Add', 'a', 'b'] };
    const go = generateFunction(loose, 'go');
    expect(go).not.toContain('errors');
    expect(go).toContain('(float64, error)');
    const rust = generateFunction(loose, 'rust');
    expect(rust).toContain('-> f64');
    expect(rust).not.toContain('Result');
  });

  it('imports the maths library only when the formula uses it', () => {
    const plain: CodeTemplate = { ...template, formulaJson: ['Add', 'revenue', 'cost'], fields: [field('revenue'), field('cost')] };
    expect(generateFunction(plain, 'python')).not.toContain('import math');
    const withSqrt: CodeTemplate = { ...plain, formulaJson: ['Sqrt', 'revenue'] };
    expect(generateFunction(withSqrt, 'python')).toContain('import math');
  });

  it('includes the helper source when the expression calls one', () => {
    const rounded: CodeTemplate = {
      ...template,
      formulaJson: ['Round', ['Divide', 'revenue', 'units'], 2],
      fields: [field('revenue'), field('units')],
    };
    const python = generateFunction(rounded, 'python');
    expect(python).toContain('def _round(');
    expect(python).toContain('import math');
    const js = generateFunction(rounded, 'javascript');
    expect(js).toContain('function _round(');
  });

  it('keeps a hostile label inside its string literal', () => {
    const hostile: CodeTemplate = {
      ...template,
      formulaJson: ['Add', 'a', 1],
      fields: [field('a', { label: 'x") ; import os ; os.system("rm -rf /', noZero: true })],
    };
    const out = generateFunction(hostile, 'python');
    // JSON.stringify is what keeps the guard message a string literal — the
    // quote that would have closed it is escaped.
    expect(out).toContain('raise ValueError("x\\") ;');
    expect(out).not.toContain('raise ValueError("x") ;');
  });

  it('cannot be made to break out of a comment', () => {
    // A label or description containing the comment terminator would end the
    // block early and drop the rest into the file as code.
    const hostile: CodeTemplate = {
      ...template,
      description: 'ends a docstring: \"\"\" and a JSDoc: */ then code',
      formulaJson: ['Add', 'a', 1],
      fields: [field('a', { label: 'label */ with \"\"\" in it' })],
    };
    const python = generateFunction(hostile, 'python');
    // The docstring's own delimiters are the only triple quotes in the file.
    expect(python.split('\"\"\"')).toHaveLength(3);

    const js = generateFunction(hostile, 'javascript');
    // Likewise: one opening /** and one closing */.
    expect(js.indexOf('*/')).toBe(js.lastIndexOf('*/'));
  });

  it('does not let a multi-line label spill out of a line comment', () => {
    const hostile: CodeTemplate = {
      ...template,
      formulaJson: ['Add', 'a', 1],
      fields: [field('a', { label: 'first line\nreturn 0, nil }' })],
    };
    const go = generateFunction(hostile, 'go');
    expect(go).not.toContain('\nreturn 0, nil }');
  });

  it('writes the original formula into the comment for every language', () => {
    for (const language of LANGUAGES) {
      expect(generateFunction(template, language), language).toContain(template.formulaLatex);
    }
  });
});
