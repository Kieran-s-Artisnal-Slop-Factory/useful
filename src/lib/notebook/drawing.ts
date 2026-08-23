/**
 * Excalidraw drawings — stored as ordinary image assets, but re-editable
 * forever. Ported from retoken.
 *
 * The trick is Excalidraw's `exportEmbedScene` flag: the exported PNG carries
 * the whole scene JSON inside it (a `tEXt` chunk), and `loadFromBlob` reads
 * it back. So a drawing needs no new storage, no new markdown syntax, and
 * nothing at all in the exports — it IS an image, which every surface
 * already handles (the `note_assets` row, the Markdown and HTML exports, the
 * backup). The files also open on excalidraw.com, and vice versa.
 *
 * `.excalidraw.png` is the convention that marks an image as re-editable;
 * `isDrawingRef` is the single place that decides.
 *
 * Excalidraw is React-only and heavy (~1 MB + React), so everything here
 * loads lazily — the drawing dialog is the only surface that pays for it, and
 * `payload.spec.ts` holds an `/excalidraw/i` matcher against every other
 * route.
 *
 * Fonts: Excalidraw fetches its faces at run time, by default from unpkg.
 * `tools/build-excalidraw-assets.mjs` vendors them under `public/excalidraw/`
 * and `loadExcalidraw` points `window.EXCALIDRAW_ASSET_PATH` there before the
 * library evaluates, so a drawing's text renders with no network. The
 * service worker keeps those files in its font bucket once fetched, and the
 * `drawing-fonts` offline bundle fetches them all up front.
 */
import { href } from '../paths';
import { FONT_CACHE } from '../math/fonts';

/** The bits of the Excalidraw module we use, kept loose to avoid its types. */
export interface ExcalidrawModule {
  Excalidraw: unknown; // React component, handed straight to createElement
  exportToBlob: (opts: {
    elements: readonly unknown[];
    appState: Record<string, unknown>;
    files: unknown;
    mimeType?: string;
    quality?: number;
    exportPadding?: number;
    getDimensions?: (w: number, h: number) => { width: number; height: number; scale?: number };
  }) => Promise<Blob>;
  loadFromBlob: (
    blob: Blob,
    localAppState: unknown,
    localElements: unknown
  ) => Promise<{ elements: readonly unknown[]; appState: Record<string, unknown>; files: unknown }>;
}

export interface ReactModule {
  createElement: (type: unknown, props?: Record<string, unknown>, ...children: unknown[]) => unknown;
}

export interface ReactDomModule {
  createRoot: (container: Element) => { render: (node: unknown) => void; unmount: () => void };
}

export interface ExcalidrawBundle {
  excalidraw: ExcalidrawModule;
  react: ReactModule;
  reactDom: ReactDomModule;
}

let modulesPromise: Promise<ExcalidrawBundle> | null = null;

/**
 * Load Excalidraw + React on demand. Its CSS rides along with the same
 * import so the canvas is styled wherever it mounts.
 */
export function loadExcalidraw(): Promise<ExcalidrawBundle> {
  modulesPromise ??= (async () => {
    // Must be set BEFORE the module evaluates: the font loader reads it when
    // it builds its URL list, and the CDN is what it uses when it is unset.
    (window as unknown as { EXCALIDRAW_ASSET_PATH?: string }).EXCALIDRAW_ASSET_PATH = new URL(
      href('/excalidraw/'),
      window.location.href
    ).toString();
    const [excalidraw, react, reactDom] = await Promise.all([
      import('../vendor/excalidraw') as unknown as Promise<ExcalidrawModule>,
      import('react') as unknown as Promise<ReactModule>,
      import('react-dom/client') as unknown as Promise<ReactDomModule>,
      import('@excalidraw/excalidraw/index.css'),
    ]);
    return { excalidraw, react, reactDom };
  })();
  return modulesPromise;
}

/** Images written by the drawing dialog — the ones that can be reopened. */
export const DRAWING_SUFFIX = '.excalidraw.png';

/** Pixel density of exported drawings (2× reads crisply on retina). */
const EXPORT_SCALE = 2;

