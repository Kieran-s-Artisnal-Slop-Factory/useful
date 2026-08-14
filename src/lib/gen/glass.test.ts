import { describe, expect, it } from 'vitest';
import { DEFAULT_GLASS, glassCss, glassInlineStyle, glassProperties, type GlassDef } from './glass';

const def = (over: Partial<GlassDef>): GlassDef => ({ ...DEFAULT_GLASS, ...over });

describe('glassCss', () => {
  it('emits the full glass block with defaults', () => {
    const css = glassCss(DEFAULT_GLASS);
    expect(css).toContain('background: rgb(255 255 255 / 0.15);');
    expect(css).toContain('backdrop-filter: blur(10px) saturate(140%);');
    expect(css).toContain('-webkit-backdrop-filter: blur(10px) saturate(140%);');
    expect(css).toContain('border: 1px solid rgb(255 255 255 / 0.3);');
    expect(css).toContain('border-radius: 12px;');
    expect(css).toContain('box-shadow:');
  });

  it('accepts any parseable tint color and ignores its own alpha', () => {
    const css = glassCss(def({ tint: 'rebeccapurple', tintOpacity: 0.4 }));
    expect(css).toContain('background: rgb(102 51 153 / 0.4);');
    const hsl = glassCss(def({ tint: 'hsl(0 100% 50%)' }));
    expect(hsl).toContain('background: rgb(255 0 0 / 0.15);');
  });

  it('falls back to white when the tint fails to parse', () => {
    expect(glassCss(def({ tint: 'not-a-color' }))).toContain('rgb(255 255 255');
  });

  it('drops saturate() at 100% and the shadow when off', () => {
    const css = glassCss(def({ saturation: 100, shadow: false }));
    expect(css).toContain('backdrop-filter: blur(10px);');
    expect(css).not.toContain('saturate');
    expect(css).not.toContain('box-shadow');
  });

  it('inline style is the same properties joined for a style attribute', () => {
    const style = glassInlineStyle(DEFAULT_GLASS);
    for (const [prop, value] of glassProperties(DEFAULT_GLASS)) {
      expect(style).toContain(`${prop}: ${value}`);
    }
    expect(style).not.toContain(';;');
  });
});
