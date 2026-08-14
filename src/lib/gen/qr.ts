/**
 * QR creation (plan §5.3.1) — a thin option-mapping wrapper over the
 * statically bundled `qrcode` encoder, kept separate from the UI so the
 * option plumbing unit-tests in node (the SVG renderer is DOM-free).
 */
import QRCode from 'qrcode';
import { parseCssColor } from './color';

export type EcLevel = 'L' | 'M' | 'Q' | 'H';

export const EC_LEVELS: { id: EcLevel; label: string }[] = [
  { id: 'L', label: 'L — low (~7% recovery)' },
  { id: 'M', label: 'M — medium (~15%)' },
  { id: 'Q', label: 'Q — quartile (~25%)' },
  { id: 'H', label: 'H — high (~30%)' },
];

export const QR_SIZES = [128, 256, 512, 1024];

export interface QrOptions {
  /** Output edge length in px (PNG) / viewport hint (SVG). */
  size: number;
  ecLevel: EcLevel;
  /** Module (foreground) color — #rrggbb. Default black. */
  dark?: string;
  /** Background color — #rrggbb. Default white. */
  light?: string;
}

const colorOpts = (opts: QrOptions) => ({
  dark: opts.dark ?? '#000000',
  light: opts.light ?? '#ffffff',
});

export function qrSvg(text: string, opts: QrOptions): Promise<string> {
  return QRCode.toString(text, {
    type: 'svg',
    errorCorrectionLevel: opts.ecLevel,
    width: opts.size,
    margin: 2,
    color: colorOpts(opts),
  });
}

/** PNG data URL — browser only (canvas-backed). */
export function qrPngDataUrl(text: string, opts: QrOptions): Promise<string> {
  return QRCode.toDataURL(text, {
    errorCorrectionLevel: opts.ecLevel,
    width: opts.size,
    margin: 2,
    color: colorOpts(opts),
  });
}

/**
 * Scanner-friendliness check for a color pair. Scanners binarize the image
 * and most expect DARK modules on a LIGHT background; low contrast fails
 * outright. Returns a human warning, or null when the pair is safe.
 */
export function qrColorWarning(dark: string, light: string): string | null {
  const d = parseCssColor(dark);
  const l = parseCssColor(light);
  if (!d || !l) return null; // the pickers only emit valid hex anyway
  const dl = luminance(d.rgb);
  const ll = luminance(l.rgb);
  if (dl > ll) {
    return 'Inverted colors (light code on dark background) — many scanners refuse these.';
  }
  const ratio = (ll + 0.05) / (dl + 0.05);
  if (ratio < 3) {
    return 'Low contrast between code and background — this may not scan reliably.';
  }
  return null;
}

/** WCAG relative luminance of a gamma sRGB triple. */
function luminance(rgb: [number, number, number]): number {
  const [r, g, b] = rgb.map((c) =>
    c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  ) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
