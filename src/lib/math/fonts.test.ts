import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MATH_ASSETS, MATH_FONT_BYTES, MATH_FONT_FILES } from './fonts';

const provenance = readFileSync('public/math/PROVENANCE.txt', 'utf8');

describe('vendored maths fonts', () => {
  it('lists the twenty faces the vendoring script insists on', () => {
    expect(MATH_FONT_FILES).toHaveLength(20);
    expect([...MATH_FONT_FILES]).toEqual([...MATH_FONT_FILES].sort());
  });

  it('bundles both stylesheets alongside them, stylesheets first', () => {
    // The font stylesheet is not decoration: its `--ML__static-fonts` rule is
    // what stops MathLive loading fonts its own way. katex.css is the layout
    // half for the notebook's maths; it declares no faces of its own.
    expect(MATH_ASSETS).toHaveLength(22);
    expect(MATH_ASSETS[0]).toContain('mathlive-fonts.css');
    expect(MATH_ASSETS[1]).toContain('katex.css');
    expect(MATH_ASSETS.slice(2).every((url) => url.endsWith('.woff2'))).toBe(true);
  });

  it('ships katex.css without any @font-face of its own', () => {
    const css = readFileSync('public/math/katex.css', 'utf8');
    expect(css).not.toContain('@font-face');
    expect(css).not.toContain('url(');
    expect(css).toContain('.katex');
    expect(provenance).toContain('katex.css');
  });

  it('agrees with what is actually on disk', () => {
    // The provenance file is written by the vendoring script from the real
    // file sizes, so this fails if someone re-vendors a different build.
    for (const name of MATH_FONT_FILES) expect(provenance).toContain(name);
    const recorded = /(\d+) bytes total/.exec(provenance);
    expect(recorded, 'PROVENANCE.txt has no byte total').not.toBeNull();
    expect(MATH_FONT_BYTES).toBe(Number(recorded![1]));
  });

  it('records that the sounds are deliberately absent', () => {
    // 227 KB of keypress .wav files nobody asked for. If a future vendoring
    // silently starts copying them, this line goes and the test says so.
    expect(provenance).toContain('soundsDirectory = null');
    expect(provenance).not.toContain('.wav"');
  });
});
