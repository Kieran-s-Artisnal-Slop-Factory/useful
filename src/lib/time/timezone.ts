/**
 * Timezone conversion on the browser's built-in IANA database — no tz data
 * shipped, fully offline. The one non-trivial piece: turning a wall-clock
 * time IN a zone into an instant. Intl only formats instants, so we guess the
 * instant, measure the zone's offset at the guess, and correct — twice, which
 * settles DST transitions.
 */

/** The zone's UTC offset in minutes at a given instant (east positive). */
export function zoneOffsetMinutes(zone: string, atMs: number): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const parts: Record<string, string> = {};
  for (const p of dtf.formatToParts(atMs)) parts[p.type] = p.value;
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second)
  );
  return Math.round((asUtc - atMs) / 60_000);
}

export interface WallTime {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
}

/** The instant (epoch ms) at which `zone`'s clocks show `wall`. For wall
 * times skipped by a DST spring-forward, returns the post-transition
 * interpretation (offset measured after the jump). */
export function wallTimeToInstant(wall: WallTime, zone: string): number {
  const asUtc = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute);
  let guess = asUtc - zoneOffsetMinutes(zone, asUtc) * 60_000;
  // Second pass: the offset at the guess can differ from the offset at the
  // first estimate around a DST boundary.
  guess = asUtc - zoneOffsetMinutes(zone, guess) * 60_000;
  return guess;
}

/** Format an instant as the wall time in `zone` (for display). */
export function instantInZone(atMs: number, zone: string): string {
  return new Intl.DateTimeFormat(undefined, {
    timeZone: zone,
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(atMs);
}

/** 'UTC+02:00'-style label for a zone at an instant. */
export function offsetLabel(zone: string, atMs: number): string {
  const min = zoneOffsetMinutes(zone, atMs);
  const sign = min < 0 ? '-' : '+';
  const abs = Math.abs(min);
  const h = String(Math.floor(abs / 60)).padStart(2, '0');
  const m = String(abs % 60).padStart(2, '0');
  return `UTC${sign}${h}:${m}`;
}

/** All IANA zones the browser knows, e.g. 'America/Edmonton'. */
export function allZones(): string[] {
  return Intl.supportedValuesOf('timeZone');
}

/**
 * True when Intl can actually format in this zone. Deliberately NOT a
 * membership test against allZones(): the GeoNames dataset (and remembered
 * preferences) can carry aliases like 'Europe/Kyiv' that DateTimeFormat
 * accepts even when the canonical list spells them differently.
 */
export function isValidZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

/** The user's own zone. */
export function currentZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

/** 'America/North_Dakota/New_Salem' → 'New Salem, North Dakota (America)'. */
export function zoneDisplayName(zone: string): string {
  const parts = zone.split('/').map((p) => p.replaceAll('_', ' '));
  if (parts.length === 1) return parts[0]!;
  const [region, ...rest] = parts;
  return rest.reverse().join(', ') + ' (' + region + ')';
}
