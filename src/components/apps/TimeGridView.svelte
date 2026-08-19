<script lang="ts">
  import type { Event as CalendarEvent, Todo } from '../../lib/db/types';
  import { describeRule } from '../../lib/scheduler/recurrence';
  import { occurrencesBetween, type Occurrence } from '../../lib/scheduler/occurrences';
  import {
    MINUTES_PER_DAY,
    minuteFromOffset,
    normalizeSpan,
    packOverlaps,
    timeLabel,
  } from '../../lib/scheduler/timegrid';
  import { renderMarkdown } from '../../lib/markdown';
  import { draggable, dropzone, type DragData } from '../../lib/dragdrop';

  /**
   * The week and day views: one component, because a day view IS a week view
   * with one column. Timed entries are positioned down a 24-hour column;
   * all-day events, multi-day spans and date-only TODOs sit in a lane above it,
   * where they have no time to be positioned by.
   *
   * Like the month grid it only DISPLAYS — every mutation goes back through the
   * callbacks, and expanding a recurring event is pure, so drawing writes
   * nothing.
   */
  let {
    events,
    todos,
    /** 7 for the week view, 1 for the day view. */
    days = 7,
    /** Anchor date 'YYYY-MM-DD'; the grid shows the week (or day) containing it. */
    anchor = $bindable(),
    /** 0 = Sunday, 1 = Monday. */
    weekStart = 0,
    oneventclick,
    ontodoclick,
    onslotclick,
    ondropitem,
  }: {
    events: CalendarEvent[];
    todos: Todo[];
    days?: 1 | 7;
    anchor: string;
    weekStart?: number;
    oneventclick: (occ: Occurrence) => void;
    ontodoclick: (t: Todo) => void;
    /** Clicking an empty slot: date plus 'HH:MM' (null in the all-day lane). */
    onslotclick: (date: string, time: string | null) => void;
    ondropitem: (
      type: 'todo' | 'event',
      id: string,
      date: string,
      occStart: string | null,
      time: string | null
    ) => void;
  } = $props();

  const HOUR_REM = 3;
  const pad = (n: number) => String(n).padStart(2, '0');
  const dateKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const parseDate = (key: string) => {
    const [y, m, d] = key.split('-').map(Number);
    return new Date(y!, m! - 1, d!);
  };
  const todayKey = dateKey(new Date());

  /** The first column's date: the anchor itself in day view, else its week. */
  let firstDate = $derived.by(() => {
    const at = parseDate(anchor);
    if (days === 1) return at;
    const shift = (((at.getDay() - weekStart) % 7) + 7) % 7;
    return new Date(at.getFullYear(), at.getMonth(), at.getDate() - shift);
  });

  let columns = $derived(
    Array.from({ length: days }, (_, i) => {
      const d = new Date(firstDate.getFullYear(), firstDate.getMonth(), firstDate.getDate() + i);
      return { date: dateKey(d), label: d.toLocaleDateString(undefined, { weekday: 'short' }), day: d.getDate() };
    })
  );

  let rangeLabel = $derived.by(() => {
    if (days === 1) {
      return parseDate(anchor).toLocaleDateString(undefined, {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
        year: 'numeric',
      });
    }
    const last = new Date(firstDate.getFullYear(), firstDate.getMonth(), firstDate.getDate() + 6);
    const sameMonth = last.getMonth() === firstDate.getMonth() && last.getFullYear() === firstDate.getFullYear();
    // Built by hand: asking Intl for {day, year} without a month yields things
    // like "2026 (day: 22)" in some locales.
    const left = firstDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    const right = sameMonth
      ? String(last.getDate())
      : last.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    return `${left} – ${right}, ${last.getFullYear()}`;
  });

  /** Anything that can be positioned down the hours: an event occurrence, or a
   * TODO that has a time of day. */
  type TimedEntry =
    | { kind: 'event'; occ: Occurrence }
    | { kind: 'todo'; todo: Todo };

  interface Placed {
    entry: TimedEntry;
    topPct: number;
    heightPct: number;
    column: number;
    columns: number;
  }

  interface Column {
    date: string;
    label: string;
    day: number;
    timed: Placed[];
    allDay: Occurrence[];
    todos: Todo[];
  }

  const occKey = (occ: Occurrence): string => occ.event.id + '@' + occ.start;
  const entryKey = (entry: TimedEntry): string =>
    entry.kind === 'event' ? occKey(entry.occ) : 'todo:' + entry.todo.id;
  const minutesInto = (iso: string, dayStart: Date): number =>
    (new Date(iso).getTime() - dayStart.getTime()) / 60_000;

  /** Minutes from local midnight for an 'HH:MM' string, or null if unusable. */
  function minutesOfTime(time: string | null): number | null {
    if (!time || !/^\d{2}:\d{2}$/.test(time)) return null;
    const h = Number(time.slice(0, 2));
    const m = Number(time.slice(3));
    if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
    return h * 60 + m;
  }

  let grid: Column[] = $derived.by(() => {
    const from = new Date(firstDate.getFullYear(), firstDate.getMonth(), firstDate.getDate());
    const to = new Date(from.getFullYear(), from.getMonth(), from.getDate() + days);
    const occs = occurrencesBetween(events, from.getTime(), to.getTime());

    return columns.map((col) => {
      const dayStart = parseDate(col.date);
      const dayEnd = new Date(dayStart.getFullYear(), dayStart.getMonth(), dayStart.getDate() + 1);
      const timedOccs: Occurrence[] = [];
      const allDay: Occurrence[] = [];

      for (const occ of occs) {
        const startMs = Date.parse(occ.start);
        const endMs = occ.end ? Date.parse(occ.end) : startMs;
        // Anything overlapping this day at all appears on it — a multi-day
        // event is on every day it covers, which the month grid never showed.
        if (endMs < dayStart.getTime() || startMs >= dayEnd.getTime()) continue;
        const spansWholeDay = startMs < dayStart.getTime() || endMs >= dayEnd.getTime();
        if (occ.event.all_day || spansWholeDay) allDay.push(occ);
        else timedOccs.push(occ);
      }

      // A TODO with a time of day belongs at that time, beside the events —
      // only an undated-time TODO has nowhere to go but the lane. It has no
      // duration, so normalizeSpan gives it the minimum height.
      const dayTodos = todos.filter((t) => t.due_date === col.date);
      const laneTodos: Todo[] = [];
      const timedTodos: { todo: Todo; startMin: number }[] = [];
      for (const t of dayTodos) {
        const startMin = minutesOfTime(t.due_time);
        if (startMin === null) laneTodos.push(t);
        else timedTodos.push({ todo: t, startMin });
      }

      // Events and timed TODOs are packed TOGETHER, so a 09:00 todo and a
      // 09:00 meeting sit side by side instead of on top of each other.
      const entries: TimedEntry[] = [
        ...timedOccs.map((occ): TimedEntry => ({ kind: 'event', occ })),
        ...timedTodos.map(({ todo }): TimedEntry => ({ kind: 'todo', todo })),
      ];
      const spans = [
        ...timedOccs.map((occ) => {
          const startMin = minutesInto(occ.start, dayStart);
          const endMin = occ.end ? minutesInto(occ.end, dayStart) : startMin;
          return normalizeSpan({ startMin, endMin });
        }),
        ...timedTodos.map(({ startMin }) => normalizeSpan({ startMin, endMin: startMin })),
      ];
      const placements = packOverlaps(spans);
      const timed: Placed[] = entries.map((entry, i) => ({
        entry,
        topPct: (spans[i]!.startMin / MINUTES_PER_DAY) * 100,
        heightPct: ((spans[i]!.endMin - spans[i]!.startMin) / MINUTES_PER_DAY) * 100,
        column: placements[i]!.column,
        columns: placements[i]!.columns,
      }));

      return { ...col, timed, allDay, todos: laneTodos };
    });
  });

  function shift(delta: number) {
    const at = parseDate(anchor);
    const step = days === 1 ? 1 : 7;
    anchor = dateKey(new Date(at.getFullYear(), at.getMonth(), at.getDate() + delta * step));
  }

  function goToday() {
    anchor = todayKey;
  }

  // ---- drag and drop ---------------------------------------------------------
  let dragOver: { date: string; time: string | null } | null = $state(null);

  /** The snapped time under the pointer inside a day column. */
  function timeAt(el: HTMLElement, clientY: number): string {
    const rect = el.getBoundingClientRect();
    return timeLabel(minuteFromOffset(clientY - rect.top, rect.height));
  }

  /**
   * `time` semantics, shared with the month grid:
   *   'HH:MM' — put it at this time
   *   ''      — it has NO time (dropped in the all-day lane)
   *   null    — leave whatever time it had (the month grid, which has no hours)
   */
  function onDropIn(data: DragData, date: string, time: string | null) {
    dragOver = null;
    if (data.kind === 'todo') {
      ondropitem('todo', data.id, date, null, time);
      return;
    }
    if (data.kind !== 'event') return;
    const at = data.id.lastIndexOf('@');
    if (at === -1) ondropitem('event', data.id, date, null, time);
    else ondropitem('event', data.id.slice(0, at), date, data.id.slice(at + 1), time);
  }

  // ---- hover previews (same behaviour as the month grid) ---------------------
  interface Preview {
    x: number;
    y: number;
    title: string;
    meta: string;
    html: string;
  }
  let preview: Preview | null = $state(null);
  let previewTimer: ReturnType<typeof setTimeout> | null = null;

  function showPreview(
    e: MouseEvent | FocusEvent,
    item: { kind: 'todo'; t: Todo } | { kind: 'event'; occ: Occurrence }
  ) {
    if (previewTimer) clearTimeout(previewTimer);
    const target = e.currentTarget as HTMLElement;
    previewTimer = setTimeout(() => {
      const r = target.getBoundingClientRect();
      const x = Math.min(r.left, window.innerWidth - 320);
      const y = r.bottom + 6;
      if (item.kind === 'todo') {
        const t = item.t;
        preview = {
          x,
          y,
          title: t.title,
          meta: [t.status.replace('_', ' '), t.priority, t.due_time ?? 'no time']
            .filter(Boolean)
            .join(' · '),
          html: t.description_md.trim() ? renderMarkdown(t.description_md) : '',
        };
      } else {
        const ev = item.occ.event;
        preview = {
          x,
          y,
          title: ev.title,
          meta: [
            ev.all_day
              ? 'all day'
              : new Date(item.occ.start).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }),
            ev.recurrence ? describeRule(ev.recurrence) : null,
            item.occ.detached ? 'changed for this day' : null,
          ]
            .filter(Boolean)
            .join(' · '),
          html: ev.description_md.trim() ? renderMarkdown(ev.description_md) : '',
        };
      }
    }, 250);
  }

  function hidePreview() {
    if (previewTimer) clearTimeout(previewTimer);
    previewTimer = null;
    preview = null;
  }

  /** Open the grid near working hours rather than at midnight. */
  let scroller: HTMLDivElement | null = $state(null);
  let scrolled = false;
  $effect(() => {
    if (!scroller || scrolled) return;
    scrolled = true;
    scroller.scrollTop = (7 / 24) * scroller.scrollHeight;
  });

  const HOURS = Array.from({ length: 24 }, (_, h) => h);
