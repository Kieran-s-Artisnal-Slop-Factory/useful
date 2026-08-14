/**
 * Navigation chrome: sidebar, mobile drawer, and the ctrl+k quick-action
 * palette. Runs against the production build like the data suite, so client-
 * side view transitions and the service worker are the real thing.
 */
import { test, expect } from './helpers/app';

test('sidebar navigates between pages and tracks the active page', async ({ app }) => {
  const { page } = app;
  await page.getByTestId('nav-settings').click();
  await expect(page).toHaveURL(/\/settings\/$/);
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
  await expect(page.getByTestId('nav-settings')).toHaveAttribute('aria-current', 'page');
  await expect(page.getByTestId('nav-home')).not.toHaveAttribute('aria-current', 'page');

  await page.getByTestId('nav-preferences').click();
  await expect(page).toHaveURL(/\/preferences\/$/);
  await expect(page.getByTestId('nav-preferences')).toHaveAttribute('aria-current', 'page');
});

test('client-side navigation writes nothing', async ({ app }) => {
  const { page } = app;
  const before = await app.dumpAll();
  await page.getByTestId('nav-settings').click();
  await expect(page).toHaveURL(/\/settings\/$/);
  await page.getByTestId('nav-preferences').click();
  await expect(page).toHaveURL(/\/preferences\/$/);
  await page.getByTestId('nav-home').click();
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

test('desktop sidebar collapse persists across a full reload', async ({ app }) => {
  const { page } = app;
  const sidebar = page.locator('#app-sidebar');
  await expect(sidebar).toBeVisible();

  await page.getByTestId('sidebar-toggle').click();
  await expect(sidebar).toBeHidden();

  await app.goto('/'); // full page load — the pre-paint script must reapply it
  await expect(page.locator('#app-sidebar')).toBeHidden();

  await page.getByTestId('sidebar-toggle').click();
  await expect(page.locator('#app-sidebar')).toBeVisible();
});

test('collapse and pinned theme survive CLIENT-SIDE navigation', async ({ app }) => {
  const { page } = app;
  // ClientRouter wipes <html> attributes on every swap (swapRootAttributes);
  // the layout re-applies theme + collapse on astro:after-swap. This is the
  // regression test for that: the collapse test above only covers full loads.
  await page.getByTestId('nav-settings').click();
  await page.getByRole('button', { name: 'dark', exact: true }).click();
  await page.getByTestId('sidebar-toggle').click();
  await expect(page.locator('#app-sidebar')).toBeHidden();

  // Navigate client-side via the palette (the sidebar is collapsed).
  await page.keyboard.press('Control+k');
  await page.getByTestId('palette-input').fill('home');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/$/);

  await expect(page.locator('#app-sidebar')).toBeHidden();
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
  await expect(page.getByTestId('nav-home')).toBeHidden();
  await page.getByTestId('sidebar-toggle').click();
  await expect(page.getByTestId('nav-home')).toBeVisible();
});

test('below the breakpoint the sidebar is an off-canvas drawer', async ({ app }) => {
  const { page } = app;
  await page.setViewportSize({ width: 360, height: 740 });
  const sidebar = page.locator('#app-sidebar');
  await expect(sidebar).not.toBeInViewport();

  await page.getByTestId('sidebar-toggle').click();
  await expect(sidebar).toBeInViewport();

  await page.getByTestId('nav-preferences').click();
  await expect(page).toHaveURL(/\/preferences\/$/);
  await expect(sidebar).not.toBeInViewport(); // closes after navigating
});
