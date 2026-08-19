/**
 * Logo/app-icon generation: procedural avatars (DiceBear), identicons
 * (Jdenticon), and badges (a Lucide icon or an emoji on a coloured tile).
 *
 * Ported from retoken's icon designer, restricted to the two modes this app
 * wants. Its **Upload** mode is gone, and its **SVG editor** mode is gone too —
 * this app already has a far better one, so a logo hands off to
 * `/tools/svg-editor/` instead of carrying a second, weaker builder.
 *
 * Everything here is a pure function over state EXCEPT the three loaders,
 * which `import()` their engine on first use: a tab nobody opens downloads
 * nothing. XML escaping and the data-URI helper come from src/lib/svg/build.ts
 * rather than being duplicated.
 */
import { escapeXml, svgInner } from '../svg/build';

const XMLNS = 'http://www.w3.org/2000/svg';
const round = (n: number): number => Math.round(n * 100) / 100;

/** The 256×256 box every generator here draws into. */
export const LOGO_SIZE = 256;

export type LogoMode = 'generator' | 'badge';
export type LogoEngine = 'dicebear' | 'jdenticon';

export interface DicebearState {
  /** Style key from @dicebear/collection, e.g. "shapes". */
  style: string;
  /** Seed text; empty = use the fallback name. */
  seed: string;
}

/** Mirrors the knobs on jdenticon.com's icon designer. */
export interface JdenticonState {
  /** Value to hash; empty = use the fallback name. */
  value: string;
  /** Allowed hues in degrees (0–360); empty = all hues. */
  hues: number[];
  colorSaturation: number; // 0..1
  grayscaleSaturation: number; // 0..1
  colorLightness: [number, number];
  grayscaleLightness: [number, number];
  backColor: string;
  transparentBack: boolean;
  padding: number; // 0..0.45
}

/** A solid tile with a library icon or an emoji on it. */
export interface BadgeState {
  background: string;
  /** Corner radius on the 256 tile, 0..128. */
  radius: number;
  kind: 'icon' | 'emoji';
  /** lucide-static export name (PascalCase), e.g. "Rocket". */
  icon: string;
  emoji: string;
  /** Stroke colour for a library icon. */
  color: string;
}

export interface LogoConfig {
  mode: LogoMode;
  engine: LogoEngine;
  dicebear: DicebearState;
  jdenticon: JdenticonState;
  badge: BadgeState;
}

export function defaultLogo(): LogoConfig {
  return {
    mode: 'generator',
    engine: 'dicebear',
    dicebear: { style: 'shapes', seed: '' },
    jdenticon: {
      value: '',
      hues: [],
      colorSaturation: 0.5,
      grayscaleSaturation: 0,
      colorLightness: [0.4, 0.8],
      grayscaleLightness: [0.3, 0.9],
      backColor: '#ffffff',
      transparentBack: true,
      padding: 0.08,
    },
    badge: {
      background: '#0d9488',
      radius: 56,
      kind: 'icon',
      icon: 'Rocket',
      emoji: '🚀',
      color: '#ffffff',
    },
  };
}

/* ------------------------------------------------------------- DiceBear --- */

/**
 * Which licence each style's ARTWORK carries. The code is MIT throughout; the
 * drawings are not, and 17 of the 31 styles ask for something in return.
 *
 * Kept as data rather than read from `node_modules` because the browser cannot
 * see package.json — a unit test checks this map against what is actually
 * installed, so an upgrade that relicenses a style fails the suite instead of
 * silently dropping an attribution.
 */
export type StyleLicense = 'mit' | 'cc-by-4.0' | 'personal-and-commercial';

export const STYLE_LICENSES: Record<string, StyleLicense> = {
  adventurer: 'cc-by-4.0',
  adventurerNeutral: 'cc-by-4.0',
  avataaars: 'personal-and-commercial',
  avataaarsNeutral: 'personal-and-commercial',
  bigEars: 'cc-by-4.0',
  bigEarsNeutral: 'cc-by-4.0',
  bigSmile: 'cc-by-4.0',
  bottts: 'personal-and-commercial',
  botttsNeutral: 'personal-and-commercial',
  croodles: 'cc-by-4.0',
  croodlesNeutral: 'cc-by-4.0',
  dylan: 'cc-by-4.0',
  funEmoji: 'cc-by-4.0',
  glass: 'mit',
  icons: 'mit',
  identicon: 'mit',
  initials: 'mit',
  lorelei: 'mit',
  loreleiNeutral: 'mit',
  micah: 'cc-by-4.0',
  miniavs: 'cc-by-4.0',
  notionists: 'mit',
  notionistsNeutral: 'mit',
  openPeeps: 'mit',
  personas: 'cc-by-4.0',
  pixelArt: 'mit',
  pixelArtNeutral: 'mit',
  rings: 'mit',
  shapes: 'mit',
  thumbs: 'mit',
  toonHead: 'cc-by-4.0',
};

/** What a user has to do if they ship a logo made with this style. */
export const LICENSE_NOTES: Record<StyleLicense, string> = {
  mit: 'MIT — use it anywhere, no attribution required.',
  'cc-by-4.0': 'Artwork is CC BY 4.0 — credit the original artist wherever you use it.',
  'personal-and-commercial':
    'Artwork is free for personal and commercial use under its own licence, which is not an open-source one — check it before shipping.',
};

