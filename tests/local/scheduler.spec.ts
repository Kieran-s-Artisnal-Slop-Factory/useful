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
  // The stored due_time is minute-granular, so the parsed due instant is the
  // START of the current minute — already up to 59s in the past when it is
  // written. The engine only fires while `now - due` is inside its 60s window,
  // so a write in the last seconds of a minute leaves less than one tick of
  // margin and the banner never appears at all. Step over the boundary rather
  // than race it: this is wall-clock, which is what a fixed wait is for.
  const secondsIn = new Date().getSeconds();
  if (secondsIn > 45) await page.waitForTimeout((61 - secondsIn) * 1000);
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

/**
 * Phase 2 — recurring EVENTS. Occurrences are virtual: the rule lives on one
 * row and the calendar computes the rest, so the invariants worth testing are
 * "how many rows did that cost" and "did drawing write anything at all".
 */
test.describe('recurring events', () => {
  /** Create a weekly event on the given date, from the UI. */
  async function createWeekly(app: import('./helpers/app').App, title: string, date: string, time = '09:00') {
    const { page } = app;
    await page.getByTestId('scheduler-new-event').click();
    await page.getByTestId('event-title').fill(title);
    await page.getByTestId('event-date').fill(date);
    await page.getByTestId('event-time').fill(time);
    await page.getByTestId('event-recur').selectOption('every');
    await page.getByTestId('event-every-n').fill('1');
    await page.getByTestId('event-every-unit').selectOption('weeks');
    await page.getByTestId('event-save').click();
    await expect.poll(async () => (await app.dump('events')).length).toBeGreaterThan(0);
  }

  test('one row draws every occurrence, and drawing writes nothing', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/scheduler/');
    await createWeekly(app, 'Standup', '2024-06-03');

    // ONE row — the whole point of expanding virtually.
    expect(await app.dump('events')).toHaveLength(1);

    await page.getByTestId('view-calendar').click();
    await gotoMonth(app, 'June 2024');
    // June 2024 has Mondays on 3, 10, 17, 24 — and the grid's trailing week
    // reaches July 1, which is a Monday too.
    await expect(page.getByTestId('cal-event')).toHaveCount(5);

    // Browsing months expands more occurrences and still writes nothing.
    const before = await app.dumpAll();
    await page.getByTestId('cal-next').click();
    await expect(page.getByTestId('cal-event').first()).toBeVisible();
    await page.getByTestId('cal-prev').click();
    await page.reload();
    await gotoMonth(app, 'June 2024');
    await expect(page.getByTestId('cal-event')).toHaveCount(5);
    expect(await app.dumpAll()).toEqual(before);
  });

  test('deleting one occurrence changes only the series row', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/scheduler/');
    await createWeekly(app, 'Standup', '2024-06-03');
    await page.getByTestId('view-calendar').click();
    await gotoMonth(app, 'June 2024');

    const before = await app.dumpAll();
    const seriesId = String((await app.dump('events'))[0]!.id);
    page.once('dialog', (d) => void d.accept());
    await page.getByTestId('cal-event').nth(2).click(); // June 17
    await expect(page.getByTestId('modal-when')).toContainText('Jun 17, 2024');
    await expect(page.getByTestId('event-scope-this')).toBeChecked();
    await page.getByTestId('modal-delete').click();

    await expect(page.getByTestId('cal-event')).toHaveCount(4);
    // Exactly one row touched: the parent, whose exdates grew by one.
    assertIsolatedDelta(before, await app.dumpAll(), [{ store: 'events', id: seriesId }]);
    const row = (await app.dump('events'))[0] as Record<string, unknown>;
    // Derived, not hard-coded: the suite runs in whatever zone the machine is
    // set to, and 09:00 local is a different instant in each one.
    expect(row.exdates).toEqual([new Date('2024-06-17T09:00').toISOString()]);
    expect(await app.dump('events')).toHaveLength(1);
  });

  test('dragging one occurrence detaches it: one NEW row, series untouched', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/scheduler/');
    await createWeekly(app, 'Standup', '2024-06-03');
    await page.getByTestId('view-calendar').click();
    await gotoMonth(app, 'June 2024');

    const before = await app.dumpAll();
    const seriesRow = (await app.dump('events'))[0] as Record<string, unknown>;
    await pointerDrag(
      page,
      page.getByTestId('cal-event').nth(1), // June 10
      page.locator('[data-testid="cal-cell"][data-date="2024-06-12"]')
    );

    await expect.poll(async () => (await app.dump('events')).length).toBe(2);
    const rows = (await app.dump('events')) as Record<string, unknown>[];
    const detached = rows.find((r) => r.series_id)!;
    expect(detached.series_id).toBe(seriesRow.id);
    expect(detached.original_start).toBe(new Date('2024-06-10T09:00').toISOString());
    expect(String(detached.start)).toContain('2024-06-12');
    expect(detached.recurrence).toBeNull();
    // The parent row is byte-identical — the override shadows its occurrence.
    const parent = rows.find((r) => !r.series_id)!;
    expect(parent).toEqual(seriesRow);
    assertIsolatedDelta(before, await app.dumpAll(), [{ store: 'events', id: String(detached.id) }]);

    // Still five entries: the moved one replaced June 10, it did not add to it.
    await expect(page.getByTestId('cal-event')).toHaveCount(5);
    await expect(
      page.locator('[data-testid="cal-cell"][data-date="2024-06-10"] [data-testid="cal-event"]')
    ).toHaveCount(0);
    await expect(
      page.locator('[data-testid="cal-cell"][data-date="2024-06-12"] [data-testid="cal-event"]')
    ).toHaveCount(1);
    assertInvariants(await app.dumpAll(), 'after detaching an occurrence');
  });

  test('"this and following" ends the old series and starts a new one — two rows', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/scheduler/');
    await createWeekly(app, 'Standup', '2024-06-03');
    await page.getByTestId('view-calendar').click();
    await gotoMonth(app, 'June 2024');

    const before = await app.dumpAll();
    const seriesId = String((await app.dump('events'))[0]!.id);
    await page.getByTestId('cal-event').nth(2).click(); // June 17
    await page.getByTestId('modal-edit').click();
    await page.getByTestId('event-scope-edit-following').check();
    await page.getByTestId('event-title').fill('Standup (new time)');
    await page.getByTestId('event-time').fill('10:00');
    await page.getByTestId('event-save').click();

    await expect.poll(async () => (await app.dump('events')).length).toBe(2);
    const rows = (await app.dump('events')) as Record<string, unknown>[];
    const oldSeries = rows.find((r) => r.id === seriesId)!;
    const newSeries = rows.find((r) => r.id !== seriesId)!;
    expect((oldSeries.recurrence as Record<string, unknown>).until).toBe('2024-06-16');
    expect(newSeries.title).toBe('Standup (new time)');
    expect(String(newSeries.start)).toContain('2024-06-17');
    assertIsolatedDelta(before, await app.dumpAll(), [
      { store: 'events', id: seriesId },
      { store: 'events', id: String(newSeries.id) },
    ]);

    // June still shows five, but the last three are the new series.
    await expect(page.getByTestId('cal-event')).toHaveCount(5);
    await expect(page.getByTestId('cal-event').nth(0)).toContainText('9:00');
    await expect(page.getByTestId('cal-event').nth(2)).toContainText('10:00');
  });

  test('"all events" edits the series in one row and leaves overrides alone', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/scheduler/');
    await createWeekly(app, 'Standup', '2024-06-03');
    await page.getByTestId('view-calendar').click();
    await gotoMonth(app, 'June 2024');
    // Detach June 10 first, so there is an override to protect.
    await pointerDrag(
      page,
      page.getByTestId('cal-event').nth(1),
      page.locator('[data-testid="cal-cell"][data-date="2024-06-12"]')
    );
    await expect.poll(async () => (await app.dump('events')).length).toBe(2);
    const detachedTitle = ((await app.dump('events')) as Record<string, unknown>[]).find((r) => r.series_id)!
      .title;

    const before = await app.dumpAll();
    const seriesId = ((await app.dump('events')) as Record<string, unknown>[]).find((r) => !r.series_id)!.id;
    await page.locator('[data-testid="cal-cell"][data-date="2024-06-03"] [data-testid="cal-event"]').click();
    await page.getByTestId('modal-edit').click();
    await page.getByTestId('event-scope-edit-all').check();
    await page.getByTestId('event-title').fill('Team standup');
    await page.getByTestId('event-save').click();

    await expect.poll(async () => {
      const rows = (await app.dump('events')) as Record<string, unknown>[];
      return rows.find((r) => !r.series_id)!.title;
    }).toBe('Team standup');
    // Google semantics: the occurrence someone deliberately changed keeps its
    // own title, and only the series row was written.
    const rows = (await app.dump('events')) as Record<string, unknown>[];
    expect(rows.find((r) => r.series_id)!.title).toBe(detachedTitle);
    assertIsolatedDelta(before, await app.dumpAll(), [{ store: 'events', id: String(seriesId) }]);
  });

  test('deleting the whole series takes its overrides with it', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/scheduler/');
    await createWeekly(app, 'Standup', '2024-06-03');
    await page.getByTestId('view-calendar').click();
    await gotoMonth(app, 'June 2024');
    await pointerDrag(
      page,
      page.getByTestId('cal-event').nth(1),
      page.locator('[data-testid="cal-cell"][data-date="2024-06-12"]')
    );
    await expect.poll(async () => (await app.dump('events')).length).toBe(2);

    page.once('dialog', (d) => void d.accept());
    await page.locator('[data-testid="cal-cell"][data-date="2024-06-03"] [data-testid="cal-event"]').click();
    await page.getByTestId('event-scope-all').check();
    await page.getByTestId('modal-delete').click();

    // Both rows tombstoned in the same action — a detached row whose parent is
    // a tombstone would be an orphan the FK check rejects. (`dump` is a RAW
    // dump: a soft delete leaves the row behind with `deleted_at` set.)
    await expect
      .poll(async () => (await app.dump('events')).filter((r) => r.deleted_at !== null).length)
      .toBe(2);
    await expect(page.getByTestId('cal-event')).toHaveCount(0);
    assertInvariants(await app.dumpAll(), 'after deleting a series');
  });

  test('an until date ends the series, and a plain event still behaves like one', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/scheduler/');
    await page.getByTestId('scheduler-new-event').click();
    await page.getByTestId('event-title').fill('Sprint');
    await page.getByTestId('event-date').fill('2024-06-03');
    await page.getByTestId('event-time').fill('09:00');
    await page.getByTestId('event-recur').selectOption('every');
    await page.getByTestId('event-every-n').fill('1');
    await page.getByTestId('event-every-unit').selectOption('weeks');
    await page.getByTestId('event-until').fill('2024-06-17');
    await page.getByTestId('event-save').click();
    await expect.poll(async () => (await app.dump('events')).length).toBe(1);

    await page.getByTestId('view-calendar').click();
    await gotoMonth(app, 'June 2024');
    // June 3, 10, 17 — inclusive of the until date, and nothing after it.
    await expect(page.getByTestId('cal-event')).toHaveCount(3);

    // A one-off event still moves by patching itself, not by detaching.
    const before = await app.dumpAll();
    await page.getByTestId('scheduler-new-event').click();
    await page.getByTestId('event-title').fill('One off');
    await page.getByTestId('event-date').fill('2024-06-25');
    await page.getByTestId('event-save').click();
    await expect.poll(async () => (await app.dump('events')).length).toBe(2);
    const plain = ((await app.dump('events')) as Record<string, unknown>[]).find((r) => r.title === 'One off')!;
    await pointerDrag(
      page,
      page.locator('[data-testid="cal-cell"][data-date="2024-06-25"] [data-testid="cal-event"]'),
      page.locator('[data-testid="cal-cell"][data-date="2024-06-26"]')
    );
    await expect.poll(async () => {
      const rows = (await app.dump('events')) as Record<string, unknown>[];
      return String(rows.find((r) => r.id === plain.id)!.start);
    }).toContain('2024-06-26');
    expect(await app.dump('events')).toHaveLength(2); // patched in place, no new row
    void before;
  });

  test('a recurring event due right now raises a banner, with no writes', async ({ app }) => {
    const { page } = app;
    // Anchor the series exactly one week before THIS INSTANT, seconds included:
    // occurrences preserve the anchor's sub-minute offset, so today's lands on
    // the current second and is comfortably inside the 60s fire window however
    // slow the page load is. (Zeroing the seconds instead makes this flaky —
    // starting the test at :59 leaves the window closing before the page is up.)
    const anchor = new Date(Date.now() - 7 * 86_400_000);
    await app.call('rawPut', 'events', {
      id: 'rec-1',
      updated_at: new Date().toISOString(),
      deleted_at: null,
      server_seq: null,
      title: 'Weekly sync',
      description_md: '',
      start: anchor.toISOString(),
      end: null,
      all_day: false,
      notify: true,
      recurrence: { kind: 'every', interval: 1, unit: 'weeks', until: null },
      exdates: [],
      series_id: null,
      original_start: null,
    });
    await app.goto('/tools/scheduler/');
    const before = await app.dumpAll();
    await expect(page.getByTestId('timer-notice')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('timer-notice')).toContainText('Weekly sync');
    // The scan expands occurrences in memory and never materialises one.
    expect(await app.dumpAll()).toEqual(before);
  });
});

