/**
 * Crontab (0.3.0 phase 10).
 *
 * Stateless — nothing on the page is written anywhere, and every case asserts
 * the database is byte-identical afterwards.
 *
 * The next-run list is computed from the browser's clock, so the assertions
 * here are about shape and ordering rather than exact timestamps; the exact
 * dates (month ends, leap years, the OR rule) are pinned in
 * src/lib/cron/cron.test.ts against fixed `Date`s.
 */
import { test, expect } from './helpers/app';

test.describe('crontab — reading an expression', () => {
  test('describes what an expression means, and writes nothing', async ({ app }) => {
    const { page } = app;
    const before = await app.dumpAll();
    await app.goto('/tools/crontab/');

    await expect(page.getByTestId('cron-description')).toHaveText('At 04:05.');

    await page.getByTestId('cron-input').fill('0 9 * * 1-5');
    await expect(page.getByTestId('cron-description')).toHaveText(
      'At 09:00 on every day-of-week from Monday through Friday.'
    );

    await page.getByTestId('cron-input').fill('*/15 * * * *');
    await expect(page.getByTestId('cron-description')).toHaveText('Every 15th minute.');

    expect(await app.dumpAll()).toEqual(before);
  });

  test('expands a macro and says what it stands for', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/crontab/');
    await page.getByTestId('cron-input').fill('@weekly');
    await expect(page.getByTestId('cron-description')).toHaveText('At 00:00 on Sunday.');
    await expect(page.getByTestId('cron-macro')).toContainText('0 0 * * 0');
  });

  test('points at the character it could not read', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/crontab/');
    await page.getByTestId('cron-input').fill('0 99 * * *');
    const error = page.getByTestId('cron-error');
    await expect(error).toContainText('hour 99 is out of range');
    await expect(error).toContainText('In the hour field.');
    // The caret sits under the 9 that starts the bad field.
    await expect(error.locator('pre')).toHaveText('0 99 * * *\n  ^');
    await expect(page.getByTestId('cron-runs-note')).toContainText('Fix the expression');
  });

  test('refuses a six-field expression by name', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/crontab/');
    await page.getByTestId('cron-input').fill('0 0 12 * * ?');
    await expect(page.getByTestId('cron-error')).toContainText('six-field expression with seconds in front');
  });

  test('warns about the day-of-month / day-of-week trap in red', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/crontab/');
    await page.getByTestId('cron-input').fill('0 0 13 * 5');

    await expect(page.getByTestId('cron-description')).toHaveText('At 00:00 on day-of-month 13th on Friday.');
    await expect(page.getByTestId('cron-or-warning')).toContainText('EITHER');
    // And it is gone the moment only one day field is set.
    await page.getByTestId('cron-input').fill('0 0 13 * *');
    await expect(page.getByTestId('cron-or-warning')).toHaveCount(0);
  });

  test('picks up the command when a whole crontab line is pasted', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/crontab/');
    await page.getByTestId('cron-input').fill('0 3 * * * /usr/local/bin/backup.sh --quiet');
    await expect(page.getByTestId('cron-command')).toContainText('/usr/local/bin/backup.sh --quiet');
    await expect(page.getByTestId('cron-description')).toHaveText('At 03:00.');
  });
});

test.describe('crontab — when it runs', () => {
  test('lists the next five runs in order, in this browser timezone', async ({ app }) => {
    const { page } = app;
    const before = await app.dumpAll();
    await app.goto('/tools/crontab/');
    await page.getByTestId('cron-input').fill('0 0 * * *');

    const runs = page.getByTestId('cron-runs').locator('li');
    await expect(runs).toHaveCount(5);

    const stamps = await runs.locator('time').evaluateAll((nodes) =>
      nodes.map((n) => n.getAttribute('datetime')!)
    );
    expect(stamps).toHaveLength(5);
    // Strictly ascending, and a day apart for a daily job.
    for (let i = 1; i < stamps.length; i++) {
      expect(new Date(stamps[i]!).getTime()).toBeGreaterThan(new Date(stamps[i - 1]!).getTime());
    }
    await expect(page.getByTestId('cron-zone')).toContainText("this browser's timezone");

    expect(await app.dumpAll()).toEqual(before);
  });

  test('says plainly when an expression never runs', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/crontab/');
    await page.getByTestId('cron-input').fill('0 0 30 2 *');
    await expect(page.getByTestId('cron-runs-note')).toContainText('never runs');
    await expect(page.getByTestId('cron-runs-note')).toContainText('February has no 30th');
  });

  test('has no schedule for @reboot, and says what it does instead', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/crontab/');
    await page.getByTestId('cron-input').fill('@reboot');
    await expect(page.getByTestId('cron-description')).toHaveText('Once, when the machine boots.');
    await expect(page.getByTestId('cron-runs-note')).toContainText('when cron starts at boot');
  });
});

