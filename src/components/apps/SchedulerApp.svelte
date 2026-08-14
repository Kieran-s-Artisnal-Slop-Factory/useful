<script lang="ts">
  import { onMount } from 'svelte';
  import Card from '../Card.svelte';
  import {
    all,
    byIndex,
    get,
    getSingleton,
    nowIso,
    patch,
    put,
    putSingleton,
    softDelete,
    softDeleteMany,
    withSyncFields,
  } from '../../lib/db/repo';
  import type {
    Event as CalendarEvent,
    Preferences,
    RecurrenceRule,
    Todo,
    TodoComment,
    TodoPriority,
    TodoStatus,
  } from '../../lib/db/types';
  import { describeRule, nextDueDate } from '../../lib/scheduler/recurrence';
  import { initialRank, rankAfter, rankBetween } from '../../lib/scheduler/rank';
  import { renderMarkdown } from '../../lib/markdown';
  import CalendarView from './CalendarView.svelte';

  type View = 'list' | 'board' | 'calendar';
  const STATUSES: { key: TodoStatus; label: string }[] = [
    { key: 'todo', label: 'TODO' },
    { key: 'in_progress', label: 'In progress' },
    { key: 'completed', label: 'Completed' },
  ];
  const PRIORITIES: TodoPriority[] = ['low', 'medium', 'high', 'urgent'];

  let loading = $state(true);
  let view: View = $state('list');
  let todos: Todo[] = $state([]);
  let events: CalendarEvent[] = $state([]);
  let comments: TodoComment[] = $state([]);

  // ---- data
  async function refresh() {
    [todos, events, comments] = await Promise.all([
      all<Todo>('todos'),
      all<CalendarEvent>('events'),
      all<TodoComment>('todo_comments'),
    ]);
  }

  onMount(async () => {
    const prefs = await getSingleton<Preferences>('preferences');
    if (prefs?.scheduler_view === 'board' || prefs?.scheduler_view === 'calendar') {
      view = prefs.scheduler_view;
    }
    await refresh();
    loading = false;
  });

  function setView(v: View) {
    view = v;
    void putSingleton<Partial<Preferences>>('preferences', { scheduler_view: v });
  }

  // ---- todo form
  let todoFormOpen = $state(false);
  let todoEditingId: string | null = $state(null);
  let todoError: string | null = $state(null);
  let todoDraft = $state(blankTodoDraft());

  function blankTodoDraft() {
    return {
      title: '',
      description_md: '',
      due_date: '',
      due_time: '',
      priority: 'medium' as TodoPriority,
      notify: false,
      recur: 'none' as 'none' | 'every' | 'weekdays',
      every_interval: 1,
      every_unit: 'days' as 'days' | 'weeks' | 'months',
      weekdays: [] as number[],
    };
  }

  function openTodoCreate() {
    todoDraft = blankTodoDraft();
    todoError = null;
    todoEditingId = null;
    todoFormOpen = true;
  }

  function openTodoEdit(t: Todo) {
    todoDraft = {
      title: t.title,
      description_md: t.description_md,
      due_date: t.due_date ?? '',
      due_time: t.due_time ?? '',
      priority: t.priority,
      notify: t.notify,
      recur: t.recurrence === null ? 'none' : t.recurrence.kind === 'every' ? 'every' : 'weekdays',
      every_interval: t.recurrence?.kind === 'every' ? t.recurrence.interval : 1,
      every_unit: t.recurrence?.kind === 'every' ? t.recurrence.unit : 'days',
      weekdays: t.recurrence?.kind === 'weekdays' ? [...t.recurrence.days] : [],
    };
    todoError = null;
    todoEditingId = t.id;
    todoFormOpen = true;
  }

  function draftRule(): RecurrenceRule | null {
    if (todoDraft.recur === 'every') {
      return {
        kind: 'every',
        interval: Math.max(1, Math.round(+todoDraft.every_interval || 1)),
        unit: todoDraft.every_unit,
      };
    }
    if (todoDraft.recur === 'weekdays') {
      return todoDraft.weekdays.length > 0 ? { kind: 'weekdays', days: [...todoDraft.weekdays].sort() } : null;
    }
    return null;
  }

  async function saveTodo(e: SubmitEvent) {
    e.preventDefault();
    todoError = null;
    if (!todoDraft.title.trim()) {
      todoError = 'A TODO needs a title.';
      return;
    }
    const fields = {
      title: todoDraft.title.trim(),
      description_md: todoDraft.description_md,
      due_date: todoDraft.due_date || null,
      due_time: (todoDraft.due_date && todoDraft.due_time) || null,
      priority: todoDraft.priority,
      notify: todoDraft.notify,
      recurrence: draftRule(),
    };
    if (todoEditingId) {
      const saved = await patch<Todo>('todos', todoEditingId, fields);
      if (!saved) {
        todoError = 'That TODO was deleted somewhere else — nothing was saved.';
        await refresh();
        return;
      }
    } else {
      await put<Todo>(
        'todos',
        withSyncFields({
          ...fields,
          status: 'todo' as TodoStatus,
          completed_at: null,
          recurrence_parent_id: null,
          rank: rankAfter(lastRank('todo')),
        })
      );
    }
    todoFormOpen = false;
    await refresh();
  }

  // ---- todo actions
  function column(status: TodoStatus): Todo[] {
    return todos.filter((t) => t.status === status).sort((a, b) => (a.rank < b.rank ? -1 : 1));
  }

  function lastRank(status: TodoStatus): string | null {
    const col = column(status);
    return col.length > 0 ? col[col.length - 1]!.rank : null;
  }

  async function setStatus(t: Todo, status: TodoStatus) {
    if (status === 'completed') {
      await completeTodo(t);
      return;
    }
    await patch<Todo>('todos', t.id, {
      status,
      completed_at: null,
      rank: rankAfter(lastRank(status)),
    });
    await refresh();
  }

  /** Completing a RECURRING todo also creates exactly one successor — inside
   * this explicit action, never on render. Idempotent: a second complete of
   * an already-completed row does nothing. */
  async function completeTodo(t: Todo) {
    const fresh = await get<Todo>('todos', t.id);
    if (!fresh || fresh.status === 'completed') return;
    await patch<Todo>('todos', t.id, {
      status: 'completed',
      completed_at: nowIso(),
      rank: rankAfter(lastRank('completed')),
    });
    if (fresh.recurrence) {
      await put<Todo>(
        'todos',
        withSyncFields({
          title: fresh.title,
          description_md: fresh.description_md,
          due_date: fresh.due_date ? nextDueDate(fresh.recurrence, fresh.due_date) : null,
          due_time: fresh.due_time,
          priority: fresh.priority,
          status: 'todo' as TodoStatus,
          completed_at: null,
          recurrence: fresh.recurrence,
          recurrence_parent_id: fresh.id,
          rank: rankAfter(lastRank('todo')),
          notify: fresh.notify,
        })
      );
    }
    await refresh();
  }

  async function deleteTodo(t: Todo) {
    if (!confirm('Delete TODO "' + t.title + '" (and its comments)?')) return;
    await softDelete('todos', t.id);
    await softDeleteMany(
      'todo_comments',
      comments.filter((c) => c.todo_id === t.id).map((c) => c.id)
    );
    if (detailId === t.id) detailId = null;
    await refresh();
  }

  /** Move within a column: ONE row changes (its rank), nothing else. */
  async function moveInColumn(t: Todo, direction: -1 | 1) {
    const col = column(t.status);
    const i = col.findIndex((x) => x.id === t.id);
    const j = i + direction;
    if (i < 0 || j < 0 || j >= col.length) return;
    const before = direction === -1 ? col[j - 1]?.rank ?? null : col[j]!.rank;
    const after = direction === -1 ? col[j]!.rank : col[j + 1]?.rank ?? null;
    await patch<Todo>('todos', t.id, { rank: rankBetween(before, after) });
    await refresh();
  }

  // ---- comments
  let detailId: string | null = $state(null);
  let commentDraft = $state('');

  function commentsFor(todoId: string): TodoComment[] {
    return comments
      .filter((c) => c.todo_id === todoId)
      .sort((a, b) => (a.updated_at < b.updated_at ? -1 : 1));
  }

  async function addComment(todoId: string) {
    if (!commentDraft.trim()) return;
    await put<TodoComment>('todo_comments', withSyncFields({ todo_id: todoId, body_md: commentDraft.trim() }));
    commentDraft = '';
    await refresh();
  }

  async function deleteComment(c: TodoComment) {
    await softDelete('todo_comments', c.id);
    await refresh();
  }

  // ---- event form
  let eventFormOpen = $state(false);
  let eventEditingId: string | null = $state(null);
  let eventError: string | null = $state(null);
  let eventDraft = $state(blankEventDraft());

  function blankEventDraft() {
    return { title: '', description_md: '', date: '', time: '', end_date: '', end_time: '', all_day: false, notify: false };
  }

  function openEventCreate(date?: string) {
    eventDraft = { ...blankEventDraft(), date: date ?? '' };
    eventError = null;
    eventEditingId = null;
    eventFormOpen = true;
  }

  function openEventEdit(ev: CalendarEvent) {
    const start = new Date(ev.start);
    const end = ev.end ? new Date(ev.end) : null;
    eventDraft = {
      title: ev.title,
      description_md: ev.description_md,
      date: localDate(start),
      time: ev.all_day ? '' : localTime(start),
      end_date: end ? localDate(end) : '',
      end_time: end && !ev.all_day ? localTime(end) : '',
      all_day: ev.all_day,
      notify: ev.notify,
    };
    eventError = null;
    eventEditingId = ev.id;
    eventFormOpen = true;
  }

  const pad = (n: number) => String(n).padStart(2, '0');
  function localDate(d: Date): string {
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }
  function localTime(d: Date): string {
    return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  async function saveEvent(e: SubmitEvent) {
    e.preventDefault();
    eventError = null;
    if (!eventDraft.title.trim() || !eventDraft.date) {
      eventError = 'An event needs a title and a date.';
      return;
    }
    const start = new Date(`${eventDraft.date}T${eventDraft.all_day || !eventDraft.time ? '00:00' : eventDraft.time}`);
    const end = eventDraft.end_date
      ? new Date(`${eventDraft.end_date}T${eventDraft.all_day || !eventDraft.end_time ? '00:00' : eventDraft.end_time}`)
      : null;
    if (end && end.getTime() < start.getTime()) {
      eventError = 'The end must not be before the start.';
      return;
    }
    const fields = {
      title: eventDraft.title.trim(),
      description_md: eventDraft.description_md,
      start: start.toISOString(),
      end: end ? end.toISOString() : null,
      all_day: eventDraft.all_day,
      notify: eventDraft.notify,
    };
    if (eventEditingId) {
      const saved = await patch<CalendarEvent>('events', eventEditingId, fields);
      if (!saved) {
        eventError = 'That event was deleted somewhere else — nothing was saved.';
        await refresh();
        return;
      }
    } else {
      await put<CalendarEvent>('events', withSyncFields(fields));
    }
    eventFormOpen = false;
    await refresh();
  }

  async function deleteEvent(ev: CalendarEvent) {
    if (!confirm('Delete event "' + ev.title + '"?')) return;
    await softDelete('events', ev.id);
    eventFormOpen = false;
    await refresh();
  }

  // ---- list helpers
  const PRIORITY_ORDER: Record<TodoPriority, number> = { urgent: 0, high: 1, medium: 2, low: 3 };
  let listTodos = $derived(
    [...todos].sort((a, b) => {
      if (a.status !== b.status) return a.status === 'completed' ? 1 : b.status === 'completed' ? -1 : 0;
      const ad = a.due_date ?? '9999-99-99';
      const bd = b.due_date ?? '9999-99-99';
      if (ad !== bd) return ad < bd ? -1 : 1;
      return PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority];
    })
  );

  function isOverdue(t: Todo): boolean {
    if (t.status === 'completed' || !t.due_date) return false;
    const due = new Date(`${t.due_date}T${t.due_time ?? '23:59'}`);
    return due.getTime() < Date.now();
  }
