/**
 * Placeholder dimensions (0.3.0 phase 11).
 *
 * Small enough to look trivial, and it is not: an aspect lock that recomputes
 * the wrong side turns "make it 1200 wide" into a picture that creeps, and a
 * ratio applied to both sides in turn drifts by a pixel every time. The lock
 * always drives from the side that was just edited, and rounds once.
 */

export interface RatioPreset {
  id: string;
  label: string;
  width: number;
  height: number;
}

export const RATIOS: RatioPreset[] = [
  { id: '16:9', label: '16:9 — video, hero', width: 16, height: 9 },
  { id: '4:3', label: '4:3 — classic photo', width: 4, height: 3 },
  { id: '3:2', label: '3:2 — 35mm', width: 3, height: 2 },
  { id: '1:1', label: '1:1 — square', width: 1, height: 1 },
  { id: '9:16', label: '9:16 — phone, portrait', width: 9, height: 16 },
];

export interface SizePreset {
  label: string;
  width: number;
  height: number;
}

/** The sizes people actually ask for. */
export const SIZE_PRESETS: SizePreset[] = [
  { label: 'Hero 1200 × 675', width: 1200, height: 675 },
  { label: 'Card 800 × 600', width: 800, height: 600 },
  { label: 'Square 600 × 600', width: 600, height: 600 },
  { label: 'Thumbnail 320 × 180', width: 320, height: 180 },
  { label: 'Open Graph 1200 × 630', width: 1200, height: 630 },
  { label: 'Phone 1080 × 1920', width: 1080, height: 1920 },
];

export const ratioById = (id: string): RatioPreset | undefined => RATIOS.find((r) => r.id === id);

/**
 * The other side, given one side and a ratio.
 *
 * `edited` names the side that was just typed in, and it is the one left
 * alone — recomputing the side someone is holding is how a locked field
 * fights the person using it.
 */
export function applyRatio(
  width: number,
  height: number,
  ratio: RatioPreset,
  edited: 'width' | 'height'
): { width: number; height: number } {
  if (edited === 'width') {
    return { width: Math.round(width), height: Math.max(1, Math.round((width * ratio.height) / ratio.width)) };
  }
  return { width: Math.max(1, Math.round((height * ratio.width) / ratio.height)), height: Math.round(height) };
}

/** The ratio a size already is, if it matches a preset within a pixel of
 * rounding. Used to light up the matching button rather than to change
 * anything. */
export function matchRatio(width: number, height: number): RatioPreset | undefined {
  return RATIOS.find((r) => Math.abs(width * r.height - height * r.width) <= Math.max(width, height) * 0.01);
}

/** "1.8 MB" / "12.4 KB" — the same shape the image tools print. */
export function describeSize(width: number, height: number): string {
  const pixels = width * height;
  if (pixels >= 1_000_000) return `${(pixels / 1_000_000).toFixed(1)} megapixels`;
  return `${Math.round(pixels / 1000)}k pixels`;
}
