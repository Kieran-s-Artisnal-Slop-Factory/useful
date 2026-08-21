/**
 * A napkin-math template as a plain function, in Python, JavaScript, Go or Rust.
 *
 * The template's description becomes the docstring, its fields become typed
 * parameters, and each field's constraint becomes a guard clause — so a
 * generated function refuses the same inputs the tool refuses, rather than
 * quietly computing something from a value the tool would have rejected.
 */
import type { NapkinField } from '../db/types';
import { emitExpression, UnsupportedOperator, type Helper, type Language } from './expression';
import { functionName, identifierMap } from './identifiers';
import { latexToMarkdownMath } from './latex';

export { UnsupportedOperator };
export type { Language };

export interface CodeTemplate {
  name: string;
  description: string;
  formulaLatex: string;
  formulaJson: unknown;
  fields: readonly NapkinField[];
}

export const LANGUAGE_LABELS: Record<Language, string> = {
  python: 'Python',
  javascript: 'JavaScript',
  go: 'Go',
  rust: 'Rust',
};

export const EXTENSIONS: Record<Language, string> = {
  python: 'py',
  javascript: 'js',
  go: 'go',
  rust: 'rs',
};

/** Wrap prose at ~76 columns so a docstring does not run off the page. */
function wrap(text: string, prefix: string): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    if (line && line.length + word.length + 1 > 76) {
      lines.push(prefix + line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  if (line) lines.push(prefix + line);
  return lines;
}

/**
 * Neutralise anything in free text that could close the comment it sits in.
 *
 * Labels and descriptions are user text and end up inside a Python docstring,
 * a JSDoc block and two kinds of line comment. A label carrying a triple quote
 * or a block-comment terminator would end the comment early and drop the rest
 * of the text into the source as code; a newline does the same to a line
 * comment. Written without those sequences here for the same reason.
 */
function commentSafe(text: string): string {
  return text
    .replace(/\r?\n/g, ' ')
    .replace(/\*\//g, '*\u200b/')
    .replace(/"""/g, '\u201c\u201d\u201c')
    .trim();
}

/**
 * The constraints a signature cannot express, in the words the UI uses.
 *
 * The TYPE is deliberately absent: every generated signature already says
 * `int`, `float`, `f64` or `number`, and repeating it in prose is noise that
 * can also fall out of step with the parameter beside it.
 */
function constraintWords(field: NapkinField): string {
  const parts: string[] = [];
  if (field.sign === 'positive') parts.push('not negative');
  if (field.noZero) parts.push('not zero');
  if (!field.required) parts.push('optional');
  return parts.join(', ');
}

/** A field's description and constraints as one trailing clause, or ''. */
function fieldNote(field: NapkinField): string {
  const description = commentSafe(field.description ?? '');
  const constraints = constraintWords(field);
  if (description && constraints) return `${description}. ${constraints[0]!.toUpperCase()}${constraints.slice(1)}`;
  if (description) return description;
  if (constraints) return `${constraints[0]!.toUpperCase()}${constraints.slice(1)}`;
  return '';
}

/**
 * The source of every emitted helper, per language.
 *
 * Exported because the web component generator needs the JavaScript column.
 * It used to keep its own copy of two of these, which is exactly how a
 * formula using `Sum` came to emit a call to `_sum` that was never defined:
 * adding a helper here left the other list untouched and nothing complained.
 */
export const HELPER_SOURCE: Record<Language, Record<Helper, string>> = {
  python: {
    // Python's round() is banker's: round(2.5) is 2. The engine rounds half
    // away from zero, so 2.5 must come back 3.
    round: `def _round(value, digits=0):
    """Round half away from zero, matching the formula editor."""
    factor = 10 ** digits
    scaled = value * factor
    return (math.floor(scaled + 0.5) if scaled >= 0 else math.ceil(scaled - 0.5)) / factor`,
    mod: '',
    sum: `def _sum(lower, upper, term):
    """Add \`term(i)\` for each whole number from lower to upper, inclusive."""
    return sum(term(i) for i in range(round(lower), round(upper) + 1))`,
    product: `def _product(lower, upper, term):
    """Multiply \`term(i)\` for each whole number from lower to upper, inclusive."""
    total = 1.0
    for i in range(round(lower), round(upper) + 1):
        total *= term(i)
    return total`,
    integrate: `def _integrate(lower, upper, f, steps=1000):
    """Definite integral by the composite Simpson\\'s rule.

    APPROXIMATE. Exact for polynomials up to cubic; everything else carries
    an error that shrinks with \`steps\`. The formula editor integrates
    numerically too, so the two agree to about the same tolerance.
    """
    if steps % 2:
        steps += 1
    h = (upper - lower) / steps
    total = f(lower) + f(upper)
    for i in range(1, steps):
        total += f(lower + i * h) * (4 if i % 2 else 2)
    return total * h / 3`,
  },
  javascript: {
    // Math.round is half UP, so Math.round(-2.5) is -2 rather than -3.
    round: `function _round(value, digits = 0) {
  // Round half away from zero, matching the formula editor.
  const factor = 10 ** digits;
  const scaled = value * factor;
  return (scaled >= 0 ? Math.floor(scaled + 0.5) : Math.ceil(scaled - 0.5)) / factor;
}`,
    // % truncates in JS, so -7 % 3 is -1 rather than 2.
    mod: `function _mod(a, b) {
  // Floored modulo: the sign follows the divisor, as the formula editor does.
  return ((a % b) + b) % b;
}`,
    sum: `function _sum(lower, upper, term) {
  // Add term(i) for each whole number from lower to upper, inclusive.
  let total = 0;
  for (let i = Math.round(lower); i <= Math.round(upper); i++) total += term(i);
  return total;
}`,
    product: `function _product(lower, upper, term) {
  // Multiply term(i) for each whole number from lower to upper, inclusive.
  let total = 1;
  for (let i = Math.round(lower); i <= Math.round(upper); i++) total *= term(i);
  return total;
}`,
    integrate: `function _integrate(lower, upper, f, steps = 1000) {
  // Definite integral by the composite Simpson\\'s rule. APPROXIMATE: exact for
  // polynomials up to cubic, and otherwise carrying an error that shrinks with
  // \`steps\`. The formula editor integrates numerically too.
  if (steps % 2) steps += 1;
  const h = (upper - lower) / steps;
  let total = f(lower) + f(upper);
  for (let i = 1; i < steps; i++) total += f(lower + i * h) * (i % 2 ? 4 : 2);
  return (total * h) / 3;
}`,
  },
  go: {
    round: `// _round rounds half away from zero at a number of digits, matching the
// formula editor. math.Round already rounds half away from zero, so this only
// adds the digit scaling.
func _round(value float64, digits float64) float64 {
	factor := math.Pow(10, digits)
	return math.Round(value*factor) / factor
}`,
    mod: `// _mod is a floored modulo: the sign follows the divisor, as the formula
// editor does. Go's % and math.Mod both truncate instead.
func _mod(a, b float64) float64 {
	return math.Mod(math.Mod(a, b)+b, b)
}`,
    sum: `// _sum adds term(i) for each whole number from lower to upper, inclusive.
func _sum(lower, upper float64, term func(float64) float64) float64 {
\\ttotal := 0.0
\\tfor i := math.Round(lower); i <= math.Round(upper); i++ {
\\t\\ttotal += term(i)
\\t}
\\treturn total
}`,
    product: `// _product multiplies term(i) for each whole number from lower to upper,
// inclusive.
func _product(lower, upper float64, term func(float64) float64) float64 {
\\ttotal := 1.0
\\tfor i := math.Round(lower); i <= math.Round(upper); i++ {
\\t\\ttotal *= term(i)
\\t}
\\treturn total
}`,
    integrate: `// _integrate is a definite integral by the composite Simpson\\'s rule.
//
// APPROXIMATE: exact for polynomials up to cubic, and otherwise carrying an
// error that shrinks with the step count. The formula editor integrates
// numerically too, so the two agree to about the same tolerance.
func _integrate(lower, upper float64, f func(float64) float64) float64 {
\\tconst steps = 1000
\\th := (upper - lower) / steps
\\ttotal := f(lower) + f(upper)
\\tfor i := 1; i < steps; i++ {
\\t\\tweight := 2.0
\\t\\tif i%2 == 1 {
\\t\\t\\tweight = 4.0
\\t\\t}
\\t\\ttotal += f(lower+float64(i)*h) * weight
\\t}
\\treturn total * h / 3
}`,
  },
  rust: {
    round: `/// Round half away from zero at a number of digits, matching the formula
/// editor. f64::round already rounds half away from zero; this adds the
/// digit scaling.
fn _round(value: f64, digits: f64) -> f64 {
    let factor = 10f64.powf(digits);
    (value * factor).round() / factor
}`,
    mod: `/// Floored modulo: the sign follows the divisor, as the formula editor does.
/// Rust's % truncates instead.
fn _mod(a: f64, b: f64) -> f64 {
    ((a % b) + b) % b
}`,
    sum: `/// Add \`term(i)\` for each whole number from lower to upper, inclusive.
fn _sum(lower: f64, upper: f64, term: impl Fn(f64) -> f64) -> f64 {
    let mut total = 0.0;
    let mut i = lower.round();
    while i <= upper.round() {
        total += term(i);
        i += 1.0;
    }
    total
}`,
    product: `/// Multiply \`term(i)\` for each whole number from lower to upper, inclusive.
fn _product(lower: f64, upper: f64, term: impl Fn(f64) -> f64) -> f64 {
    let mut total = 1.0;
    let mut i = lower.round();
    while i <= upper.round() {
        total *= term(i);
        i += 1.0;
    }
    total
}`,
    integrate: `/// Definite integral by the composite Simpson\\'s rule.
///
/// APPROXIMATE: exact for polynomials up to cubic, and otherwise carrying an
/// error that shrinks with the step count. The formula editor integrates
/// numerically too, so the two agree to about the same tolerance.
fn _integrate(lower: f64, upper: f64, f: impl Fn(f64) -> f64) -> f64 {
    const STEPS: i32 = 1000;
    let h = (upper - lower) / STEPS as f64;
    let mut total = f(lower) + f(upper);
    for i in 1..STEPS {
        let weight = if i % 2 == 1 { 4.0 } else { 2.0 };
        total += f(lower + i as f64 * h) * weight;
    }
    total * h / 3.0
}`,
  },
};

/**
 * The one-line summary every language's doc block opens with.
 *
 * A docstring that starts with the extended description reads as a wall; a
 * summary line is what every convention here asks for. The template's name is
 * the natural one, and its first sentence is the fallback.
 */
function summaryLine(name: string, description: string): string {
  const cleaned = commentSafe(name).trim();
  if (cleaned) return cleaned;
  const first = description.split(/(?<=[.!?])\s/)[0];
  return first?.trim() || 'Calculates a value from the inputs below';
}

/** What the return value is, said once and reused by three languages. */
function resultNote(template: CodeTemplate): string {
  const named = commentSafe(template.name).trim();
  return named ? `The ${named.charAt(0).toLowerCase()}${named.slice(1)}` : 'The calculated value';
}

/** Emit the whole file for one template. Throws `UnsupportedOperator`. */
export function generateFunction(template: CodeTemplate, language: Language): string {
  const symbols = template.fields.map((f) => f.name);
  const names = identifierMap(symbols, language);
  const { expression, helpers, usesMath } = emitExpression(template.formulaJson, language, names);
  const fn = functionName(template.name, language);
  const description = commentSafe(template.description);
  // The mathfield's LaTeX is markup for a renderer; a comment wants something
  // a person can read, and something Markdown will render as maths.
  const formula = commentSafe(latexToMarkdownMath(template.formulaLatex));
  const helperSource = [...helpers]
    .map((h) => HELPER_SOURCE[language][h])
    .filter(Boolean)
    .join('\n\n');
  // A Python `_round` uses math.floor, so it pulls the import in by itself.
  const needsMath =
    usesMath ||
    (language === 'python' && helpers.has('round')) ||
    helpers.has('mod') ||
    // Go's loop helpers round their bounds with math.Round.
    (language === 'go' && (helpers.has('sum') || helpers.has('product')));

  const param = (field: NapkinField) => names.get(field.name)!;

  switch (language) {
    case 'python': {
      // NumPy-style: a one-line summary, an extended description, then
      // underlined sections. The underline must be exactly as long as its
      // heading or the tooling that reads these will not recognise the block.
      const params = template.fields.map(
        (f) => `${param(f)}: ${f.type === 'integer' ? 'int' : 'float'}`
      );
      const guards = template.fields.flatMap((f) => guardLines(f, param(f), 'python'));
      const raises = template.fields.flatMap((f) => {
        const problems: string[] = [];
        if (f.sign === 'positive') problems.push(`${param(f)} is negative`);
        if (f.noZero) problems.push(`${param(f)} is zero`);
        return problems;
      });
      const paramLines = template.fields.flatMap((f) => {
        const note = fieldNote(f);
        return [
          `    ${param(f)} : ${f.type === 'integer' ? 'int' : 'float'}`,
          ...(note ? wrap(note, '        ') : []),
        ];
      });
      return [
        // PEP 8 wants two blank lines between the imports and a definition,
        // and no leading blank line when there are no imports at all.
        ...(needsMath ? ['import math', '', ''] : []),
        `def ${fn}(${params.join(', ')}) -> float:`,
        `    """${summaryLine(template.name, description)}`,
        ...(description ? ['', ...wrap(description, '    ')] : []),
        ...(formula ? ['', `    ${formula}`] : []),
        '',
        '    Parameters',
        '    ----------',
        ...paramLines,
        '',
        '    Returns',
        '    -------',
        '    float',
        `        ${resultNote(template)}`,
        ...(raises.length > 0
          ? ['', '    Raises', '    ------', '    ValueError', ...raises.map((r) => `        If ${r}.`)]
          : []),
        '    """',
        ...guards,
        `    return ${expression}`,
        ...(helperSource ? ['', '', helperSource] : []),
        '',
      ].join('\n');
    }

    case 'javascript': {
      const params = template.fields.map(param);
      const guards = template.fields.flatMap((f) => guardLines(f, param(f), 'javascript'));
      return [
        '/**',
        ...wrap(summaryLine(template.name, description), ' * '),
        ...(description ? [' *', ...wrap(description, ' * ')] : []),
        ...(formula ? [' *', ` * ${formula}`] : []),
        ' *',
        ...template.fields.map((f) => {
          const note = fieldNote(f);
          return ` * @param {${f.type === 'integer' ? 'number' : 'number'}} ${param(f)}${note ? ` ${note}` : ''}`;
        }),
        ' * @returns {number}',
        ' */',
        `export function ${fn}(${params.join(', ')}) {`,
        ...guards,
        `  return ${expression};`,
        '}',
        ...(helperSource ? ['', helperSource] : []),
        '',
      ].join('\n');
    }

    case 'go': {
      const params = template.fields.map((f) => `${param(f)} float64`);
      const guards = template.fields.flatMap((f) => guardLines(f, param(f), 'go'));
      const returnsError = guards.length > 0;
      return [
        'package napkin',
        '',
        ...(needsMath || returnsError
          ? ['import (', ...(returnsError ? ['\t"errors"'] : []), ...(needsMath ? ['\t"math"'] : []), ')', '']
          : []),
        // The house style from speyl/algorithms: a summary line, an extended
        // description, then `# Parameters` / `# Returns` sections whose entries
        // are indented by one space so godoc renders them as a block.
        `// ${summaryLine(template.name, description)}`,
        ...(description ? ['//', ...wrap(description, '// ')] : []),
        ...(formula ? ['//', `// ${formula}`] : []),
        '//',
        '// # Parameters',
        ...template.fields.map((f) => {
          const note = fieldNote(f);
          return `//  ${param(f)} (float64): ${note || 'No further constraints'}`;
        }),
        '//',
        '// # Returns',
        `//  float64: ${resultNote(template)}`,
        ...(returnsError
          ? ['//  error: Non-nil when an argument breaks one of the constraints above']
          : []),
        `func ${fn}(${params.join(', ')}) (float64, error) {`,
        ...guards,
        `\treturn ${expression}, nil`,
        '}',
        ...(helperSource ? ['', helperSource] : []),
        '',
      ].join('\n');
    }

    case 'rust': {
      const params = template.fields.map((f) => `${param(f)}: f64`);
      const guards = template.fields.flatMap((f) => guardLines(f, param(f), 'rust'));
      const returnsResult = guards.length > 0;
      const returnType = returnsResult ? 'Result<f64, String>' : 'f64';
      return [
        // Deliberately terse: the signature already says `f64`, so the doc
        // carries only the name, what it means, and the one constraint a type
        // cannot express.
        `/// ${summaryLine(template.name, description)}`,
        ...(description ? ['///', ...wrap(description, '/// ')] : []),
        ...(formula ? ['///', `/// ${formula}`] : []),
        '///',
        ...template.fields.map((f) => {
          const note = fieldNote(f);
          return `/// * \`${param(f)}\`${note ? ` — ${note}` : ''}`;
        }),
        `pub fn ${fn}(${params.join(', ')}) -> ${returnType} {`,
        ...guards,
        returnsResult ? `    Ok(${expression})` : `    ${expression}`,
        '}',
        ...(helperSource ? ['', helperSource] : []),
        '',
      ].join('\n');
    }
  }
}

/**
 * The checks a field's constraint becomes.
 *
 * Emitted because the tool enforces them: a function that accepted a negative
 * where the tool refuses one would compute an answer its author never saw.
 */
function guardLines(field: NapkinField, name: string, language: Language): string[] {
  // Rust will not compare an f64 with an integer literal — `x < 0` is a
  // compile error, not a warning, so the zero has to carry a decimal point.
  const zero = language === 'rust' ? '0.0' : '0';
  const label = commentSafe(field.label);
  const conditions: { test: string; message: string }[] = [];
  if (field.sign === 'positive') {
    conditions.push({ test: `${name} < ${zero}`, message: `${label} cannot be negative` });
  }
  if (field.noZero) {
    conditions.push({ test: `${name} == ${zero}`, message: `${label} cannot be zero` });
  }
  if (conditions.length === 0) return [];

  switch (language) {
    case 'python':
      return conditions.map(
        (c) => `    if ${c.test}:\n        raise ValueError(${JSON.stringify(c.message)})`
      );
    case 'javascript':
      return conditions.map(
        (c) => `  if (${c.test.replace('==', '===')}) throw new RangeError(${JSON.stringify(c.message)});`
      );
    case 'go':
      return conditions.map(
        (c) => `\tif ${c.test} {\n\t\treturn 0, errors.New(${JSON.stringify(c.message)})\n\t}`
      );
    case 'rust':
      return conditions.map(
        (c) =>
          `    if ${c.test.replace('==', '==')} {\n        return Err(${JSON.stringify(c.message)}.to_string());\n    }`
      );
  }
}