</script>

<div class="cal">
  <div class="row head">
    <button
      class="btn btn-sm"
      data-testid="cal-prev"
      aria-label={days === 1 ? 'Previous day' : 'Previous week'}
      onclick={() => shift(-1)}>←</button
    >
    <button class="btn btn-sm" data-testid="cal-today" onclick={goToday}>Today</button>
    <button
      class="btn btn-sm"
      data-testid="cal-next"
      aria-label={days === 1 ? 'Next day' : 'Next week'}
      onclick={() => shift(1)}>→</button
    >
    <h2 data-testid="cal-label">{rangeLabel}</h2>
  </div>

  <div class="tg" style={`--cols: ${days}; --hour: ${HOUR_REM}rem`}>
    <div class="tg-head">
      <div class="gutter-head" aria-hidden="true"></div>
      {#each grid as col (col.date)}
        <div class="col-head" class:today={col.date === todayKey}>
          <span class="dow">{col.label}</span>
          <span class="dnum">{col.day}</span>
        </div>
      {/each}
    </div>

    <div class="tg-allday">
      <div class="gutter-label">all day</div>
      {#each grid as col (col.date)}
        <div
          class="allday-cell"
          class:dropping={dragOver?.date === col.date && dragOver?.time === null}
          data-testid="tg-allday"
          data-date={col.date}
          use:dropzone={{
            accepts: (d) => d.kind === 'todo' || d.kind === 'event',
            onOver: () => (dragOver = { date: col.date, time: null }),
            onLeave: () => {
              if (dragOver?.date === col.date && dragOver?.time === null) dragOver = null;
            },
            onDrop: (d) => onDropIn(d, col.date, ''),
          }}
        >
          {#each col.allDay as occ (occKey(occ))}
            <button
              class="entry event"
              data-testid="cal-event"
              data-occurrence={occ.start}
              use:draggable={{
                data: { kind: 'event', id: occKey(occ) },
                label: occ.event.title,
                handle: '.entry',
                onStart: hidePreview,
              }}
              onmouseenter={(e) => showPreview(e, { kind: 'event', occ })}
              onmouseleave={hidePreview}
              onfocus={(e) => showPreview(e, { kind: 'event', occ })}
              onblur={hidePreview}
              onclick={() => {
                hidePreview();
                oneventclick(occ);
              }}
            >
              {occ.event.title}{occ.event.recurrence ? ' ↻' : ''}
            </button>
          {/each}
          {#each col.todos as t (t.id)}
            <button
              class="entry todo"
              class:done={t.status === 'completed'}
              data-testid="cal-todo"
              use:draggable={{
                data: { kind: 'todo', id: t.id },
                label: t.title,
                handle: '.entry',
                onStart: hidePreview,
              }}
              onmouseenter={(e) => showPreview(e, { kind: 'todo', t })}
              onmouseleave={hidePreview}
              onfocus={(e) => showPreview(e, { kind: 'todo', t })}
              onblur={hidePreview}
              onclick={() => {
                hidePreview();
                ontodoclick(t);
              }}
            >
              ☐ {t.title}
            </button>
          {/each}
        </div>
      {/each}
    </div>

    <div class="tg-body" bind:this={scroller} data-testid="tg-body">
      <div class="gutter">
        {#each HOURS as h (h)}
          <div class="hour-label"><span>{timeLabel(h * 60)}</span></div>
        {/each}
      </div>
      {#each grid as col (col.date)}
        <div
          class="day-col"
          class:today={col.date === todayKey}
          data-testid="tg-col"
          data-date={col.date}
          use:dropzone={{
            accepts: (d) => d.kind === 'todo' || d.kind === 'event',
            onOver: (_d, e, node) => {
              dragOver = { date: col.date, time: timeAt(node, e.clientY) };
            },
            onLeave: () => {
              if (dragOver?.date === col.date && dragOver?.time !== null) dragOver = null;
            },
            onDrop: (d, e, node) => onDropIn(d, col.date, timeAt(node, e.clientY)),
          }}
        >
          {#each HOURS as h (h)}
            <button
              class="slot"
              data-testid="tg-slot"
              data-date={col.date}
              data-hour={h}
              aria-label={`Add event on ${col.date} at ${timeLabel(h * 60)}`}
              onclick={() => onslotclick(col.date, timeLabel(h * 60))}
            ></button>
          {/each}
          {#if dragOver?.date === col.date && dragOver.time !== null}
            <div
              class="snapline"
              data-testid="tg-snapline"
              style={`top: ${((Number(dragOver.time.slice(0, 2)) * 60 + Number(dragOver.time.slice(3))) / MINUTES_PER_DAY) * 100}%`}
            >
              <span>{dragOver.time}</span>
            </div>
          {/if}
          {#each col.timed as placed (entryKey(placed.entry))}
            {@const box = `top:${placed.topPct}%; height:${placed.heightPct}%; left:${(placed.column / placed.columns) * 100}%; width:${(1 / placed.columns) * 100}%`}
            {#if placed.entry.kind === 'event'}
              {@const occ = placed.entry.occ}
              <button
                class="entry event timed"
                data-testid="cal-event"
                data-occurrence={occ.start}
                style={box}
                use:draggable={{
                  data: { kind: 'event', id: occKey(occ) },
                  label: occ.event.title,
                  handle: '.entry',
                  onStart: hidePreview,
                }}
                onmouseenter={(e) => showPreview(e, { kind: 'event', occ })}
                onmouseleave={hidePreview}
                onfocus={(e) => showPreview(e, { kind: 'event', occ })}
                onblur={hidePreview}
                onclick={() => {
                  hidePreview();
                  oneventclick(occ);
                }}
              >
                <span class="etime"
                  >{new Date(occ.start).toLocaleTimeString(undefined, {
                    hour: 'numeric',
                    minute: '2-digit',
                  })}</span
                >
                <span class="etitle">{occ.event.title}{occ.event.recurrence ? ' ↻' : ''}</span>
              </button>
            {:else}
              {@const t = placed.entry.todo}
              <button
                class="entry todo timed"
                class:done={t.status === 'completed'}
                data-testid="cal-todo"
                data-time={t.due_time}
                style={box}
                use:draggable={{
                  data: { kind: 'todo', id: t.id },
                  label: t.title,
                  handle: '.entry',
                  onStart: hidePreview,
                }}
                onmouseenter={(e) => showPreview(e, { kind: 'todo', t })}
                onmouseleave={hidePreview}
                onfocus={(e) => showPreview(e, { kind: 'todo', t })}
                onblur={hidePreview}
                onclick={() => {
                  hidePreview();
                  ontodoclick(t);
                }}
              >
                <span class="etime">{t.due_time}</span>
                <span class="etitle">☐ {t.title}</span>
              </button>
            {/if}
          {/each}
        </div>
      {/each}
    </div>
  </div>

  {#if preview}
    <div class="preview" data-testid="cal-preview" style="left: {preview.x}px; top: {preview.y}px" role="tooltip">
      <p class="preview-title">{preview.title}</p>
      <p class="preview-meta">{preview.meta}</p>
      {#if preview.html}
        <div class="preview-body">{@html preview.html}</div>
      {/if}
    </div>
  {/if}
</div>

<style>
  .cal {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .head {
    align-items: center;
  }

  .head h2 {
    font-size: var(--font-size-lg);
    letter-spacing: var(--tracking-label);
  }

  .tg {
    border: 1.5px solid var(--border-strong-color);
    background: var(--surface-color);
    --gutter: 3.5rem;
  }

  .tg-head,
  .tg-allday {
    display: grid;
    grid-template-columns: var(--gutter) repeat(var(--cols), 1fr);
  }

  .tg-head {
    border-bottom: 1.5px solid var(--border-strong-color);
  }

  .col-head {
    padding: var(--space-1) var(--space-2);
    text-align: center;
    border-left: 1px dashed var(--border-color);
  }

  .col-head.today {
    background: var(--color-primary-soft);
  }

  .dow {
    display: block;
    font-size: var(--font-size-eyebrow);
    letter-spacing: var(--tracking-label);
    text-transform: uppercase;
    color: var(--text-muted-color);
  }

  .dnum {
    font-size: var(--font-size-lg);
  }

  .tg-allday {
    border-bottom: 1.5px solid var(--border-strong-color);
    min-height: 2rem;
  }

  .gutter-label {
    font-size: var(--font-size-eyebrow);
    letter-spacing: var(--tracking-label);
    text-transform: uppercase;
    color: var(--text-muted-color);
    padding: var(--space-1);
    text-align: right;
  }

  .allday-cell {
    border-left: 1px dashed var(--border-color);
    padding: 2px;
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-height: 1.6rem;
  }

  .allday-cell.dropping {
    background: var(--color-primary-soft);
  }

  .tg-body {
    display: grid;
    grid-template-columns: var(--gutter) repeat(var(--cols), 1fr);
    max-height: 32rem;
    overflow-y: auto;
    position: relative;
  }

  .gutter {
    position: relative;
  }

  .hour-label {
    height: var(--hour);
    font-size: var(--font-size-sm);
    color: var(--text-muted-color);
    text-align: right;
    padding-right: var(--space-1);
    border-top: 1px dashed var(--border-color);
  }

  .hour-label span {
    position: relative;
    top: -0.6em;
  }

  .day-col {
    position: relative;
    border-left: 1px dashed var(--border-color);
  }

  .day-col.today {
    background: color-mix(in srgb, var(--color-primary-soft) 40%, transparent);
  }

  .slot {
    display: block;
    width: 100%;
    height: var(--hour);
    border: none;
    border-top: 1px dashed var(--border-color);
    background: none;
    cursor: pointer;
    padding: 0;
  }

  .slot:hover,
  .slot:focus-visible {
    background: var(--color-primary-soft);
  }

  .entry {
    display: block;
    width: 100%;
    text-align: left;
    font-size: var(--font-size-sm);
    border: 1px solid var(--border-strong-color);
    background: var(--surface-raised-color);
    color: var(--text-color);
    cursor: pointer;
    padding: 0 var(--space-1);
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
    touch-action: none;
  }

  .entry.timed {
    position: absolute;
    border-left: 3px solid var(--color-primary);
    white-space: normal;
  }

  .entry.todo.timed {
    border-left-color: var(--color-stamp);
  }

  .entry.todo.done {
    text-decoration: line-through;
    color: var(--text-muted-color);
  }

  .etime {
    color: var(--text-muted-color);
    margin-right: var(--space-1);
  }

  .etitle {
    font-weight: 600;
  }

  .snapline {
    position: absolute;
    left: 0;
    right: 0;
    border-top: 2px solid var(--color-stamp);
    pointer-events: none;
    z-index: 2;
  }

  .snapline span {
    position: absolute;
    top: -0.9em;
    left: 2px;
    font-size: var(--font-size-eyebrow);
    background: var(--color-stamp);
    color: var(--color-on-primary);
    padding: 0 2px;
  }

  .preview {
    position: fixed;
    z-index: 900;
    width: 18rem;
    max-height: 14rem;
    overflow: auto;
    background: var(--surface-raised-color);
    border: 1.5px solid var(--border-strong-color);
    box-shadow: var(--shadow-2);
    padding: var(--space-2);
    pointer-events: none;
  }

  .preview-title {
    font-weight: 600;
  }

  .preview-meta {
    font-size: var(--font-size-sm);
    color: var(--text-muted-color);
    margin-bottom: var(--space-1);
  }

  .preview-body {
    font-size: var(--font-size-sm);
  }

  @media (width < 44rem) {
    .tg {
      --gutter: 2.6rem;
    }

    .etime {
      display: none;
    }
  }
</style>
