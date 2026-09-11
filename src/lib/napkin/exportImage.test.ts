import { describe, expect, it } from 'vitest';
import {
  EXPORT_THEMES,
  UNTITLED_CURRENT,
  captionText,
  comparisonLayout,
  comparisonRows,
  composeCalculationSvg,
  composeComparisonSvg,
  fontFaceRules,
  formatNumberLatex,
  imageFilename,
  type ComposeOptions,
  type MeasuredRow,
  type RowLayout,
} from './exportImage';

/* `buildCalculationSvg` and `layoutRow` measure real text in a real shadow
   root, so they live in the Playwright suite, which decodes the PNG they
   produce and checks the picture is neither blank nor the wrong size. What is
   testable here is the arithmetic and naming around them, and the two pure
   composers, fed synthetic geometry in place of what `layoutRow` measures. */

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

describe('comparisonLayout', () => {
  const formula = { label: 'Formula', latex: '\\mathrm{revenue}-\\mathrm{cost}' };
  const current = { title: '', substituted: '12500-4750', result: '= 7750' };
  const other = { title: 'Option 1', substituted: '9000-4750', result: '= 4250' };

  it('puts the formula in the header and gives each calculation a column, in input order', () => {
    const layout = comparisonLayout({
      formula,
      substitutedLabel: 'With your values',
      resultLabel: 'Result',
      calculations: [{ ...current, title: 'Option 2' }, other],
    });
    expect(layout.header).toEqual([formula]);
    expect(layout.columns).toEqual([
      [
        { label: 'Option 2', latex: '12500-4750' },
        { label: 'Result — Option 2', latex: '= 7750' },
      ],
      [
        { label: 'Option 1', latex: '9000-4750' },
        { label: 'Result — Option 1', latex: '= 4250' },
      ],
    ]);
  });

  it('captions the columns exactly as the stacked rows are captioned', () => {
    // Same input, two arrangements: the caption text must not depend on which.
    const input = { formula, substitutedLabel: 'With your values', resultLabel: 'Result', calculations: [current, other] };
    const stacked = comparisonRows(input).map((r) => r.label);
    const layout = comparisonLayout(input);
    expect([...layout.header, ...layout.columns.flat()].map((r) => r.label).sort()).toEqual([...stacked].sort());
    expect(layout.columns[0]![0]!.label).toBe('With your values');
    expect(layout.columns[0]![1]!.label).toBe(`Result — ${UNTITLED_CURRENT}`);
  });

  it('drops a column with nothing in it, and the header when the formula is off', () => {
    const layout = comparisonLayout({
      formula: null,
      substitutedLabel: 'With your values',
      resultLabel: 'Result',
      calculations: [current, { ...other, substituted: null, result: null }],
    });
    expect(layout.header).toEqual([]);
    expect(layout.columns).toHaveLength(1);
  });
});

/* Synthetic geometry: one run per row, drawn at the row's origin, in place of
   what `layoutRow` reads back from the browser. */
const fakeLayout = (width: number, height: number, text: string): RowLayout => ({
  width,
  height,
  runs: [{ text, x: 0, baseline: height - 4, family: 'KaTeX_Main', size: 18, italic: false, weight: '400', color: null }],
  rules: [],
  embedded: [],
});
const measured = (label: string, width: number, height: number, text: string): MeasuredRow => ({
  label: captionText(label),
  layout: fakeLayout(width, height, text),
});
const OPTIONS: ComposeOptions = {
  title: 'T',
  palette: EXPORT_THEMES.light,
  padding: 24,
  transparent: false,
  fontCss: '@font-face{x}',
};

describe('composeCalculationSvg', () => {
  it('draws the stacked picture exactly as 0.5.0 drew it', () => {
    // Worked by hand from the 0.5.0 builder: 24 px padding, a 24 px title
    // with a 16 px gap, then per row an 18 px caption line and the row, with
    // 16 px between rows. Width is the 120 px floor plus padding. This is the
    // byte-level promise that the column work left the single picture alone.
    const rows = [measured('Formula', 100, 20, 'a'), measured('Result', 60, 20, 'b')];
    const out = composeCalculationSvg(rows, OPTIONS);
    expect(out.width).toBe(168);
    expect(out.height).toBe(180);
    expect(out.runs).toBe(2);
    expect(out.svg).toBe(
      '<svg xmlns="http://www.w3.org/2000/svg" width="168" height="180" viewBox="0 0 168 180">' +
        '<style>@font-face{x}</style>' +
        '<rect width="168" height="180" fill="#ffffff"/>' +
        '<text x="24" y="40" font-family="ui-sans-serif, system-ui, sans-serif" font-size="15" font-weight="600" fill="#111111">T</text>' +
        '<text x="24" y="75" font-family="ui-sans-serif, system-ui, sans-serif" font-size="11" letter-spacing="0.06em" fill="#6b7280">FORMULA</text>' +
        '<text x="24" y="98" font-family="KaTeX_Main" font-size="18" font-style="normal" font-weight="400" fill="#111111" xml:space="preserve">a</text>' +
        '<text x="24" y="129" font-family="ui-sans-serif, system-ui, sans-serif" font-size="11" letter-spacing="0.06em" fill="#6b7280">RESULT</text>' +
        '<text x="24" y="152" font-family="KaTeX_Main" font-size="18" font-style="normal" font-weight="400" fill="#111111" xml:space="preserve">b</text>' +
        '</svg>'
    );
  });

  it('leaves the paper out when transparent, and skips a blank caption line', () => {
    const out = composeCalculationSvg([measured('', 100, 20, 'a')], { ...OPTIONS, title: '', transparent: true });
    expect(out.svg).not.toContain('<rect');
    expect(out.svg).not.toContain('letter-spacing');
    expect(out.height).toBe(24 * 2 + 20);
  });
});

