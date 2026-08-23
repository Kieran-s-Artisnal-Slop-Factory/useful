/**
 * Navigation chrome: the rail-and-flyout sidebar, the mobile drawer, and the
 * ctrl+k quick-action palette. Runs against the production build like the
 * data suite, so client-side view transitions and the service worker are the
 * real thing.
 *
 * The sidebar (Phase 14, variant G): a rail of category buttons with the
 * chosen category's tools listed beside it, and a gear pinned to the foot of
 * the rail for Settings. Collapsed on desktop, the rail stays and only the
 * list hides; the home page has no sidebar row — the brand is its link.
 */
import { test, expect } from './helpers/app';

test('the rail picks a category and the flyout tracks the active page', async ({ app }) => {
  const { page } = app;
  // On the home page the first category is shown.
  await expect(page.getByTestId('sidebar-flyout').getByRole('heading')).toHaveText('Time');
  await expect(page.getByTestId('rail-time')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('nav-timers')).toBeVisible();

  // A rail click swaps the list without navigating.
  await page.getByTestId('rail-productivity').click();
  await expect(page.getByTestId('sidebar-flyout').getByRole('heading')).toHaveText('Productivity');
  await expect(page.getByTestId('nav-notebook')).toBeVisible();
  await expect(page.getByTestId('nav-scheduler')).toBeVisible();
  await expect(page).toHaveURL(/\/$/);

  // Navigating marks the page; landing in another category swaps the list.
  await page.getByTestId('nav-scheduler').click();
  await expect(page).toHaveURL(/\/tools\/scheduler\/$/);
  await expect(page.getByTestId('nav-scheduler')).toHaveAttribute('aria-current', 'page');
  await page.getByTestId('rail-security').click();
  await page.getByTestId('nav-hashing').click();
  await expect(page).toHaveURL(/\/tools\/hashing\/$/);
  await expect(page.getByTestId('rail-security')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('nav-hashing')).toHaveAttribute('aria-current', 'page');
  await expect(page.getByTestId('nav-timers')).toHaveCount(0);
});

test('the gear is pinned to the rail and opens Settings; the brand goes home', async ({ app }) => {
  const { page } = app;
  await page.getByTestId('nav-settings').click();
  await expect(page).toHaveURL(/\/settings\/$/);
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
  await expect(page.getByTestId('nav-settings')).toHaveAttribute('aria-current', 'page');
  // Preferences live on the same page now.
  await expect(page.getByTestId('pref-scheduler_week_start')).toBeVisible();
  // Settings is not a rail category: the flyout keeps showing tools.
  await expect(page.getByTestId('sidebar-flyout').getByRole('heading')).toHaveText('Time');

  await page.getByTestId('nav-brand').click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByTestId('nav-settings')).not.toHaveAttribute('aria-current', 'page');
});

test('the old /preferences/ address lands on Settings', async ({ app }) => {
  const { page } = app;
  await page.goto('/preferences/');
  await expect(page).toHaveURL(/\/settings\/$/, { timeout: 15_000 });
  await expect(page.getByTestId('pref-timer_alarm_seconds')).toBeVisible();
});

test('client-side navigation writes nothing', async ({ app }) => {
  const { page } = app;
  const before = await app.dumpAll();
  await page.getByTestId('nav-settings').click();
  await expect(page).toHaveURL(/\/settings\/$/);
  await page.getByTestId('nav-timers').click();
  await expect(page).toHaveURL(/\/tools\/timers\/$/);
  await page.getByTestId('nav-brand').click();
  await expect(page).toHaveURL(/\/$/);
  expect(await app.dumpAll()).toEqual(before);
});

test('ctrl+k opens the palette, fuzzy search navigates on Enter', async ({ app }) => {
  const { page } = app;
  await page.keyboard.press('Control+k');
  const input = page.getByTestId('palette-input');
  await expect(input).toBeFocused();

  await input.fill('sett');
  await expect(page.getByTestId('palette-option').first()).toContainText('Settings');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/settings\/$/);
  await expect(page.getByTestId('palette-input')).toHaveCount(0);
});

test('palette arrow keys move the selection', async ({ app }) => {
  const { page } = app;
  await page.keyboard.press('Control+k');
  const options = page.getByTestId('palette-option');
  await expect(options.first()).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('ArrowDown');
  await expect(options.nth(1)).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('ArrowUp');
  await expect(options.first()).toHaveAttribute('aria-selected', 'true');
});

