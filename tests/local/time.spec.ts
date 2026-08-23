/**
 * Phase 1 (Time) — timers, stopwatch, timezone converter, driven through the
 * real UI against the production build, with every write audited through the
 * oracle (isolated deltas; page loads write nothing).
 */
import { test, expect } from './helpers/app';
import { assertIsolatedDelta } from './helpers/oracle';

test.describe('timers', () => {
  test('creating a timer writes the timer row and only the defaults singleton', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/timers/');
    const before = await app.dumpAll();

    await page.getByTestId('timer-new').click();
    await page.getByTestId('timer-label').fill('Tea');
    await page.getByTestId('timer-save').click();
    await expect(page.getByTestId('timer-state')).toHaveText('idle');

    const after = await app.dumpAll();
    const timers = await app.dump('timers');
    expect(timers).toHaveLength(1);
    const timer = timers[0] as Record<string, unknown>;
    expect(timer.label).toBe('Tea');
    expect(timer.duration_ms).toBe(5 * 60_000);
    expect(timer.state).toBe('idle');
    expect(timer.end_at).toBeNull();
    // The save also remembered completion defaults — and touched NOTHING else.
    assertIsolatedDelta(before, after, [
      { store: 'timers', id: String(timer.id) },
      { store: 'preferences', id: 'singleton' },
    ]);
  });

  test('a running timer survives reload from its absolute deadline, and loading writes nothing', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/timers/');
    await page.getByTestId('timer-new').click();
    await page.getByTestId('timer-label').fill('Long run');
    await page.getByTestId('timer-hours').fill('1');
    await page.getByTestId('timer-minutes').fill('0');
    await page.getByTestId('timer-save').click();
    await page.getByTestId('timer-start').click();
    await expect(page.getByTestId('timer-state')).toHaveText('running');

    const running = (await app.dump('timers'))[0] as Record<string, unknown>;
    expect(running.state).toBe('running');
    expect(running.end_at).toBeTruthy();

    const before = await app.dumpAll();
    await app.goto('/tools/timers/');
    await expect(page.getByTestId('timer-state')).toHaveText('running');
    // The countdown recomputes from end_at — reload changed no data at all.
    expect(await app.dumpAll()).toEqual(before);
    await expect(page.getByTestId('timer-countdown')).toHaveText(/^(1:00:00|59:[0-5]\d)$/);
  });

  test('pause banks the remaining budget; resume restores it', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/timers/');
    await page.getByTestId('timer-new').click();
    await page.getByTestId('timer-label').fill('Pausable');
    await page.getByTestId('timer-hours').fill('1');
    await page.getByTestId('timer-minutes').fill('0');
    await page.getByTestId('timer-save').click();
    await page.getByTestId('timer-start').click();
    await expect(page.getByTestId('timer-state')).toHaveText('running');
    await page.getByTestId('timer-pause').click();
    await expect(page.getByTestId('timer-state')).toHaveText('paused');

    const paused = (await app.dump('timers'))[0] as Record<string, unknown>;
    expect(paused.end_at).toBeNull();
    const banked = paused.paused_remaining_ms as number;
    expect(banked).toBeGreaterThan(3_500_000);
    expect(banked).toBeLessThanOrEqual(3_600_000);

    await page.getByTestId('timer-start').click(); // Resume
    await expect(page.getByTestId('timer-state')).toHaveText('running');
    const resumed = (await app.dump('timers'))[0] as Record<string, unknown>;
    expect(resumed.paused_remaining_ms).toBeNull();
    expect(Date.parse(resumed.end_at as string)).toBeGreaterThan(Date.now() + 3_400_000);
  });

  test('a timer that expires fires the engine: state done + banner', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/timers/');
    await page.getByTestId('timer-new').click();
    await page.getByTestId('timer-label').fill('Quick');
    await page.getByTestId('timer-minutes').fill('0');
    await page.getByTestId('timer-seconds').fill('2');
    // No sound in a headless run.
    await page.getByRole('checkbox', { name: 'Play sound' }).uncheck();
    await page.getByTestId('timer-save').click();
    await page.getByTestId('timer-start').click();

    await expect(page.getByTestId('timer-notice')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('timer-notice')).toContainText('Quick');
    await expect(page.getByTestId('timer-state')).toHaveText('done');
    const done = (await app.dump('timers'))[0] as Record<string, unknown>;
    expect(done.state).toBe('done');
    expect(done.end_at).toBeNull();
  });

  test('a timer already long past its deadline surfaces as MISSED (closed-app case)', async ({ app }) => {
    const { page } = app;
    // Simulate "finished while closed": a running timer whose deadline passed
    // a minute ago. The engine's next scan finds it far beyond the live
    // threshold and labels it missed — the same path a fresh app open takes.
    await app.call('rawPut', 'timers', {
      id: 'missed-1',
      updated_at: new Date().toISOString(),
      deleted_at: null,
      server_seq: null,
      label: 'While away',
      description_md: '',
      duration_ms: 60_000,
      end_at: new Date(Date.now() - 60_000).toISOString(),
      paused_remaining_ms: null,
      state: 'running',
      sound: false,
      vibrate: false,
      notify: false,
      delete_on_complete: false,
    });
    await expect(page.getByTestId('timer-notice')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('timer-notice')).toContainText('MISSED');
    await expect(page.getByTestId('timer-notice')).toContainText('While away');
    await expect.poll(async () => (await app.get('timers', 'missed-1'))!.state).toBe('done');
  });
});

