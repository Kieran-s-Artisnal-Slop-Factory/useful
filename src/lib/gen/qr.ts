/**
 * QR creation (plan §5.3.1) — a thin option-mapping wrapper over the
 * statically bundled `qrcode` encoder, kept separate from the UI so the
 * option plumbing unit-tests in node (the SVG renderer is DOM-free).
 */
import QRCode from 'qrcode';

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
}

export function qrSvg(text: string, opts: QrOptions): Promise<string> {
  return QRCode.toString(text, {
    type: 'svg',
    errorCorrectionLevel: opts.ecLevel,
    width: opts.size,
    margin: 2,
  });
}

/** PNG data URL — browser only (canvas-backed). */
export function qrPngDataUrl(text: string, opts: QrOptions): Promise<string> {
  return QRCode.toDataURL(text, {
    errorCorrectionLevel: opts.ecLevel,
    width: opts.size,
    margin: 2,
  });
}
