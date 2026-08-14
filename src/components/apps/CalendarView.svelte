<script lang="ts">
  import type { Event as CalendarEvent, Todo } from '../../lib/db/types';

  // Pure display: renders the month grid from props, writes nothing.
  let {
    events,
    todos,
    oneventclick,
    ondayclick,
  }: {
    events: CalendarEvent[];
    todos: Todo[];
    oneventclick: (ev: CalendarEvent) => void;
    ondayclick: (date: string) => void;
  } = $props();

  const today = new Date();
  let year = $state(today.getFullYear());
  let month = $state(today.getMonth()); // 0-11

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
    events: CalendarEvent[];
    todos: Todo[];
  }

  let monthLabel = $derived(
    new Date(year, month, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
  );

  let cells: Cell[] = $derived.by(() => {
    const eventsByDate = new Map<string, CalendarEvent[]>();
    for (const ev of events) {
      const key = localDateOf(ev.start);
      eventsByDate.set(key, [...(eventsByDate.get(key) ?? []), ev]);
    }
    const todosByDate = new Map<string, Todo[]>();
    for (const t of todos) {
      if (!t.due_date) continue;
      todosByDate.set(t.due_date, [...(todosByDate.get(t.due_date) ?? []), t]);
    }

    const first = new Date(year, month, 1);
    const start = new Date(year, month, 1 - first.getDay()); // back to Sunday
    const out: Cell[] = [];
    for (let i = 0; i < 42; i++) {
      const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
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
    year = d.getFullYear();
    month = d.getMonth();
  }

  function goToday() {
    year = today.getFullYear();
    month = today.getMonth();
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
    {#each ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as name (name)}
      <div class="dow" role="columnheader">{name}</div>
    {/each}
    {#each cells as cell (cell.date)}
      <div
        class="cell"
        class:out={!cell.inMonth}
        class:today={cell.date === todayKey}
        role="gridcell"
        data-testid="cal-cell"
        data-date={cell.date}
      >
        <button class="day" aria-label={'Add event on ' + cell.date} onclick={() => ondayclick(cell.date)}>
          {cell.day}
        </button>
        {#each cell.events as ev (ev.id)}
          <button class="entry event" data-testid="cal-event" onclick={() => oneventclick(ev)}>
            {ev.all_day ? '' : new Date(ev.start).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) + ' '}{ev.title}
          </button>
        {/each}
        {#each cell.todos as t (t.id)}
          <span class="entry todo" class:done={t.status === 'completed'} data-testid="cal-todo">
            ☐ {t.title}
          </span>
        {/each}
      </div>
    {/each}
  </div>
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
  }

  .entry.event {
    background: var(--color-primary-soft);
    border: none;
    border-left: 2px solid var(--color-primary);
    cursor: pointer;
    color: var(--text-color);
  }

  .entry.todo {
    color: var(--text-muted-color);
  }

  .entry.todo.done {
    text-decoration: line-through;
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
