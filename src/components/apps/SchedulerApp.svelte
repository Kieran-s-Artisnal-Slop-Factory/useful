<script lang="ts">
  import { onMount } from 'svelte';
  import {
    all,
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
  import { draggable, dropzone, type DragData } from '../../lib/dragdrop';
  import { describeRule, nextDueDate } from '../../lib/scheduler/recurrence';
  import { isSeries, type Occurrence } from '../../lib/scheduler/occurrences';
  import { draftToRule, ruleToDraft, type RecurDraft } from '../../lib/scheduler/recurDraft';
  import { rankAfter, rankBetween } from '../../lib/scheduler/rank';
  import { renderMarkdown } from '../../lib/markdown';
  import CalendarView from './CalendarView.svelte';
  import TimeGridView from './TimeGridView.svelte';
  import RecurrenceFields from './RecurrenceFields.svelte';

  /**
   * Which instances of a series an edit or a delete applies to. Google's
   * semantics: "all" leaves occurrences that were already changed on their own
   * alone, because someone deliberately made them different (Q3).
   */
  type Scope = 'this' | 'following' | 'all';

  type View = 'list' | 'board' | 'calendar';
  /** Month, week or day — a sub-view OF the calendar, not a fourth view. */
  type CalView = 'month' | 'week' | 'day';
  const CAL_VIEWS: { key: CalView; label: string }[] = [
    { key: 'month', label: 'Month' },
    { key: 'week', label: 'Week' },
    { key: 'day', label: 'Day' },
  ];
  const STATUSES: { key: TodoStatus; label: string }[] = [
    { key: 'todo', label: 'TODO' },
    { key: 'in_progress', label: 'In progress' },
    { key: 'completed', label: 'Completed' },
  ];
  const PRIORITIES: TodoPriority[] = ['low', 'medium', 'high', 'urgent'];

  const pad2 = (n: number) => String(n).padStart(2, '0');
  const todayKey = (() => {
    const d = new Date();
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  })();

  let loading = $state(true);
  let view: View = $state('list');
  let calView: CalView = $state('month');
  /** Shared by all three calendar grids, so switching lands on the same dates. */
  let calAnchor = $state(todayKey);
  let weekStart = $state(0);
  let todos: Todo[] = $state([]);
  let events: CalendarEvent[] = $state([]);
  let comments: TodoComment[] = $state([]);

  async function refresh() {
    [todos, events, comments] = await Promise.all([
      all<Todo>('todos'),
      all<CalendarEvent>('events'),
      all<TodoComment>('todo_comments'),
    ]);
  }

  onMount(async () => {
    const prefs = await getSingleton<Preferences>('preferences');
    if (prefs?.scheduler_calendar_view === 'week' || prefs?.scheduler_calendar_view === 'day') {
      calView = prefs.scheduler_calendar_view;
    }
    if (prefs?.scheduler_week_start === 1) weekStart = 1;
    if (prefs?.scheduler_view === 'board' || prefs?.scheduler_view === 'calendar') {
      view = prefs.scheduler_view;
    }
    await refresh();
    loading = false;
  });

  function setCalView(v: CalView) {
    calView = v;
    void putSingleton<Partial<Preferences>>('preferences', { scheduler_calendar_view: v });
  }

  function setView(v: View) {
    view = v;
    void putSingleton<Partial<Preferences>>('preferences', { scheduler_view: v });
  }

  // ---- the modal (native <dialog>): create opens in edit mode; existing
  // items open in READ mode with a pencil to switch to edit.
  interface ModalState {
    type: 'todo' | 'event';
    id: string | null; // null = creating
    mode: 'read' | 'edit';
  }
  let modal: ModalState | null = $state(null);
  let dialogEl: HTMLDialogElement | undefined = $state();

  $effect(() => {
    if (!dialogEl) return;
    if (modal && !dialogEl.open) dialogEl.showModal();
    if (!modal && dialogEl.open) dialogEl.close();
  });

  $effect(() => {
    document.body.style.overflow = modal ? 'hidden' : '';
    return () => {
      document.body.style.overflow = '';
    };
  });

  // Read `modal` into a local before the lookup: narrowing a captured `$state`
  // variable does not survive into the `find` callback, so the assertion the
  // one-liner needed was hiding a genuine type error rather than proving one.
  let modalTodo = $derived.by(() => {
    const m = modal;
    return m?.type === 'todo' && m.id ? (todos.find((t) => t.id === m.id) ?? null) : null;
  });
  let modalEvent = $derived.by(() => {
    const m = modal;
    return m?.type === 'event' && m.id ? (events.find((e) => e.id === m.id) ?? null) : null;
  });
  /** The occurrence the modal was opened from — a series row is not enough. */
  let modalOccurrence: Occurrence | null = $state(null);
  /** Does this modal need to ask "this / following / all"? */
  let modalNeedsScope = $derived(
    modalEvent !== null && (isSeries(modalEvent) || modalEvent.series_id !== null)
  );
  let eventScope: Scope = $state('this');

  function closeModal() {
    modal = null;
  }

  // ---- todo draft/form
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
      until: '',
    };
  }

  function openTodoCreate() {
    todoDraft = blankTodoDraft();
    todoError = null;
    modal = { type: 'todo', id: null, mode: 'edit' };
  }

  function openTodoRead(t: Todo) {
    todoError = null;
    modal = { type: 'todo', id: t.id, mode: 'read' };
  }

  function editTodoFromModal(t: Todo) {
    todoDraft = {
      title: t.title,
      description_md: t.description_md,
      due_date: t.due_date ?? '',
      due_time: t.due_time ?? '',
      priority: t.priority,
      notify: t.notify,
      ...ruleToDraft(t.recurrence),
    };
    todoError = null;
    modal = { type: 'todo', id: t.id, mode: 'edit' };
  }

  function draftRule(): RecurrenceRule | null {
    return draftToRule(todoDraft as RecurDraft);
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
    if (modal?.id) {
      const saved = await patch<Todo>('todos', modal.id, fields);
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
    closeModal();
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
    closeModal();
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

  // ---- event draft/form
  let eventError: string | null = $state(null);
  let eventDraft = $state(blankEventDraft());

  function blankEventDraft() {
    return {
      title: '',
      description_md: '',
      date: '',
      time: '',
      end_date: '',
      end_time: '',
      all_day: false,
      notify: false,
      recur: 'none' as 'none' | 'every' | 'weekdays',
      every_interval: 1,
      every_unit: 'days' as 'days' | 'weeks' | 'months',
      weekdays: [] as number[],
      until: '',
    };
  }

  function openEventCreate(date?: string, time?: string) {
    eventDraft = { ...blankEventDraft(), date: date ?? '', time: time ?? '' };
    eventError = null;
    modalOccurrence = null;
    eventScope = 'this';
    modal = { type: 'event', id: null, mode: 'edit' };
  }

  /** Opened from the calendar: remember WHICH occurrence was clicked. */
  function openOccurrenceRead(occ: Occurrence) {
    eventError = null;
    modalOccurrence = occ;
    eventScope = 'this';
    modal = { type: 'event', id: occ.event.id, mode: 'read' };
  }

  function editEventFromModal(ev: CalendarEvent) {
    // Edit the occurrence that was opened, not the series anchor: the times in
    // the form must be the ones on screen.
    const startIso = modalOccurrence?.event.id === ev.id ? modalOccurrence.start : ev.start;
    const endIso = modalOccurrence?.event.id === ev.id ? modalOccurrence.end : ev.end;
    const start = new Date(startIso);
    const end = endIso ? new Date(endIso) : null;
    eventDraft = {
      title: ev.title,
      description_md: ev.description_md,
      date: localDate(start),
      time: ev.all_day ? '' : localTime(start),
      end_date: end ? localDate(end) : '',
      end_time: end && !ev.all_day ? localTime(end) : '',
      all_day: ev.all_day,
      notify: ev.notify,
      ...ruleToDraft(ev.recurrence),
    };
    eventError = null;
    eventScope = isSeries(ev) || ev.series_id ? 'this' : 'all';
    modal = { type: 'event', id: ev.id, mode: 'edit' };
  }

  /** The day before a local date — where "this and following" ends the old series. */
  function dayBefore(date: string): string {
    const [y, m, d] = date.split('-').map(Number);
    const dt = new Date(y!, m! - 1, d! - 1);
    return localDate(dt);
  }

  /** Detached rows that belong to a series (alive only — `all()` hides tombstones). */
  function detachedOf(seriesId: string): CalendarEvent[] {
    return events.filter((e) => e.series_id === seriesId);
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
    const rule = draftToRule(eventDraft as RecurDraft);
    const fields = {
      title: eventDraft.title.trim(),
      description_md: eventDraft.description_md,
      start: start.toISOString(),
      end: end ? end.toISOString() : null,
      all_day: eventDraft.all_day,
      notify: eventDraft.notify,
    };

    if (!modal?.id) {
      await put<CalendarEvent>(
        'events',
        withSyncFields({ ...fields, recurrence: rule, exdates: [], series_id: null, original_start: null })
      );
      closeModal();
      await refresh();
      return;
    }

    const row = events.find((e) => e.id === modal!.id);
    if (!row) {
      eventError = 'That event was deleted somewhere else — nothing was saved.';
      await refresh();
      return;
    }

    // A detached row, or a plain event, is just itself.
    if (!isSeries(row) || eventScope === 'all') {
      const saved = await patch<CalendarEvent>('events', row.id, {
        ...fields,
        ...(isSeries(row) || row.recurrence ? { recurrence: rule } : {}),
      });
      if (!saved) {
        eventError = 'That event was deleted somewhere else — nothing was saved.';
        await refresh();
        return;
      }
    } else if (eventScope === 'this') {
      // One occurrence pulled out of the series: ONE new row, parent untouched.
      const occStart = modalOccurrence?.start ?? row.start;
      await put<CalendarEvent>(
        'events',
        withSyncFields({
          ...fields,
          recurrence: null,
          exdates: [],
          series_id: row.id,
          original_start: occStart,
        })
      );
    } else {
      // This and following: end the old series the day before, start a new one
      // here. Two rows, both deliberate.
      const occStart = modalOccurrence?.start ?? row.start;
      const splitDate = localDate(new Date(occStart));
      const previous = dayBefore(splitDate);
      await patch<CalendarEvent>('events', row.id, {
        recurrence: { ...(row.recurrence as RecurrenceRule), until: previous },
      });
      await put<CalendarEvent>(
        'events',
        withSyncFields({ ...fields, recurrence: rule, exdates: [], series_id: null, original_start: null })
      );
    }
    closeModal();
    await refresh();
  }

  async function deleteEvent(ev: CalendarEvent) {
    const occStart = modalOccurrence?.event.id === ev.id ? modalOccurrence.start : ev.start;

    // A detached override: remove the row AND cancel the instant on the parent,
    // or the series would simply put its original occurrence back.
    if (ev.series_id && ev.original_start) {
      if (!confirm('Delete this occurrence of "' + ev.title + '"?')) return;
      const parent = events.find((e) => e.id === ev.series_id);
      await softDelete('events', ev.id);
      if (parent) {
        await patch<CalendarEvent>('events', parent.id, {
          exdates: [...(parent.exdates ?? []), ev.original_start],
        });
      }
      closeModal();
      await refresh();
      return;
    }

    if (!isSeries(ev)) {
      if (!confirm('Delete event "' + ev.title + '"?')) return;
      await softDelete('events', ev.id);
      closeModal();
      await refresh();
      return;
    }

    if (eventScope === 'this') {
      if (!confirm('Delete this occurrence of "' + ev.title + '"?')) return;
      await patch<CalendarEvent>('events', ev.id, { exdates: [...(ev.exdates ?? []), occStart] });
    } else if (eventScope === 'following') {
      if (!confirm('Delete this and every later occurrence of "' + ev.title + '"?')) return;
      await patch<CalendarEvent>('events', ev.id, {
        recurrence: { ...(ev.recurrence as RecurrenceRule), until: dayBefore(localDate(new Date(occStart))) },
      });
    } else {
      if (!confirm('Delete the whole series "' + ev.title + '"?')) return;
      // The overrides are part of the series; leaving them would orphan rows
      // whose foreign key points at a tombstone.
      const children = detachedOf(ev.id).map((c) => c.id);
      await softDeleteMany('events', [ev.id, ...children]);
    }
    closeModal();
    await refresh();
  }

  // ---- board drag-and-drop (one write per drop; dropping into Completed
  // runs the same complete path as the buttons, so recurrence still spawns)
  let boardDropCol: TodoStatus | null = $state(null);

  /** The todo a drag is carrying, if it is still around. */
  function draggedTodo(data: DragData): Todo | undefined {
    return data.kind === 'todo' ? todos.find((x) => x.id === data.id) : undefined;
  }

  async function dropOnColumn(data: DragData, status: TodoStatus) {
    boardDropCol = null;
    const t = draggedTodo(data);
    if (!t) return;
    if (t.status !== status) {
      await setStatus(t, status);
      return;
    }
    const col = column(status);
    if (col[col.length - 1]?.id === t.id) return; // already last — write nothing
    const rest = col.filter((x) => x.id !== t.id);
    await patch<Todo>('todos', t.id, { rank: rankAfter(rest[rest.length - 1]?.rank ?? null) });
    await refresh();
  }

  async function dropOnCard(data: DragData, target: Todo) {
    boardDropCol = null;
    const t = draggedTodo(data);
    if (!t || t.id === target.id) return;
    if (t.status !== target.status) {
      await setStatus(t, target.status); // cross-column drops append
      return;
    }
    const orig = column(target.status);
    if (orig.findIndex((x) => x.id === t.id) === orig.findIndex((x) => x.id === target.id) - 1) {
      return; // already directly above the target — write nothing
    }
    const rest = orig.filter((x) => x.id !== t.id);
    const idx = rest.findIndex((x) => x.id === target.id);
    await patch<Todo>('todos', t.id, {
      rank: rankBetween(idx > 0 ? rest[idx - 1]!.rank : null, target.rank),
    });
    await refresh();
  }

  /** Calendar drag-and-drop: ONE row per drop; same-day drops write nothing.
   * Events keep their time of day (end shifts by the same delta). */
  async function dropOnDate(
    type: 'todo' | 'event',
    id: string,
    date: string,
    occStart: string | null = null,
    /** 'HH:MM' when dropped on a time grid; null from the month grid. */
    time: string | null = null
  ) {
    if (type === 'todo') {
      const t = todos.find((x) => x.id === id);
      if (!t) return;
      // `time` is 'HH:MM' to set a time, '' to clear it (the all-day lane), or
      // null to leave it alone (the month grid, which has no hours to drop on).
      const nextTime = time === null ? t.due_time : time === '' ? null : time;
      // A drop that changes neither the date nor the time must not write.
      if (t.due_date === date && t.due_time === nextTime) return;
      await patch<Todo>('todos', id, { due_date: date, due_time: nextTime });
      await refresh();
      return;
    }

    const ev = events.find((x) => x.id === id);
    if (!ev) return;
    // Move the OCCURRENCE that was dragged, which for a series is not the row's
    // own start.
    const fromIso = occStart ?? ev.start;
    const start = new Date(fromIso);
    if (localDate(start) === date && (time === null || localTime(start) === time)) return;
    const [y, m, d] = date.split('-').map(Number);
    const newStart = new Date(start);
    newStart.setFullYear(y!, m! - 1, d!);
    if (time !== null) {
      const [hh, mm] = time.split(':').map(Number);
      newStart.setHours(hh!, mm!, 0, 0);
    }
    const durationMs = ev.end ? Date.parse(ev.end) - Date.parse(ev.start) : null;
    const newEnd = durationMs === null ? null : new Date(newStart.getTime() + durationMs).toISOString();

    if (isSeries(ev)) {
      // Dragging one occurrence of a series detaches it: ONE new row, and the
      // series is not touched at all.
      await put<CalendarEvent>(
        'events',
        withSyncFields({
          title: ev.title,
          description_md: ev.description_md,
          start: newStart.toISOString(),
          end: newEnd,
          all_day: ev.all_day,
          notify: ev.notify,
          recurrence: null,
          exdates: [],
          series_id: ev.id,
          original_start: fromIso,
        })
      );
    } else {
      await patch<CalendarEvent>('events', id, { start: newStart.toISOString(), end: newEnd });
    }
    await refresh();
  }

  // ---- list helpers
  // The list is YOUR order: the same fractional rank the board columns use
  // (drag rows to rearrange), with completed todos sinking to the bottom.
  let listTodos = $derived(
    [...todos].sort((a, b) => {
      if ((a.status === 'completed') !== (b.status === 'completed')) {
        return a.status === 'completed' ? 1 : -1;
      }
      if (a.rank !== b.rank) return a.rank < b.rank ? -1 : 1;
      return a.id < b.id ? -1 : 1;
    })
  );

  // ---- list drag-and-drop (reorder by rank; ONE write per drop, no-op
  // drops write nothing — same contract as the board)
  let listDropId: string | null = $state(null);
  let listDropEnd = $state(false);

  async function dropOnRow(data: DragData, target: Todo) {
    listDropId = null;
    listDropEnd = false;
    const t = draggedTodo(data);
    if (!t || t.id === target.id) return;
    const seq = listTodos;
    if (seq.findIndex((x) => x.id === t.id) === seq.findIndex((x) => x.id === target.id) - 1) {
      return; // already directly above the target — write nothing
    }
    const rest = seq.filter((x) => x.id !== t.id);
    const idx = rest.findIndex((x) => x.id === target.id);
    const prev = idx > 0 ? rest[idx - 1]!.rank : null;
    // Crossing the completed divider can invert display order vs rank order —
    // fall back to "just below everything above the target" in that case.
    const rank =
      prev !== null && prev >= target.rank
        ? rankBetween(null, target.rank)
        : rankBetween(prev, target.rank);
    await patch<Todo>('todos', t.id, { rank });
    await refresh();
  }

  async function dropAtListEnd(data: DragData) {
    listDropId = null;
    listDropEnd = false;
    const t = draggedTodo(data);
    if (!t) return;
    if (listTodos[listTodos.length - 1]?.id === t.id) return; // already last
    const last = listTodos.filter((x) => x.id !== t.id).at(-1);
    await patch<Todo>('todos', t.id, { rank: rankAfter(last?.rank ?? null) });
    await refresh();
  }

  function isOverdue(t: Todo): boolean {
    if (t.status === 'completed' || !t.due_date) return false;
    const due = new Date(`${t.due_date}T${t.due_time ?? '23:59'}`);
    return due.getTime() < Date.now();
  }

  function eventWhen(ev: CalendarEvent, startIso = ev.start, endIso = ev.end): string {
    const start = new Date(startIso);
    const startText = ev.all_day
      ? start.toLocaleDateString()
      : start.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
    if (!endIso) return startText;
    const end = new Date(endIso);
    const endText = ev.all_day
      ? end.toLocaleDateString()
      : end.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
    return `${startText} → ${endText}`;
  }

  /**
   * When the OCCURRENCE the modal was opened from happens — not the series
   * anchor, which for a weekly meeting opened in March may be back in January.
   */
  function occurrenceWhen(): string {
    if (!modalEvent) return '';
    const occ = modalOccurrence?.event.id === modalEvent.id ? modalOccurrence : null;
    return eventWhen(modalEvent, occ?.start ?? modalEvent.start, occ?.end ?? modalEvent.end);
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

<!-- The scheduler modal: create (edit mode) and read/update for both types. -->
<dialog
  bind:this={dialogEl}
  data-testid="scheduler-modal"
  onclose={() => (modal = null)}
  onclick={(e) => e.target === dialogEl && closeModal()}
>
  {#if modal?.type === 'todo'}
    {#if modal.mode === 'read' && modalTodo}
      <div class="modal-body stack" data-testid="modal-read">
        <header class="row modal-head">
          <h3>{modalTodo.title}</h3>
          <span class="spacer"></span>
          <button
            class="btn btn-sm"
            data-testid="modal-edit"
            aria-label="Edit"
            onclick={() => modalTodo && editTodoFromModal(modalTodo)}
          >
            ✎ Edit
          </button>
          <button class="btn btn-sm" data-testid="modal-close" onclick={closeModal}>Close</button>
        </header>
        <dl class="attrs">
          <dt>Status</dt>
          <dd>{STATUSES.find((s) => s.key === modalTodo!.status)?.label}</dd>
          <dt>Due</dt>
          <dd class:overdue={isOverdue(modalTodo)}>
            {modalTodo.due_date ?? '—'}{modalTodo.due_time ? ' ' + modalTodo.due_time : ''}
          </dd>
          <dt>Priority</dt>
          <dd class="prio prio-{modalTodo.priority}">{modalTodo.priority}</dd>
          <dt>Repeats</dt>
          <dd>{modalTodo.recurrence ? describeRule(modalTodo.recurrence) : 'never'}</dd>
          <dt>Notify</dt>
          <dd>{modalTodo.notify ? 'at due time' : 'no'}</dd>
        </dl>
        {#if modalTodo.description_md.trim()}
          <div class="desc" data-testid="modal-desc">{@html renderMarkdown(modalTodo.description_md)}</div>
        {:else}
          <p class="muted">No description.</p>
        {/if}
        <section class="stack" aria-label="Comments" data-testid="todo-comments">
          <h4 class="eyebrow">Comments</h4>
          {#each commentsFor(modalTodo.id) as c (c.id)}
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
              if (modalTodo) void addComment(modalTodo.id);
            }}
          >
            <input data-testid="comment-input" placeholder="Add a comment (markdown)…" bind:value={commentDraft} />
            <button class="btn btn-sm" data-testid="comment-add" type="submit">Comment</button>
          </form>
        </section>
        <div class="row">
          <button class="btn btn-sm btn-danger" data-testid="modal-delete" onclick={() => modalTodo && deleteTodo(modalTodo)}>
            Delete
          </button>
        </div>
      </div>
    {:else}
      <div class="modal-body stack">
        <header class="row modal-head">
          <h3>{modal.id ? 'Edit TODO' : 'New TODO'}</h3>
          <span class="spacer"></span>
          <button class="btn btn-sm" data-testid="modal-close" onclick={closeModal}>Close</button>
        </header>
        <form class="stack" onsubmit={saveTodo}>
          <div>
            <label for="todo-title">Title</label>
            <input id="todo-title" data-testid="todo-title" bind:value={todoDraft.title} required />
          </div>
          <div>
            <label for="todo-desc">Description (markdown)</label>
            <textarea id="todo-desc" data-testid="todo-desc" rows="4" bind:value={todoDraft.description_md}></textarea>
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
            <RecurrenceFields bind:draft={todoDraft} idPrefix="todo" />
            <label class="check">
              <input type="checkbox" data-testid="todo-notify" bind:checked={todoDraft.notify} />
              Notify when due
            </label>
          </div>
          {#if todoError}<p class="form-error">{todoError}</p>{/if}
          <div class="row">
            <button class="btn btn-primary" data-testid="todo-save" type="submit">Save</button>
            <button class="btn" type="button" onclick={closeModal}>Cancel</button>
          </div>
        </form>
      </div>
    {/if}
  {:else if modal?.type === 'event'}
    {#if modal.mode === 'read' && modalEvent}
      <div class="modal-body stack" data-testid="modal-read">
        <header class="row modal-head">
          <h3>{modalEvent.title}</h3>
          <span class="spacer"></span>
          <button
            class="btn btn-sm"
            data-testid="modal-edit"
            aria-label="Edit"
            onclick={() => modalEvent && editEventFromModal(modalEvent)}
          >
            ✎ Edit
          </button>
          <button class="btn btn-sm" data-testid="modal-close" onclick={closeModal}>Close</button>
        </header>
        <dl class="attrs">
          <dt>When</dt>
          <dd data-testid="modal-when">{occurrenceWhen()}</dd>
          <dt>All day</dt>
          <dd>{modalEvent.all_day ? 'yes' : 'no'}</dd>
          <dt>Repeats</dt>
          <dd data-testid="modal-repeats">
            {modalEvent.recurrence ? describeRule(modalEvent.recurrence) : 'never'}{modalEvent.recurrence
              ?.until
              ? ' until ' + modalEvent.recurrence.until
              : ''}{modalEvent.series_id ? ' (changed for this day)' : ''}
          </dd>
          <dt>Notify</dt>
          <dd>{modalEvent.notify ? 'at start' : 'no'}</dd>
        </dl>
        {#if modalEvent.description_md.trim()}
          <div class="desc" data-testid="modal-desc">{@html renderMarkdown(modalEvent.description_md)}</div>
        {:else}
          <p class="muted">No description.</p>
        {/if}
        {#if modalNeedsScope && modalEvent.recurrence}
          <fieldset class="scope" data-testid="event-scope">
            <legend>Apply to</legend>
            {#each [['this', 'This event'], ['following', 'This and following'], ['all', 'All events']] as [value, label] (value)}
              <label class="check">
                <input
                  type="radio"
                  name="event-scope"
                  data-testid={'event-scope-' + value}
                  value={value}
                  checked={eventScope === value}
                  onchange={() => (eventScope = value as Scope)}
                />
                {label}
              </label>
            {/each}
          </fieldset>
        {/if}
        <div class="row">
          <button class="btn btn-sm btn-danger" data-testid="modal-delete" onclick={() => modalEvent && deleteEvent(modalEvent)}>
            Delete
          </button>
        </div>
      </div>
    {:else}
      <div class="modal-body stack">
        <header class="row modal-head">
          <h3>{modal.id ? 'Edit event' : 'New event'}</h3>
          <span class="spacer"></span>
          <button class="btn btn-sm" data-testid="modal-close" onclick={closeModal}>Close</button>
        </header>
        <form class="stack" onsubmit={saveEvent}>
          <div>
            <label for="event-title">Title</label>
            <input id="event-title" data-testid="event-title" bind:value={eventDraft.title} required />
          </div>
          <div>
            <label for="event-desc">Description (markdown, optional)</label>
            <textarea id="event-desc" rows="3" bind:value={eventDraft.description_md}></textarea>
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
          {#if !modal.id || !modalEvent?.series_id}
            <div class="row">
              <RecurrenceFields bind:draft={eventDraft} idPrefix="event" />
            </div>
          {:else}
            <p class="muted small">
              This day was changed on its own, so it no longer follows the series' repeat.
            </p>
          {/if}
          {#if modalNeedsScope}
            <fieldset class="scope" data-testid="event-scope-edit">
              <legend>Apply to</legend>
              {#each [['this', 'This event'], ['following', 'This and following'], ['all', 'All events']] as [value, label] (value)}
                <label class="check">
                  <input
                    type="radio"
                    name="event-scope-edit"
                    data-testid={'event-scope-edit-' + value}
                    value={value}
                    checked={eventScope === value}
                    onchange={() => (eventScope = value as Scope)}
                  />
                  {label}
                </label>
              {/each}
            </fieldset>
          {/if}
          {#if eventError}<p class="form-error">{eventError}</p>{/if}
          <div class="row">
            <button class="btn btn-primary" data-testid="event-save" type="submit">Save</button>
            <button class="btn" type="button" onclick={closeModal}>Cancel</button>
          </div>
        </form>
      </div>
    {/if}
  {/if}
</dialog>

{#if loading}
  <p class="muted">Loading…</p>
{:else if view === 'list'}
  {#if listTodos.length === 0}
    <p class="muted">No TODOs yet.</p>
  {:else}
    <div
      class="table-wrap"
      class:drop-end={listDropEnd}
      use:dropzone={{
        accepts: (d) => d.kind === 'todo',
        onOver: () => {
          listDropEnd = true;
          listDropId = null;
        },
        onLeave: () => (listDropEnd = false),
        onDrop: (d) => void dropAtListEnd(d),
      }}
    >
      <table class="data-table">
        <thead>
          <tr><th class="handle-col"><span class="visually-hidden">Drag to reorder</span></th><th>Status</th><th>Title</th><th>Due</th><th>Priority</th><th></th></tr>
        </thead>
        <tbody>
          {#each listTodos as t (t.id)}
            <tr
              data-testid="todo-row"
              data-todo-id={t.id}
              class:done={t.status === 'completed'}
              class:drop-above={listDropId === t.id}
              use:draggable={{ data: { kind: 'todo', id: t.id }, label: t.title, handle: '.drag-handle' }}
              use:dropzone={{
                accepts: (d) => d.kind === 'todo',
                onOver: () => {
                  listDropEnd = false;
                  listDropId = t.id;
                },
                onLeave: () => {
                  if (listDropId === t.id) listDropId = null;
                },
                onDrop: (d) => void dropOnRow(d, t),
              }}
            >
              <td class="drag-handle" title="Drag to reorder">⠿</td>
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
                <button class="linklike" data-testid="todo-open" onclick={() => openTodoRead(t)}>
                  {t.title}
                </button>
                {#if t.recurrence}<span class="muted recur-tag">↻ {describeRule(t.recurrence)}</span>{/if}
              </td>
              <td class:overdue={isOverdue(t)} data-testid="todo-due-cell">
                {t.due_date ?? '—'}{t.due_time ? ' ' + t.due_time : ''}
              </td>
              <td class="prio prio-{t.priority}">{t.priority}</td>
              <td class="actions">
                <button class="btn btn-sm" data-testid="todo-edit" onclick={() => editTodoFromModal(t)}>Edit</button>
                <button class="btn btn-sm btn-danger" data-testid="todo-delete" onclick={() => deleteTodo(t)}>Delete</button>
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
      <!-- Row drops insert ABOVE the target; this strip is the "make it
           last" target (the wrap's drop handler appends). -->
      <div class="end-strip" data-testid="list-end-drop" aria-hidden="true"></div>
    </div>
  {/if}
{:else if view === 'board'}
  <div class="board">
    {#each STATUSES as s (s.key)}
      <section
        class="col"
        class:dropping={boardDropCol === s.key}
        aria-label={s.label}
        data-testid={'board-col-' + s.key}
        use:dropzone={{
          accepts: (d) => d.kind === 'todo',
          onOver: () => (boardDropCol = s.key),
          onLeave: () => {
            if (boardDropCol === s.key) boardDropCol = null;
          },
          onDrop: (d) => void dropOnColumn(d, s.key),
        }}
      >
        <h2>{s.label} <span class="muted">{column(s.key).length}</span></h2>
        {#each column(s.key) as t, i (t.id)}
          <div
            class="card-item"
            data-testid="board-card"
            data-todo-id={t.id}
            role="listitem"
            use:draggable={{ data: { kind: 'todo', id: t.id }, label: t.title, handle: '.card-grip' }}
            use:dropzone={{
              accepts: (d) => d.kind === 'todo',
              onDrop: (d) => void dropOnCard(d, t),
            }}
          >
            <div class="card-head">
              <span class="card-grip" title="Drag to move">⠿</span>
              <button class="linklike card-title" data-testid="board-card-title" onclick={() => openTodoRead(t)}>
                {t.title}
              </button>
            </div>
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
  <div class="row cal-views" role="group" aria-label="Calendar range">
    {#each CAL_VIEWS as v (v.key)}
      <button
        class="btn btn-sm"
        class:btn-primary={calView === v.key}
        data-testid={'cal-view-' + v.key}
        aria-pressed={calView === v.key}
        onclick={() => setCalView(v.key)}
      >
        {v.label}
      </button>
    {/each}
  </div>
  {#if calView === 'month'}
    <CalendarView
      {events}
      {todos}
      bind:anchor={calAnchor}
      {weekStart}
      oneventclick={(occ) => openOccurrenceRead(occ)}
      ontodoclick={(t) => openTodoRead(t)}
      ondayclick={(date) => openEventCreate(date)}
      ondropitem={(type, id, date, occStart) => void dropOnDate(type, id, date, occStart)}
    />
  {:else}
    <TimeGridView
      {events}
      {todos}
      days={calView === 'week' ? 7 : 1}
      bind:anchor={calAnchor}
      {weekStart}
      oneventclick={(occ) => openOccurrenceRead(occ)}
      ontodoclick={(t) => openTodoRead(t)}
      onslotclick={(date, time) => openEventCreate(date, time ?? undefined)}
      ondropitem={(type, id, date, occStart, time) => void dropOnDate(type, id, date, occStart, time)}
    />
  {/if}
{/if}

<style>
  .cal-views {
    justify-content: flex-end;
  }

  .scope {
    border: 1px dashed var(--border-color);
    padding: var(--space-2);
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-3);
    align-items: center;
  }

  .scope legend {
    font-size: var(--font-size-eyebrow);
    letter-spacing: var(--tracking-label);
    text-transform: uppercase;
    color: var(--text-muted-color);
    padding: 0 var(--space-1);
  }

  .views {
    margin-bottom: var(--space-4);
  }

  dialog {
    /* Centered by `dialog { margin: auto }` in global.css (the blanket margin
       reset would otherwise pin it top-left). */
    width: min(46rem, calc(100vw - 2 * var(--space-4)));
    max-height: 88vh;
    background: var(--surface-raised-color);
    color: var(--text-color);
    border: 1px solid var(--border-strong-color);
    outline: 1px dashed var(--border-color);
    outline-offset: 4px;
    padding: 0;
  }

  dialog::backdrop {
    background: var(--scrim-color);
  }

  .modal-body {
    padding: var(--space-4);
  }

  .modal-head h3 {
    font-size: var(--font-size-lg);
    overflow-wrap: anywhere;
  }

  .spacer {
    flex: 1;
  }

  .attrs {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: var(--space-1) var(--space-4);
    margin: 0;
  }

  .attrs dt {
    font-size: var(--font-size-eyebrow);
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: var(--tracking-label);
    color: var(--text-muted-color);
    align-self: center;
  }

  .attrs dd {
    margin: 0;
  }

  .eyebrow {
    font-size: var(--font-size-eyebrow);
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: var(--tracking-label);
    color: var(--text-muted-color);
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

  .visually-hidden {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
  }

  /* List drag-reorder affordances. */
  .handle-col {
    width: 1.8rem;
  }

  .drag-handle {
    color: var(--text-muted-color);
    cursor: grab;
    user-select: none;
    /* The handle owns the gesture on a touchscreen: without this the browser
       pans the page instead of letting the drag start. Everywhere else on the
       row keeps scrolling normally. */
    touch-action: none;
  }

  tbody tr {
    cursor: grab;
  }

  tbody tr.drop-above td {
    border-top: 2px solid var(--color-stamp);
  }

  .end-strip {
    height: var(--space-4);
  }

  .table-wrap.drop-end .end-strip {
    background: repeating-linear-gradient(45deg, transparent 0 4px, var(--color-stamp) 4px 5px);
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
    text-align: left;
  }

  .recur-tag {
    margin-left: var(--space-2);
    font-size: var(--font-size-sm);
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

  .desc :global(ul),
  .desc :global(ol) {
    padding-left: var(--space-5);
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

  .col {
    min-height: 10rem; /* an empty column is still a drop target */
  }

  .col.dropping {
    outline: 2px solid var(--color-stamp);
    outline-offset: -2px;
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
    cursor: grab;
  }

  .card-head {
    display: flex;
    align-items: baseline;
    gap: var(--space-2);
    margin-bottom: var(--space-1);
  }

  .card-grip {
    color: var(--text-muted-color);
    cursor: grab;
    user-select: none;
    touch-action: none; /* see .drag-handle */
  }

  .card-title {
    font-weight: 700;
    overflow-wrap: anywhere;
    display: block;
  }
</style>
