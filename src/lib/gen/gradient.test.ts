import { describe, expect, it } from 'vitest';
import { DEFAULT_GRADIENT, gradientCss, gradientDeclaration, type GradientDef } from './gradient';

const def = (over: Partial<GradientDef>): GradientDef => ({ ...DEFAULT_GRADIENT, ...over });

describe('gradientCss', () => {
  it('builds linear gradients with angle and stop positions', () => {
    expect(gradientCss(DEFAULT_GRADIENT)).toBe(
      'linear-gradient(135deg, #1e3a5f 0%, #e8a13a 100%)'
    );
  });

  it('omits positions the user left unset', () => {
    expect(
      gradientCss(def({ stops: [{ color: 'red', position: null }, { color: 'blue', position: null }] }))
    ).toBe('linear-gradient(135deg, red, blue)');
  });

  it('builds conic gradients with a from-angle', () => {
    expect(gradientCss(def({ kind: 'conic', angle: 90 }))).toBe(
      'conic-gradient(from 90deg, #1e3a5f 0%, #e8a13a 100%)'
    );
  });

  it('builds radial gradients with the shape', () => {
    expect(gradientCss(def({ kind: 'radial', shape: 'circle' }))).toBe(
      'radial-gradient(circle, #1e3a5f 0%, #e8a13a 100%)'
    );
  });

  it('supports repeating variants and multi-stop lists', () => {
    const g = def({
      repeating: true,
      stops: [
        { color: '#000', position: 0 },
        { color: '#fff', position: 10.5 },
        { color: '#000', position: 20 },
      ],
    });
    expect(gradientCss(g)).toBe(
      'repeating-linear-gradient(135deg, #000 0%, #fff 10.5%, #000 20%)'
    );
  });

  it('wraps the declaration for copying', () => {
    expect(gradientDeclaration(DEFAULT_GRADIENT)).toBe(
      'background: linear-gradient(135deg, #1e3a5f 0%, #e8a13a 100%);'
    );
  });
});
