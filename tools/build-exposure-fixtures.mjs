/**
 * Generates the two tiny JPEG fixtures the Photography "Compare two photos"
 * Playwright tests upload — each an 8×8 flat-colour JPEG with a known
 * exposure written into its EXIF via piexifjs (the same library the image
 * editor uses to write JPEG metadata):
 *  - exposure-f2.8-250-iso100.jpg  — f/2.8, 1/250 s, ISO 100, 50 mm, "Fixture Cam"
 *  - exposure-f4-250-iso100.jpg    — f/4,   1/250 s, ISO 100, 50 mm — one stop
 *                                    less light than the first, aperture only
 * The Unsplash JPEG already in fixtures/ carries no exposure tags at all, which
 * is why these exist. The base pixels come from sharp (present in node_modules
 * as Astro's image dependency); piexifjs wants a binary string, hence the
 * latin1 round trip.
 *
 * Run: node tools/build-exposure-fixtures.mjs
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import piexif from 'piexifjs';
import sharp from 'sharp';

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'tests', 'local', 'fixtures');
mkdirSync(out, { recursive: true });

/** A rational EXIF value: [numerator, denominator]. */
const rational = (n, d) => [n, d];

const FIXTURES = [
  { name: 'exposure-f2.8-250-iso100.jpg', fnumber: rational(28, 10), colour: { r: 120, g: 90, b: 60 } },
  { name: 'exposure-f4-250-iso100.jpg', fnumber: rational(4, 1), colour: { r: 60, g: 90, b: 120 } },
];

for (const fx of FIXTURES) {
  const base = await sharp({ create: { width: 8, height: 8, channels: 3, background: fx.colour } })
    .jpeg({ quality: 60 })
    .toBuffer();
  const exif = piexif.dump({
    '0th': { [piexif.ImageIFD.Make]: 'Useful', [piexif.ImageIFD.Model]: 'Fixture Cam' },
    Exif: {
      [piexif.ExifIFD.FNumber]: fx.fnumber,
      [piexif.ExifIFD.ExposureTime]: rational(1, 250),
      [piexif.ExifIFD.ISOSpeedRatings]: 100,
      [piexif.ExifIFD.FocalLength]: rational(50, 1),
    },
    GPS: {},
  });
  const withExif = piexif.insert(exif, base.toString('latin1'));
  writeFileSync(join(out, fx.name), Buffer.from(withExif, 'latin1'));
}

console.log('exposure fixtures written to', out);