test.describe('timer options', () => {
  test('Save & start saves the timer and starts it immediately', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/timers/');
    await page.getByTestId('timer-new').click();
    await page.getByTestId('timer-label').fill('Straight to work');
    await page.getByTestId('timer-hours').fill('1');
    await page.getByTestId('timer-minutes').fill('0');
    await page.getByTestId('timer-save-start').click();

    await expect(page.getByTestId('timer-state')).toHaveText('running');
    const row = (await app.dump('timers'))[0] as Record<string, unknown>;
    expect(row.state).toBe('running');
    expect(row.end_at).toBeTruthy();
  });

  test('delete-on-complete tombstones the timer after it fires (banner still shows)', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/timers/');
    await page.getByTestId('timer-new').click();
    await page.getByTestId('timer-label').fill('One shot');
    await page.getByTestId('timer-minutes').fill('0');
    await page.getByTestId('timer-seconds').fill('2');
    await page.getByRole('checkbox', { name: 'Play sound' }).uncheck();
    await page.getByTestId('timer-delete-on-complete').check();
    await page.getByTestId('timer-save-start').click();

    await expect(page.getByTestId('timer-notice')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('timer-notice')).toContainText('One shot');
    // Soft-deleted, not a hole: the tombstone remains for backup/sync.
    const raw = (await app.call<Record<string, unknown>[]>('rawDump', 'timers'))[0]!;
    expect(raw.deleted_at).toBeTruthy();
    // And it left the visible list.
    await expect(page.getByTestId('timer-state')).toHaveCount(0);
  });

  test('the new options are remembered as defaults for the next timer', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/timers/');
    await page.getByTestId('timer-new').click();
    await page.getByTestId('timer-label').fill('Remember me');
    await page.getByTestId('timer-delete-on-complete').check();
    await page.getByTestId('timer-save').click();
    await expect(page.getByTestId('timer-state')).toHaveText('idle');

    const prefs = (await app.get('preferences', 'singleton')) as Record<string, unknown>;
    expect(prefs.timer_default_delete_on_complete).toBe(true);

    await page.getByTestId('timer-new').click();
    await expect(page.getByTestId('timer-delete-on-complete')).toBeChecked();
  });
});

