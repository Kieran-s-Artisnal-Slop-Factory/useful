import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  buildBadge,
  buildDicebear,
  buildJdenticon,
  buildLogo,
  composeBadge,
  defaultLogo,
  jdenticonConfig,
  LICENSE_NOTES,
  loadLucide,
  LOGO_SIZE,
  STYLE_LICENSES,
  styleLabel,
  type BadgeState,
} from './logo';

const badge = (over: Partial<BadgeState> = {}): BadgeState => ({ ...defaultLogo().badge, ...over });

describe('composeBadge', () => {
  it('draws the tile at the logo size with the chosen radius and colour', () => {
    const svg = composeBadge(badge({ background: '#123456', radius: 24 }), undefined);
    expect(svg).toContain(`viewBox="0 0 ${LOGO_SIZE} ${LOGO_SIZE}"`);
    expect(svg).toContain('rx="24"');
    expect(svg).toContain('fill="#123456"');
  });

  it('scales a 24-unit icon onto the 256 tile and paints it by stroke', () => {
    // Lucide icons are stroke-drawn: colouring them with `fill` produces a
    // solid blob, which is why the wrapper sets fill="none".
    const icon = '<svg viewBox="0 0 24 24"><path d="M1 2"/></svg>';
    const svg = composeBadge(badge({ kind: 'icon', color: '#ffffff' }), icon);
    expect(svg).toContain('transform="translate(48 48) scale(6.67)"');
    expect(svg).toContain('fill="none"');
    expect(svg).toContain('stroke="#ffffff"');
    expect(svg).toContain('<path d="M1 2"/>');
  });

  it('falls back to the emoji when the icon markup is missing', () => {
    const svg = composeBadge(badge({ kind: 'icon', emoji: '🚀' }), undefined);
    expect(svg).toContain('🚀');
    expect(svg).not.toContain('<g transform');
  });

  it('uses a default face rather than emitting an empty badge', () => {
    expect(composeBadge(badge({ kind: 'emoji', emoji: '' }), undefined)).toContain('🙂');
  });

  it('escapes everything a caller could smuggle in', () => {
    // Colours and the emoji come from free-text fields, so they cannot be
    // allowed to close an attribute or open an element.
    const svg = composeBadge(
      badge({
        kind: 'emoji',
        emoji: '"><script>alert(1)</script>',
        background: '"><script>x</script>',
      }),
      undefined
    );
    expect(svg).not.toContain('<script>');
    expect(svg).toContain('&quot;&gt;&lt;script&gt;');
  });
});

describe('jdenticonConfig', () => {
  it('omits the hue list entirely when no hues are chosen', () => {
    // jdenticon treats an empty array as "no hues allowed" and renders grey;
    // undefined is what means "any hue".
    expect(jdenticonConfig(defaultLogo().jdenticon).hues).toBeUndefined();
    expect(jdenticonConfig({ ...defaultLogo().jdenticon, hues: [200] }).hues).toEqual([200]);
  });

  it('sends the transparent sentinel rather than a colour when back is off', () => {
    const state = defaultLogo().jdenticon;
    expect(jdenticonConfig({ ...state, transparentBack: true }).backColor).toBe('#00000000');
    expect(jdenticonConfig({ ...state, transparentBack: false, backColor: '#ff0000' }).backColor).toBe(
      '#ff0000'
    );
  });

  it('copies the range arrays instead of aliasing the state', () => {
    const state = defaultLogo().jdenticon;
    const config = jdenticonConfig(state) as { lightness: { color: number[] } };
    config.lightness.color[0] = 0.99;
    expect(state.colorLightness[0]).toBe(0.4);
  });
});

describe('styleLabel', () => {
  it('turns a camelCase key into a readable name', () => {
    expect(styleLabel('shapes')).toBe('Shapes');
    expect(styleLabel('bigEarsNeutral')).toBe('Big ears neutral');
    expect(styleLabel('pixelArt')).toBe('Pixel art');
  });
});

