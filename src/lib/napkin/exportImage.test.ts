import { describe, expect, it } from 'vitest';
import {
  EXPORT_THEMES,
  UNTITLED_CURRENT,
  captionText,
  comparisonRows,
  fontFaceRules,
  formatNumberLatex,
  imageFilename,
} from './exportImage';

/* `buildCalculationSvg` and `layoutRow` measure real text in a real shadow
   root, so they live in the Playwright suite, which decodes the PNG they
   produce and checks the picture is neither blank nor the wrong size. What is
   testable here is the arithmetic and naming around them. */

describe('formatNumberLatex', () => {
  it('shows exactly what the page shows when no rounding is asked for', () => {
    expect(formatNumberLatex(2.5)).toBe('2.5');
    expect(formatNumberLatex(6)).toBe('6');
    expect(formatNumberLatex(1 / 3)).toBe(String(1 / 3));
  });

  it('rounds to the requested number of decimals', () => {
    expect(formatNumberLatex(1 / 3, 2)).toBe('0.33');
    expect(formatNumberLatex(2.5, 0)).toBe('3');
    expect(formatNumberLatex(1.005, 1)).toBe('1.0');
  });

  it('groups thousands with the separator the engine uses, not a comma', () => {
    // The substituted row above it is rendered by the Compute Engine, which
    // writes `\,` — a comma here would make the picture inconsistent.
    expect(formatNumberLatex(1234567)).toBe('1\\,234\\,567');
    expect(formatNumberLatex(12345)).toBe('12\\,345');
  });

  it('leaves four digits unbroken, which is how a formula reads', () => {
    expect(formatNumberLatex(1000)).toBe('1000');
    expect(formatNumberLatex(9999)).toBe('9999');
    expect(formatNumberLatex(10000)).toBe('10\\,000');
  });

  it('groups the whole part only, never the decimals', () => {
    expect(formatNumberLatex(1234567.891, 3)).toBe('1\\,234\\,567.891');
  });

  it('keeps a negative sign outside the grouping', () => {
    expect(formatNumberLatex(-1234567)).toBe('-1\\,234\\,567');
    expect(formatNumberLatex(-2.5, 1)).toBe('-2.5');
  });

  it('passes a non-finite value through rather than inventing digits', () => {
    expect(formatNumberLatex(Infinity)).toBe('Infinity');
    expect(formatNumberLatex(NaN)).toBe('NaN');
  });

  it('handles zero in both modes', () => {
    expect(formatNumberLatex(0)).toBe('0');
    expect(formatNumberLatex(0, 2)).toBe('0.00');
  });
});

describe('captionText', () => {
  // The dialog turns a caption off by handing the builder '' (0.6.0 Phase 1),
  // and a caption the user has emptied arrives as whitespace. Both have to
  // mean "no caption line", or a switched-off caption would still cost the
  // row its 18 px of headroom.
  it('treats blank as none, whitespace included', () => {
    expect(captionText('')).toBe('');
    expect(captionText('   ')).toBe('');
    expect(captionText('\t\n')).toBe('');
    expect(captionText(undefined)).toBe('');
    expect(captionText(null)).toBe('');
  });

  it('draws a caption trimmed and in capitals, as the picture always has', () => {
    expect(captionText('With your values')).toBe('WITH YOUR VALUES');
    expect(captionText('  Given ')).toBe('GIVEN');
  });

  it('keeps a custom caption intact apart from the case', () => {
    expect(captionText('At current market rate')).toBe('AT CURRENT MARKET RATE');
    expect(captionText('Q3 (est.)')).toBe('Q3 (EST.)');
  });
});

