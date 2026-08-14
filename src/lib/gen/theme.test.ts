import { describe, expect, it } from 'vitest';
import { buildTheme, contrastOn, contrastRatio, THEME_ROLES, type ThemeInput } from './theme';

const role = (light: string | null = null, dark: string | null = null) => ({ light, dark });

const input = (over: Partial<ThemeInput> = {}): ThemeInput => ({
  colors: [role('#1e3a5f'), role(), role(), role(), role()],
  paddingPx: 12,
  radiusPx: 8,
  ...over,
});

describe('contrast helpers', () => {
  it('contrastOn picks white on dark colors, near-black on light ones', () => {
    expect(contrastOn('#1e3a5f')).toBe('#ffffff');
    expect(contrastOn('#ffd700')).toBe('#111111');
    expect(contrastOn('#ffffff')).toBe('#111111');
  });

  it('contrastRatio matches known WCAG values', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 0);
    expect(contrastRatio('#ffffff', '#000000')).toBeCloseTo(21, 0);
    expect(contrastRatio('#777777', '#777777')).toBeCloseTo(1, 5);
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

  it('covers all five roles, deriving the missing slots', () => {
    const t = buildTheme(input());
    expect(t.swatches.map((s) => s.role)).toEqual([...THEME_ROLES]);
    expect(t.swatches[0]!.derivedLight).toBe(false);
    expect(t.swatches[0]!.derivedDark).toBe(true); // dark slot not given
    for (const s of t.swatches.slice(1)) {
      expect(s.derivedLight, s.role).toBe(true);
      expect(s.derivedDark, s.role).toBe(true);
    }
    expect(t.swatches[1]!.light).not.toBe(t.swatches[0]!.light);
  });

  it('honors explicit dark-slot overrides', () => {
    const t = buildTheme(input({ colors: [role('#1e3a5f', '#a5c8ff'), role(), role(), role(), role()] }));
    expect(t.swatches[0]!.dark).toBe('#a5c8ff');
    expect(t.swatches[0]!.derivedDark).toBe(false);
    expect(t.css).toContain('--primary: light-dark(#1e3a5f, #a5c8ff);');
    // On-color follows the override: light blue needs dark text.
    expect(t.swatches[0]!.onDark).toBe('#111111');
  });

  it('uses every user color when the full swatch is given', () => {
    const t = buildTheme(
      input({ colors: [role('#1e3a5f'), role('#e8a13a'), role('#2f8f5f'), role('#6b7280'), role('#faf7f0')] })
    );
    expect(t.swatches.every((s) => !s.derivedLight)).toBe(true);
    expect(t.css).toContain('--secondary: light-dark(#e8a13a,');
    expect(t.css).toContain('--accent: light-dark(#2f8f5f,');
  });

  it('derived dark variants differ from light and stay in range', () => {
    const t = buildTheme(input());
    for (const s of t.swatches) {
      expect(s.dark, s.role).toMatch(/^#[0-9a-f]{6}$/);
      expect(s.dark, s.role).not.toBe(s.light);
    }
  });

  it('the default derivation raises no contrast warnings', () => {
    expect(buildTheme(input()).warnings).toEqual([]);
  });

  it('warns per scheme when a role sinks into the background', () => {
    // Near-white primary on the (near-white) derived light surface.
    const light = buildTheme(input({ colors: [role('#f3f5f7'), role(), role(), role(), role()] }));
    expect(light.warnings.some((w) => w.role === 'primary' && w.scheme === 'light')).toBe(true);

    // A too-dark dark-slot override vs the near-black dark surface.
    const dark = buildTheme(input({ colors: [role('#1e3a5f', '#20242c'), role(), role(), role(), role()] }));
    expect(dark.warnings.some((w) => w.role === 'primary' && w.scheme === 'dark')).toBe(true);
    expect(dark.warnings.every((w) => w.ratio < 3)).toBe(true);
  });

  it('accepts any parseable CSS color and survives junk', () => {
    const t = buildTheme(input({ colors: [role('oklch(0.63 0.26 29)'), role('not-a-color'), role(), role(), role()] }));
    expect(t.swatches[0]!.derivedLight).toBe(false);
    expect(t.swatches[1]!.derivedLight).toBe(true); // junk falls back to derived
    expect(t.css).toContain('--primary: light-dark(#');
  });

  it('vars mirror the css (drives the live preview)', () => {
    const t = buildTheme(input());
    for (const [name, value] of t.vars) {
      expect(t.css).toContain(`${name}: ${value};`);
    }
  });
});
