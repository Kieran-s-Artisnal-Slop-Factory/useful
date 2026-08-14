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
