/**
 * Phase 2 (Scheduler) — events, todos, comments, recurrence, board ordering,
 * driven through the real UI with every write audited by the oracle.
 */
import { test, expect } from './helpers/app';
import { assertIsolatedDelta, assertInvariants } from './helpers/oracle';

type P = import('@playwright/test').Page;

/**
 * A real pointer drag: press, move in steps, release. The app's drag and drop
 * is pointer-based (src/lib/dragdrop.ts), so this is what a user's mouse
 * actually produces — Playwright's dragTo() drives the HTML5 drag API
 * instead, which is a different pipeline entirely and one no touchscreen has.
 */
async function pointerDrag(
  page: P,
  source: import('@playwright/test').Locator,
  target: import('@playwright/test').Locator,
  options: { sourcePosition?: { x: number; y: number } } = {}
) {
  await source.scrollIntoViewIfNeeded();
  const from = (await source.boundingBox())!;
  const to = (await target.boundingBox())!;
  const startX = from.x + (options.sourcePosition?.x ?? from.width / 2);
  const startY = from.y + (options.sourcePosition?.y ?? from.height / 2);
  const endX = to.x + to.width / 2;
  const endY = to.y + to.height / 2;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  // Several moves: the first crosses the drag threshold, the rest let the
  // drop target under the pointer update the way it does for a user.
  await page.mouse.move(startX + 8, startY + 8, { steps: 2 });
  await page.mouse.move((startX + endX) / 2, (startY + endY) / 2, { steps: 4 });
  await page.mouse.move(endX, endY, { steps: 4 });
  await page.mouse.up();
}

/** The same gesture as a finger: touch drags are the case HTML5 DnD never supported. */
async function touchDrag(
  page: P,
  source: import('@playwright/test').Locator,
  target: import('@playwright/test').Locator,
  sourcePosition?: { x: number; y: number }
) {
  const from = (await source.boundingBox())!;
  const to = (await target.boundingBox())!;
  const startX = from.x + (sourcePosition?.x ?? from.width / 2);
  const startY = from.y + (sourcePosition?.y ?? from.height / 2);
  const endX = to.x + to.width / 2;
  const endY = to.y + to.height / 2;
  const cdp = await page.context().newCDPSession(page);
  const point = (x: number, y: number) => [{ x, y, radiusX: 5, radiusY: 5, force: 1, id: 1 }];
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: point(startX, startY) });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: point(startX + 8, startY + 8) });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: point((startX + endX) / 2, (startY + endY) / 2) });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: point(endX, endY) });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.detach();
}

async function createTodo(app: import('./helpers/app').App, title: string) {
  const { page } = app;
  await page.getByTestId('scheduler-new-todo').click();
  await page.getByTestId('todo-title').fill(title);
  await page.getByTestId('todo-save').click();
  await expect(page.getByTestId('todo-row').filter({ hasText: title })).toBeVisible();
}

