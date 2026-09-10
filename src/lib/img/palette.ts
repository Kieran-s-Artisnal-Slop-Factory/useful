/**
 * Palette extraction — the major colours of an image (0.5.0 plan Phase 1,
 * decision 2).
 *
 * The method is k-means in **OKLab**, not in RGB and not median-cut, and the
 * space is the whole reason it works:
 *
 *  - In OKLab, Euclidean distance approximates how different two colours
 *    LOOK. Cluster there and a gradient sky collapses into one blue, while a
 *    small saturated logo mark survives as its own entry — which is what a
 *    person means by "the major colours".
 *  - Median-cut is faster but splits by axis, so it cuts that same sky into
 *    three near-identical blues and reports them as three of your six.
 *  - k-means needs a seed. It gets a fixed one, through the app's single
 *    PRNG, so the same image and the same k give the same palette every time.
 *    That is what makes the whole thing unit-testable — and it also means
 *    nudging the count up and back down returns you to where you were.
 *
 * Cost: the image is downsampled to `MAX_SAMPLE_SIDE` on its long edge before
 * a single pixel is read, so the clustering runs over ~37k points regardless
 * of whether you handed it a phone photo or a 60-megapixel raw export. At
 * k = 16 that is a few million distance computations — a few tens of
 * milliseconds, which is why this is on the main thread and not in a worker.
 */
import { mulberry32 } from '../random';
import { allFormats, oklabToRgb, rgbToHex, rgbToOklab } from '../gen/color';
import { contrastOn, type RoleInput, type ThemeInput } from '../gen/theme';

/** Longest edge, in pixels, the sampler downscales to before reading pixels. */
export const MAX_SAMPLE_SIDE = 192;

/** Pixels more transparent than this are not colours, they are absence. */
export const MIN_ALPHA = 0.5;

/** Fixed seed: a palette is a fact about an image, not a roll of the dice. */
export const PALETTE_SEED = 0x9e3779b9;

/** Hard bounds on the requested colour count, matching the UI's input. */
export const MIN_COLORS = 2;
export const MAX_COLORS = 16;

export type Lab = [number, number, number];

export interface Cluster {
  /** Centroid in OKLab. */
  lab: Lab;
  /** How many sampled pixels landed here. */
  count: number;
}

export interface PaletteEntry {
  hex: string;
  rgb: string;
  hsl: string;
  oklch: string;
  /** Share of the sampled pixels, 0–1. */
  share: number;
  /** Black or white — whichever reads on top of `hex`. */
  onColor: string;
  /** OKLab lightness, 0–1. Kept for role assignment. */
  lightness: number;
  /** OKLab chroma. Kept for role assignment. */
  chroma: number;
}

/* --------------------------------------------------------------- sampling - */

/** The downsampled size for an image, preserving aspect, long edge capped. */
export function sampleSize(
  width: number,
  height: number,
  maxSide = MAX_SAMPLE_SIDE
): { width: number; height: number } {
  const w = Math.max(1, Math.round(width));
  const h = Math.max(1, Math.round(height));
  const longest = Math.max(w, h);
  if (longest <= maxSide) return { width: w, height: h };
  const scale = maxSide / longest;
  return { width: Math.max(1, Math.round(w * scale)), height: Math.max(1, Math.round(h * scale)) };
}

/**
 * RGBA bytes → OKLab points, skipping anything too transparent to be a
 * colour. Pure over a plain array, so it is tested without a canvas.
 */
export function pixelsToLab(rgba: ArrayLike<number>, minAlpha = MIN_ALPHA): Lab[] {
  const points: Lab[] = [];
  for (let i = 0; i + 3 < rgba.length; i += 4) {
    if (rgba[i + 3]! / 255 < minAlpha) continue;
    points.push(rgbToOklab([rgba[i]! / 255, rgba[i + 1]! / 255, rgba[i + 2]! / 255]) as Lab);
  }
  return points;
}

/** Draw a canvas down to the sample size and read its pixels back as OKLab. */
export function samplePixels(
  canvas: HTMLCanvasElement,
  maxSide = MAX_SAMPLE_SIDE
): Lab[] {
  const { width, height } = sampleSize(canvas.width, canvas.height, maxSide);
  const small = document.createElement('canvas');
  small.width = width;
  small.height = height;
  const ctx = small.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(canvas, 0, 0, width, height);
  return pixelsToLab(ctx.getImageData(0, 0, width, height).data);
}

/* --------------------------------------------------------------- k-means -- */

