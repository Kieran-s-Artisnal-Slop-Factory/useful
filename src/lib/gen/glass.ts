/**
 * Glassmorphism CSS building (plan §5.1.3): backdrop blur, tint transparency
 * and border controls in, a copyable CSS block out. Pure function so the live
 * preview styles and the copied text are the same string.
 */
import { parseCssColor } from './color';

export interface GlassDef {
  /** Backdrop blur radius in px. */
  blur: number;
  /** Any CSS color; its own alpha is ignored (tintOpacity rules). */
  tint: string;
  /** 0..1 — background tint opacity. */
  tintOpacity: number;
  /** Backdrop saturation %, 100 = unchanged. */
  saturation: number;
  /** 0..1 — border visibility. */
  borderOpacity: number;
  /** Corner radius in px. */
  radius: number;
  shadow: boolean;
}

export const DEFAULT_GLASS: GlassDef = {
  blur: 10,
  tint: '#ffffff',
  tintOpacity: 0.15,
  saturation: 140,
  borderOpacity: 0.3,
  radius: 12,
  shadow: true,
};

/**
 * One-click starting points (plan follow-up 2026-08-14). Each is a complete
 * def, so applying one is a plain state replacement the controls then tweak.
 */
export const GLASS_PRESETS: { id: string; label: string; def: GlassDef }[] = [
  {
    id: 'frosted-light',
    label: 'Frosted · light',
    def: { blur: 6, tint: '#ffffff', tintOpacity: 0.1, saturation: 120, borderOpacity: 0.2, radius: 12, shadow: false },
  },
  {
    id: 'frosted-medium',
    label: 'Frosted · medium',
    def: { blur: 12, tint: '#ffffff', tintOpacity: 0.18, saturation: 140, borderOpacity: 0.3, radius: 12, shadow: true },
  },
  {
    id: 'frosted-strong',
    label: 'Frosted · strong',
    def: { blur: 28, tint: '#ffffff', tintOpacity: 0.3, saturation: 160, borderOpacity: 0.4, radius: 12, shadow: true },
  },
  {
    id: 'dark-frost',
    label: 'Dark frosted',
    def: { blur: 16, tint: '#10141c', tintOpacity: 0.45, saturation: 120, borderOpacity: 0.18, radius: 12, shadow: true },
  },
  {
    id: 'ios-clear',
    // The iOS look: barely-there tint, heavy blur, saturation pushed well past
    // 100 so the backdrop's colors refract through.
    label: 'iOS clear',
    def: { blur: 24, tint: '#ffffff', tintOpacity: 0.08, saturation: 190, borderOpacity: 0.25, radius: 18, shadow: false },
  },
  {
    id: 'tint-blue',
    label: 'Blue tint',
    def: { blur: 14, tint: '#2f6fb0', tintOpacity: 0.28, saturation: 140, borderOpacity: 0.35, radius: 12, shadow: true },
  },
  {
    id: 'tint-amber',
    label: 'Amber tint',
    def: { blur: 14, tint: '#e8a13a', tintOpacity: 0.28, saturation: 140, borderOpacity: 0.35, radius: 12, shadow: true },
  },
  {
    id: 'tint-rose',
    label: 'Rose tint',
    def: { blur: 14, tint: '#c04a6b', tintOpacity: 0.28, saturation: 140, borderOpacity: 0.35, radius: 12, shadow: true },
  },
];

const round = (n: number, d = 2): number => Math.round(n * 10 ** d) / 10 ** d;

/** "255 255 255" from any parseable CSS color (falls back to white). */
function tintChannels(tint: string): string {
  const parsed = parseCssColor(tint);
  const rgb = parsed ? parsed.rgb : [1, 1, 1];
  return rgb.map((v) => Math.round(Math.min(1, Math.max(0, v)) * 255)).join(' ');
}

/** The properties as [property, value] pairs (drives the preview). */
export function glassProperties(def: GlassDef): [string, string][] {
  const rgb = tintChannels(def.tint);
  const filter = `blur(${round(def.blur)}px)` +
    (def.saturation === 100 ? '' : ` saturate(${round(def.saturation)}%)`);
  const props: [string, string][] = [
    ['background', `rgb(${rgb} / ${round(def.tintOpacity)})`],
    ['backdrop-filter', filter],
    ['-webkit-backdrop-filter', filter],
    ['border', `1px solid rgb(${rgb} / ${round(def.borderOpacity)})`],
    ['border-radius', `${round(def.radius)}px`],
  ];
  if (def.shadow) props.push(['box-shadow', '0 8px 32px rgb(0 0 0 / 0.2)']);
  return props;
}

/** The copyable CSS block. */
export function glassCss(def: GlassDef): string {
  return glassProperties(def)
    .map(([prop, value]) => `${prop}: ${value};`)
    .join('\n');
}

/** Inline style attribute value for the live preview. */
export function glassInlineStyle(def: GlassDef): string {
  return glassProperties(def)
    .map(([prop, value]) => `${prop}: ${value}`)
    .join('; ');
}