test.describe('crontab — the builder', () => {
  test('writes the expression from the controls', async ({ app }) => {
    const { page } = app;
    const before = await app.dumpAll();
    await app.goto('/tools/crontab/');
    await page.getByTestId('cron-builder-card').getByText('Build it').click();

    await page.getByTestId('cron-mode-minute').selectOption('step');
    await page.getByTestId('cron-step-minute').fill('10');
    await page.getByTestId('cron-step-minute').press('Enter');
    await expect(page.getByTestId('cron-input')).toHaveValue(/^\*\/10 /);

    await page.getByTestId('cron-mode-hour').selectOption('range');
    await page.getByTestId('cron-from-hour').fill('9');
    await page.getByTestId('cron-from-hour').press('Enter');
    await page.getByTestId('cron-to-hour').fill('17');
    await page.getByTestId('cron-to-hour').press('Enter');

    await page.getByTestId('cron-mode-dow').selectOption('list');
    await page.getByTestId('cron-pick-dow-1').check();
    await page.getByTestId('cron-pick-dow-5').check();

    await expect(page.getByTestId('cron-input')).toHaveValue('*/10 9-17 * * 1,5');
    await expect(page.getByTestId('cron-description')).toContainText('Monday and Friday');

    expect(await app.dumpAll()).toEqual(before);
  });

  test('reads a typed expression back into the controls', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/crontab/');
    await page.getByTestId('cron-builder-card').getByText('Build it').click();

    await page.getByTestId('cron-input').fill('30 8 1 * *');
    await expect(page.getByTestId('cron-mode-minute')).toHaveValue('list');
    await expect(page.getByTestId('cron-list-minute')).toHaveValue('30');
    await expect(page.getByTestId('cron-mode-month')).toHaveValue('every');

    // A shape the controls cannot draw keeps its text rather than being
    // flattened into something they can.
    await page.getByTestId('cron-input').fill('1-5/2,30 * * * *');
    await expect(page.getByTestId('cron-mode-minute')).toHaveValue('custom');
    await expect(page.getByTestId('cron-field-minute')).toContainText('1-5/2,30');
  });

  test('a preset fills the expression in one click', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/crontab/');
    await page.getByTestId('cron-preset-0 9 * * 1-5').click();
    await expect(page.getByTestId('cron-input')).toHaveValue('0 9 * * 1-5');
  });
});

test.describe('crontab — systemd and where the line goes', () => {
  test('translates the schedule into a timer unit', async ({ app }) => {
    const { page } = app;
    const before = await app.dumpAll();
    await app.goto('/tools/crontab/');
    await page.getByTestId('cron-systemd-card').getByText('As a systemd timer').click();

    await expect(page.getByTestId('cron-oncalendar')).toHaveText('OnCalendar=*-*-* 04:05:00');
    await expect(page.getByTestId('cron-unit')).toContainText('Persistent=true');
    await expect(page.getByTestId('cron-unit')).toContainText('WantedBy=timers.target');

    expect(await app.dumpAll()).toEqual(before);
  });

  test('refuses to translate the OR case instead of quietly ANDing it', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/crontab/');
    await page.getByTestId('cron-input').fill('0 0 13 * 5');
    await page.getByTestId('cron-systemd-card').getByText('As a systemd timer').click();

    await expect(page.getByTestId('cron-oncalendar')).toHaveCount(0);
    await expect(page.getByTestId('cron-systemd-warning')).toContainText('TWO OnCalendar=');
  });

  test('spells out the user column, which is the mistake that eats an afternoon', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/crontab/');
    await page.getByTestId('cron-where-card').getByText('Where the line goes').click();
    await expect(page.getByTestId('cron-user-column')).toContainText('/etc/cron.d');
    await expect(page.getByTestId('cron-where-card')).toContainText('run-parts');
  });
});