test.describe('list view drag-reorder', () => {
  const rowTitles = async (page: import('@playwright/test').Page): Promise<string[]> =>
    (await page.getByTestId('todo-row').locator('[data-testid="todo-open"]').allTextContents()).map(
      (s) => s.trim()
    );

  test('dragging a row above another moves it, rewriting only that row', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/scheduler/');
    await createTodo(app, 'Alpha');
    await createTodo(app, 'Beta');
    await createTodo(app, 'Gamma');
    expect(await rowTitles(page)).toEqual(['Alpha', 'Beta', 'Gamma']);
    const before = await app.dumpAll();

    // A REAL drag (mouse press → move → release through Playwright's HTML5
    // DnD pipeline), starting on the row's drag handle.
    await pointerDrag(
      page,
      page.getByTestId('todo-row').filter({ hasText: 'Gamma' }),
      page.getByTestId('todo-row').filter({ hasText: 'Alpha' }),
      { sourcePosition: { x: 14, y: 10 } }
    );

    await expect(page.getByTestId('todo-row').first()).toContainText('Gamma');
    expect(await rowTitles(page)).toEqual(['Gamma', 'Alpha', 'Beta']);
    const gamma = (await app.dump('todos')).find((t) => t.title === 'Gamma')!;
    assertIsolatedDelta(before, await app.dumpAll(), [{ store: 'todos', id: String(gamma.id) }]);

    // Dropping where it already sits (directly above the target) writes nothing.
    const settled = await app.dumpAll();
    await pointerDrag(
      page,
      page.getByTestId('todo-row').filter({ hasText: 'Gamma' }),
      page.getByTestId('todo-row').filter({ hasText: 'Alpha' }),
      { sourcePosition: { x: 14, y: 10 } }
    );
    expect(await rowTitles(page)).toEqual(['Gamma', 'Alpha', 'Beta']);
    expect(await app.dumpAll()).toEqual(settled);
  });

  test('dragging a row to the end strip makes it last (one row)', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/scheduler/');
    await createTodo(app, 'Alpha');
    await createTodo(app, 'Beta');
    await createTodo(app, 'Gamma');
    const before = await app.dumpAll();

    await pointerDrag(page, page.getByTestId('todo-row').filter({ hasText: 'Alpha' }), page.getByTestId('list-end-drop'), {
      sourcePosition: { x: 14, y: 10 },
    });

    await expect.poll(() => rowTitles(page)).toEqual(['Beta', 'Gamma', 'Alpha']);
    const alpha = (await app.dump('todos')).find((t) => t.title === 'Alpha')!;
    assertIsolatedDelta(before, await app.dumpAll(), [{ store: 'todos', id: String(alpha.id) }]);
  });

  test('the manual list order is the same order the board column shows', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/scheduler/');
    await createTodo(app, 'Alpha');
    await createTodo(app, 'Beta');
    await pointerDrag(
      page,
      page.getByTestId('todo-row').filter({ hasText: 'Beta' }),
      page.getByTestId('todo-row').filter({ hasText: 'Alpha' }),
      { sourcePosition: { x: 14, y: 10 } }
    );
    await expect.poll(() => rowTitles(page)).toEqual(['Beta', 'Alpha']);

    await page.getByTestId('view-board').click();
    const cards = page.getByTestId('board-col-todo').getByTestId('board-card');
    await expect(cards.first()).toContainText('Beta');
    await expect(cards.nth(1)).toContainText('Alpha');
  });
});

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
    await page.getByTestId('todo-open').click(); // opens the read modal
    await page.getByTestId('comment-input').fill('First **comment**');
    await page.getByTestId('comment-add').click();
    await expect(page.getByTestId('todo-comment')).toHaveCount(1);

    page.on('dialog', (d) => void d.accept());
    await page.getByTestId('modal-delete').click(); // deletes from the modal
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
    await page.getByTestId('todo-open').click(); // opening the modal writes nothing
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