test.describe('alarm loop + preferences panel', () => {
  test('a finished timer rings until its banner is dismissed', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/timers/');
    await page.getByTestId('timer-new').click();
    await page.getByTestId('timer-label').fill('Ringer');
    await page.getByTestId('timer-minutes').fill('0');
    await page.getByTestId('timer-seconds').fill('2');
    await page.getByTestId('timer-save-start').click();

    const notice = page.getByTestId('timer-notice');
    await expect(notice).toBeVisible({ timeout: 10_000 });
    await expect(notice).toHaveAttribute('data-alarming', 'true');

    await page.getByRole('button', { name: /Dismiss notification/ }).click();
    await expect(page.getByTestId('timer-notice')).toHaveCount(0);
  });

  test('acting on the finished timer interrupts the alarm', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/timers/');
    await page.getByTestId('timer-new').click();
    await page.getByTestId('timer-label').fill('Interrupt me');
    await page.getByTestId('timer-minutes').fill('0');
    await page.getByTestId('timer-seconds').fill('2');
    await page.getByTestId('timer-save-start').click();

    await expect(page.getByTestId('timer-notice')).toHaveAttribute('data-alarming', 'true', {
      timeout: 10_000,
    });
    await page.getByTestId('timer-start').click(); // "Run again"
    await expect(page.getByTestId('timer-notice')).toHaveCount(0);
    await expect(page.getByTestId('timer-state')).toHaveText('running');
  });

  test('the alarm duration preference caps the ringing', async ({ app }) => {
    const { page } = app;
    await app.goto('/settings/');
    await page.getByTestId('pref-timer_alarm_seconds').fill('1');
    await page.getByTestId('pref-timer_alarm_seconds').blur();
    await expect
      .poll(async () => (await app.get('preferences', 'singleton'))?.timer_alarm_seconds)
      .toBe(1);

    await app.goto('/tools/timers/');
    await page.getByTestId('timer-new').click();
    await page.getByTestId('timer-label').fill('Short ring');
    await page.getByTestId('timer-minutes').fill('0');
    await page.getByTestId('timer-seconds').fill('2');
    await page.getByTestId('timer-save-start').click();

    const notice = page.getByTestId('timer-notice');
    await expect(notice).toBeVisible({ timeout: 10_000 });
    // Ringing stops on its own within the configured second (+tick slack)…
    await expect(notice).toHaveAttribute('data-alarming', 'false', { timeout: 6_000 });
    // …but the banner persists until dismissed.
    await expect(notice).toBeVisible();
  });

  test('panel toggles write only the singleton and drive the timer form', async ({ app }) => {
    const { page } = app;
    await app.goto('/settings/');
    const before = await app.dumpAll();
    await page.getByTestId('pref-timer_default_delete_on_complete').check();
    await expect
      .poll(async () => (await app.get('preferences', 'singleton'))?.timer_default_delete_on_complete)
      .toBe(true);
    assertIsolatedDelta(before, await app.dumpAll(), [{ store: 'preferences', id: 'singleton' }]);

    await app.goto('/tools/timers/');
    await page.getByTestId('timer-new').click();
    await expect(page.getByTestId('timer-delete-on-complete')).toBeChecked();
  });

  test('with auto-remember off, saving a timer leaves the set defaults alone', async ({ app }) => {
    const { page } = app;
    await app.goto('/settings/');
    await page.getByTestId('pref-auto_remember_based_on_last_value').uncheck();
    await expect
      .poll(async () => (await app.get('preferences', 'singleton'))?.auto_remember_based_on_last_value)
      .toBe(false);

    await app.goto('/tools/timers/');
    await page.getByTestId('timer-new').click();
    await page.getByTestId('timer-label').fill('No remember');
    await page.getByRole('checkbox', { name: 'Play sound' }).uncheck();
    await page.getByTestId('timer-save').click();
    await expect(page.getByTestId('timer-state')).toHaveText('idle');

    // The stored default did NOT follow the saved timer…
    const prefs = (await app.get('preferences', 'singleton')) as Record<string, unknown>;
    expect(prefs.timer_default_sound).not.toBe(false);
    // …so the next new timer pre-fills sound on again.
    await page.getByTestId('timer-new').click();
    await expect(page.getByRole('checkbox', { name: 'Play sound' })).toBeChecked();
  });
});

