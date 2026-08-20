import { describe, expect, it } from 'vitest';
import { latexToMarkdownMath } from './latex';

const latex = String.raw;

describe('latexToMarkdownMath', () => {
  it('unwraps the name markup and the sizing delimiters', () => {
    expect(latexToMarkdownMath(latex`\left(\mathrm{costPerMonth}*12\right)*\mathrm{years}`)).toBe(
      latex`$\(costPerMonth*12\)*years$`
    );
  });

  it('leaves structures Markdown maths already renders', () => {
    // A fraction is correct Markdown maths as it stands; rewriting it would
    // only make it less precise.
    expect(latexToMarkdownMath(latex`\frac{\mathrm{revenue}-\mathrm{cost}}{\mathrm{units}}`)).toBe(
      latex`$\frac{revenue-cost}{units}$`
    );
    expect(latexToMarkdownMath(latex`\sqrt{x}`)).toBe(latex`$\sqrt{x}$`);
    expect(latexToMarkdownMath(latex`x^2`)).toBe('$x^2$');
  });

  it('writes multiplication the way people type it', () => {
    expect(latexToMarkdownMath(latex`\mathrm{a}\cdot \mathrm{b}`)).toBe('$a*b$');
    expect(latexToMarkdownMath(latex`\mathrm{a}\times \mathrm{b}`)).toBe('$a*b$');
  });

  it('handles the other sizing delimiters', () => {
    expect(latexToMarkdownMath(latex`\left[x\right]`)).toBe(latex`$\[x\]$`);
    expect(latexToMarkdownMath(latex`\left\{x\right\}`)).toBe(latex`$\{x\}$`);
    expect(latexToMarkdownMath(latex`\left|x\right|`)).toBe('$|x|$');
  });

  it('drops the spacing macros that only matter to a renderer', () => {
    expect(latexToMarkdownMath(latex`\int_0^1 x\,dx`)).toBe(latex`$\int_0^1 x dx$`);
  });

  it('returns nothing for nothing, so a caller can omit the line', () => {
    expect(latexToMarkdownMath('')).toBe('');
    expect(latexToMarkdownMath('   ')).toBe('');
  });

  it('leaves anything it has no rule for exactly as it was', () => {
    // A readability pass, not a converter — a half-understood rewrite would be
    // worse than the raw source.
    expect(latexToMarkdownMath(latex`\Gamma\left(x\right)`)).toBe(latex`$\Gamma\(x\)$`);
  });
});
