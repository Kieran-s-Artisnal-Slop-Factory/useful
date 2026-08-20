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

const HELPER_SOURCE: Record<Language, Record<Helper, string>> = {
  python: {
    // Python's round() is banker's: round(2.5) is 2. The engine rounds half
    // away from zero, so 2.5 must come back 3.
    round: `def _round(value, digits=0):
    """Round half away from zero, matching the formula editor."""
    factor = 10 ** digits
    scaled = value * factor
    return (math.floor(scaled + 0.5) if scaled >= 0 else math.ceil(scaled - 0.5)) / factor`,
    mod: '',
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
  const needsMath = usesMath || (language === 'python' && helpers.has('round')) || helpers.has('mod');

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