const dist2 = (a: Lab, b: Lab): number => {
  const dL = a[0] - b[0];
  const dA = a[1] - b[1];
  const dB = a[2] - b[2];
  return dL * dL + dA * dA + dB * dB;
};

/**
 * k-means++ seeding: the first centre is random, and every centre after it is
 * chosen with probability proportional to its squared distance from the
 * nearest centre already taken. Plain random seeding regularly puts two
 * centres inside one dominant colour and leaves a real one unrepresented;
 * this is the standard fix and costs one extra pass per centre.
 */
function seedCentroids(points: Lab[], k: number, rng: () => number): Lab[] {
  const centroids: Lab[] = [[...points[Math.floor(rng() * points.length)]!] as Lab];
  const best = points.map((p) => dist2(p, centroids[0]!));

  while (centroids.length < k) {
    let total = 0;
    for (const d of best) total += d;
    // Every point already sits exactly on a centre: no distinct colour is
    // left to seed, so stop rather than duplicate one.
    if (total <= 0) break;
    let threshold = rng() * total;
    let index = best.length - 1;
    for (let i = 0; i < best.length; i += 1) {
      threshold -= best[i]!;
      if (threshold <= 0) {
        index = i;
        break;
      }
    }
    const chosen = [...points[index]!] as Lab;
    centroids.push(chosen);
    for (let i = 0; i < points.length; i += 1) {
      const d = dist2(points[i]!, chosen);
      if (d < best[i]!) best[i] = d;
    }
  }
  return centroids;
}

/**
 * Cluster OKLab points into at most `k` groups, returned biggest first.
 *
 * Empty clusters are DROPPED rather than reported: asking a two-colour logo
 * for eight colours should give you the two it has plus whatever real
 * variation exists, not six entries of black. That is why the result may be
 * shorter than `k`, and why the UI says the count is a request.
 */
export function kmeans(
  points: Lab[],
  k: number,
  seed = PALETTE_SEED,
  maxIterations = 24
): Cluster[] {
  if (points.length === 0 || k < 1) return [];
  const rng = mulberry32(seed);
  let centroids = seedCentroids(points, Math.min(k, points.length), rng);
  const assignment = new Int32Array(points.length).fill(-1);

  // At least one pass, always. The counts at the bottom are read out of
  // `assignment`, so a budget of zero would leave every entry at its -1 fill,
  // tally them all into a negative index and return an empty palette — an
  // odd way for "seed but do not iterate" to behave.
  const iterations = Math.max(1, maxIterations);

  for (let iteration = 0; iteration < iterations; iteration += 1) {
    let moved = false;
    for (let i = 0; i < points.length; i += 1) {
      let bestIndex = 0;
      let bestDistance = Infinity;
      for (let c = 0; c < centroids.length; c += 1) {
        const d = dist2(points[i]!, centroids[c]!);
        if (d < bestDistance) {
          bestDistance = d;
          bestIndex = c;
        }
      }
      if (assignment[i] !== bestIndex) {
        assignment[i] = bestIndex;
        moved = true;
      }
    }
    // Converged: nothing changed hands, so the means cannot move either.
    if (!moved) break;

    const sums = centroids.map(() => [0, 0, 0, 0]);
    for (let i = 0; i < points.length; i += 1) {
      const bucket = sums[assignment[i]!]!;
      bucket[0]! += points[i]![0];
      bucket[1]! += points[i]![1];
      bucket[2]! += points[i]![2];
      bucket[3]! += 1;
    }
    centroids = centroids.map((current, c) => {
      const [l, a, b, n] = sums[c] as [number, number, number, number];
      return n === 0 ? current : ([l / n, a / n, b / n] as Lab);
    });
  }

  const counts = centroids.map(() => 0);
  for (let i = 0; i < points.length; i += 1) counts[assignment[i]!]! += 1;

  return centroids
    .map((lab, index) => ({ lab, count: counts[index]! }))
    .filter((cluster) => cluster.count > 0)
    .sort((a, b) => b.count - a.count);
}

/* --------------------------------------------------------------- palette -- */

/**
 * Clusters → the strings the UI copies, with their share of the image.
 *
 * `lightness` and `chroma` are measured on the colour that is actually
 * DELIVERED, not on the raw centroid. The sRGB gamut is not convex in OKLab,
 * so the mean of two perfectly ordinary in-gamut colours regularly falls
 * outside it and gets clipped per channel on the way back — the midpoint of
 * green and blue clips by more than a whole channel. Reporting the centroid's
 * numbers alongside the clipped hex made the entry contradict itself (its own
 * `oklch` string, built from the clipped value, disagreed with its `chroma`)
 * and, worse, made `suggestRoles` rank and classify by saturation the user
 * never receives — including flipping colours across the near-grey threshold.
 */
