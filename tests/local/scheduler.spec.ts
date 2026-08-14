/**
 * Phase 2 (Scheduler) — events, todos, comments, recurrence, board ordering,
 * driven through the real UI with every write audited by the oracle.
 */
import { test, expect } from './helpers/app';
import { assertIsolatedDelta, assertInvariants } from './helpers/oracle';

async function createTodo(app: import('./helpers/app').App, title: string) {
  const { page } = app;
  await page.getByTestId('scheduler-new-todo').click();
  await page.getByTestId('todo-title').fill(title);
  await page.getByTestId('todo-save').click();
  await expect(page.getByTestId('todo-row').filter({ hasText: title })).toBeVisible();
}

test.describe('todos', () => {
  test('creating a todo writes exactly one row', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/scheduler/');
    const before = await app.dumpAll();
    await createTodo(app, 'Write the spec');
    const after = await app.dumpAll();
    const rows = await app.dump('todos');
    expect(rows).toHaveLength(1);
    const todo = rows[0] as Record<string, unknown>;
    expect(todo.status).toBe('todo');
    expect(todo.rank).toBeTruthy();
    assertIsolatedDelta(before, after, [{ store: 'todos', id: String(todo.id) }]);
  });

  test('a status change writes only that row', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/scheduler/');
    await createTodo(app, 'Move me');
    await createTodo(app, 'Bystander');
    const before = await app.dumpAll();

    const row = page.getByTestId('todo-row').filter({ hasText: 'Move me' });
    await row.getByTestId('todo-status').selectOption('in_progress');
    await expect
      .poll(async () =>
        ((await app.dump('todos')).find((t) => t.title === 'Move me') as Record<string, unknown>)?.status
      )
      .toBe('in_progress');

    const moved = (await app.dump('todos')).find((t) => t.title === 'Move me')!;
    assertIsolatedDelta(before, await app.dumpAll(), [{ store: 'todos', id: String(moved.id) }]);
  });

  test('board reorder writes only the moved card', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/scheduler/');
    await createTodo(app, 'First');
    await createTodo(app, 'Second');
    await page.getByTestId('view-board').click();
    await expect(page.getByTestId('board-card')).toHaveCount(2);
    const before = await app.dumpAll();

    // Move "Second" above "First": one rank write on one row.
    await page.getByRole('button', { name: 'Move Second up' }).click();
    await expect(page.getByTestId('board-card').first()).toContainText('Second');

    const second = (await app.dump('todos')).find((t) => t.title === 'Second')!;
    assertIsolatedDelta(before, await app.dumpAll(), [{ store: 'todos', id: String(second.id) }]);
    assertInvariants(await app.dumpAll(), 'after reorder');
  });

  test('completing a recurring todo spawns exactly one successor, idempotently', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/scheduler/');
    await page.getByTestId('scheduler-new-todo').click();
    await page.getByTestId('todo-title').fill('Water plants');
    await page.getByTestId('todo-due').fill('2024-06-03');
    await page.getByTestId('todo-recur').selectOption('every');
    await page.getByTestId('todo-save').click();
    await expect(page.getByTestId('todo-row')).toHaveCount(1);

    const row = page.getByTestId('todo-row').filter({ hasText: 'Water plants' }).first();
    await row.getByTestId('todo-status').selectOption('completed');

    // Exactly one successor: same title, due the next day, linked to the parent.
    await expect(page.getByTestId('todo-row')).toHaveCount(2);
    const rows = (await app.dump('todos')) as Record<string, unknown>[];
    expect(rows).toHaveLength(2);
    const parent = rows.find((t) => t.status === 'completed')!;
    const successor = rows.find((t) => t.status === 'todo')!;
    expect(successor.due_date).toBe('2024-06-04');
    expect(successor.recurrence_parent_id).toBe(parent.id);
    expect(parent.completed_at).toBeTruthy();
    assertInvariants(await app.dumpAll(), 'after recurring complete');

    // Occurrences are materialized ONLY by the explicit complete action — a
    // reload/re-render must not spawn any more rows (or write anything).
    const beforeReload = await app.dumpAll();
    await app.goto('/tools/scheduler/');
    await expect(page.getByTestId('todo-row')).toHaveCount(2);
    expect(await app.dumpAll()).toEqual(beforeReload);
  });

  test('deleting a todo tombstones it and its comments', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/scheduler/');
    await createTodo(app, 'Commented');
    await page.getByTestId('todo-open').click();
    await page.getByTestId('comment-input').fill('First **comment**');
    await page.getByTestId('comment-add').click();
    await expect(page.getByTestId('todo-comment')).toHaveCount(1);

    page.on('dialog', (d) => void d.accept());
    await page.getByTestId('todo-delete').click();
    await expect(page.getByTestId('todo-row')).toHaveCount(0);

    // Soft-deleted, not holes; FK invariants stay green.
    const rawTodos = await app.call<Record<string, unknown>[]>('rawDump', 'todos');
    const rawComments = await app.call<Record<string, unknown>[]>('rawDump', 'todo_comments');
    expect(rawTodos).toHaveLength(1);
    expect(rawTodos[0]!.deleted_at).toBeTruthy();
    expect(rawComments).toHaveLength(1);
    expect(rawComments[0]!.deleted_at).toBeTruthy();
    assertInvariants(await app.dumpAll(), 'after delete');
  });

  test('adding a comment writes only the comment row', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/scheduler/');
    await createTodo(app, 'Discuss');
    await page.getByTestId('todo-open').click();
    const before = await app.dumpAll();
    await page.getByTestId('comment-input').fill('A note');
    await page.getByTestId('comment-add').click();
    await expect(page.getByTestId('todo-comment')).toHaveCount(1);
    const comment = (await app.dump('todo_comments'))[0]!;
    assertIsolatedDelta(before, await app.dumpAll(), [
      { store: 'todo_comments', id: String(comment.id) },
    ]);
  });
});

