/**
 * Generates the binary image fixtures the Playwright image suite uploads:
 *  - sample.tiff  — a valid 20×10 RGBA TIFF (solid red) via utif2's encoder
 *  - broken.tiff  — bytes that claim to be TIFF but aren't (graceful-failure case)
 * PNG/JPG/WebP fixtures are generated in-browser at test time (canvas
 * encodes those natively); SVG is a text fixture checked in directly.
 *
 * Run: node tools/build-image-fixtures.mjs
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import UTIF from 'utif2';

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'tests', 'local', 'fixtures');
mkdirSync(out, { recursive: true });

const width = 20;
const height = 10;
const rgba = new Uint8Array(width * height * 4);
for (let i = 0; i < width * height; i++) {
  rgba[i * 4] = 255; // solid red, fully opaque
  rgba[i * 4 + 3] = 255;
}
writeFileSync(join(out, 'sample.tiff'), Buffer.from(UTIF.encodeImage(rgba, width, height)));

// Starts with a valid TIFF little-endian magic, then garbage.
const broken = Buffer.alloc(64, 0xab);
broken.write('II*\0', 0, 'latin1');
writeFileSync(join(out, 'broken.tiff'), broken);

console.log('fixtures written to', out);
