<script lang="ts">
  import type { Event as CalendarEvent, Todo } from '../../lib/db/types';
  import { describeRule } from '../../lib/scheduler/recurrence';
  import { occurrencesBetween, type Occurrence } from '../../lib/scheduler/occurrences';
  import { DAY_NAMES } from '../../lib/scheduler/recurDraft';
  import { leadingBlanks, weekdayOrder } from '../../lib/scheduler/timegrid';
  import { renderMarkdown } from '../../lib/markdown';
  import { draggable, dropzone, type DragData } from '../../lib/dragdrop';

  // Pure display + interaction affordances: renders the month grid from
  // props; every mutation goes back through the callbacks.
  let {
    events,
    todos,
    anchor = $bindable(),
    weekStart = 0,
    oneventclick,
    ontodoclick,
    ondayclick,
    ondropitem,
  }: {
    events: CalendarEvent[];
    todos: Todo[];
    /** Anchor date 'YYYY-MM-DD' — the month containing it is the one shown.
     * Bindable so switching to week/day lands where you were looking. */
    anchor: string;
    /** 0 = Sunday, 1 = Monday. */
    weekStart?: number;
    /** Clicking an entry hands back the OCCURRENCE, not the row: a series has
     * many, and which one you clicked decides what "this event" means. */
    oneventclick: (occ: Occurrence) => void;
    ontodoclick: (t: Todo) => void;
    ondayclick: (date: string) => void;
    /** `occStart` is the instant of the dragged occurrence (null for todos). */
    ondropitem: (type: 'todo' | 'event', id: string, date: string, occStart: string | null) => void;
  } = $props();

  const today = new Date();
  const parseDate = (key: string) => {
    const [y, m, d] = key.split('-').map(Number);
    return new Date(y!, m! - 1, d!);
  };
  // The month on screen follows the shared anchor, so month/week/day switches
  // land on the same dates.
  let year = $derived(parseDate(anchor).getFullYear());
  let month = $derived(parseDate(anchor).getMonth()); // 0-11

  const pad = (n: number) => String(n).padStart(2, '0');
  const dateKey = (y: number, m: number, d: number) => `${y}-${pad(m + 1)}-${pad(d)}`;
  const todayKey = dateKey(today.getFullYear(), today.getMonth(), today.getDate());

  function localDateOf(iso: string): string {
    const d = new Date(iso);
    return dateKey(d.getFullYear(), d.getMonth(), d.getDate());
  }

  interface Cell {
    date: string;
    day: number;
    inMonth: boolean;
    events: Occurrence[];
    todos: Todo[];
  }

  /** Identity of one occurrence — unique even when a series repeats daily. */
  const occKey = (occ: Occurrence): string => occ.event.id + '@' + occ.start;

  let monthLabel = $derived(
    new Date(year, month, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
  );

  let cells: Cell[] = $derived.by(() => {
    // The grid always shows 42 days starting on the Sunday on or before the
    // 1st. Expanding exactly that range keeps the work proportional to what is
    // on screen — and expansion is pure, so drawing still writes nothing.
    const first = new Date(year, month, 1);
    const gridStart = new Date(year, month, 1 - leadingBlanks(first.getDay(), weekStart));
    const gridEnd = new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + 42);

    const eventsByDate = new Map<string, Occurrence[]>();
    for (const occ of occurrencesBetween(events, gridStart.getTime(), gridEnd.getTime())) {
      const key = localDateOf(occ.start);
      eventsByDate.set(key, [...(eventsByDate.get(key) ?? []), occ]);
    }
    const todosByDate = new Map<string, Todo[]>();
    for (const t of todos) {
      if (!t.due_date) continue;
      todosByDate.set(t.due_date, [...(todosByDate.get(t.due_date) ?? []), t]);
    }

    const out: Cell[] = [];
    for (let i = 0; i < 42; i++) {
      const d = new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + i);
      const key = dateKey(d.getFullYear(), d.getMonth(), d.getDate());
      out.push({
        date: key,
        day: d.getDate(),
        inMonth: d.getMonth() === month,
        events: (eventsByDate.get(key) ?? []).sort((a, b) => (a.start < b.start ? -1 : 1)),
        todos: todosByDate.get(key) ?? [],
      });
    }
    return out;
  });

  function shift(delta: number) {
    const d = new Date(year, month + delta, 1);
    anchor = dateKey(d.getFullYear(), d.getMonth(), 1);
  }

  function goToday() {
    anchor = todayKey;
  }

  // ---- drag-and-drop rescheduling (pointer-based: see src/lib/dragdrop.ts —
  // the HTML5 drag API this used to use never fires on touch or pen)
  let dragOverDate: string | null = $state(null);

  function onDrop(data: DragData, date: string) {
    dragOverDate = null;
    if (data.kind === 'todo') {
      ondropitem('todo', data.id, date, null);
      return;
    }
    if (data.kind !== 'event') return;
    // Event drags carry `<rowId>@<occurrenceStart>` - the row alone cannot say
    // WHICH occurrence of a series was picked up. Row ids are UUIDs, so the
    // last '@' is unambiguous.
    const at = data.id.lastIndexOf('@');
    if (at === -1) {
      ondropitem('event', data.id, date, null);
      return;
    }
    ondropitem('event', data.id.slice(0, at), date, data.id.slice(at + 1));
  }

  // ---- wiki-style hover previews
  interface Preview {
    x: number;
    y: number;
    title: string;
    meta: string;
    html: string;
  }
  let preview: Preview | null = $state(null);
  let previewTimer: ReturnType<typeof setTimeout> | null = null;

  function showPreview(e: MouseEvent | FocusEvent, item: { kind: 'todo'; t: Todo } | { kind: 'event'; occ: Occurrence }) {
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
          meta: [
            t.status.replace('_', ' '),
            t.priority,
            t.due_date ? `due ${t.due_date}${t.due_time ? ' ' + t.due_time : ''}` : 'undated',
            t.recurrence ? describeRule(t.recurrence) : null,
          ]
            .filter(Boolean)
            .join(' · '),
          html: t.description_md.trim() ? renderMarkdown(t.description_md) : '',
        };
      } else {
        const ev = item.occ.event;
        const start = new Date(item.occ.start);
        preview = {
          x,
          y,
          title: ev.title,
          meta: [
            ev.all_day
              ? 'all day'
              : start.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }),
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
</script>

<div class="cal">
  <div class="row head">
    <button class="btn btn-sm" data-testid="cal-prev" aria-label="Previous month" onclick={() => shift(-1)}>←</button>
    <button class="btn btn-sm" data-testid="cal-today" onclick={goToday}>Today</button>
    <button class="btn btn-sm" data-testid="cal-next" aria-label="Next month" onclick={() => shift(1)}>→</button>
    <h2 data-testid="cal-label">{monthLabel}</h2>
  </div>

  <div class="grid" role="grid" aria-label={monthLabel}>
    {#each weekdayOrder(weekStart) as day (day)}
      <div class="dow" role="columnheader">{DAY_NAMES[day]}</div>
    {/each}
    {#each cells as cell (cell.date)}
      <div
        class="cell"
        class:out={!cell.inMonth}
        class:today={cell.date === todayKey}
        class:dropping={dragOverDate === cell.date}
        role="gridcell"
        data-testid="cal-cell"
        data-date={cell.date}
        use:dropzone={{
          accepts: (d) => d.kind === 'todo' || d.kind === 'event',
          onOver: () => (dragOverDate = cell.date),
          onLeave: () => {
            if (dragOverDate === cell.date) dragOverDate = null;
          },
          onDrop: (d) => onDrop(d, cell.date),
        }}
      >
        <button class="day" aria-label={'Add event on ' + cell.date} onclick={() => ondayclick(cell.date)}>
          {cell.day}
        </button>
        {#each cell.events as occ (occKey(occ))}
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
            {occ.event.all_day ? '' : new Date(occ.start).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) + ' '}{occ.event.title}{occ.event.recurrence ? ' ↻' : ''}
          </button>
        {/each}
        {#each cell.todos as t (t.id)}
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
  .head {
    margin-bottom: var(--space-3);
  }

  .head h2 {
    font-size: var(--font-size-lg);
    text-transform: uppercase;
    letter-spacing: var(--tracking-wide);
    margin-left: var(--space-3);
  }

  .grid {
    display: grid;
    grid-template-columns: repeat(7, 1fr);
    border: 1px solid var(--border-strong-color);
    background: var(--surface-color);
  }

  .dow {
    font-size: var(--font-size-eyebrow);
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: var(--tracking-label);
    color: var(--text-muted-color);
    padding: var(--space-2);
    border-bottom: 1.5px solid var(--border-strong-color);
    text-align: center;
  }

  .cell {
    min-height: 6rem;
    border-right: 1px dashed var(--border-color);
    border-bottom: 1px dashed var(--border-color);
    padding: var(--space-1);
    display: flex;
    flex-direction: column;
    gap: 2px;
    overflow: hidden;
  }

  .cell:nth-child(7n + 7) {
    border-right: none;
  }

  .cell.out {
    opacity: 0.45;
  }

  .cell.dropping {
    outline: 2px solid var(--color-stamp);
    outline-offset: -2px;
  }

  .cell.today .day {
    color: var(--color-stamp);
    font-weight: 700;
  }

  .day {
    background: none;
    border: none;
    cursor: pointer;
    color: var(--text-muted-color);
    font-size: var(--font-size-sm);
    text-align: left;
    padding: var(--space-1);
    align-self: flex-start;
  }

  .entry {
    font-size: var(--font-size-sm);
    text-align: left;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    padding: 0 var(--space-1);
    cursor: grab;
    /* Entries ARE the drag handle here (they are too small for a separate
       grip), so they own the gesture on touch — the empty space in a day cell
       still scrolls the page. */
    touch-action: none;
  }

  .entry.event {
    background: var(--color-primary-soft);
    border: none;
    border-left: 2px solid var(--color-primary);
    color: var(--text-color);
  }

  .entry.todo {
    background: none;
    border: none;
    color: var(--text-muted-color);
  }

  .entry.todo.done {
    text-decoration: line-through;
  }

  .preview {
    position: fixed;
    z-index: 40;
    width: min(19rem, calc(100vw - 2 * var(--space-4)));
    background: var(--surface-raised-color);
    border: 1px solid var(--border-strong-color);
    box-shadow: var(--shadow-2), inset 2px 0 0 var(--color-stamp);
    padding: var(--space-3);
    pointer-events: none;
  }

  .preview-title {
    font-weight: 700;
    overflow-wrap: anywhere;
  }

  .preview-meta {
    font-size: var(--font-size-eyebrow);
    text-transform: uppercase;
    letter-spacing: var(--tracking-wide);
    color: var(--text-muted-color);
    margin-bottom: var(--space-2);
  }

  .preview-body {
    font-size: var(--font-size-sm);
    max-height: 10rem;
    overflow: hidden;
  }

  .preview-body :global(p) {
    margin-block: var(--space-1);
  }

  @media (width < 44rem) {
    .cell {
      min-height: 3.5rem;
    }

    .entry {
      display: none; /* too narrow for titles — the dot day view is future work */
    }
  }
</style>