describe('composeComparisonSvg', () => {
  const header = [measured('Formula', 100, 20, 'f')];
  const first = [measured('Option 2', 90, 20, 'a'), measured('Result — Option 2', 50, 20, 'x')];
  const second = [measured('Option 1', 80, 20, 'b'), measured('Result — Option 1', 50, 20, 'y')];
  const captionAt = (svg: string, caption: string): { x: number; y: number } => {
    const match = new RegExp(`<text x="([\\d.]+)" y="([\\d.]+)"[^>]*>${caption}</text>`).exec(svg);
    if (!match) throw new Error(`${caption} is not in the picture`);
    return { x: Number(match[1]), y: Number(match[2]) };
  };

  it('is wider than either calculation on its own, and carries both captions', () => {
    const both = composeComparisonSvg({ header, columns: [first, second] }, OPTIONS);
    const alone1 = composeCalculationSvg([...header, ...first], OPTIONS);
    const alone2 = composeCalculationSvg([...header, ...second], OPTIONS);
    expect(both.width).toBeGreaterThan(alone1.width);
    expect(both.width).toBeGreaterThan(alone2.width);
    // Two columns of 90 and 80 with the gutter between, plus padding.
    expect(both.width).toBe(Math.ceil(90 + 40 + 80 + 24 * 2));
    expect(both.svg).toContain('>OPTION 2<');
    expect(both.svg).toContain('>OPTION 1<');
    expect(both.runs).toBe(5);
  });

  it('lays the columns out left to right in input order, aligned at the top', () => {
    const svg = composeComparisonSvg({ header, columns: [first, second] }, OPTIONS).svg;
    const a = captionAt(svg, 'OPTION 2');
    const b = captionAt(svg, 'OPTION 1');
    expect(a.x).toBe(24);
    expect(b.x).toBe(24 + 90 + 40);
    expect(a.y).toBe(b.y);
    expect(captionAt(svg, 'RESULT — OPTION 2').y).toBe(captionAt(svg, 'RESULT — OPTION 1').y);
    // The formula sits above both, once, across the full width.
    expect(svg.match(/>FORMULA</g)).toHaveLength(1);
    expect(captionAt(svg, 'FORMULA').y).toBeLessThan(a.y);
    expect(svg.indexOf('>OPTION 2<')).toBeLessThan(svg.indexOf('>OPTION 1<'));

    const swapped = composeComparisonSvg({ header, columns: [second, first] }, OPTIONS).svg;
    expect(captionAt(swapped, 'OPTION 1').x).toBe(24);
    expect(captionAt(swapped, 'OPTION 2').x).toBe(24 + 80 + 40);
  });

  it('is as tall as the header plus the tallest column', () => {
    const tall = [measured('Option 1', 80, 60, 'b'), measured('Result — Option 1', 50, 20, 'y')];
    const out = composeComparisonSvg({ header, columns: [first, tall] }, OPTIONS);
    // padding, title + gap, header row (caption + row), gap, tallest column.
    expect(out.height).toBe(24 * 2 + (24 + 16) + (18 + 20) + 16 + (18 + 60 + 16 + 18 + 20));
  });

  it('keeps the theme, transparency and padding options', () => {
    const out = composeComparisonSvg(
      { header, columns: [first, second] },
      { ...OPTIONS, palette: EXPORT_THEMES.dark, transparent: true, padding: 10 }
    );
    expect(out.svg).not.toContain('<rect');
    expect(out.svg).toContain(`fill="${EXPORT_THEMES.dark.text}"`);
    expect(out.svg).toContain(`fill="${EXPORT_THEMES.dark.muted}"`);
    expect(out.width).toBe(Math.ceil(90 + 40 + 80 + 10 * 2));
    expect(captionAt(out.svg, 'OPTION 2').x).toBe(10);
  });

  it('with no header, the columns start at the top', () => {
    const out = composeComparisonSvg({ header: [], columns: [first, second] }, { ...OPTIONS, title: '' });
    expect(captionAt(out.svg, 'OPTION 2').y).toBe(24 + 11);
    expect(out.height).toBe(24 * 2 + (18 + 20 + 16 + 18 + 20));
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