test('the header search button opens the palette; focus is trapped and restored', async ({ app }) => {
  const { page } = app;
  await page.getByTestId('open-palette').click();
  const input = page.getByTestId('palette-input');
  await expect(input).toBeFocused();

  // The input is the dialog's only control — Tab must not escape it.
  await page.keyboard.press('Tab');
  await expect(input).toBeFocused();

  await page.keyboard.press('Escape');
  await expect(page.getByTestId('palette-input')).toHaveCount(0);
  await expect(page.getByTestId('open-palette')).toBeFocused();
});

test('desktop collapse keeps the rail, hides the list, and persists across a full reload', async ({
  app,
}) => {
  const { page } = app;
  const flyout = page.getByTestId('sidebar-flyout');
  const rail = page.getByTestId('sidebar-rail');
  await expect(flyout).toBeVisible();

  await page.getByTestId('sidebar-toggle').click();
  await expect(flyout).toBeHidden();
  await expect(rail).toBeVisible();
  await expect(page.getByTestId('nav-settings')).toBeVisible();

  await app.goto('/'); // full page load — the pre-paint script must reapply it
  await expect(page.getByTestId('sidebar-flyout')).toBeHidden();
  await expect(page.getByTestId('sidebar-rail')).toBeVisible();

  // A rail click while collapsed brings the list back, on that category.
  await page.getByTestId('rail-images').click();
  await expect(page.getByTestId('sidebar-flyout')).toBeVisible();
  await expect(page.getByTestId('sidebar-flyout').getByRole('heading')).toHaveText('Images');
  await expect(page.getByTestId('sidebar-toggle')).toHaveAttribute('aria-expanded', 'true');
});

test('collapse and pinned theme survive CLIENT-SIDE navigation', async ({ app }) => {
  const { page } = app;
  // ClientRouter wipes <html> attributes on every swap (swapRootAttributes);
  // the layout re-applies theme + collapse on astro:after-swap. This is the
  // regression test for that: the collapse test above only covers full loads.
  await page.getByTestId('nav-settings').click();
  await page.getByRole('button', { name: 'dark', exact: true }).click();
  await page.getByTestId('sidebar-toggle').click();
  await expect(page.getByTestId('sidebar-flyout')).toBeHidden();

  // Navigate client-side via the palette (the list is collapsed).
  await page.keyboard.press('Control+k');
  await page.getByTestId('palette-input').fill('timers');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/tools\/timers\/$/);

  await expect(page.getByTestId('sidebar-flyout')).toBeHidden();
  await expect
    .poll(() => page.evaluate(() => document.documentElement.style.colorScheme))
    .toBe('dark');

  // Restore for any test that reuses this context.
  await page.getByTestId('sidebar-toggle').click();
});

test('Escape closes only the topmost layer (palette over drawer)', async ({ app }) => {
  const { page } = app;
  await page.setViewportSize({ width: 360, height: 740 });
  await page.getByTestId('sidebar-toggle').click();
  await expect(page.locator('#app-sidebar')).toBeInViewport();

  await page.keyboard.press('Control+k');
  await expect(page.getByTestId('palette-input')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('palette-input')).toHaveCount(0);
  await expect(page.locator('#app-sidebar')).toBeInViewport(); // drawer survives

  await page.keyboard.press('Escape');
  await expect(page.locator('#app-sidebar')).not.toBeInViewport();
});

test('closed mobile drawer links are out of the tab order', async ({ app }) => {
  const { page } = app;
  await page.setViewportSize({ width: 360, height: 740 });
  // visibility:hidden rides with the off-canvas transform, so the links are
  // hidden from focus and the accessibility tree, not just moved off-screen.
  await expect(page.getByTestId('nav-timers')).toBeHidden();
  await expect(page.getByTestId('nav-settings')).toBeHidden();
  await page.getByTestId('sidebar-toggle').click();
  await expect(page.getByTestId('nav-timers')).toBeVisible();
  await expect(page.getByTestId('nav-settings')).toBeVisible();
});

test('below the breakpoint the sidebar is an off-canvas drawer', async ({ app }) => {
  const { page } = app;
  await page.setViewportSize({ width: 360, height: 740 });
  const sidebar = page.locator('#app-sidebar');
  await expect(sidebar).not.toBeInViewport();

  await page.getByTestId('sidebar-toggle').click();
  await expect(sidebar).toBeInViewport();

  // A rail click keeps the drawer open; a tool click closes it.
  await page.getByTestId('rail-devops').click();
  await expect(sidebar).toBeInViewport();
  await page.getByTestId('nav-crontab').click();
  await expect(page).toHaveURL(/\/tools\/crontab\/$/);
  await expect(sidebar).not.toBeInViewport(); // closes after navigating
});
