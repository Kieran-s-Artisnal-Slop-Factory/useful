/**
 * A formula's LaTeX, reduced to something readable in a source comment.
 *
 * The mathfield writes markup meant for a renderer: `\mathrm{}` around every
 * multi-letter name (which is how the engine is told they are one symbol, not
 * a product of letters) and `\left(` / `\right)` for delimiters that grow with
 * their contents. In a docstring both are noise — nobody reading a Python
 * function wants `\left(\mathrm{costPerMonth}*12\right)*\mathrm{years}`.
 *
 * The output is wrapped in `$…$` so a comment lifted into Markdown — a README,
 * a doc site, a Go pkgsite page — renders as maths rather than as literal
 * backslashes.
 *
 * This is a readability pass, not a converter: anything it has no rule for is
 * left exactly as it was. `\frac{a}{b}` stays `\frac{a}{b}`, which is correct
 * Markdown maths already.
 */

/** Substitutions applied in order. Each is a pure textual simplification. */
const RULES: [RegExp, string][] = [
  // `\mathrm{costPerMonth}` is only there to make the parser treat the name as
  // one symbol; the reader already knows it is a name.
  [/\\mathrm\{([^{}]*)\}/g, '$1'],
  [/\\operatorname\{([^{}]*)\}/g, '$1'],
  // Sizing delimiters carry no meaning at one line.
  [/\\left\(/g, '\\('],
  [/\\right\)/g, '\\)'],
  [/\\left\[/g, '\\['],
  [/\\right\]/g, '\\]'],
  [/\\left\\\{/g, '\\{'],
  [/\\right\\\}/g, '\\}'],
  [/\\left\\?\|/g, '|'],
  [/\\right\\?\|/g, '|'],
  [/\\left\./g, ''],
  [/\\right\./g, ''],
  // Multiplication reads better as the symbol people type.
  [/\\cdot\s?/g, '*'],
  [/\\times\s?/g, '*'],
  // A thin space before a differential, and the spacing macros, are typography.
  [/\\,/g, ' '],
  [/\\!/g, ''],
  [/\\;/g, ' '],
];

/**
 * `\left(\mathrm{costPerMonth}*12\right)*\mathrm{years}` becomes
 * `$\(costPerMonth*12\)*years$`.
 *
 * Returns an empty string for an empty formula, so a caller can leave the line
 * out entirely rather than emitting `$$`.
 */
export function latexToMarkdownMath(latex: string): string {
  let out = latex.trim();
  if (!out) return '';
  for (const [pattern, replacement] of RULES) out = out.replace(pattern, replacement);
  // Collapse the runs of whitespace the substitutions leave behind; a comment
  // is one line and double spaces read as a mistake.
  out = out.replace(/[ \t]+/g, ' ').trim();
  if (!out) return '';
  return `$${out}$`;
}
