/**
 * Geometry for the week and day time grids — pure functions over minutes, with
 * no DOM and no clock. The component supplies pixels; everything that decides
 * WHERE something goes lives here so it can be tested without a browser.
 */

export const MINUTES_PER_DAY = 1440;

/** Anything that occupies a span of the day, in minutes from local midnight. */
export interface Span {
  startMin: number;
  endMin: number;
}

/** Where one entry sits once overlapping entries have been shared out. */
export interface Placement {
  /** 0-based column within its overlap cluster. */
  column: number;
  /** How many columns that cluster was split into. */
  columns: number;
}

/**
 * The smallest visible height for an entry, in minutes. A 5-minute event still
 * needs to be clickable, and a zero-length one still needs to exist.
 */
export const MIN_SPAN_MINUTES = 15;

/** Clamp a span into the day and give it a minimum visible height. */
export function normalizeSpan(span: Span): Span {
  const startMin = Math.min(Math.max(0, span.startMin), MINUTES_PER_DAY - 1);
  const rawEnd = Math.max(span.endMin, startMin + MIN_SPAN_MINUTES);
  return { startMin, endMin: Math.min(rawEnd, MINUTES_PER_DAY) };
}

/**
 * Share the width between entries that overlap in time.
 *
 * Entries are clustered transitively — A overlapping B and B overlapping C puts
 * all three in one cluster even when A and C do not touch — so a cluster always
 * splits into the same number of columns and nothing is drawn on top of
 * anything else. Within a cluster each entry takes the first column that is
 * free at its start, which is the greedy assignment calendars conventionally
 * use: earlier entries stay left, later ones fill in beside them.
 *
 * Returns one placement per input, in input order.
 */
export function packOverlaps(spans: Span[]): Placement[] {
  const items = spans.map((span, index) => ({ index, ...normalizeSpan(span) }));
  // Sort by start, then by the longer span first: a long entry that starts at
  // the same minute should take the left column.
  const order = [...items].sort((a, b) => a.startMin - b.startMin || b.endMin - a.endMin || a.index - b.index);

  const placements: Placement[] = spans.map(() => ({ column: 0, columns: 1 }));
  let cluster: typeof order = [];
  let clusterEnd = -1;

  const flush = () => {
    if (cluster.length === 0) return;
    // Greedy column assignment inside the cluster.
    const columnEnds: number[] = [];
    const assigned = new Map<number, number>();
    for (const item of cluster) {
      let col = columnEnds.findIndex((end) => end <= item.startMin);
      if (col === -1) {
        col = columnEnds.length;
        columnEnds.push(item.endMin);
      } else {
        columnEnds[col] = item.endMin;
      }
      assigned.set(item.index, col);
    }
    const columns = columnEnds.length;
    for (const item of cluster) {
      placements[item.index] = { column: assigned.get(item.index)!, columns };
    }
    cluster = [];
    clusterEnd = -1;
  };

  for (const item of order) {
    if (cluster.length > 0 && item.startMin >= clusterEnd) flush();
    cluster.push(item);
    clusterEnd = Math.max(clusterEnd, item.endMin);
  }
  flush();

  return placements;
}

/**
 * The minute a pointer at `offsetY` within a `height`-pixel column lands on,
 * snapped to `snapMinutes`. Out-of-range offsets clamp into the day rather than
 * producing a time that does not exist.
 */
export function minuteFromOffset(offsetY: number, height: number, snapMinutes = 15): number {
  if (!(height > 0)) return 0;
  const ratio = Math.min(Math.max(offsetY / height, 0), 1);
  const raw = ratio * MINUTES_PER_DAY;
  const snapped = Math.round(raw / snapMinutes) * snapMinutes;
  return Math.min(Math.max(snapped, 0), MINUTES_PER_DAY - snapMinutes);
}

/** 'HH:MM' for a minute-of-day. */
export function timeLabel(minute: number): string {
  const m = Math.min(Math.max(0, Math.round(minute)), MINUTES_PER_DAY);
  return `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/**
 * The seven day-of-week indexes in display order for a given first day
 * (0 = Sunday, 1 = Monday).
 */
export function weekdayOrder(weekStart: number): number[] {
  const start = ((weekStart % 7) + 7) % 7;
  return Array.from({ length: 7 }, (_, i) => (start + i) % 7);
}

/**
 * How many blank cells a month grid needs before the 1st, given the weekday the
 * month starts on and which day the week starts on.
 */
export function leadingBlanks(firstWeekday: number, weekStart: number): number {
  return (((firstWeekday - weekStart) % 7) + 7) % 7;
}