export function toPalette(clusters: Cluster[]): PaletteEntry[] {
  const total = clusters.reduce((sum, c) => sum + c.count, 0);
  if (total === 0) return [];
  return clusters.map((cluster) => {
    const rgb = oklabToRgb(cluster.lab).map((v) => Math.min(1, Math.max(0, v))) as [
      number,
      number,
      number,
    ];
    const hex = rgbToHex(rgb);
    const formats = allFormats({ rgb, alpha: 1 });
    const delivered = rgbToOklab(rgb);
    return {
      hex,
      rgb: formats.rgb,
      hsl: formats.hsl,
      oklch: formats.oklch,
      share: cluster.count / total,
      onColor: contrastOn(hex),
      lightness: delivered[0],
      chroma: Math.hypot(delivered[1], delivered[2]),
    };
  });
}

/** The whole pipeline over a canvas: sample, cluster, format. */
export function paletteFromCanvas(
  canvas: HTMLCanvasElement,
  k: number,
  seed = PALETTE_SEED
): PaletteEntry[] {
  return toPalette(kmeans(samplePixels(canvas), clampCount(k), seed));
}

export const clampCount = (k: number): number =>
  Math.min(MAX_COLORS, Math.max(MIN_COLORS, Math.round(Number.isFinite(k) ? k : 6)));

/* ----------------------------------------------------------- theme roles -- */

/** Chroma below this reads as a grey rather than a colour. */
const NEUTRAL_CHROMA = 0.04;

/**
 * A first guess at which extracted colour plays which theme role.
 *
 * The rules, in order, each falling back rather than failing:
 *  - **base** is the page background, so it wants the most common colour that
 *    is nearly grey. If the image has NO near-grey it is left null on
 *    purpose — a flat three-colour graphic would otherwise put its most
 *    common saturated colour behind every page, which is a garish theme that
 *    trips three contrast warnings on arrival. Derived, it becomes a pale
 *    tint of the primary, which is what a person would have picked.
 *  - **primary** is the most common colour that actually IS a colour.
 *  - **accent** is the most chromatic colour that is not already primary —
 *    highlights should shout.
 *  - **secondary** is the next most common chromatic colour.
 *  - **neutral** is the mid-lightness grey, for muted text and chrome.
 *
 * A slot with nothing left to give is returned as null, and `buildTheme`
 * derives it from the primary — which is the same thing the Themes tool does
 * for a blank field, so one extracted colour still produces a whole theme.
 */
export function suggestRoles(palette: PaletteEntry[]): (string | null)[] {
  if (palette.length === 0) return [null, null, null, null, null];

  const chromatic = palette.filter((entry) => entry.chroma >= NEUTRAL_CHROMA);
  const neutrals = palette.filter((entry) => entry.chroma < NEUTRAL_CHROMA);
  const taken = new Set<string>();

  const take = (entry: PaletteEntry | undefined): string | null => {
    if (!entry || taken.has(entry.hex)) return null;
    taken.add(entry.hex);
    return entry.hex;
  };
  const firstFree = (list: PaletteEntry[]): PaletteEntry | undefined =>
    list.find((entry) => !taken.has(entry.hex));

  // Base first — it is the surface every contrast warning is measured against.
  const base = take(neutrals[0]);
  const primary = take(firstFree(chromatic) ?? firstFree(palette));
  const accent = take(firstFree([...chromatic].sort((a, b) => b.chroma - a.chroma)));
  const secondary = take(firstFree(chromatic));
  const neutral = take(
    firstFree([...neutrals].sort((a, b) => Math.abs(a.lightness - 0.5) - Math.abs(b.lightness - 0.5)))
  );

  // Role order matches THEME_ROLES: primary, secondary, accent, neutral, base.
  return [primary, secondary, accent, neutral, base];
}

/** `suggestRoles` output shaped for `buildTheme` — light slots only, darks derived. */
export function toThemeInput(
  roles: (string | null)[],
  paddingPx = 12,
  radiusPx = 8
): ThemeInput {
  const colors: RoleInput[] = Array.from({ length: 5 }, (_, i) => ({
    light: roles[i] ?? null,
    dark: null,
  }));
  return { colors, paddingPx, radiusPx };
}