test.describe('modal read/update + calendar interactions', () => {
  test('the read modal renders markdown and the pencil switches to edit', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/scheduler/');
    await page.getByTestId('scheduler-new-todo').click();
    await expect(page.getByTestId('scheduler-modal')).toBeVisible(); // creation is a modal now
    await page.getByTestId('todo-title').fill('Documented');
    await page.getByTestId('todo-desc').fill('Some **bold** words');
    await page.getByTestId('todo-save').click();

    await page.getByTestId('todo-open').click();
    await expect(page.getByTestId('modal-read')).toBeVisible();
    await expect(page.getByTestId('modal-desc').locator('strong')).toHaveText('bold');

    await page.getByTestId('modal-edit').click();
    await expect(page.getByTestId('todo-title')).toHaveValue('Documented');
    await page.getByTestId('modal-close').click();
    await expect(page.getByTestId('scheduler-modal')).not.toBeVisible();
  });

  test('the modal is centered in the viewport', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/scheduler/');
    await page.getByTestId('scheduler-new-todo').click();
    const dialogBox = (await page.getByTestId('scheduler-modal').boundingBox())!;
    const viewport = page.viewportSize()!;
    const centerX = dialogBox.x + dialogBox.width / 2;
    // The blanket margin reset once pinned the dialog top-left; assert the
    // dialog's center sits near the viewport's horizontal center.
    expect(Math.abs(centerX - viewport.width / 2)).toBeLessThan(40);
    expect(dialogBox.y).toBeGreaterThan(10);
  });

  test('code blocks in descriptions are syntax-highlighted', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/scheduler/');
    await page.getByTestId('scheduler-new-todo').click();
    await page.getByTestId('todo-title').fill('With code');
    await page.getByTestId('todo-desc').fill('```python\nimport math\nmath.ceil(3.1)\n```');
    await page.getByTestId('todo-save').click();

    await page.getByTestId('todo-open').click();
    const keyword = page.getByTestId('modal-desc').locator('.token.keyword').first();
    await expect(keyword).toHaveText('import');
  });

  test('dragging a board card to another column changes only that row', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/scheduler/');
    await createTodo(app, 'Drag me');
    await createTodo(app, 'Bystander');
    await page.getByTestId('view-board').click();
    await expect(page.getByTestId('board-card')).toHaveCount(2);
    const before = await app.dumpAll();

    await pointerDrag(
      page,
      page.getByTestId('board-card').filter({ hasText: 'Drag me' }),
      page.getByTestId('board-col-in_progress')
    );

    await expect
      .poll(async () =>
        ((await app.dump('todos')).find((t) => t.title === 'Drag me') as Record<string, unknown>)?.status
      )
      .toBe('in_progress');
    const moved = (await app.dump('todos')).find((t) => t.title === 'Drag me')!;
    assertIsolatedDelta(before, await app.dumpAll(), [{ store: 'todos', id: String(moved.id) }]);
  });

  test('a board card title opens the same read modal', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/scheduler/');
    await createTodo(app, 'Board me');
    await page.getByTestId('view-board').click();
    await page.getByTestId('board-card-title').click();
    await expect(page.getByTestId('modal-read')).toBeVisible();
    await expect(page.getByTestId('modal-read')).toContainText('Board me');
  });

  test('calendar entries show a hover preview with rendered markdown', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/scheduler/');
    await page.getByTestId('scheduler-new-event').click();
    await page.getByTestId('event-title').fill('Site walk');
    await page.locator('#event-desc').fill('Bring the **helmet**');
    await page.getByTestId('event-date').fill('2024-06-12');
    await page.getByTestId('event-time').fill('09:00');
    await page.getByTestId('event-save').click();

    await page.getByTestId('view-calendar').click();
    await gotoMonth(app, 'June 2024');
    await page.getByTestId('cal-event').hover();
    await expect(page.getByTestId('cal-preview')).toBeVisible();
    await expect(page.getByTestId('cal-preview').locator('strong')).toHaveText('helmet');
  });

  test('dragging an event to another day reschedules it, keeping the time (one row)', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/scheduler/');
    await page.getByTestId('scheduler-new-event').click();
    await page.getByTestId('event-title').fill('Movable');
    await page.getByTestId('event-date').fill('2024-06-12');
    await page.getByTestId('event-time').fill('14:30');
    await page.getByTestId('event-save').click();

    await page.getByTestId('view-calendar').click();
    await gotoMonth(app, 'June 2024');
    const before = await app.dumpAll();
    await pointerDrag(page, page.getByTestId('cal-event'), page.locator('[data-testid="cal-cell"][data-date="2024-06-20"]'));

    await expect
      .poll(async () => ((await app.dump('events'))[0] as Record<string, unknown>).start)
      .toBe(new Date('2024-06-20T14:30').toISOString());
    const ev = (await app.dump('events'))[0]!;
    assertIsolatedDelta(before, await app.dumpAll(), [{ store: 'events', id: String(ev.id) }]);
  });

  test('dragging a todo to another day moves its due date (one row)', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/scheduler/');
    await page.getByTestId('scheduler-new-todo').click();
    await page.getByTestId('todo-title').fill('Sliding task');
    await page.getByTestId('todo-due').fill('2024-06-12');
    await page.getByTestId('todo-save').click();

    await page.getByTestId('view-calendar').click();
    await gotoMonth(app, 'June 2024');
    const before = await app.dumpAll();
    await pointerDrag(page, page.getByTestId('cal-todo'), page.locator('[data-testid="cal-cell"][data-date="2024-06-21"]'));

    await expect
      .poll(async () => ((await app.dump('todos'))[0] as Record<string, unknown>).due_date)
      .toBe('2024-06-21');
    const t = (await app.dump('todos'))[0]!;
    assertIsolatedDelta(before, await app.dumpAll(), [{ store: 'todos', id: String(t.id) }]);
  });

  test('calendar drag works even while the hover preview is showing', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/scheduler/');
    await page.getByTestId('scheduler-new-todo').click();
    await page.getByTestId('todo-title').fill('Hover then drag');
    await page.getByTestId('todo-due').fill('2024-06-12');
    await page.getByTestId('todo-save').click();

    await page.getByTestId('view-calendar').click();
    await gotoMonth(app, 'June 2024');

    // The realistic sequence: linger long enough for the wiki preview to pop
    // up UNDER the cursor, then start dragging from the same spot.
    await page.getByTestId('cal-todo').hover();
    await expect(page.getByTestId('cal-preview')).toBeVisible();
    await pointerDrag(
      page,
      page.getByTestId('cal-todo'),
      page.locator('[data-testid="cal-cell"][data-date="2024-06-18"]')
    );

    await expect
      .poll(async () => ((await app.dump('todos'))[0] as Record<string, unknown>).due_date)
      .toBe('2024-06-18');
    // Starting the drag dismissed the preview.
    await expect(page.getByTestId('cal-preview')).toHaveCount(0);
  });
});