/** A style key as a readable label: `bigEarsNeutral` → "Big ears neutral". */
export function styleLabel(style: string): string {
  const spaced = style.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

export interface DicebearApi {
  /** Style key → style module. */
  styles: Record<string, unknown>;
  render(style: string, seed: string): string;
}

let dicebearApi: Promise<DicebearApi> | null = null;

/** Lazily load @dicebear/core + collection once (31 styles, ~2 MB of chunk). */
export function loadDicebear(): Promise<DicebearApi> {
  if (!dicebearApi) {
    dicebearApi = Promise.all([import('@dicebear/core'), import('@dicebear/collection')])
      .then(([core, collection]) => {
        const styles = Object.fromEntries(
          Object.entries(collection).filter(([, v]) => typeof v === 'object' && v !== null)
        );
        return {
          styles,
          render(style: string, seed: string): string {
            const def = styles[style];
            if (!def) throw new Error(`Unknown DiceBear style "${style}"`);
            return core.createAvatar(def as Parameters<typeof core.createAvatar>[0], { seed }).toString();
          },
        };
      })
      // Never cache a rejected promise: one failed chunk load would otherwise
      // poison every later attempt on the page.
      .catch((err) => {
        dicebearApi = null;
        throw err;
      });
  }
  return dicebearApi;
}

export async function buildDicebear(style: string, seed: string): Promise<string> {
  return (await loadDicebear()).render(style, seed);
}

/* ------------------------------------------------------------ Jdenticon --- */

/** Map the designer state onto jdenticon's own config object. */
export function jdenticonConfig(state: JdenticonState): Record<string, unknown> {
  return {
    hues: state.hues.length > 0 ? state.hues : undefined,
    lightness: {
      color: [...state.colorLightness],
      grayscale: [...state.grayscaleLightness],
    },
    saturation: { color: state.colorSaturation, grayscale: state.grayscaleSaturation },
    backColor: state.transparentBack ? '#00000000' : state.backColor,
    padding: state.padding,
  };
}

export async function buildJdenticon(state: JdenticonState, fallbackValue: string): Promise<string> {
  const { toSvg } = await import('jdenticon');
  const value = state.value.trim() || fallbackValue;
  return toSvg(value, LOGO_SIZE, jdenticonConfig(state));
}

/* ---------------------------------------------------------------- Badge --- */

export interface LucideApi {
  names: string[];
  /** The raw 24×24 SVG string for an icon name. */
  svg(name: string): string | undefined;
}

let lucideApi: Promise<LucideApi> | null = null;

/**
 * Lazily load lucide-static (~2,000 icons, ISC). Lucide excludes trademarked
 * brand logos by policy, which is why there is no company mark in the picker.
 */
export function loadLucide(): Promise<LucideApi> {
  if (!lucideApi) {
    lucideApi = import('lucide-static')
      .then((mod) => {
        const entries = Object.entries(mod).filter(
          ([name, v]) => typeof v === 'string' && /^[A-Z]/.test(name)
        ) as [string, string][];
        const map = new Map(entries);
        return {
          names: entries.map(([name]) => name).sort(),
          svg: (name: string) => map.get(name),
        };
      })
      .catch((err) => {
        lucideApi = null;
        throw err;
      });
  }
  return lucideApi;
}

/**
 * Compose the badge from its state plus the raw Lucide markup (when the badge
 * is an icon). Pure, so the composition is unit-testable without the engine.
 */
export function composeBadge(state: BadgeState, iconSvg: string | undefined): string {
  const fg =
    state.kind === 'icon' && iconSvg
      ? // A 24×24 icon scaled to 160px and centred on the 256 tile. Lucide icons
        // are stroke-drawn, so the colour flows through `stroke` on the wrapper.
        `<g transform="translate(48 48) scale(${round(160 / 24)})" fill="none" stroke="${escapeXml(
          state.color
        )}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${svgInner(iconSvg)}</g>`
      : `<text x="128" y="140" font-size="150" text-anchor="middle" dominant-baseline="central">${escapeXml(
          state.emoji || '🙂'
        )}</text>`;
  return `<svg xmlns="${XMLNS}" viewBox="0 0 ${LOGO_SIZE} ${LOGO_SIZE}">
  <rect width="${LOGO_SIZE}" height="${LOGO_SIZE}" rx="${round(state.radius)}" fill="${escapeXml(
    state.background
  )}"/>
  ${fg}
</svg>
`;
}

export async function buildBadge(state: BadgeState): Promise<string> {
  const iconSvg = state.kind === 'icon' ? (await loadLucide()).svg(state.icon) : undefined;
  return composeBadge(state, iconSvg);
}

/* ----------------------------------------------------------- dispatcher --- */

/** Build whatever the config currently describes. */
export async function buildLogo(config: LogoConfig, fallbackName: string): Promise<string> {
  if (config.mode === 'badge') return buildBadge(config.badge);
  if (config.engine === 'jdenticon') return buildJdenticon(config.jdenticon, fallbackName);
  return buildDicebear(config.dicebear.style, config.dicebear.seed.trim() || fallbackName);
}