</script>

<div class="page-header">
  <h1>Scheduler</h1>
  <div class="row">
    <button class="btn btn-sm" data-testid="scheduler-new-todo" onclick={openTodoCreate}>+ TODO</button>
    <button class="btn btn-sm" data-testid="scheduler-new-event" onclick={() => openEventCreate()}>+ Event</button>
  </div>
</div>

<div class="row views" role="group" aria-label="View">
  {#each [['list', 'List'], ['board', 'Board'], ['calendar', 'Calendar']] as [key, label] (key)}
    <button
      class="btn btn-sm"
      class:btn-primary={view === key}
      data-testid={'view-' + key}
      aria-pressed={view === key}
      onclick={() => setView(key as View)}
    >
      {label}
    </button>
  {/each}
</div>

{#if todoFormOpen}
  <Card title={todoEditingId ? 'Edit TODO' : 'New TODO'}>
    <form class="stack" onsubmit={saveTodo}>
      <div>
        <label for="todo-title">Title</label>
        <input id="todo-title" data-testid="todo-title" bind:value={todoDraft.title} required />
      </div>
      <div>
        <label for="todo-desc">Description (markdown)</label>
        <textarea id="todo-desc" data-testid="todo-desc" rows="3" bind:value={todoDraft.description_md}></textarea>
      </div>
      <div class="row">
        <div>
          <label for="todo-due">Due date</label>
          <input id="todo-due" data-testid="todo-due" type="date" bind:value={todoDraft.due_date} />
        </div>
        <div>
          <label for="todo-due-time">Time (optional)</label>
          <input id="todo-due-time" data-testid="todo-due-time" type="time" bind:value={todoDraft.due_time} disabled={!todoDraft.due_date} />
        </div>
        <div>
          <label for="todo-priority">Priority</label>
          <select id="todo-priority" data-testid="todo-priority" bind:value={todoDraft.priority}>
            {#each PRIORITIES as p (p)}<option value={p}>{p}</option>{/each}
          </select>
        </div>
      </div>
      <div class="row">
        <div>
          <label for="todo-recur">Repeats</label>
          <select id="todo-recur" data-testid="todo-recur" bind:value={todoDraft.recur}>
            <option value="none">never</option>
            <option value="every">every N…</option>
            <option value="weekdays">weekly on…</option>
          </select>
        </div>
        {#if todoDraft.recur === 'every'}
          <div>
            <label for="todo-every-n">Every</label>
            <div class="row">
              <input id="todo-every-n" class="num" type="number" min="1" max="365" bind:value={todoDraft.every_interval} />
              <select bind:value={todoDraft.every_unit} aria-label="Unit">
                <option value="days">days</option>
                <option value="weeks">weeks</option>
                <option value="months">months</option>
              </select>
            </div>
          </div>
        {:else if todoDraft.recur === 'weekdays'}
          <div class="row" role="group" aria-label="Weekdays">
            {#each ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as name, day (day)}
              <label class="check">
                <input type="checkbox" checked={todoDraft.weekdays.includes(day)} onchange={(e) => {
                  todoDraft.weekdays = e.currentTarget.checked
                    ? [...todoDraft.weekdays, day]
                    : todoDraft.weekdays.filter((d) => d !== day);
                }} />
                {name}
              </label>
            {/each}
          </div>
        {/if}
        <label class="check">
          <input type="checkbox" data-testid="todo-notify" bind:checked={todoDraft.notify} />
          Notify when due
        </label>
      </div>
      {#if todoError}<p class="form-error">{todoError}</p>{/if}
      <div class="row">
        <button class="btn btn-primary" data-testid="todo-save" type="submit">Save</button>
        <button class="btn" type="button" onclick={() => (todoFormOpen = false)}>Cancel</button>
      </div>
    </form>
  </Card>
{/if}

{#if eventFormOpen}
  <Card title={eventEditingId ? 'Edit event' : 'New event'}>
    <form class="stack" onsubmit={saveEvent}>
      <div>
        <label for="event-title">Title</label>
        <input id="event-title" data-testid="event-title" bind:value={eventDraft.title} required />
      </div>
      <div>
        <label for="event-desc">Description (markdown, optional)</label>
        <textarea id="event-desc" rows="2" bind:value={eventDraft.description_md}></textarea>
      </div>
      <div class="row">
        <div>
          <label for="event-date">Date</label>
          <input id="event-date" data-testid="event-date" type="date" bind:value={eventDraft.date} required />
        </div>
        {#if !eventDraft.all_day}
          <div>
            <label for="event-time">Time</label>
            <input id="event-time" data-testid="event-time" type="time" bind:value={eventDraft.time} />
          </div>
        {/if}
        <div>
          <label for="event-end-date">End date (optional)</label>
          <input id="event-end-date" type="date" bind:value={eventDraft.end_date} />
        </div>
        {#if !eventDraft.all_day && eventDraft.end_date}
          <div>
            <label for="event-end-time">End time</label>
            <input id="event-end-time" type="time" bind:value={eventDraft.end_time} />
          </div>
        {/if}
      </div>
      <div class="row">
        <label class="check"><input type="checkbox" data-testid="event-all-day" bind:checked={eventDraft.all_day} /> All day</label>
        <label class="check"><input type="checkbox" bind:checked={eventDraft.notify} /> Notify at start</label>
      </div>
      {#if eventError}<p class="form-error">{eventError}</p>{/if}
      <div class="row">
        <button class="btn btn-primary" data-testid="event-save" type="submit">Save</button>
        {#if eventEditingId}
          {@const editing = events.find((ev) => ev.id === eventEditingId)}
          {#if editing}
            <button class="btn btn-sm btn-danger" type="button" onclick={() => deleteEvent(editing)}>Delete</button>
          {/if}
        {/if}
        <button class="btn" type="button" onclick={() => (eventFormOpen = false)}>Cancel</button>
      </div>
    </form>
  </Card>
{/if}

{#if loading}
  <p class="muted">Loading…</p>
{:else if view === 'list'}
  {#if listTodos.length === 0}
    <p class="muted">No TODOs yet.</p>
  {:else}
    <div class="table-wrap">
      <table class="data-table">
        <thead>
          <tr><th>Status</th><th>Title</th><th>Due</th><th>Priority</th><th></th></tr>
        </thead>
        <tbody>
          {#each listTodos as t (t.id)}
            <tr data-testid="todo-row" data-todo-id={t.id} class:done={t.status === 'completed'}>
              <td>
                <select
                  class="status-select"
                  data-testid="todo-status"
                  aria-label={'Status of ' + t.title}
                  value={t.status}
                  onchange={(e) => setStatus(t, e.currentTarget.value as TodoStatus)}
                >
                  {#each STATUSES as s (s.key)}<option value={s.key}>{s.label}</option>{/each}
                </select>
              </td>
              <td>
                <button class="linklike" data-testid="todo-open" onclick={() => (detailId = detailId === t.id ? null : t.id)}>
                  {t.title}
                </button>
                {#if t.recurrence}<span class="muted recur-tag">↻ {describeRule(t.recurrence)}</span>{/if}
                {#if detailId === t.id}
                  <div class="detail stack">
                    {#if t.description_md.trim()}
                      <div class="desc">{@html renderMarkdown(t.description_md)}</div>
                    {/if}
                    <div class="stack" data-testid="todo-comments">
                      {#each commentsFor(t.id) as c (c.id)}
                        <div class="comment" data-testid="todo-comment">
                          <span class="muted small">{new Date(c.updated_at).toLocaleString()}</span>
                          <div class="desc">{@html renderMarkdown(c.body_md)}</div>
                          <button class="btn btn-sm btn-danger" onclick={() => deleteComment(c)}>Delete</button>
                        </div>
                      {/each}
                      <form
                        class="row"
                        onsubmit={(e) => {
                          e.preventDefault();
                          void addComment(t.id);
                        }}
                      >
                        <input
                          data-testid="comment-input"
                          placeholder="Add a comment (markdown)…"
                          bind:value={commentDraft}
                        />
                        <button class="btn btn-sm" data-testid="comment-add" type="submit">Comment</button>
                      </form>
                    </div>
                  </div>
                {/if}
              </td>
              <td class:overdue={isOverdue(t)} data-testid="todo-due-cell">
                {t.due_date ?? '—'}{t.due_time ? ' ' + t.due_time : ''}
              </td>
              <td class="prio prio-{t.priority}">{t.priority}</td>
              <td class="actions">
                <button class="btn btn-sm" data-testid="todo-edit" onclick={() => openTodoEdit(t)}>Edit</button>
                <button class="btn btn-sm btn-danger" data-testid="todo-delete" onclick={() => deleteTodo(t)}>Delete</button>
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
{:else if view === 'board'}
  <div class="board">
    {#each STATUSES as s (s.key)}
      <section class="col" aria-label={s.label}>
        <h2>{s.label} <span class="muted">{column(s.key).length}</span></h2>
        {#each column(s.key) as t, i (t.id)}
          <div class="card-item" data-testid="board-card" data-todo-id={t.id}>
            <p class="card-title">{t.title}</p>
            <p class="muted small">
              {t.due_date ?? ''}{t.due_time ? ' ' + t.due_time : ''}
              <span class="prio prio-{t.priority}">{t.priority}</span>
            </p>
            <div class="row">
              {#if s.key !== 'todo'}
                <button class="btn btn-sm" data-testid="card-left" aria-label={'Move ' + t.title + ' left'} onclick={() => setStatus(t, s.key === 'completed' ? 'in_progress' : 'todo')}>←</button>
              {/if}
              <button class="btn btn-sm" data-testid="card-up" aria-label={'Move ' + t.title + ' up'} disabled={i === 0} onclick={() => moveInColumn(t, -1)}>↑</button>
              <button class="btn btn-sm" data-testid="card-down" aria-label={'Move ' + t.title + ' down'} disabled={i === column(s.key).length - 1} onclick={() => moveInColumn(t, 1)}>↓</button>
              {#if s.key !== 'completed'}
                <button class="btn btn-sm" data-testid="card-right" aria-label={'Move ' + t.title + ' right'} onclick={() => setStatus(t, s.key === 'todo' ? 'in_progress' : 'completed')}>→</button>
              {/if}
            </div>
          </div>
        {/each}
      </section>
    {/each}
  </div>
{:else}
  <CalendarView
    {events}
    {todos}
    oneventclick={(ev) => openEventEdit(ev)}
    ondayclick={(date) => openEventCreate(date)}
  />
{/if}

<style>
  .views {
    margin-bottom: var(--space-4);
  }

  .num {
    width: 4.5rem;
  }

  .check {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    color: var(--text-color);
    font-size: var(--font-size-base);
    text-transform: none;
    letter-spacing: normal;
    margin-bottom: 0;
  }

  .form-error {
    color: var(--color-danger);
    font-size: var(--font-size-sm);
  }

  .small {
    font-size: var(--font-size-sm);
  }

  tr.done {
    opacity: 0.6;
  }

  .status-select {
    width: auto;
  }

  .linklike {
    background: none;
    border: none;
    padding: 0;
    cursor: pointer;
    color: var(--color-primary-strong);
    font-weight: 600;
    text-decoration: underline;
    text-underline-offset: 3px;
  }

  .recur-tag {
    margin-left: var(--space-2);
    font-size: var(--font-size-sm);
  }

  .detail {
    margin-top: var(--space-3);
    padding: var(--space-3);
    border: 1px dashed var(--border-color);
  }

  .comment {
    border-bottom: 1px dashed var(--border-color);
    padding-bottom: var(--space-2);
  }

  .overdue {
    color: var(--color-danger);
    font-weight: 700;
  }

  .prio {
    text-transform: uppercase;
    font-size: var(--font-size-eyebrow);
    letter-spacing: var(--tracking-wide);
  }

  .prio-urgent {
    color: var(--color-danger);
    font-weight: 700;
  }

  .prio-high {
    color: var(--color-warning);
    font-weight: 700;
  }

  .actions {
    display: flex;
    gap: var(--space-1);
    justify-content: flex-end;
  }

  .desc :global(p) {
    margin-block: var(--space-1);
  }

  .board {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: var(--space-4);
  }

  @media (width < 50rem) {
    .board {
      grid-template-columns: 1fr;
    }
  }

  .col h2 {
    font-size: var(--font-size-eyebrow);
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: var(--tracking-label);
    color: var(--text-muted-color);
    margin-bottom: var(--space-3);
  }

  .card-item {
    background: var(--surface-color);
    border: 1px solid var(--border-strong-color);
    padding: var(--space-3);
    margin-bottom: var(--space-3);
  }

  .card-title {
    font-weight: 700;
    overflow-wrap: anywhere;
  }
</style>