describe('style licences', () => {
  it('has a note for every licence kind it can report', () => {
    for (const license of new Set(Object.values(STYLE_LICENSES))) {
      expect(LICENSE_NOTES[license], license).toBeTruthy();
    }
  });

  it('matches the licences of the packages actually installed', async () => {
    // The browser cannot read package.json, so the map is committed data — this
    // is what stops it drifting when @dicebear/collection is upgraded and a
    // style quietly changes terms.
    const collection = await import('@dicebear/collection');
    const styles = Object.entries(collection)
      .filter(([, v]) => typeof v === 'object' && v !== null)
      .map(([name]) => name);

    expect(styles.length).toBeGreaterThan(0);
    expect(Object.keys(STYLE_LICENSES).sort()).toEqual([...styles].sort());

    const kebab = (s: string) => s.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
    for (const style of styles) {
      const path = `node_modules/@dicebear/${kebab(style)}/package.json`;
      if (!existsSync(path)) continue; // bundled into the collection itself
      const declared = String(JSON.parse(readFileSync(path, 'utf8')).license);
      const expected =
        declared === 'MIT'
          ? 'mit'
          : declared.includes('CC-BY-4.0')
            ? 'cc-by-4.0'
            : 'personal-and-commercial';
      expect(STYLE_LICENSES[style], `${style} is declared "${declared}"`).toBe(expected);
    }
  });

  it('knows that most styles need attribution', () => {
    const needing = Object.values(STYLE_LICENSES).filter((l) => l !== 'mit');
    expect(needing.length).toBeGreaterThan(10);
  });
});

describe('the engines', () => {
  it('DiceBear renders a deterministic SVG for a seed', async () => {
    const a = await buildDicebear('shapes', 'useful');
    const b = await buildDicebear('shapes', 'useful');
    const c = await buildDicebear('shapes', 'different');
    expect(a).toContain('<svg');
    expect(a).toBe(b); // same seed, same picture
    expect(a).not.toBe(c);
  });

  it('DiceBear refuses a style it does not have', async () => {
    await expect(buildDicebear('not-a-style', 'x')).rejects.toThrow(/Unknown DiceBear style/);
  });

  it('Jdenticon renders at the logo size and is seeded by its value', async () => {
    const state = defaultLogo().jdenticon;
    const a = await buildJdenticon(state, 'useful');
    const b = await buildJdenticon({ ...state, value: 'other' }, 'useful');
    expect(a).toContain(`width="${LOGO_SIZE}"`);
    expect(a).not.toBe(b);
    // An empty value falls back to the supplied name, so the two agree.
    expect(await buildJdenticon({ ...state, value: '  ' }, 'useful')).toBe(a);
  });

  it('Lucide exposes a large, sorted, brand-free icon list', async () => {
    const lucide = await loadLucide();
    expect(lucide.names.length).toBeGreaterThan(1000);
    expect([...lucide.names]).toEqual([...lucide.names].sort());
    expect(lucide.svg(lucide.names[0]!)).toContain('<svg');
    expect(lucide.svg('NotAnIcon')).toBeUndefined();
    // Lucide excludes trademarked logos by policy; spot-check a few.
    for (const brand of ['Github', 'Twitter', 'Facebook', 'Google']) {
      expect(lucide.names, `${brand} should not be in a brand-free set`).not.toContain(brand);
    }
  });

  it('a badge with a real Lucide icon carries that icon markup', async () => {
    const svg = await buildBadge(badge({ kind: 'icon', icon: 'Rocket' }));
    expect(svg).toContain('stroke="#ffffff"');
    expect(svg).toContain('<g transform=');
    expect(svg.length).toBeGreaterThan(200);
  });
});

describe('buildLogo', () => {
  it('dispatches on mode and engine', async () => {
    const config = defaultLogo();
    expect(await buildLogo(config, 'useful')).toBe(await buildDicebear('shapes', 'useful'));
    expect(await buildLogo({ ...config, engine: 'jdenticon' }, 'useful')).toBe(
      await buildJdenticon(config.jdenticon, 'useful')
    );
    expect(await buildLogo({ ...config, mode: 'badge' }, 'useful')).toContain('<rect');
  });

  it('uses the fallback name when the seed is blank', async () => {
    const config = defaultLogo();
    expect(await buildLogo(config, 'fallback')).toBe(await buildDicebear('shapes', 'fallback'));
  });
});