/** True when a markdown image ref is a re-editable drawing. */
export function isDrawingRef(src: string): boolean {
  return src.toLowerCase().split(/[?#]/)[0]!.endsWith(DRAWING_SUFFIX);
}

/**
 * A filename for a new drawing: `drawing.excalidraw.png`, or the author's
 * title slugified. The asset store de-duplicates collisions.
 */
export function drawingFilename(title = ''): string {
  const slug = title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return (slug || 'drawing') + DRAWING_SUFFIX;
}

/**
 * Render a scene to a PNG with the scene JSON embedded.
 *
 * The export is ALWAYS light-on-opaque, regardless of the theme the author
 * happens to be drawing in: the image ships to readers whose theme we can't
 * know, so baking in dark mode would hand them a black box on a light page.
 * Dark canvas while editing, canonical light on export — the same choice
 * excalidraw.com makes.
 */
export async function sceneToBlob(
  mod: ExcalidrawModule,
  scene: { elements: readonly unknown[]; appState: Record<string, unknown>; files: unknown }
): Promise<Blob> {
  return mod.exportToBlob({
    elements: scene.elements,
    files: scene.files,
    mimeType: 'image/png',
    appState: {
      ...scene.appState,
      // THE requirement: keeps the scene inside the PNG so it can reopen.
      exportEmbedScene: true,
      exportBackground: true,
      exportWithDarkMode: false,
    },
    // 2× for crisp rendering on high-DPI screens. The canvas dimensions must
    // be scaled TOO — returning the unscaled width/height alongside
    // `scale: 2` leaves the canvas at 1× while the content draws at 2×,
    // silently cropping the drawing to its top-left quarter.
    getDimensions: (width, height) => ({
      width: width * EXPORT_SCALE,
      height: height * EXPORT_SCALE,
      scale: EXPORT_SCALE,
    }),
  });
}

/** Read a drawing back into an editable scene (throws if it isn't one). */
export async function blobToScene(
  mod: ExcalidrawModule,
  blob: Blob
): Promise<{ elements: readonly unknown[]; appState: Record<string, unknown>; files: unknown }> {
  return mod.loadFromBlob(blob, null, null);
}

/* ── The vendored faces ──────────────────────────────────────────────── */

/**
 * The twenty-five faces under `public/excalidraw/fonts/`, as
 * `public/excalidraw/PROVENANCE.txt` records them. Hashed names are
 * Excalidraw's own: its font loader asks for exactly these paths.
 */
export const DRAWING_FONT_FILES: readonly string[] = [
  'Assistant/Assistant-Bold.woff2',
  'Assistant/Assistant-Medium.woff2',
  'Assistant/Assistant-Regular.woff2',
  'Assistant/Assistant-SemiBold.woff2',
  'Cascadia/CascadiaCode-Regular.woff2',
  'ComicShanns/ComicShanns-Regular-279a7b317d12eb88de06167bd672b4b4.woff2',
  'ComicShanns/ComicShanns-Regular-6e066e8de2ac57ea9283adb9c24d7f0c.woff2',
  'ComicShanns/ComicShanns-Regular-dc6a8806fa96795d7b3be5026f989a17.woff2',
  'ComicShanns/ComicShanns-Regular-fcb0fc02dcbee4c9846b3e2508668039.woff2',
  'Excalifont/Excalifont-Regular-349fac6ca4700ffec595a7150a0d1e1d.woff2',
  'Excalifont/Excalifont-Regular-3f2c5db56cc93c5a6873b1361d730c16.woff2',
  'Excalifont/Excalifont-Regular-41b173a47b57366892116a575a43e2b6.woff2',
  'Excalifont/Excalifont-Regular-623ccf21b21ef6b3a0d87738f77eb071.woff2',
  'Excalifont/Excalifont-Regular-a88b72a24fb54c9f94e3b5fdaa7481c9.woff2',
  'Excalifont/Excalifont-Regular-b9dcf9d2e50a1eaf42fc664b50a3fd0d.woff2',
  'Excalifont/Excalifont-Regular-be310b9bcd4f1a43f571c46df7809174.woff2',
  'Liberation/LiberationSans-Regular.woff2',
  'Lilita/Lilita-Regular-i7dPIFZ9Zz-WBtRtedDbYE98RXi4EwSsbg.woff2',
  'Lilita/Lilita-Regular-i7dPIFZ9Zz-WBtRtedDbYEF8RXi4EwQ.woff2',
  'Nunito/Nunito-Regular-XRXI3I6Li01BKofiOc5wtlZ2di8HDIkhdTA3j6zbXWjgevT5.woff2',
  'Nunito/Nunito-Regular-XRXI3I6Li01BKofiOc5wtlZ2di8HDIkhdTQ3j6zbXWjgeg.woff2',
  'Nunito/Nunito-Regular-XRXI3I6Li01BKofiOc5wtlZ2di8HDIkhdTk3j6zbXWjgevT5.woff2',
  'Nunito/Nunito-Regular-XRXI3I6Li01BKofiOc5wtlZ2di8HDIkhdTo3j6zbXWjgevT5.woff2',
  'Nunito/Nunito-Regular-XRXI3I6Li01BKofiOc5wtlZ2di8HDIkhdTs3j6zbXWjgevT5.woff2',
  'Virgil/Virgil-Regular.woff2',
];

/** The same, as app URLs — what the offline bundle fetches into `FONT_CACHE`. */
export const DRAWING_ASSETS: readonly string[] = DRAWING_FONT_FILES.map((name) =>
  href(`/excalidraw/fonts/${name}`)
);

/**
 * Total bytes, from `public/excalidraw/PROVENANCE.txt`. A unit test reads
 * that file and checks this number, so a re-vendor that changes sizes fails
 * the suite rather than quietly lying to the offline dialog's progress bar.
 */
export const DRAWING_FONT_BYTES = 439_576;

/** True when every face is already in the font cache. */
export async function drawingFontsReady(): Promise<boolean> {
  try {
    const cache = await caches.open(FONT_CACHE);
    for (const url of DRAWING_ASSETS) {
      if (!(await cache.match(url, { ignoreVary: true }))) return false;
    }
    return true;
  } catch {
    return false;
  }
}
