/**
 * 0.6.0 Phase 4 (Time › Pomodoro) — the singleton cycle driven through the
 * real UI against the production build, every write audited through the
 * oracle. Page load writes nothing; the first Start creates the row; the
 * engine writes once per phase transition.
 */
import { test, expect } from './helpers/app';
import { assertIsolatedDelta } from './helpers/oracle';

type Row = Record<string, unknown>;

/** A complete running row for the engine to find, on the timers' rawPut
 * pattern: the deadline is what the test is about, so it is set directly. */
function runningRow(endAtOffsetMs: number, extra: Partial<Row> = {}): Row {
  return {
    id: 'singleton',
    updated_at: new Date().toISOString(),
    deleted_at: null,
    server_seq: null,
    work_ms: 25 * 60_000,
    short_break_ms: 5 * 60_000,
    long_break_ms: 15 * 60_000,
    rounds_before_long: 4,
    phase: 'work',
    round: 1,
    state: 'running',
    end_at: new Date(Date.now() + endAtOffsetMs).toISOString(),
    paused_remaining_ms: null,
    auto_advance: false,
    sound: false, // headless run
    vibrate: false,
    notify: false,
    completed_today: 0,
    completed_today_date: '',
    ...extra,
  };
}

test.describe('pomodoro', () => {
  test('a fresh page shows the defaults and writes nothing', async ({ app }) => {
    const { page } = app;
    const before = await app.dumpAll();
    await app.goto('/tools/pomodoro/');
    await expect(page.getByTestId('pom-phase')).toHaveText('Focus');
    await expect(page.getByTestId('pom-remaining')).toHaveText('25:00');
    await expect(page.getByTestId('pom-round')).toContainText('Round 1 of 4');
    await expect(page.getByTestId('pom-today')).toContainText('0 focus rounds');
    await expect(page.getByTestId('pom-dot')).toHaveCount(4);
    await expect(page.getByTestId('pom-work-min')).toHaveValue('25');
    expect(await app.dumpAll()).toEqual(before);
  });

  test('Start writes one running row; Pause banks the remainder and touches nothing else; Resume restores it', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/pomodoro/');
    const before = await app.dumpAll();

    await page.getByTestId('pom-start').click();
    await expect(page.getByTestId('pom-state')).toHaveText('running');
    const after = await app.dumpAll();
    assertIsolatedDelta(before, after, [{ store: 'pomodoro', id: 'singleton' }]);
    expect(after.pomodoro).toHaveLength(1);
    const running = (await app.get('pomodoro', 'singleton')) as Row;
    expect(running.state).toBe('running');
    expect(running.phase).toBe('work');
    expect(running.round).toBe(1);
    expect(running.work_ms).toBe(25 * 60_000);
    expect(running.rounds_before_long).toBe(4);
    expect(running.auto_advance).toBe(false);
    expect(running.paused_remaining_ms).toBeNull();
    const deadline = Date.parse(running.end_at as string);
    expect(deadline).toBeGreaterThan(Date.now() + 24 * 60_000);
    expect(deadline).toBeLessThanOrEqual(Date.now() + 25 * 60_000);

    await page.getByTestId('pom-pause').click();
    await expect(page.getByTestId('pom-state')).toHaveText('paused');
    const paused = (await app.get('pomodoro', 'singleton')) as Row;
    expect(paused.state).toBe('paused');
    expect(paused.end_at).toBeNull();
    const banked = paused.paused_remaining_ms as number;
    expect(banked).toBeGreaterThan(24 * 60_000);
    expect(banked).toBeLessThanOrEqual(25 * 60_000);
    // Only the pause fields (and the row clock) moved.
    const untouched = Object.keys(running).filter(
      (k) => !['state', 'end_at', 'paused_remaining_ms', 'updated_at'].includes(k)
    );
    for (const k of untouched) expect(paused[k], k).toEqual(running[k]);
    expect(Object.keys(paused).sort()).toEqual(Object.keys(running).sort());

    await page.getByTestId('pom-resume').click();
    await expect(page.getByTestId('pom-state')).toHaveText('running');
    const resumed = (await app.get('pomodoro', 'singleton')) as Row;
    expect(resumed.paused_remaining_ms).toBeNull();
    expect(Date.parse(resumed.end_at as string)).toBeGreaterThan(Date.now() + 23 * 60_000);

    // Reload: the countdown recomputes from end_at — no data changed.
    const snapshot = await app.dumpAll();
    await app.goto('/tools/pomodoro/');
    await expect(page.getByTestId('pom-state')).toHaveText('running');
    expect(await app.dumpAll()).toEqual(snapshot);
  });

  test('Skip walks the cycle without counting, through the long break and back to round 1', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/pomodoro/');
    // A two-round cycle keeps the walk short.
    await page.getByTestId('pom-rounds').fill('2');
    await page.getByTestId('pom-rounds').blur();
    await expect.poll(async () => (await app.get('pomodoro', 'singleton'))?.rounds_before_long).toBe(2);
    await expect(page.getByTestId('pom-dot')).toHaveCount(2);

    await page.getByTestId('pom-skip').click();
    await expect(page.getByTestId('pom-phase')).toHaveText('Short break');
    await expect(page.getByTestId('pom-remaining')).toHaveText('5:00');
    await page.getByTestId('pom-skip').click();
    await expect(page.getByTestId('pom-phase')).toHaveText('Focus');
    await expect(page.getByTestId('pom-round')).toContainText('Round 2 of 2');
    await page.getByTestId('pom-skip').click();
    await expect(page.getByTestId('pom-phase')).toHaveText('Long break');
    await expect(page.getByTestId('pom-remaining')).toHaveText('15:00');
    await page.getByTestId('pom-skip').click();
    await expect(page.getByTestId('pom-phase')).toHaveText('Focus');
    await expect(page.getByTestId('pom-round')).toContainText('Round 1 of 2');

    const row = (await app.get('pomodoro', 'singleton')) as Row;
    expect(row.state).toBe('idle');
    expect(row.phase).toBe('work');
    expect(row.round).toBe(1);
    // Skipped rounds are not completed rounds.
    expect(row.completed_today).toBe(0);
    await expect(page.getByTestId('pom-today')).toContainText('0 focus rounds');

    // Reset from mid-cycle goes back to round 1 and writes only the singleton.
    await page.getByTestId('pom-skip').click();
    await expect(page.getByTestId('pom-phase')).toHaveText('Short break');
    const before = await app.dumpAll();
    await page.getByTestId('pom-reset').click();
    await expect(page.getByTestId('pom-phase')).toHaveText('Focus');
    await expect(page.getByTestId('pom-round')).toContainText('Round 1 of 2');
    assertIsolatedDelta(before, await app.dumpAll(), [{ store: 'pomodoro', id: 'singleton' }]);
  });

  test('a focus round whose deadline arrives raises the notice, counts, and parks the break in done', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/pomodoro/');
    await app.call('rawPut', 'pomodoro', runningRow(1_500));

    const notice = page.getByTestId('timer-notice');
    await expect(notice).toBeVisible({ timeout: 10_000 });
    await expect(notice).toContainText('Focus round 1 of 4 done — break time');
    await expect(notice).toContainText('DONE');
    await expect(page.getByTestId('pom-state')).toHaveText('done');
    await expect(page.getByTestId('pom-phase')).toHaveText('Short break');
    await expect(page.getByTestId('pom-remaining')).toHaveText('5:00');
    await expect(page.getByTestId('pom-today')).toContainText('1 focus round completed');

    const row = (await app.get('pomodoro', 'singleton')) as Row;
    expect(row.state).toBe('done');
    expect(row.phase).toBe('short_break');
    expect(row.round).toBe(1);
    expect(row.end_at).toBeNull();
    expect(row.completed_today).toBe(1);
    expect(row.completed_today_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    // Start on a parked row begins the next phase and clears the banner.
    await expect(page.getByTestId('pom-start')).toHaveText('Start short break');
    await page.getByTestId('pom-start').click();
    await expect(page.getByTestId('pom-state')).toHaveText('running');
    await expect(page.getByTestId('timer-notice')).toHaveCount(0);
    const started = (await app.get('pomodoro', 'singleton')) as Row;
    expect(started.phase).toBe('short_break');
    expect(Date.parse(started.end_at as string)).toBeGreaterThan(Date.now() + 4 * 60_000);
  });

  test('with auto-advance on, the break starts by itself', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/pomodoro/');
    await app.call('rawPut', 'pomodoro', runningRow(1_500, { auto_advance: true }));

    await expect(page.getByTestId('timer-notice')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('pom-phase')).toHaveText('Short break');
    await expect(page.getByTestId('pom-state')).toHaveText('running');
    const row = (await app.get('pomodoro', 'singleton')) as Row;
    expect(row.state).toBe('running');
    expect(row.phase).toBe('short_break');
    expect(row.end_at).toBeTruthy();
    expect(row.completed_today).toBe(1);
  });

  test('a deadline long past surfaces as MISSED and never auto-starts', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/pomodoro/');
    // The last round of the cycle, so the missed completion also crosses the
    // long-break boundary.
    await app.call('rawPut', 'pomodoro', runningRow(-60_000, { auto_advance: true, round: 4 }));

    const notice = page.getByTestId('timer-notice');
    await expect(notice).toBeVisible({ timeout: 10_000 });
    await expect(notice).toContainText('MISSED');
    await expect(notice).toContainText('Focus round 4 of 4 done — long break time');
    await expect(page.getByTestId('pom-phase')).toHaveText('Long break');
    await expect.poll(async () => (await app.get('pomodoro', 'singleton'))?.state).toBe('done');
  });

  test('settings write only the singleton, reject sub-second phases, and come back on reload', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/pomodoro/');
    const before = await app.dumpAll();

    await page.getByTestId('pom-work-min').fill('0.5');
    await page.getByTestId('pom-work-min').blur();
    await expect.poll(async () => (await app.get('pomodoro', 'singleton'))?.work_ms).toBe(30_000);
    await expect(page.getByTestId('pom-remaining')).toHaveText('0:30');
    await page.getByTestId('pom-auto-advance').check();
    await expect.poll(async () => (await app.get('pomodoro', 'singleton'))?.auto_advance).toBe(true);
    assertIsolatedDelta(before, await app.dumpAll(), [{ store: 'pomodoro', id: 'singleton' }]);
    const written = (await app.get('pomodoro', 'singleton')) as Row;
    expect(written.state).toBe('idle');
    expect(written.short_break_ms).toBe(5 * 60_000);

    // Below one second is refused and nothing is written.
    const snapshot = await app.dumpAll();
    await page.getByTestId('pom-work-min').fill('0.01');
    await page.getByTestId('pom-work-min').blur();
    await expect(page.getByTestId('pom-settings-error')).toBeVisible();
    expect(await app.dumpAll()).toEqual(snapshot);

    await app.goto('/tools/pomodoro/');
    await expect(page.getByTestId('pom-work-min')).toHaveValue('0.5');
    await expect(page.getByTestId('pom-auto-advance')).toBeChecked();
    expect(await app.dumpAll()).toEqual(snapshot);
  });
});