/**
 * Phase 3 — week and day grids. The month grid answers "what is happening this
 * month"; these answer "what is happening today", which needs a position down
 * the day and therefore an overlap rule, a snap, and a time on every drop.
 *
 * Dates here are relative to the CURRENT week rather than fixed: the week grid
 * steps a week at a time, so walking it back to a hard-coded month would take
 * hundreds of clicks and would silently match the same month in the wrong year.
 */
const pad2 = (n: number) => String(n).padStart(2, '0');
const localKey = (d: Date) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

/** A date in the current Sunday-start week: 0 = Sunday … 6 = Saturday. */
function dayOfThisWeek(index: number): string {
  const now = new Date();
  const sunday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - now.getDay());
  return localKey(new Date(sunday.getFullYear(), sunday.getMonth(), sunday.getDate() + index));
}

test.describe('week and day views', () => {
  async function createTimed(
    app: import('./helpers/app').App,
    title: string,
    date: string,
    time: string,
    endTime?: string
  ) {
    const { page } = app;
    await page.getByTestId('scheduler-new-event').click();
    await page.getByTestId('event-title').fill(title);
    await page.getByTestId('event-date').fill(date);
    await page.getByTestId('event-time').fill(time);
    if (endTime) {
      await page.locator('#event-end-date').fill(date);
      await page.locator('#event-end-time').fill(endTime);
    }
    await page.getByTestId('event-save').click();
    await expect.poll(async () => (await app.dump('events')).length).toBeGreaterThan(0);
  }

  test('the switcher moves between month, week and day, writing only the preference', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/scheduler/');
    await page.getByTestId('view-calendar').click();
    await expect
      .poll(async () => (await app.get('preferences', 'singleton'))?.scheduler_view)
      .toBe('calendar');

    const before = await app.dumpAll();
    await page.getByTestId('cal-view-week').click();
    await expect(page.getByTestId('tg-col')).toHaveCount(7);
    await expect(page.getByTestId('tg-slot')).toHaveCount(24 * 7);
    await page.getByTestId('cal-view-day').click();
    await expect(page.getByTestId('tg-col')).toHaveCount(1);
    await expect(page.getByTestId('tg-slot')).toHaveCount(24);
    await page.getByTestId('cal-view-month').click();
    await expect(page.getByTestId('cal-cell')).toHaveCount(42);

    // Navigating the grids draws a lot and writes nothing but the sub-view.
    await page.getByTestId('cal-view-week').click();
    await page.getByTestId('cal-next').click();
    await page.getByTestId('cal-prev').click();
    await page.getByTestId('cal-today').click();
    assertIsolatedDelta(before, await app.dumpAll(), [{ store: 'preferences', id: 'singleton' }]);
    expect((await app.get('preferences', 'singleton'))?.scheduler_calendar_view).toBe('week');

    // Remembered in its OWN field, so an older build still reads
    // `scheduler_view` and shows the month grid rather than falling back to a list.
    await page.reload();
    await expect(page.getByTestId('tg-col')).toHaveCount(7);
  });

  test('the calendar keeps its place when you switch between month, week and day', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/scheduler/');
    await page.getByTestId('view-calendar').click();
    // Two months back in the month grid…
    await page.getByTestId('cal-prev').click();
    await page.getByTestId('cal-prev').click();
    const monthLabel = (await page.getByTestId('cal-label').textContent())!;
    const [monthName] = monthLabel.split(' ');

    // …and the week grid opens in that month, not back at today.
    await page.getByTestId('cal-view-week').click();
    const weekLabel = (await page.getByTestId('cal-label').textContent())!;
    expect(weekLabel).toContain(monthName!.slice(0, 3));
  });

  test('timed entries sit at their time, and overlapping ones share the width', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/scheduler/');
    const day = dayOfThisWeek(3);
    await createTimed(app, 'Alpha', day, '10:00', '11:30');
    await createTimed(app, 'Beta', day, '10:30', '12:00');
    await createTimed(app, 'Solo', day, '15:00', '16:00');

    await page.getByTestId('view-calendar').click();
    await page.getByTestId('cal-view-week').click();

    const alpha = page.getByTestId('cal-event').filter({ hasText: 'Alpha' });
    const beta = page.getByTestId('cal-event').filter({ hasText: 'Beta' });
    const solo = page.getByTestId('cal-event').filter({ hasText: 'Solo' });

    // 10:00 is 600/1440 of the day; 90 minutes is 6.25% of it.
    expect(await alpha.getAttribute('style')).toContain('top: 41.6667%');
    expect(await beta.getAttribute('style')).toContain('top: 43.75%');
    expect(await alpha.getAttribute('style')).toContain('height: 6.25%');
    // The two that overlap split the column; the one that does not keeps it all.
    expect(await alpha.getAttribute('style')).toContain('width: 50%');
    expect(await beta.getAttribute('style')).toContain('width: 50%');
    expect(await beta.getAttribute('style')).toContain('left: 50%');
    expect(await solo.getAttribute('style')).toContain('width: 100%');
  });

  test('all-day events and TODOs with no time go in the lane above the hours', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/scheduler/');
    const day = dayOfThisWeek(3);
    await page.getByTestId('scheduler-new-event').click();
    await page.getByTestId('event-title').fill('Holiday');
    await page.getByTestId('event-date').fill(day);
    await page.getByTestId('event-all-day').check();
    await page.getByTestId('event-save').click();
    await expect.poll(async () => (await app.dump('events')).length).toBe(1);

    await page.getByTestId('scheduler-new-todo').click();
    await page.getByTestId('todo-title').fill('Pack');
    await page.getByTestId('todo-due').fill(day);
    await page.getByTestId('todo-save').click();
    await expect.poll(async () => (await app.dump('todos')).length).toBe(1);

    await page.getByTestId('view-calendar').click();
    await page.getByTestId('cal-view-week').click();

    const lane = page.locator(`[data-testid="tg-allday"][data-date="${day}"]`);
    await expect(lane.getByTestId('cal-event')).toHaveText(/Holiday/);
    await expect(lane.getByTestId('cal-todo')).toHaveText(/Pack/);
    // Nothing all-day is positioned down the hours column.
    await expect(page.locator('[data-testid="tg-col"] [data-testid="cal-event"]')).toHaveCount(0);
  });

  test('dropping onto a slot sets the time as well as the day — one row', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/scheduler/');
    const from = dayOfThisWeek(2);
    const to = dayOfThisWeek(4);
    await createTimed(app, 'Move me', from, '09:00', '10:00');
    await page.getByTestId('view-calendar').click();
    await page.getByTestId('cal-view-week').click();

    const before = await app.dumpAll();
    const id = String((await app.dump('events'))[0]!.id);
    const target = page.locator(`[data-testid="tg-col"][data-date="${to}"]`);
    await target.scrollIntoViewIfNeeded();
    const box = (await target.boundingBox())!;
    const source = page.getByTestId('cal-event').first();
    const src = (await source.boundingBox())!;
    // A third of the way down the column is 08:00.
    const dropY = box.y + box.height / 3;
    await page.mouse.move(src.x + src.width / 2, src.y + src.height / 2);
    await page.mouse.down();
    await page.mouse.move(src.x + src.width / 2 + 8, src.y + src.height / 2 + 8, { steps: 2 });
    await page.mouse.move(box.x + box.width / 2, dropY, { steps: 6 });
    await expect(page.getByTestId('tg-snapline')).toBeVisible();
    await page.mouse.up();

    await expect
      .poll(async () => String(((await app.dump('events'))[0] as Record<string, unknown>).start))
      .toContain(to);
    const row = (await app.dump('events'))[0] as Record<string, unknown>;
    const start = new Date(String(row.start));
    expect(start.getHours()).toBe(8);
    expect(start.getMinutes() % 15).toBe(0); // snapped to the quarter hour
    // The duration came with it.
    expect(Date.parse(String(row.end)) - Date.parse(String(row.start))).toBe(60 * 60_000);
    assertIsolatedDelta(before, await app.dumpAll(), [{ store: 'events', id }]);
  });

  test('a slot click opens the create form already filled in', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/scheduler/');
    await page.getByTestId('view-calendar').click();
    await page.getByTestId('cal-view-day').click();
    const date = await page.getByTestId('tg-col').first().getAttribute('data-date');
    await page.locator('[data-testid="tg-slot"][data-hour="9"]').click();
    await expect(page.getByTestId('event-date')).toHaveValue(date!);
    await expect(page.getByTestId('event-time')).toHaveValue('09:00');
  });

  test('the week can start on Monday, in every grid', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/scheduler/');
    await page.getByTestId('view-calendar').click();
    // Sunday by default, in both grids.
    await expect(page.locator('.dow').first()).toHaveText('Sun');
    await page.getByTestId('cal-view-week').click();
    const firstColumn = await page.getByTestId('tg-col').first().getAttribute('data-date');
    expect(new Date(firstColumn + 'T00:00').getDay()).toBe(0);

    await app.goto('/settings/');
    const before = await app.dumpAll();
    await page.getByTestId('pref-scheduler_week_start').selectOption('1');
    await expect
      .poll(async () => (await app.get('preferences', 'singleton'))?.scheduler_week_start)
      .toBe(1);
    assertIsolatedDelta(before, await app.dumpAll(), [{ store: 'preferences', id: 'singleton' }]);

    await app.goto('/tools/scheduler/');
    await page.getByTestId('view-calendar').click();
    await expect(page.locator('.dow').first()).toHaveText('Mon');
    await page.getByTestId('cal-view-week').click();
    const mondayFirst = await page.getByTestId('tg-col').first().getAttribute('data-date');
    expect(new Date(mondayFirst + 'T00:00').getDay()).toBe(1);
  });

  test('an entry drags with a finger in the week grid', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/scheduler/');
    const from = dayOfThisWeek(2);
    const to = dayOfThisWeek(5);
    await createTimed(app, 'Touchable', from, '09:00');
    await page.getByTestId('view-calendar').click();
    await page.getByTestId('cal-view-week').click();

    await touchDrag(
      page,
      page.getByTestId('cal-event').first(),
      page.locator(`[data-testid="tg-col"][data-date="${to}"]`)
    );
    await expect
      .poll(async () => String(((await app.dump('events'))[0] as Record<string, unknown>).start))
      .toContain(to);
  });

  test('a TODO with a time sits at that time, and gains its place the moment one is set', async ({ app }) => {
    // The bug this covers: a TODO created without a time correctly went in the
    // all-day lane, and STAYED there after a time was added, because the grid
    // sorted todos by "has a due date" rather than "has a time of day".
    const { page } = app;
    await app.goto('/tools/scheduler/');
    const day = dayOfThisWeek(3);
    await page.getByTestId('scheduler-new-todo').click();
    await page.getByTestId('todo-title').fill('I need to do thing');
    await page.getByTestId('todo-due').fill(day);
    await page.getByTestId('todo-save').click();
    await expect.poll(async () => (await app.dump('todos')).length).toBe(1);

    await page.getByTestId('view-calendar').click();
    await page.getByTestId('cal-view-week').click();
    const lane = page.locator(`[data-testid="tg-allday"][data-date="${day}"]`);
    // No time yet: the lane is the only place it can go.
    await expect(lane.getByTestId('cal-todo')).toHaveText(/I need to do thing/);
    await expect(page.locator('[data-testid="tg-col"] [data-testid="cal-todo"]')).toHaveCount(0);

    // Give it one.
    await page.getByTestId('cal-todo').click();
    await page.getByTestId('modal-edit').click();
    await page.getByTestId('todo-due-time').fill('06:00');
    await page.getByTestId('todo-save').click();

    // It leaves the lane and lands at 06:00 — 360/1440 of the day.
    await expect(lane.getByTestId('cal-todo')).toHaveCount(0);
    const timed = page.locator(`[data-testid="tg-col"][data-date="${day}"] [data-testid="cal-todo"]`);
    await expect(timed).toHaveCount(1);
    expect(await timed.getAttribute('style')).toContain('top: 25%');
    await expect(timed).toContainText('06:00');

    // And clearing the time puts it back.
    await timed.click();
    await page.getByTestId('modal-edit').click();
    await page.getByTestId('todo-due-time').fill('');
    await page.getByTestId('todo-save').click();
    await expect(lane.getByTestId('cal-todo')).toHaveCount(1);
  });

  test('a timed TODO shares the width with an event at the same time', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/scheduler/');
    const day = dayOfThisWeek(3);
    await createTimed(app, 'Meeting', day, '09:00', '10:00');
    await page.getByTestId('scheduler-new-todo').click();
    await page.getByTestId('todo-title').fill('Prep');
    await page.getByTestId('todo-due').fill(day);
    await page.getByTestId('todo-due-time').fill('09:00');
    await page.getByTestId('todo-save').click();
    await expect.poll(async () => (await app.dump('todos')).length).toBe(1);

    await page.getByTestId('view-calendar').click();
    await page.getByTestId('cal-view-week').click();
    // Packed together, not on top of each other: events and timed TODOs go
    // through one overlap pass.
    const meeting = page.getByTestId('cal-event').filter({ hasText: 'Meeting' });
    const prep = page.getByTestId('cal-todo').filter({ hasText: 'Prep' });
    expect(await meeting.getAttribute('style')).toContain('width: 50%');
    expect(await prep.getAttribute('style')).toContain('width: 50%');
    expect(await prep.getAttribute('style')).toContain('left: 50%');
  });

  test('dropping a TODO in the all-day lane takes its time away; dropping on an hour gives it one', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/scheduler/');
    const from = dayOfThisWeek(2);
    const to = dayOfThisWeek(4);
    await page.getByTestId('scheduler-new-todo').click();
    await page.getByTestId('todo-title').fill('Movable');
    await page.getByTestId('todo-due').fill(from);
    await page.getByTestId('todo-due-time').fill('09:00');
    await page.getByTestId('todo-save').click();
    await expect.poll(async () => (await app.dump('todos')).length).toBe(1);
    const id = String((await app.dump('todos'))[0]!.id);

    await page.getByTestId('view-calendar').click();
    await page.getByTestId('cal-view-week').click();

    // Into the lane: the time goes, because the lane means "no time".
    let before = await app.dumpAll();
    await pointerDrag(
      page,
      page.getByTestId('cal-todo').first(),
      page.locator(`[data-testid="tg-allday"][data-date="${to}"]`)
    );
    await expect
      .poll(async () => (await app.dump('todos'))[0]!.due_time)
      .toBeNull();
    expect((await app.dump('todos'))[0]!.due_date).toBe(to);
    assertIsolatedDelta(before, await app.dumpAll(), [{ store: 'todos', id }]);

    // Back onto the hours: it gets a time again, snapped to the quarter hour.
    before = await app.dumpAll();
    const target = page.locator(`[data-testid="tg-col"][data-date="${from}"]`);
    const box = (await target.boundingBox())!;
    const src = (await page.getByTestId('cal-todo').first().boundingBox())!;
    await page.mouse.move(src.x + src.width / 2, src.y + src.height / 2);
    await page.mouse.down();
    await page.mouse.move(src.x + src.width / 2 + 8, src.y + src.height / 2 + 8, { steps: 2 });
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 6 });
    await page.mouse.up();

    await expect
      .poll(async () => (await app.dump('todos'))[0]!.due_time)
      .toMatch(/^\d{2}:(00|15|30|45)$/);
    expect((await app.dump('todos'))[0]!.due_date).toBe(from);
    assertIsolatedDelta(before, await app.dumpAll(), [{ store: 'todos', id }]);
  });

  test('a recurring series draws in the week grid too, and drawing writes nothing', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/scheduler/');
    // Anchored on the Monday of this week: Mon..Sat is six of the seven days.
    await page.getByTestId('scheduler-new-event').click();
    await page.getByTestId('event-title').fill('Daily standup');
    await page.getByTestId('event-date').fill(dayOfThisWeek(1));
    await page.getByTestId('event-time').fill('09:00');
    await page.getByTestId('event-recur').selectOption('every');
    await page.getByTestId('event-every-n').fill('1');
    await page.getByTestId('event-every-unit').selectOption('days');
    await page.getByTestId('event-save').click();
    await expect.poll(async () => (await app.dump('events')).length).toBe(1);

    await page.getByTestId('view-calendar').click();
    await page.getByTestId('cal-view-week').click();
    await expect(page.getByTestId('cal-event')).toHaveCount(6);

    // Snapshot AFTER the sub-view preference has been written, so what is being
    // measured is the drawing, not the click that got us here.
    const before = await app.dumpAll();
    await page.getByTestId('cal-next').click();
    await page.getByTestId('cal-prev').click();
    await expect(page.getByTestId('cal-event')).toHaveCount(6);
    await page.reload();
    await expect(page.getByTestId('cal-event')).toHaveCount(6);
    expect(await app.dumpAll()).toEqual(before);

    // The day view shows today's one occurrence — unless today is the Sunday
    // before the anchor, when there is none yet.
    await page.getByTestId('cal-view-day').click();
    const isSundayBeforeAnchor = new Date().getDay() === 0;
    await expect(page.getByTestId('cal-event')).toHaveCount(isSundayBeforeAnchor ? 0 : 1);
  });
});
