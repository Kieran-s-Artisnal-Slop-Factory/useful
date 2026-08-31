/**
 * Phase 3 (HTTP playground) — craft a request, send it, read what came back.
 *
 * The requests here are REAL: the test server grows `/__echo/*` routes and the
 * page fetches them the way a user would. They are same-origin because that is
 * the only kind a browser lets a page reach without the target opting in — so
 * these cases prove the SEND path, and the CORS classifier is unit-tested
 * against synthetic failures where its inputs can actually be controlled.
 *
 * The whole tool is stateless this phase, so every case ends by asserting the
 * database is byte-identical.
 */
import { test, expect } from './helpers/app';

type P = import('@playwright/test').Page;

const ECHO = 'http://127.0.0.1:4330/__echo';

/** Replace the JSON body. CodeMirror is contenteditable, not a textarea. */
async function typeJson(page: P, text: string) {
  const content = page.getByTestId('hp-json').locator('.cm-content');
  await content.click();
  await page.keyboard.press('ControlOrMeta+a');
  await content.fill(text);
}

async function sendTo(page: P, url: string) {
  await page.getByTestId('hp-url').fill(url);
  await page.getByTestId('hp-send').click();
}

test.describe('http playground', () => {
  test.slow(); // a real request and a CodeMirror pane per case

  test('sends a request and shows the answer, writing nothing', async ({ app }) => {
    const { page } = app;
    // Snapshot BEFORE navigating: loading the page is inside the window too.
    const before = await app.dumpAll();
    await app.goto('/tools/http-playground/');
    await expect(page.getByTestId('hp-idle')).toBeVisible();

    await sendTo(page, `${ECHO}/json`);
    await expect(page.getByTestId('hp-status')).toContainText('200');
    await expect(page.getByTestId('hp-status')).toContainText('success');
    await expect(page.getByTestId('hp-timing')).toContainText('ms');
    await expect(page.getByTestId('hp-size')).toContainText('bytes');

    // JSON is recognised and pretty-printed.
    await expect(page.getByTestId('hp-body-reason')).toContainText('pretty-printed');
    await expect(page.getByTestId('hp-body')).toContainText('"method": "GET"');

    // The response's own headers are listed.
    await expect(page.getByTestId('hp-response-header').first()).toBeVisible();

    expect(await app.dumpAll(), 'the HTTP playground wrote to the database').toEqual(before);
  });

  test('a forbidden header is flagged as you type — and really is dropped', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/http-playground/');
    const before = await app.dumpAll();
    // A URL first: an empty one is itself a blocker, and this test is about
    // what the HEADER does to the Send button.
    await page.getByTestId('hp-url').fill(`${ECHO}/json`);

    await page.getByTestId('hp-header-add').click();
    await page.getByTestId('hp-header-name-1').fill('Host');
    await page.getByTestId('hp-header-value-1').fill('evil.test');

    // A warning, not an error: the row is legal, the browser just will not
    // send it. Send stays available, which is the honest behaviour.
    const problem = page.getByTestId('hp-header-problem-1');
    await expect(problem).toHaveAttribute('data-kind', 'forbidden');
    await expect(problem).toContainText('dropped silently');
    await expect(page.getByTestId('hp-send')).toBeEnabled();

    // And the echo proves it: the header the browser set is there, ours is not.
    await sendTo(page, `${ECHO}/json`);
    await expect(page.getByTestId('hp-body')).toContainText('"host"');
    await expect(page.getByTestId('hp-body')).not.toContainText('evil.test');

    // An invalid name, by contrast, is an error and does block the send.
    await page.getByTestId('hp-header-name-1').fill('Bad Name');
    await expect(page.getByTestId('hp-header-problem-1')).toHaveAttribute('data-kind', 'name');
    await expect(page.getByTestId('hp-send')).toBeDisabled();
    await expect(page.getByTestId('hp-blockers')).toContainText('header name');

    expect(await app.dumpAll()).toEqual(before);
  });

  test('a JSON body is checked before it is sent, not after', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/http-playground/');
    const before = await app.dumpAll();

    await page.getByTestId('hp-url').fill(`${ECHO}/json`);
    await page.getByTestId('hp-method').selectOption('POST');
    await page.getByTestId('hp-body-kind').selectOption('json');
    await typeJson(page, '{ "broken": ');

    await expect(page.getByTestId('hp-json-error')).toBeVisible();
    await expect(page.getByTestId('hp-send')).toBeDisabled();

    // Fixed, it goes — and comes back echoed, with the type the kind implies.
    await typeJson(page, '{"hello":"world"}');
    await expect(page.getByTestId('hp-send')).toBeEnabled();
    await sendTo(page, `${ECHO}/json`);
    await expect(page.getByTestId('hp-body')).toContainText('"method": "POST"');
    await expect(page.getByTestId('hp-body')).toContainText('hello');
    await expect(page.getByTestId('hp-body')).toContainText('application/json');

    expect(await app.dumpAll()).toEqual(before);
  });

  test('a form body shows the exact bytes it will send', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/http-playground/');
    const before = await app.dumpAll();

    await page.getByTestId('hp-method').selectOption('POST');
    await page.getByTestId('hp-body-kind').selectOption('form');
    await page.getByTestId('hp-field-add').click();
    await page.getByTestId('hp-field-name-0').fill('q');
    await page.getByTestId('hp-field-value-0').fill('two words & more');

    // The encoding is shown rather than left to be discovered server-side.
    await expect(page.getByTestId('hp-form-encoded')).toHaveText('q=two+words+%26+more');

    await sendTo(page, `${ECHO}/json`);
    await expect(page.getByTestId('hp-body')).toContainText('q=two+words+%26+more');
    await expect(page.getByTestId('hp-body')).toContainText('x-www-form-urlencoded');

    expect(await app.dumpAll()).toEqual(before);
  });

  test('the bytes decide what a body is, not the header', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/http-playground/');
    const before = await app.dumpAll();

    // This route serves a PNG under `content-type: text/plain`, on purpose.
    await sendTo(page, `${ECHO}/binary`);
    await expect(page.getByTestId('hp-status')).toContainText('200');

    await expect(page.getByTestId('hp-disagreement')).toContainText('image/png');
    await expect(page.getByTestId('hp-disagreement')).toContainText('the bytes are the evidence');

    // Binary gets a download and NO viewer, exactly as specified.
    await expect(page.getByTestId('hp-download')).toContainText('response.png');
    await expect(page.getByTestId('hp-body')).toHaveCount(0);

    const downloadPromise = page.waitForEvent('download');
    await page.getByTestId('hp-download').click();
    expect((await downloadPromise).suggestedFilename()).toBe('response.png');

    expect(await app.dumpAll()).toEqual(before);
  });

  test('HTML is source first, and its preview runs with no origin', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/http-playground/');
    const before = await app.dumpAll();

    await sendTo(page, `${ECHO}/html`);
    await expect(page.getByTestId('hp-body-reason')).toContainText('source by default');
    await expect(page.getByTestId('hp-body')).toContainText('<h1>From the server</h1>');

    await page.getByTestId('hp-render-html').click();
    const frame = page.locator('iframe[title="Response preview"]');
    await expect(frame).toHaveAttribute('sandbox', 'allow-scripts');
    // A stranger's HTML must never get allow-same-origin: with scripts, the
    // two together let the framed document remove its own sandbox.
    expect(await frame.getAttribute('sandbox')).not.toContain('allow-same-origin');
    await expect(
      page.frameLocator('iframe[title="Response preview"]').locator('h1')
    ).toHaveText('From the server');
    await expect(page.getByTestId('hp-preview-note')).toContainText('no origin of its own');

    // And back to source.
    await page.getByTestId('hp-render-html').click();
    await expect(page.getByTestId('hp-body')).toContainText('<h1>');

    expect(await app.dumpAll()).toEqual(before);
  });

  test('a 404 is an answer, not a failure', async ({ app }) => {
    const { page } = app;
    // The browser logs a failed resource load for any non-2xx fetch, whoever
    // asked for it — and fetching one is the feature here.
    app.expectConsoleError(/Failed to load resource.*404/i);
    await app.goto('/tools/http-playground/');
    const before = await app.dumpAll();

    await sendTo(page, `${ECHO}/status/404`);
    await expect(page.getByTestId('hp-status')).toContainText('404');
    await expect(page.getByTestId('hp-status')).toContainText('client error');
    // No diagnosis card: nothing went wrong, the server said no.
    await expect(page.getByTestId('hp-failure')).toHaveCount(0);

    expect(await app.dumpAll()).toEqual(before);
  });

  test('a body that claims JSON and is not says so, without hiding it', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/http-playground/');

    await sendTo(page, `${ECHO}/broken`);
    await expect(page.getByTestId('hp-body-reason')).toContainText('does not parse');
    // The body is still shown — it is what came back, however malformed.
    await expect(page.getByTestId('hp-body')).toContainText('almost');
  });

  test('Cancel really stops a request in flight', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/http-playground/');
    const before = await app.dumpAll();

    await sendTo(page, `${ECHO}/slow`);
    await expect(page.getByTestId('hp-busy')).toBeVisible();
    await page.getByTestId('hp-cancel').click();

    const failure = page.getByTestId('hp-failure');
    await expect(failure).toHaveAttribute('data-kind', 'aborted');
    await expect(failure).toContainText('Nothing was received');
    // Cancelling returns the page to a state you can send from again.
    await expect(page.getByTestId('hp-send')).toBeVisible();

    expect(await app.dumpAll()).toEqual(before);
  });

  test('a bodyless method says so instead of failing at send time', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/http-playground/');

    await expect(page.getByTestId('hp-no-body')).toContainText('carry no body');
    await page.getByTestId('hp-method').selectOption('POST');
    await expect(page.getByTestId('hp-no-body')).toHaveCount(0);
    await expect(page.getByTestId('hp-body-kind')).toBeVisible();
  });

  test('the URL is checked before anything is attempted', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/http-playground/');

    // Empty to start with: nothing to send to.
    await expect(page.getByTestId('hp-send')).toBeDisabled();

    await page.getByTestId('hp-url').fill('example.test/thing');
    await expect(page.getByTestId('hp-blockers')).toContainText('scheme');

    await page.getByTestId('hp-url').fill('file:///etc/passwd');
    await expect(page.getByTestId('hp-blockers')).toContainText('file:');
    await expect(page.getByTestId('hp-send')).toBeDisabled();

    await page.getByTestId('hp-url').fill(`${ECHO}/json`);
    await expect(page.getByTestId('hp-send')).toBeEnabled();
  });
});
