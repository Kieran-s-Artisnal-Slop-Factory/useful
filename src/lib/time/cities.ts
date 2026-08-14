/**
 * City → timezone lookup for the timezone converter. Data: GeoNames
 * cities15000 (population >= 15k, ~34k entries, CC BY 4.0 —
 * https://www.geonames.org/), compacted by tools/build-city-dataset.mjs.
 *
 * The ~1.4MB JSON is a SEPARATE lazily-imported chunk: nothing pays for it
 * until the first city search, and once loaded the service worker's asset
 * crawl keeps it cached for offline use.
 */
import { fuzzyScore } from '../fuzzy';

/** [name, countryCode, ianaZone, population] — population-descending. */
export type CityRow = [string, string, string, number];

export interface CityHit {
  name: string;
  country: string;
  zone: string;
}

let citiesPromise: Promise<CityRow[]> | null = null;
let loaded = false;

export function loadCities(): Promise<CityRow[]> {
  citiesPromise ??= import('./cities.json').then((m) => {
    loaded = true;
    return m.default as CityRow[];
  });
  return citiesPromise;
}

/** True once the dataset chunk has been fetched (for UI loading states). */
export function citiesLoaded(): boolean {
  return loaded;
}

/**
 * Fuzzy-match city names. Rows are population-sorted, so among equal scores
 * the bigger city surfaces first — "tokyo" means Tokyo, not Shinjuku.
 */
export async function searchCities(query: string, limit = 8): Promise<CityHit[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  const rows = await loadCities();
  const hits: { row: CityRow; score: number }[] = [];
  for (const row of rows) {
    const score = fuzzyScore(q, row[0]);
    if (score !== null) hits.push({ row, score });
  }
  return hits
    .sort((a, b) => b.score - a.score || b.row[3] - a.row[3])
    .slice(0, limit)
    .map(({ row }) => ({ name: row[0], country: row[1], zone: row[2] }));
}
