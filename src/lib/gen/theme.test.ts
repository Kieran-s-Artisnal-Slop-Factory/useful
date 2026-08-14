import { describe, expect, it } from 'vitest';
import { buildTheme, contrastOn, THEME_ROLES, type ThemeInput } from './theme';

const input = (over: Partial<ThemeInput> = {}): ThemeInput => ({
  colors: ['#1e3a5f', null, null, null, null],
  paddingPx: 12,
  radiusPx: 8,
  ...over,
});

describe('contrastOn', () => {
  it('picks white on dark colors, near-black on light ones', () => {
    expect(contrastOn('#1e3a5f')).toBe('#ffffff');
    expect(contrastOn('#000080')).toBe('#ffffff');
    expect(contrastOn('#ffd700')).toBe('#111111');
    expect(contrastOn('#ffffff')).toBe('#111111');
  });
});

describe('buildTheme', () => {
  it('emits a complete :root block with light-dark() and the knobs', () => {
    const t = buildTheme(input());
    expect(t.css).toMatch(/^:root \{\n  color-scheme: light dark;/);
    expect(t.css).toContain('--primary: light-dark(#1e3a5f,');
    expect(t.css).toContain('--on-primary: light-dark(#ffffff,');
    expect(t.css).toContain('--surface: light-dark(');
    expect(t.css).toContain('--text: light-dark(');
    expect(t.css).toContain('--border: light-dark(');
    expect(t.css).toContain('--padding: 12px;');
    expect(t.css).toContain('--radius: 8px;');
    expect(t.css.trim().endsWith('}')).toBe(true);
  });

  it('covers all five roles, deriving the missing ones from the primary', () => {
    const t = buildTheme(input());
    expect(t.swatches.map((s) => s.role)).toEqual([...THEME_ROLES]);
    expect(t.swatches[0]!.derived).toBe(false);
    for (const s of t.swatches.slice(1)) expect(s.derived, s.role).toBe(true);
    // Derived secondary is the complement — a different hue, not a copy.
    expect(t.swatches[1]!.light).not.toBe(t.swatches[0]!.light);
  });

  it('uses every user color when the full swatch is given', () => {
    const t = buildTheme(
      input({ colors: ['#1e3a5f', '#e8a13a', '#2f8f5f', '#6b7280', '#faf7f0'] })
    );
    expect(t.swatches.every((s) => !s.derived)).toBe(true);
    expect(t.css).toContain('--secondary: light-dark(#e8a13a,');
    expect(t.css).toContain('--accent: light-dark(#2f8f5f,');
  });

  it('dark variants differ from light and stay in range', () => {
    const t = buildTheme(input());
    for (const s of t.swatches) {
      expect(s.dark, s.role).toMatch(/^#[0-9a-f]{6}$/);
      expect(s.dark, s.role).not.toBe(s.light);
    }
  });

  it('accepts any parseable CSS color and survives junk', () => {
    const t = buildTheme(input({ colors: ['oklch(0.63 0.26 29)', 'not-a-color', null, null, null] }));
    expect(t.swatches[0]!.derived).toBe(false);
    expect(t.swatches[1]!.derived).toBe(true); // junk falls back to derived
    expect(t.css).toContain('--primary: light-dark(#');
  });

  it('vars mirror the css (drives the live preview)', () => {
    const t = buildTheme(input());
    for (const [name, value] of t.vars) {
      expect(t.css).toContain(`${name}: ${value};`);
    }
  });
});
