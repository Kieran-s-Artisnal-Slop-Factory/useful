/**
 * Renders the placeholder generator picker's example thumbnails, once.
 *
 * The picker shows a small picture beside each of the image generators (every
 * entry in GENERATORS) so they can be told apart before one is chosen. A first
 * version drew them all from the live settings on every change, which made the
 * page feel slow — a dozen SVGs (two of them filter-heavy) per keystroke, for pictures whose
 * job is only to say "this is what a flow field looks like". So they are
 * rendered here, at build-script time, from the generators' DEFAULTS, and the
 * page imports the result as data. They do not follow the controls; the big
 * preview does.
 *
 * The output is COMMITTED (src/lib/placeholder/thumbnails.json). Re-run when a
 * generator's default look changes:
 *
 *   node tools/build-placeholder-thumbs.mjs
 *
 * It bundles and runs the real generator code (esbuild, which the build
 * already depends on), so there is no second renderer to drift.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const OUT = join(ROOT, 'src/lib/placeholder/thumbnails.json');

// The generator modules import each other without extensions (Vite resolves
// those; node does not), so bundle them with esbuild — already a dependency
// of the build — into one temporary module and import that.
const tmp = mkdtempSync(join(tmpdir(), 'useful-thumbs-'));
const entry = join(tmp, 'entry.ts');
writeFileSync(
  entry,
  [
    `export * from ${JSON.stringify(join(ROOT, 'src/lib/placeholder/images.ts'))};`,
    `export { svgDataUri } from ${JSON.stringify(join(ROOT, 'src/lib/svg/build.ts'))};`,
    `export { DEFAULT_GRADIENT } from ${JSON.stringify(join(ROOT, 'src/lib/gen/gradient.ts'))};`,
  ].join('\n')
);
const bundle = join(tmp, 'bundle.mjs');
await build({ entryPoints: [entry], bundle: true, format: 'esm', platform: 'node', outfile: bundle, logLevel: 'silent' });
const images = await import(pathToFileURL(bundle).href);
const { svgDataUri, DEFAULT_GRADIENT } = images;

/** Lucide's `image` icon — the icon generator's example, without the 2 MB set. */
const SAMPLE_ICON =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect width="18" height="18" x="3" y="3" rx="2" ry="2"/>' +
  '<circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/></svg>';

const WIDTH = 160;
const HEIGHT = 90;

const thumbnails = {};
for (const generator of images.GENERATORS) {
  const svg = images.buildImage({
    ...images.DEFAULT_IMAGE_OPTIONS,
    gradient: DEFAULT_GRADIENT,
    generator: generator.id,
    width: WIDTH,
    height: HEIGHT,
    heading: `${WIDTH} × ${HEIGHT}`,
    iconSvg: SAMPLE_ICON,
  });
  thumbnails[generator.id] = svgDataUri(svg);
}

writeFileSync(OUT, JSON.stringify(thumbnails, null, 2) + '\n', 'utf8');
const bytes = Object.values(thumbnails).reduce((sum, uri) => sum + uri.length, 0);
console.log(`placeholder thumbnails: ${Object.keys(thumbnails).length} generators, ${bytes} bytes → src/lib/placeholder/thumbnails.json`);
