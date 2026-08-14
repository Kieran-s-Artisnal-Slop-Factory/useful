/**
 * File-transfer time estimation (plan §4.3). Decimal units throughout
 * (KB = 1000 B — what drives and ISPs advertise); bits vs bytes is explicit
 * in the unit tables so the UI can never conflate Mbps with MB/s.
 */

export interface SizeUnit {
  id: string;
  label: string;
  bytes: number;
}

export const SIZE_UNITS: SizeUnit[] = [
  { id: 'KB', label: 'KB (kilobytes)', bytes: 1e3 },
  { id: 'MB', label: 'MB (megabytes)', bytes: 1e6 },
  { id: 'GB', label: 'GB (gigabytes)', bytes: 1e9 },
  { id: 'TB', label: 'TB (terabytes)', bytes: 1e12 },
];

export interface SpeedUnit {
  id: string;
  label: string;
  bitsPerSecond: number;
  /** Whether the unit is bit-based (network ads) or byte-based (file managers). */
  kind: 'bits' | 'bytes';
}

export const SPEED_UNITS: SpeedUnit[] = [
  { id: 'Kbps', label: 'Kbps (kilobits/s)', bitsPerSecond: 1e3, kind: 'bits' },
  { id: 'Mbps', label: 'Mbps (megabits/s)', bitsPerSecond: 1e6, kind: 'bits' },
  { id: 'Gbps', label: 'Gbps (gigabits/s)', bitsPerSecond: 1e9, kind: 'bits' },
  { id: 'KBps', label: 'KB/s (kilobytes/s)', bitsPerSecond: 8e3, kind: 'bytes' },
  { id: 'MBps', label: 'MB/s (megabytes/s)', bitsPerSecond: 8e6, kind: 'bytes' },
];

export function sizeUnitById(id: string): SizeUnit | null {
  return SIZE_UNITS.find((u) => u.id === id) ?? null;
}

export function speedUnitById(id: string): SpeedUnit | null {
  return SPEED_UNITS.find((u) => u.id === id) ?? null;
}

/**
 * Seconds to move `sizeBytes` at `speedBitsPerSecond`, with `overheadPercent`
 * of the link consumed by protocol overhead (0–<100). Returns null when the
 * inputs can't produce a finite positive estimate.
 */
export function transferSeconds(
  sizeBytes: number,
  speedBitsPerSecond: number,
  overheadPercent = 0
): number | null {
  if (!(sizeBytes > 0) || !(speedBitsPerSecond > 0)) return null;
  if (!(overheadPercent >= 0) || overheadPercent >= 100) return null;
  const effective = speedBitsPerSecond * (1 - overheadPercent / 100);
  return (sizeBytes * 8) / effective;
}

/**
 * "0.4 s", "40 s", "2 min 40 s", "1 h 4 min", "3 d 7 h" — the two most
 * significant units, seconds shown with a decimal only under a minute.
 */
export function formatDuration(seconds: number): string {
  if (!(seconds >= 0) || !Number.isFinite(seconds)) return '—';
  if (seconds < 1) return `${Number(seconds.toPrecision(2))} s`;
  if (seconds < 60) return `${Number(seconds.toPrecision(3))} s`;
  const units: { label: string; secs: number }[] = [
    { label: 'd', secs: 86_400 },
    { label: 'h', secs: 3_600 },
    { label: 'min', secs: 60 },
    { label: 's', secs: 1 },
  ];
  const top = units.findIndex((u) => seconds >= u.secs);
  const major = units[top]!;
  const minor = units[top + 1];
  let hi = Math.floor(seconds / major.secs);
  if (!minor) return `${hi} ${major.label}`;
  // Round the remainder into the adjacent smaller unit, carrying on overflow
  // (1 h 59.7 min must read "2 h", never "1 h 60 min").
  let lo = Math.round((seconds - hi * major.secs) / minor.secs);
  if (lo * minor.secs >= major.secs) {
    hi += 1;
    lo = 0;
  }
  return lo > 0 ? `${hi} ${major.label} ${lo} ${minor.label}` : `${hi} ${major.label}`;
}

/** The same speed spelled both ways: "100 Mbps = 12.5 MB/s". */
export function speedBothWays(bitsPerSecond: number): string {
  const bits = humanRate(bitsPerSecond, [
    { label: 'bps', scale: 1 },
    { label: 'Kbps', scale: 1e3 },
    { label: 'Mbps', scale: 1e6 },
    { label: 'Gbps', scale: 1e9 },
  ]);
  const bytes = humanRate(bitsPerSecond / 8, [
    { label: 'B/s', scale: 1 },
    { label: 'KB/s', scale: 1e3 },
    { label: 'MB/s', scale: 1e6 },
    { label: 'GB/s', scale: 1e9 },
  ]);
  return `${bits} = ${bytes}`;
}

function humanRate(perSecond: number, scales: { label: string; scale: number }[]): string {
  let pick = scales[0]!;
  for (const s of scales) if (perSecond >= s.scale) pick = s;
  return `${Number((perSecond / pick.scale).toPrecision(3))} ${pick.label}`;
}