test('a todo due just now raises a DUE banner (no writes)', async ({ app }) => {
  const { page } = app;
  // The stored due_time is minute-granular: using the CURRENT minute keeps the
  // parsed due instant at most 59s in the past — always inside the 60s fire
  // window, whatever second this test runs at.
  const due = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  await app.call('rawPut', 'todos', {
    id: 'due-1',
    updated_at: new Date().toISOString(),
    deleted_at: null,
    server_seq: null,
    field_updated_at: {},
    title: 'Due right now',
    description_md: '',
    due_date: `${due.getFullYear()}-${pad(due.getMonth() + 1)}-${pad(due.getDate())}`,
    due_time: `${pad(due.getHours())}:${pad(due.getMinutes())}`,
    priority: 'medium',
    status: 'todo',
    completed_at: null,
    recurrence: null,
    recurrence_parent_id: null,
    rank: 'n',
    notify: true,
  });
  const before = await app.dumpAll();
  await expect(page.getByTestId('timer-notice')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId('timer-notice')).toContainText('DUE');
  await expect(page.getByTestId('timer-notice')).toContainText('Due right now');
  // The due scan never writes — fired state is in-memory only.
  expect(await app.dumpAll()).toEqual(before);
});

test.describe('events + calendar', () => {
  test('creating an event writes one row and it renders on the calendar', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/scheduler/');
    const before = await app.dumpAll();
    await page.getByTestId('scheduler-new-event').click();
    await page.getByTestId('event-title').fill('Design review');
    await page.getByTestId('event-date').fill('2024-06-12');
    await page.getByTestId('event-time').fill('14:30');
    await page.getByTestId('event-save').click();

    const ev = (await app.dump('events'))[0] as Record<string, unknown>;
    expect(ev.title).toBe('Design review');
    assertIsolatedDelta(before, await app.dumpAll(), [{ store: 'events', id: String(ev.id) }]);

    await page.getByTestId('view-calendar').click();
    // Navigate to June 2024 — the calendar opens on the current month.
    for (let i = 0; i < 40; i++) {
      const label = await page.getByTestId('cal-label').textContent();
      if (label?.includes('June 2024')) break;
      const isFuture = new Date(label + ' 1').getTime() > Date.UTC(2024, 5, 1);
      await page.getByTestId(isFuture ? 'cal-prev' : 'cal-next').click();
    }
    await expect(page.getByTestId('cal-event')).toContainText('Design review');
  });

  test('switching views and browsing the calendar writes nothing (except the view pref)', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/scheduler/');
    await page.getByTestId('view-calendar').click();
    await expect
      .poll(async () => (await app.get('preferences', 'singleton'))?.scheduler_view)
      .toBe('calendar');
    const before = await app.dumpAll();
    await page.getByTestId('cal-next').click();
    await page.getByTestId('cal-prev').click();
    await page.getByTestId('cal-today').click();
    await expect(page.getByTestId('cal-cell').first()).toBeVisible();
    expect(await app.dumpAll()).toEqual(before);
  });
});
