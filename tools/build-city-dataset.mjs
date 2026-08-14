/**
 * Regenerates src/lib/time/cities.json from a GeoNames cities dump.
 *
 * Source: https://download.geonames.org/export/dump/cities15000.zip
 * (all cities with population >= 15k; CC BY 4.0 — attribution in the JSON's
 * companion loader, src/lib/time/cities.ts).
 *
 * Usage: node tools/build-city-dataset.mjs path/to/cities15000.txt
 *
 * Output rows: [name, countryCode, ianaZone, population] — the minimum needed
 * for "type a city, get its timezone", ranked by population. Sorted by
 * population descending so search can early-rank without a sort.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const src = process.argv[2];
if (!src) {
  console.error('usage: node tools/build-city-dataset.mjs <cities15000.txt>');
  process.exit(1);
}

// GeoNames TSV columns: 1=name, 8=country code, 14=population, 17=timezone
const rows = [];
for (const line of readFileSync(src, 'utf8').split('\n')) {
  if (!line.trim()) continue;
  const cols = line.split('\t');
  const name = cols[1];
  const country = cols[8];
  const population = Number(cols[14]) || 0;
  const zone = cols[17];
  if (!name || !zone || !country) continue;
  rows.push([name, country, zone, population]);
}
rows.sort((a, b) => b[3] - a[3]);

const out = resolve('src/lib/time/cities.json');
writeFileSync(out, JSON.stringify(rows));
console.log(`wrote ${rows.length} cities to ${out}`);
