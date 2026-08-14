import { describe, expect, it } from 'vitest';
import { loadCities, searchCities } from './cities';
import { isValidZone } from './timezone';

describe('city dataset', () => {
  it('finds major cities and maps them to real IANA zones', async () => {
    for (const [query, zone] of [
      ['osaka', 'Asia/Tokyo'],
      ['red deer', 'America/Edmonton'],
      ['munich', 'Europe/Berlin'],
    ] as const) {
      const hits = await searchCities(query);
      expect(hits.length, query).toBeGreaterThan(0);
      expect(hits.map((h) => h.zone), query).toContain(zone);
    }
  });

  it('every zone in the dataset is formattable by Intl (aliases included)', async () => {
    const rows = await loadCities();
    const zones = new Set(rows.map((r) => r[2]));
    for (const zone of zones) {
      expect(isValidZone(zone), zone).toBe(true);
    }
  });

  it('ranks the metropolis above the suburb for a bare name', async () => {
    const hits = await searchCities('tokyo');
    expect(hits[0]!.name).toBe('Tokyo');
  });

  it('ignores sub-2-character queries', async () => {
    expect(await searchCities('a')).toEqual([]);
  });
});