test.describe('stopwatch', () => {
  test('start/lap/pause/reset write only the singleton; elapsed survives reload', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/stopwatch/');
    const before = await app.dumpAll();

    await page.getByTestId('stopwatch-start').click();
    await page.getByTestId('stopwatch-lap').click();
    await page.getByTestId('stopwatch-lap').click();
    await expect(page.getByTestId('stopwatch-lap-row')).toHaveCount(2);
    await page.getByTestId('stopwatch-pause').click();

    const after = await app.dumpAll();
    assertIsolatedDelta(before, after, [{ store: 'stopwatch', id: 'singleton' }]);
    const row = (await app.get('stopwatch', 'singleton')) as Record<string, unknown>;
    expect(row.state).toBe('paused');
    expect(row.started_at).toBeNull();
    expect(row.elapsed_before_pause_ms as number).toBeGreaterThan(0);
    expect((row.laps as number[]).length).toBe(2);

    // Reload: display restores from the row, and loading writes nothing.
    const banked = await app.dumpAll();
    await app.goto('/tools/stopwatch/');
    await expect(page.getByTestId('stopwatch-lap-row')).toHaveCount(2);
    expect(await app.dumpAll()).toEqual(banked);

    await page.getByTestId('stopwatch-reset').click();
    const reset = (await app.get('stopwatch', 'singleton')) as Record<string, unknown>;
    expect(reset.state).toBe('idle');
    expect(reset.elapsed_before_pause_ms).toBe(0);
    expect(reset.laps).toEqual([]);
  });

  test('a running stopwatch keeps counting across a reload', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/stopwatch/');
    await page.getByTestId('stopwatch-start').click();
    await page.waitForTimeout(1200);
    await app.goto('/tools/stopwatch/');
    // Still running, elapsed at least the pre-reload second.
    await expect(page.getByTestId('stopwatch-pause')).toBeVisible();
    await expect(page.getByTestId('stopwatch-elapsed')).not.toHaveText('0:00.0');
  });
});

test.describe('timezones', () => {
  test('loading the page writes nothing', async ({ app }) => {
    const before = await app.dumpAll();
    await app.goto('/tools/timezones/');
    expect(await app.dumpAll()).toEqual(before);
  });

  test('converts a fixed winter time between two picked zones and remembers the pair', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/timezones/');
    const before = await app.dumpAll();

    await page.getByTestId('tz-when').fill('2024-01-15T12:00');
    await page.getByTestId('tz-from-search').fill('edmonton');
    await page.getByTestId('tz-from-option').first().click();
    await expect(page.getByTestId('tz-from-current')).toContainText('Edmonton');
    await page.getByTestId('tz-to-search').fill('tokyo');
    await page.getByTestId('tz-to-option').first().click();
    await expect(page.getByTestId('tz-to-current')).toContainText('Tokyo');

    // 12:00 MST (UTC-7) === 19:00 UTC === 04:00 JST on Jan 16.
    await expect(page.getByTestId('tz-to-text')).toContainText('4:00');
    await expect(page.getByTestId('tz-to-text')).toContainText('16');

    const after = await app.dumpAll();
    assertIsolatedDelta(before, after, [{ store: 'preferences', id: 'singleton' }]);
    const prefs = (await app.get('preferences', 'singleton')) as Record<string, unknown>;
    expect(prefs.tz_last_from).toBe('America/Edmonton');
    expect(prefs.tz_last_to).toBe('Asia/Tokyo');

    // The remembered pair comes back on the next visit.
    await app.goto('/tools/timezones/');
    await expect(page.getByTestId('tz-from-current')).toContainText('Edmonton');
    await expect(page.getByTestId('tz-to-current')).toContainText('Tokyo');
  });

  test('a city with no IANA zone of its own resolves through the GeoNames dataset', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/timezones/');
    // Osaka is not an IANA zone name — only the city dataset can find it.
    await page.getByTestId('tz-from-search').fill('osaka');
    const option = page.getByTestId('tz-from-option').filter({ hasText: 'Asia/Tokyo' }).first();
    await expect(option).toBeVisible({ timeout: 10_000 }); // first hit lazy-loads the ~1.4MB chunk
    await option.click();
    await expect(page.getByTestId('tz-from-current')).toContainText('Tokyo');
  });

  test('swap exchanges the zones', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/timezones/');
    await page.getByTestId('tz-from-search').fill('edmonton');
    await page.getByTestId('tz-from-option').first().click();
    await page.getByTestId('tz-to-search').fill('paris');
    await page.getByTestId('tz-to-option').first().click();
    await page.getByTestId('tz-swap').click();
    await expect(page.getByTestId('tz-from-current')).toContainText('Paris');
    await expect(page.getByTestId('tz-to-current')).toContainText('Edmonton');
  });
});
