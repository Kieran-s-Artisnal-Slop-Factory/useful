import { describe, expect, it } from 'vitest';
import {
  allZones,
  wallTimeToInstant,
  zoneDisplayName,
  zoneOffsetMinutes,
} from './timezone';

describe('zoneOffsetMinutes', () => {
  it('is zero for UTC', () => {
    expect(zoneOffsetMinutes('UTC', Date.UTC(2024, 5, 1))).toBe(0);
  });

  it('tracks DST in America/Edmonton (MST -420 / MDT -360)', () => {
    expect(zoneOffsetMinutes('America/Edmonton', Date.UTC(2024, 0, 15, 12))).toBe(-420);
    expect(zoneOffsetMinutes('America/Edmonton', Date.UTC(2024, 6, 15, 12))).toBe(-360);
  });

  it('handles half-hour zones (Asia/Kolkata +330)', () => {
    expect(zoneOffsetMinutes('Asia/Kolkata', Date.UTC(2024, 0, 15))).toBe(330);
  });
});

describe('wallTimeToInstant', () => {
  it('maps a winter wall time in Edmonton to the right instant', () => {
    // 12:00 MST === 19:00 UTC
    expect(wallTimeToInstant({ year: 2024, month: 1, day: 15, hour: 12, minute: 0 }, 'America/Edmonton')).toBe(
      Date.UTC(2024, 0, 15, 19, 0)
    );
  });

  it('maps a summer wall time (MDT) correctly', () => {
    // 12:00 MDT === 18:00 UTC
    expect(wallTimeToInstant({ year: 2024, month: 7, day: 15, hour: 12, minute: 0 }, 'America/Edmonton')).toBe(
      Date.UTC(2024, 6, 15, 18, 0)
    );
  });

  it('round-trips across many zones', () => {
    const wall = { year: 2024, month: 10, day: 5, hour: 8, minute: 30 };
    for (const zone of ['UTC', 'Europe/Paris', 'Asia/Kolkata', 'Australia/Sydney', 'Pacific/Chatham']) {
      const instant = wallTimeToInstant(wall, zone);
      // Formatting the instant back in the zone must show the same wall time.
      const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: zone,
        hourCycle: 'h23',
        hour: '2-digit',
        minute: '2-digit',
      }).format(instant);
      expect(parts, zone).toBe('08:30');
    }
  });

  it('resolves a DST-skipped wall time to a nearby real instant, deterministically', () => {
    // 2024-03-10 02:30 does not exist in America/Denver (spring forward).
    const skipped = { year: 2024, month: 3, day: 10, hour: 2, minute: 30 };
    const a = wallTimeToInstant(skipped, 'America/Denver');
    const b = wallTimeToInstant(skipped, 'America/Denver');
    expect(a).toBe(b);
    // Within an hour of both plausible interpretations.
    expect(Math.abs(a - Date.UTC(2024, 2, 10, 9, 30))).toBeLessThanOrEqual(3_600_000);
  });
});

describe('zone catalog', () => {
  it('the browser ships a real zone list', () => {
    const zones = allZones();
    expect(zones.length).toBeGreaterThan(300);
    expect(zones).toContain('America/Edmonton');
  });

  it('display names read city-first', () => {
    expect(zoneDisplayName('America/Edmonton')).toBe('Edmonton (America)');
    expect(zoneDisplayName('America/North_Dakota/New_Salem')).toBe('New Salem, North Dakota (America)');
    expect(zoneDisplayName('UTC')).toBe('UTC');
  });
});
