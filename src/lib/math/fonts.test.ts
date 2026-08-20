import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MATH_ASSETS, MATH_FONT_BYTES, MATH_FONT_FILES } from './fonts';

const provenance = readFileSync('public/math/PROVENANCE.txt', 'utf8');

describe('vendored maths fonts', () => {
  it('lists the twenty faces the vendoring script insists on', () => {
    expect(MATH_FONT_FILES).toHaveLength(20);
    expect([...MATH_FONT_FILES]).toEqual([...MATH_FONT_FILES].sort());
  });

  it('bundles the stylesheet alongside them', () => {
    // The stylesheet is not decoration: its `--ML__static-fonts` rule is what
    // stops MathLive loading fonts its own way.
    expect(MATH_ASSETS).toHaveLength(21);
    expect(MATH_ASSETS[0]).toContain('mathlive-fonts.css');
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