test.describe('drag works with a finger, not just a mouse', () => {
  // The regression that started this: with the HTML5 drag API every one of
  // these was silently dead on a touchscreen, and a mouse-driven suite could
  // not see it. Touch drags start from the grab handles.
  test('list rows reorder by touch', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/scheduler/');
    await createTodo(app, 'Alpha');
    await createTodo(app, 'Beta');

    await touchDrag(
      page,
      page.getByTestId('todo-row').filter({ hasText: 'Beta' }),
      page.getByTestId('todo-row').filter({ hasText: 'Alpha' }),
      { x: 14, y: 10 }
    );

    await expect(page.getByTestId('todo-row').first()).toContainText('Beta');
  });

  test('board cards move columns by touch', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/scheduler/');
    await createTodo(app, 'Touch me');
    await page.getByTestId('view-board').click();
    await expect(page.getByTestId('board-card')).toHaveCount(1);

    await touchDrag(page, page.getByTestId('board-card'), page.getByTestId('board-col-in_progress'), {
      x: 12,
      y: 14,
    });

    await expect
      .poll(async () => ((await app.dump('todos'))[0] as Record<string, unknown>).status)
      .toBe('in_progress');
  });

  test('calendar entries reschedule by touch', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/scheduler/');
    await page.getByTestId('scheduler-new-todo').click();
    await page.getByTestId('todo-title').fill('Finger drag');
    await page.getByTestId('todo-due').fill('2024-06-12');
    await page.getByTestId('todo-save').click();
    await page.getByTestId('view-calendar').click();
    await gotoMonth(app, 'June 2024');

    await touchDrag(
      page,
      page.getByTestId('cal-todo'),
      page.locator('[data-testid="cal-cell"][data-date="2024-06-19"]')
    );

    await expect
      .poll(async () => ((await app.dump('todos'))[0] as Record<string, unknown>).due_date)
      .toBe('2024-06-19');
  });
});

async function gotoMonth(app: import('./helpers/app').App, label: string) {
  const { page } = app;
  for (let i = 0; i < 40; i++) {
    const current = await page.getByTestId('cal-label').textContent();
    if (current?.includes(label)) return;
    const isFuture = new Date(current + ' 1').getTime() > new Date(label + ' 1').getTime();
    await page.getByTestId(isFuture ? 'cal-prev' : 'cal-next').click();
  }
  throw new Error('never reached ' + label);
}

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

    // Saving is async (write, then close the modal): read the store only once
    // the row is actually there, or this races the click on a slow run.
    await expect.poll(async () => (await app.dump('events')).length).toBe(1);
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