describe('comparisonRows', () => {
  const formula = { label: 'Formula', latex: '\\mathrm{revenue}-\\mathrm{cost}' };
  const current = { title: '', substituted: '12500-4750', result: '= 7750' };
  const other = { title: 'Option 1', substituted: '9000-4750', result: '= 4250' };
  const single = () =>
    comparisonRows({ formula, substitutedLabel: 'With your values', resultLabel: 'Result', calculations: [current] });

  it('with one calculation and no title builds exactly the three rows the dialog always built', () => {
    // The renderer did not change for comparisons. This is the input it gets
    // when none is added, and it is byte-for-byte the 0.5.0 input, so the
    // single-calculation picture is the same picture.
    expect(single()).toEqual([
      { label: 'Formula', latex: '\\mathrm{revenue}-\\mathrm{cost}' },
      { label: 'With your values', latex: '12500-4750' },
      { label: 'Result', latex: '= 7750' },
    ]);
  });

  it('passes switched-off captions through as blank, unchanged', () => {
    expect(
      comparisonRows({ formula: { label: '', latex: 'x' }, substitutedLabel: '', resultLabel: '', calculations: [current] })
    ).toEqual([
      { label: '', latex: 'x' },
      { label: '', latex: '12500-4750' },
      { label: '', latex: '= 7750' },
    ]);
  });

  it('leaves out the rows that are switched off or could not be built', () => {
    expect(
      comparisonRows({ formula: null, substitutedLabel: 'With your values', resultLabel: 'Result', calculations: [{ ...current, substituted: null }] })
    ).toEqual([{ label: 'Result', latex: '= 7750' }]);
    expect(
      comparisonRows({ formula: null, substitutedLabel: 'With your values', resultLabel: 'Result', calculations: [{ ...current, result: null }] })
    ).toEqual([{ label: 'With your values', latex: '12500-4750' }]);
  });

  it('draws the formula once, then every substituted row, then every result', () => {
    const rows = comparisonRows({
      formula,
      substitutedLabel: 'With your values',
      resultLabel: 'Result',
      calculations: [{ ...current, title: 'Option 2' }, other],
    });
    expect(rows).toEqual([
      { label: 'Formula', latex: '\\mathrm{revenue}-\\mathrm{cost}' },
      { label: 'Option 2', latex: '12500-4750' },
      { label: 'Option 1', latex: '9000-4750' },
      { label: 'Result — Option 2', latex: '= 7750' },
      { label: 'Result — Option 1', latex: '= 4250' },
    ]);
  });

  it('keeps the row caption for an untitled current calculation, and names its result', () => {
    const rows = comparisonRows({
      formula: null,
      substitutedLabel: 'With your values',
      resultLabel: 'Result',
      calculations: [current, other],
    });
    expect(rows.map((r) => r.label)).toEqual([
      'With your values',
      'Option 1',
      `Result — ${UNTITLED_CURRENT}`,
      'Result — Option 1',
    ]);
  });

  it('with the result caption off, a compared result is captioned by its title alone', () => {
    const rows = comparisonRows({
      formula: null,
      substitutedLabel: '',
      resultLabel: '',
      calculations: [{ ...current, title: 'Option 2' }, other],
    });
    expect(rows.map((r) => r.label)).toEqual(['Option 2', 'Option 1', 'Option 2', 'Option 1']);
  });

  it('a comparison whose caption was emptied draws its rows uncaptioned', () => {
    const rows = comparisonRows({
      formula: null,
      substitutedLabel: 'With your values',
      resultLabel: 'Result',
      calculations: [current, { ...other, title: '  ' }],
    });
    expect(rows.map((r) => r.label)).toEqual(['With your values', '', `Result — ${UNTITLED_CURRENT}`, 'Result']);
  });

  it('a lone calculation ignores its title, so removing the last comparison restores the single picture', () => {
    // The title box keeps its text between adds; what it must not do is
    // change a picture that has nothing to compare.
    const rows = comparisonRows({
      formula,
      substitutedLabel: 'With your values',
      resultLabel: 'Result',
      calculations: [{ ...current, title: 'Option 2' }],
    });
    expect(rows).toEqual(single());
  });
});

describe('imageFilename', () => {
  it('turns a template name into a filename with the right extension', () => {
    expect(imageFilename('Monthly cost', 'svg')).toBe('Monthly-cost.svg');
    expect(imageFilename('Monthly cost', 'png')).toBe('Monthly-cost.png');
  });

  it('drops characters a filesystem would object to', () => {
    expect(imageFilename('Rev / Cost: 2024?', 'svg')).toBe('Rev-Cost-2024.svg');
  });

  it('collapses runs of whitespace into one hyphen', () => {
    expect(imageFilename('a   b\tc', 'png')).toBe('a-b-c.png');
  });

  it('falls back rather than producing a bare extension', () => {
    expect(imageFilename('', 'svg')).toBe('calculation.svg');
    expect(imageFilename('   ', 'png')).toBe('calculation.png');
    expect(imageFilename('///', 'svg')).toBe('calculation.svg');
  });

  it('cannot emit a path separator or a traversal', () => {
    const name = imageFilename('../../etc/passwd', 'svg');
    expect(name).not.toContain('/');
    expect(name).not.toContain('\\');
    expect(name).not.toContain('..');
  });

  it('caps a very long name', () => {
    expect(imageFilename('x'.repeat(500), 'svg').length).toBeLessThanOrEqual(64);
  });
});

describe('EXPORT_THEMES', () => {
  it('resolves every colour to a literal, because an SVG file has no :root', () => {
    for (const [name, theme] of Object.entries(EXPORT_THEMES)) {
      for (const [role, value] of Object.entries(theme)) {
        expect(value, `${name}.${role}`).toMatch(/^#[0-9a-f]{6}$/i);
        expect(value, `${name}.${role}`).not.toContain('var(');
      }
    }
  });

  it('offers a light and a dark palette that actually differ', () => {
    expect(EXPORT_THEMES.light.background).not.toBe(EXPORT_THEMES.dark.background);
    expect(EXPORT_THEMES.light.text).not.toBe(EXPORT_THEMES.dark.text);
  });
});

describe('fontFaceRules', () => {
  const FACE = '@font-face{font-family:"KaTeX_Main";src:url(data:font/woff2;base64,AAA)}';
  const LAYOUT = '.ML__latex{display:inline-block}.ML__base{position:relative}';

  it('keeps the faces and drops the layout rules', () => {
    // The layout CSS positions HTML. The output is <text> and <rect>, which
    // it cannot affect — carrying it would add ~30 KB to every picture for
    // nothing.
    expect(fontFaceRules(FACE + LAYOUT)).toBe(FACE);
  });

  it('keeps every face when there are several', () => {
    const second = '@font-face{font-family:"KaTeX_Math";font-style:italic;src:url(data:font/woff2;base64,BBB)}';
    const out = fontFaceRules(LAYOUT + FACE + LAYOUT + second);
    expect(out).toContain('KaTeX_Main');
    expect(out).toContain('KaTeX_Math');
    expect(out).not.toContain('.ML__latex');
  });

  it('tolerates whitespace between the at-rule and its block', () => {
    expect(fontFaceRules('@font-face  {font-family:"X"}')).toBe('@font-face  {font-family:"X"}');
  });

  it('returns an empty string when the fonts were left out', () => {
    expect(fontFaceRules(LAYOUT)).toBe('');
    expect(fontFaceRules('')).toBe('');
  });
});
