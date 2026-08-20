/**
 * The vendored KaTeX faces MathLive renders formulas with.
 *
 * Namespaced `math/` rather than `napkin/` because they are not the napkin
 * tool's: any later maths rendering shares this one bundle rather than
 * vendoring a second copy of the same twenty files.
 *
 * The stylesheet is the whole mechanism. Its last rule is
 * `:root{--ML__static-fonts:true}`, which tells MathLive's own font loader to
 * stand down — so the library constructs no `FontFace`, probes for no fonts
 * directory, and the browser pulls each face on demand through
 * `font-display: swap`. Measured on a production build: **two** faces fetched
 * for a typical formula and zero `HEAD` requests, against all twenty fetched
 * eagerly plus a stray `HEAD` when `MathfieldElement.fontsDirectory` is used
 * instead.
 *
 * Regenerate with `node tools/build-math-assets.mjs --force`.
 */
import { href } from '../paths';

/**
 * Its own cache, deliberately OUTSIDE the app-cache prefix.
 *
 * These are stable, unfingerprinted `public/` files, so a `CACHE_NAME` bump
 * must not evict them — re-downloading 260 KB of unchanged fonts because a
 * stylesheet changed would be as indefensible as re-downloading the
 * segmentation model. `public/sw.js` holds the same string.
 */
export const FONT_CACHE = 'useful-fonts-v1';

/** The twenty faces, as `public/math/PROVENANCE.txt` records them. */
export const MATH_FONT_FILES: readonly string[] = [
  'KaTeX_AMS-Regular.woff2',
  'KaTeX_Caligraphic-Bold.woff2',
  'KaTeX_Caligraphic-Regular.woff2',
  'KaTeX_Fraktur-Bold.woff2',
  'KaTeX_Fraktur-Regular.woff2',
  'KaTeX_Main-Bold.woff2',
  'KaTeX_Main-BoldItalic.woff2',
  'KaTeX_Main-Italic.woff2',
  'KaTeX_Main-Regular.woff2',
  'KaTeX_Math-BoldItalic.woff2',
  'KaTeX_Math-Italic.woff2',
  'KaTeX_SansSerif-Bold.woff2',
  'KaTeX_SansSerif-Italic.woff2',
  'KaTeX_SansSerif-Regular.woff2',
  'KaTeX_Script-Regular.woff2',
  'KaTeX_Size1-Regular.woff2',
  'KaTeX_Size2-Regular.woff2',
  'KaTeX_Size3-Regular.woff2',
  'KaTeX_Size4-Regular.woff2',
  'KaTeX_Typewriter-Regular.woff2',
];

/** The stylesheet plus every face — what the offline bundle downloads. */
export const MATH_ASSETS: readonly string[] = [
  href('/math/mathlive-fonts.css'),
  ...MATH_FONT_FILES.map((name) => href(`/math/fonts/${name}`)),
];

/**
 * Total bytes, from `public/math/PROVENANCE.txt`. A unit test reads that file
 * and checks this number, so a re-vendor that changes sizes fails the suite
 * rather than quietly lying to the offline dialog's progress bar.
 */
export const MATH_FONT_BYTES = 262_804;

/** True when every asset is already in the cache. */
export async function fontsReady(): Promise<boolean> {
  try {
    const cache = await caches.open(FONT_CACHE);
    for (const url of MATH_ASSETS) {
      // `ignoreVary` because the SW stores whatever the server sent, and a
      // Vary header we never asked about should not count as a miss.
      if (!(await cache.match(url, { ignoreVary: true }))) return false;
    }
    return true;
  } catch {
    // No Cache Storage (a private window, a locked-down context) is a
    // "not downloaded", not an error to surface.
    return false;
  }
}

const LINK_ID = 'ml-fonts';

/**
 * Put the font stylesheet in the document, once.
 *
 * Called from the mathfield wrapper's mount, never at module scope — a page
 * that never shows a formula should not carry the request.
 */
export function ensureFontCss(): void {
  if (document.getElementById(LINK_ID)) return;
  const link = document.createElement('link');
  link.id = LINK_ID;
  link.rel = 'stylesheet';
  link.href = href('/math/mathlive-fonts.css');
  document.head.append(link);
}
