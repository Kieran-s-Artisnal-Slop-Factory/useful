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

  test('media is offered behind a button, and nothing decodes before it', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/http-playground/');
    const before = await app.dumpAll();

    await sendTo(page, `${ECHO}/image`);
    await expect(page.getByTestId('hp-status')).toContainText('200');

    // The download never goes away — the preview is an addition to it.
    await expect(page.getByTestId('hp-download')).toContainText('response.png');
    // Nothing is on screen until it is asked for.
    await expect(page.getByTestId('hp-media-image')).toHaveCount(0);

    const show = page.getByTestId('hp-show-media');
    await expect(show).toHaveText('Show image');
    await show.click();

    const image = page.getByTestId('hp-media-image');
    await expect(image).toBeVisible();
    // Really decoded, not merely mounted: a broken src has no intrinsic size.
    // Polled, because decoding is asynchronous however small the image is.
    await expect
      .poll(() => image.evaluate((el: HTMLImageElement) => el.naturalWidth))
      .toBeGreaterThan(0);
    // The blob is this app's own bytes, not a second trip to the server.
    expect(await image.getAttribute('src')).toMatch(/^blob:/);

    await expect(show).toHaveText('Hide preview');
    await show.click();
    await expect(page.getByTestId('hp-media-image')).toHaveCount(0);

    expect(await app.dumpAll()).toEqual(before);
  });

  test('a format the browser cannot draw says so instead of offering a blank box', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/http-playground/');

    await sendTo(page, `${ECHO}/tiff`);
    await expect(page.getByTestId('hp-download')).toContainText('response.tiff');
    await expect(page.getByTestId('hp-show-media')).toHaveCount(0);
    await expect(page.getByTestId('hp-unrenderable')).toContainText('no mainstream browser draws one');
  });

  test('audio plays in the page, from the bytes already in hand', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/http-playground/');

    await sendTo(page, `${ECHO}/audio`);
    await expect(page.getByTestId('hp-download')).toContainText('response.wav');
    await page.getByTestId('hp-show-media').click();

    const audio = page.getByTestId('hp-media-audio');
    await expect(audio).toBeVisible();
    // Decoded rather than merely mounted: a duration means the browser read it.
    await expect
      .poll(() => audio.evaluate((el: HTMLAudioElement) => el.duration))
      .toBeGreaterThan(0);
    expect(await audio.evaluate((el: HTMLAudioElement) => el.error)).toBeNull();
  });

  /**
   * The one frame in the app without a sandbox, so the reason had better be
   * on the page: Chrome refuses to start its PDF viewer inside a sandboxed
   * frame at ANY setting — `allow-same-origin` included — and the choice was
   * that or a blank box.
   *
   * **What this test cannot check:** whether the PDF actually draws. The PDF
   * viewer is a Chrome component, not a Chromium one, and Playwright's
   * Chromium has none — the frame here stays an empty `text/html` document
   * whatever the bytes are. Rendering was verified by hand in the app's own
   * browser; what is asserted below is everything that IS decidable here, and
   * the missing half is named rather than quietly skipped.
   */
  test('a PDF is handed to the browser’s own viewer, with the trade-off stated', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/http-playground/');

    await sendTo(page, `${ECHO}/pdf`);
    await expect(page.getByTestId('hp-show-media')).toHaveText('Show PDF');
    await page.getByTestId('hp-show-media').click();

    const frame = page.getByTestId('hp-media-pdf');
    await expect(frame).toBeVisible();
    // Our own bytes, not a second trip to the server.
    expect(await frame.getAttribute('src')).toMatch(/^blob:/);
    // The exception is deliberate, and it is the only one — see the note.
    expect(await frame.getAttribute('sandbox')).toBeNull();
    await expect(page.getByTestId('hp-media-pdf-note')).toContainText('not sandboxed');
  });

  /**
   * And the general rule the PDF is an exception to: every OTHER frame in the
   * playground is sandboxed with no origin of its own. This fails if someone
   * widens the PDF exception to cover the HTML preview too.
   */
  test('the PDF exception did not spread to the HTML preview', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/http-playground/');

    await sendTo(page, `${ECHO}/html`);
    await page.getByTestId('hp-render-html').click();
    const frame = page.locator('iframe[title="Response preview"]');
    await expect(frame).toHaveAttribute('sandbox', 'allow-scripts');
  });

  test('textual bodies are highlighted, and the text survives it exactly', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/http-playground/');
    const before = await app.dumpAll();

    const cases = [
      { path: 'css', reason: 'highlighted as CSS', body: '.card > p {\n  color: #ff0000; /* red */\n}\n' },
      { path: 'js', reason: 'highlighted as JavaScript', body: 'const greet = (who) => `hello ${who}`;\n' },
      { path: 'markdown', reason: 'highlighted as Markdown', body: '# Title\n\nSome *emphasis* and `code`.\n' },
    ];

    for (const item of cases) {
      await sendTo(page, `${ECHO}/${item.path}`);
      await expect(page.getByTestId('hp-body-reason')).toContainText(item.reason);
      const body = page.getByTestId('hp-body');
      // The colours are decoration; the bytes are the point. A highlighter
      // that drops a character is worse than none, because nothing says so.
      await expect(body).toHaveText(item.body);
      expect(
        await body.locator('span[class*="token"]').count(),
        `${item.path} produced no tokens`
      ).toBeGreaterThan(0);
    }

    // XML is the same grammar but must not be CALLED HTML.
    await sendTo(page, `${ECHO}/xml`);
    await expect(page.getByTestId('hp-body-reason')).toContainText('XML.');
    await expect(page.getByTestId('hp-body-reason')).not.toContainText('HTML');
    await expect(page.getByTestId('hp-body').locator('span.token.prolog')).toHaveText(
      '<?xml version="1.0"?>'
    );

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

  /**
   * The case a user reported as a bug in this tool: one URL from a host works
   * and the next one does not, because the server attaches the CORS header
   * per file type. The old answer — "most likely CORS", flagged as a guess —
   * was true and useless, because they had just watched that host answer.
   *
   * `localhost` and `127.0.0.1` are different origins to a browser and the
   * same server to the OS, which is what makes a real cross-origin failure
   * reproducible in a suite with one process in it.
   */
  test('a host that already answered gets a diagnosis, not a guess', async ({ app }) => {
    const { page } = app;
    app.expectConsoleError(/Failed to load resource|Access-Control-Allow-Origin|CORS/i);
    await app.goto('/tools/http-playground/');

    const other = 'http://localhost:4330/__echo';

    // Before anything is known about the host, it can only guess.
    await sendTo(page, `${other}/json`);
    const failure = page.getByTestId('hp-failure');
    await expect(failure).toHaveAttribute('data-kind', 'cors');
    await expect(failure).toContainText('Most likely CORS');
    await expect(page.getByTestId('hp-failure-guess')).toBeVisible();
    // Even here it raises the per-resource possibility, which is the one that
    // makes people go looking for a bug in the client.
    await expect(failure).toContainText('per resource');

    // Now prove the host: this route DOES share itself.
    await sendTo(page, `${other}/cors-ok`);
    await expect(page.getByTestId('hp-status')).toContainText('200');

    // The very same failing request now gets a sharp answer instead.
    await sendTo(page, `${other}/json`);
    await expect(failure).toContainText('only for this resource');
    await expect(failure).toContainText('already answered');
    await expect(failure).toContainText('Nothing about the request you just built is wrong');
    // It is no longer a guess, so the badge is gone.
    await expect(page.getByTestId('hp-failure-guess')).toHaveCount(0);
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

  // --- Phase 4: environments, variables, secrets ---------------------------

  /** Open the management card and put one variable in the Global scope. */
  async function addGlobalVariable(page: P, name: string, value: string) {
    await page.getByTestId('hp-env-card').evaluate((el) => ((el as HTMLDetailsElement).open = true));
    await page.getByTestId('hp-var-new-name').fill(name);
    await page.getByTestId('hp-var-new-value').fill(value);
    await page.getByTestId('hp-var-add').click();
    await expect(page.getByTestId(`hp-var-value-${name}`)).toHaveValue(value);
  }

  async function addSecret(page: P, name: string, value: string) {
    await page.getByTestId('hp-env-card').evaluate((el) => ((el as HTMLDetailsElement).open = true));
    await page.getByTestId('hp-secret-new-name').fill(name);
    await page.getByTestId('hp-secret-new-value').fill(value);
    await page.getByTestId('hp-secret-add').click();
    await expect(page.getByTestId(`hp-secret-value-${name}`)).toBeVisible();
  }

  test('a variable is resolved into the request that actually goes out', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/http-playground/');

    await addGlobalVariable(page, 'base_url', 'http://127.0.0.1:4330');
    await page.getByTestId('hp-url').fill('{{base_url}}/__echo/json');

    // The panel says where it came from before anything is sent.
    await page.getByTestId('hp-vars-section').evaluate((el) => ((el as HTMLDetailsElement).open = true));
    const row = page.getByTestId('hp-vars-row').first();
    await expect(row).toContainText('base_url');
    await expect(row).toContainText('Global');

    await page.getByTestId('hp-send').click();
    // The echo proves the resolved URL is what was fetched.
    await expect(page.getByTestId('hp-status')).toContainText('200');
    await expect(page.getByTestId('hp-body')).toContainText('"method": "GET"');
  });

  /** Decision 2 — the bug the whole feature exists to prevent. */
  test('a missing variable blocks the send and names it', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/http-playground/');

    await page.getByTestId('hp-url').fill('{{nowhere}}/things');
    await expect(page.getByTestId('hp-send')).toBeDisabled();
    await expect(page.getByTestId('hp-blockers')).toContainText('nowhere');
    // And it is named as a URL problem, not as "that is not a valid URL" —
    // the placeholder is the cause, and the shape of the text is a symptom.
    await expect(page.getByTestId('hp-blockers')).toContainText('URL:');
    await expect(page.getByTestId('hp-blockers')).not.toContainText('needs a scheme');

    await addGlobalVariable(page, 'nowhere', 'http://127.0.0.1:4330');
    await expect(page.getByTestId('hp-send')).toBeEnabled();
  });

  test('offers to create the variables a request needs, and marks them empty', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/http-playground/');

    await page.getByTestId('hp-url').fill('{{base_url}}/things/{{thing_id}}');
    await page.getByTestId('hp-header-value-0').fill('Bearer {{token}}');

    // Three distinct names, offered as one write.
    const offer = page.getByTestId('hp-missing-vars');
    await expect(offer).toContainText('base_url');
    await expect(offer).toContainText('thing_id');
    await expect(offer).toContainText('token');
    await expect(page.getByTestId('hp-add-missing-vars')).toContainText('Add 3 variables');
    await expect(page.getByTestId('hp-send')).toBeDisabled();

    const before = await app.dumpAll();
    await page.getByTestId('hp-add-missing-vars').click();
    await expect(page.getByTestId('hp-notice')).toContainText('Added 3 empty variables');

    // One row written, not three.
    const after = await app.dumpAll();
    expect(after.http_environments).toHaveLength(before.http_environments!.length + 1);
    expect((after.http_environments![0] as { values: Record<string, string> }).values).toEqual({
      base_url: '',
      thing_id: '',
      token: '',
    });

    // The offer is gone, and nothing is left to add.
    await expect(page.getByTestId('hp-missing-vars')).toHaveCount(0);

    // They resolve now — and the panel says loudly that they resolve to
    // NOTHING, which is the trade this button makes.
    await page.getByTestId('hp-vars-section').evaluate((el) => ((el as HTMLDetailsElement).open = true));
    const blank = page.getByTestId('hp-vars-blank');
    await expect(blank).toContainText('3 variables resolve to nothing');
    await expect(blank).toContainText('base_url');
    await expect(page.getByTestId('hp-vars-blank-cell').first()).toHaveText('(empty)');

    // An empty variable INSIDE the URL leaves it unsendable, and the blocker
    // blames the variable rather than the address the user did not type.
    await expect(page.getByTestId('hp-blockers')).toContainText('resolved to nothing');
    await expect(page.getByTestId('hp-blockers')).toContainText('base_url');

    // Filling them in takes them off the list and unblocks the send.
    await page.getByTestId('hp-env-card').evaluate((el) => ((el as HTMLDetailsElement).open = true));
    await page.getByTestId('hp-var-value-thing_id').fill('42');
    await page.getByTestId('hp-var-value-thing_id').blur();
    await expect(page.getByTestId('hp-vars-blank')).toContainText('2 variables');
    await expect(page.getByTestId('hp-vars-blank')).not.toContainText('thing_id');

    await page.getByTestId('hp-var-value-base_url').fill(ECHO);
    await page.getByTestId('hp-var-value-base_url').blur();
    await page.getByTestId('hp-var-value-token').fill('t');
    await page.getByTestId('hp-var-value-token').blur();
    await expect(page.getByTestId('hp-vars-blank')).toHaveCount(0);
    await expect(page.getByTestId('hp-send')).toBeEnabled();
  });

  test('a placeholder links to the row it is set in', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/http-playground/');

    await page.getByTestId('hp-url').fill('{{base_url}}/things/{{slug}}');
    await page.getByTestId('hp-add-missing-vars').click();
    await page.getByTestId('hp-vars-section').evaluate((el) => ((el as HTMLDetailsElement).open = true));
    // Shut the card again, so the jump has to open it to get anywhere.
    await page.getByTestId('hp-env-card').evaluate((el) => ((el as HTMLDetailsElement).open = false));

    await page.getByTestId('hp-vars-jump-slug').click();

    await expect(page.getByTestId('hp-env-card')).toHaveAttribute('open', /.*/);
    const row = page.locator('#hp-var-row-slug');
    await expect(row).toBeVisible();
    // Two pulses, and the row is really the one animating.
    expect(
      await row.evaluate((el) =>
        [...el.children].flatMap((c) => c.getAnimations()).map((a) => a.effect?.getTiming().iterations)
      )
    ).toContain(2);
    // It lands somewhere you can immediately type, by pointer or keyboard.
    await expect(page.getByTestId('hp-var-value-slug')).toBeFocused();
  });

  test('jumping to a secret goes to its row without revealing it', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/http-playground/');

    await addSecret(page, 'api_key', 'sk-live-STILL-HIDDEN');
    await page.getByTestId('hp-header-value-0').fill('Bearer {{api_key}}');
    await page.getByTestId('hp-vars-section').evaluate((el) => ((el as HTMLDetailsElement).open = true));
    await page.getByTestId('hp-env-card').evaluate((el) => ((el as HTMLDetailsElement).open = false));

    await page.getByTestId('hp-vars-jump-api_key').click();

    await expect(page.locator('#hp-secret-row-api_key')).toBeVisible();
    // Being taken to a secret is not the same as being shown one.
    await expect(page.getByTestId('hp-secret-value-api_key')).not.toContainText('sk-live');
  });

  test('the button does not offer a name a secret already covers', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/http-playground/');

    await addSecret(page, 'token', 'sk-live-COVERED');
    await page.getByTestId('hp-url').fill(`${ECHO}/json?t={{token}}`);
    // Nothing missing: the secret supplies it, and offering to shadow it with
    // an empty variable would be actively harmful.
    await expect(page.getByTestId('hp-missing-vars')).toHaveCount(0);

    await page.getByTestId('hp-url').fill(`${ECHO}/json?t={{token}}&u={{other}}`);
    await expect(page.getByTestId('hp-add-missing-vars')).toContainText('Add 1 variable');
    await expect(page.getByTestId('hp-missing-vars')).not.toContainText('token');
  });

  test('switching environments changes what is transmitted', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/http-playground/');

    await addGlobalVariable(page, 'flavour', 'from-global');

    // A second environment, with the same name pointing somewhere else.
    await page.getByTestId('hp-env-new').fill('Staging');
    await page.getByTestId('hp-env-add').click();
    await expect(page.getByTestId('hp-env-active')).toHaveValue(/.+/);
    await page.getByTestId('hp-var-new-name').fill('flavour');
    await page.getByTestId('hp-var-new-value').fill('from-staging');
    await page.getByTestId('hp-var-add').click();

    await page.getByTestId('hp-url').fill(`${ECHO}/json?f={{flavour}}`);
    await page.getByTestId('hp-send').click();
    await expect(page.getByTestId('hp-body')).toContainText('from-staging');

    // Back to Global only, and the very same request sends something else.
    await page.getByTestId('hp-env-active').selectOption('');
    await page.getByTestId('hp-send').click();
    await expect(page.getByTestId('hp-body')).toContainText('from-global');
  });

  /**
   * The assertion the whole storage split exists for. `http_secrets` is not
   * in `STORES`, so the exporter cannot reach it — this proves the promise
   * rather than trusting the arrangement that makes it true.
   */
  test('a secret never reaches a backup', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/http-playground/');

    const value = 'sk-live-NEVER-IN-A-BACKUP-42';
    await addSecret(page, 'api_key', value);

    // It really was stored — this is not passing because nothing was written.
    const stored = await app.call<{ name: string; value: string }[]>('rawDump', 'http_secrets');
    expect(stored.map((row) => row.name)).toContain('api_key');
    expect(stored.map((row) => row.value)).toContain(value);

    // And the backup file has no trace of the value.
    const backup = await app.call<unknown>('exportData');
    const text = JSON.stringify(backup);
    expect(text, 'the secret value reached the backup envelope').not.toContain(value);
    expect(text).not.toContain('http_secrets');

    // Masked in the UI too, until asked for one row at a time.
    await expect(page.getByTestId('hp-secret-value-api_key')).not.toContainText(value);
    await page.getByTestId('hp-secret-reveal-api_key').click();
    await expect(page.getByTestId('hp-secret-value-api_key')).toHaveText(value);
  });

  test('a secret resolves for real while never being shown', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/http-playground/');

    await addSecret(page, 'token', 'sk-live-SHOWN-NOWHERE');
    await page.getByTestId('hp-url').fill(`${ECHO}/json`);
    await page.getByTestId('hp-header-value-0').fill('Bearer {{token}}');

    await page.getByTestId('hp-vars-section').evaluate((el) => ((el as HTMLDetailsElement).open = true));
    // Masked in the table and in the "what will be sent" preview.
    await expect(page.getByTestId('hp-vars-masked').first()).toBeVisible();
    await expect(page.getByTestId('hp-vars-row').first()).toContainText('secrets');
    await expect(page.getByTestId('hp-vars-preview')).not.toContainText('sk-live');

    // And the server got the real thing, which is the point of a secret.
    await page.getByTestId('hp-send').click();
    await expect(page.getByTestId('hp-body')).toContainText('Bearer sk-live-SHOWN-NOWHERE');
  });

  test('saving a request writes one row, and keeps its placeholders', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/http-playground/');
    const before = await app.dumpAll();

    await page.getByTestId('hp-url').fill('{{base_url}}/things');
    await page.getByTestId('hp-library-card').evaluate((el) => ((el as HTMLDetailsElement).open = true));
    await page.getByTestId('hp-name').fill('List things');
    await page.getByTestId('hp-save').click();
    await expect(page.getByTestId('hp-notice')).toContainText('template');

    const after = await app.dumpAll();
    const rows = after.http_requests!;
    expect(rows).toHaveLength(before.http_requests!.length + 1);
    const row = rows[0] as { name: string; request: { url: string } };
    expect(row.name).toBe('List things');
    // UNRESOLVED, which is what makes a saved request safe to back up.
    expect(row.request.url).toBe('{{base_url}}/things');

    // Reopening it restores the template, not a rendered copy.
    await page.getByTestId('hp-new').click();
    await expect(page.getByTestId('hp-url')).toHaveValue('');
    await page.getByTestId('hp-open-List things').click();
    await expect(page.getByTestId('hp-url')).toHaveValue('{{base_url}}/things');
  });

  test('exporting an environment lists secret names and no secret values', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/http-playground/');

    await addGlobalVariable(page, 'base_url', 'https://api.example.com');
    await addSecret(page, 'api_key', 'sk-live-NOT-IN-THE-FILE');

    const downloadPromise = page.waitForEvent('download');
    await page.getByTestId('hp-env-export').click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe('global.http-environment.json');

    const stream = await download.createReadStream();
    const text = await new Promise<string>((resolve, reject) => {
      let out = '';
      stream.on('data', (chunk) => (out += chunk));
      stream.on('end', () => resolve(out));
      stream.on('error', reject);
    });
    const file = JSON.parse(text) as { values: Record<string, unknown>; secret_names: string[]; note: string };
    expect(file.values).toEqual({ base_url: 'https://api.example.com' });
    // The name is useful — it tells the reader what to fill in. The value is not.
    expect(file.secret_names).toEqual(['api_key']);
    expect(file.note).toContain('deliberately not in this file');
    expect(text).not.toContain('sk-live-NOT-IN-THE-FILE');
  });

  test('deleting an environment takes its secrets with it, values and all', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/http-playground/');

    await page.getByTestId('hp-env-card').evaluate((el) => ((el as HTMLDetailsElement).open = true));
    await page.getByTestId('hp-env-new').fill('Throwaway');
    await page.getByTestId('hp-env-add').click();
    await page.getByTestId('hp-secret-new-name').fill('temp_key');
    await page.getByTestId('hp-secret-new-value').fill('sk-live-GOES-AWAY');
    await page.getByTestId('hp-secret-add').click();
    await expect(page.getByTestId('hp-secret-value-temp_key')).toBeVisible();

    page.once('dialog', (dialog) => void dialog.accept());
    await page.getByTestId('hp-env-delete').click();
    await expect(page.getByTestId('hp-notice')).toContainText('secrets with it');

    // Gone for real, not tombstoned: a tombstone keeps the value, and
    // "delete a secret" has to mean the bytes are not there any more.
    const stored = await app.call<unknown[]>('rawDump', 'http_secrets');
    expect(JSON.stringify(stored)).not.toContain('sk-live-GOES-AWAY');
    expect(stored).toHaveLength(0);
  });

  // --- Phase 5: multi-step flows -------------------------------------------

  /** Save the request currently in the card, under `name`. */
  async function saveCurrentAs(page: P, name: string) {
    await page.getByTestId('hp-library-card').evaluate((el) => ((el as HTMLDetailsElement).open = true));
    await page.getByTestId('hp-name').fill(name);
    await page.getByTestId('hp-save').click();
    await expect(page.getByTestId(`hp-open-${name}`)).toBeVisible();
    await page.getByTestId('hp-new').click();
  }

  /**
   * The TODO's example, for real: authenticate against one endpoint, use the
   * token on the next. `/__echo/me` answers 401 without the exact token, so
   * this cannot pass by coincidence.
   */
  test('a flow carries a token from one step into the next', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/http-playground/');

    // Two saved requests for the two steps.
    await page.getByTestId('hp-method').selectOption('POST');
    await page.getByTestId('hp-url').fill(`${ECHO}/auth`);
    await saveCurrentAs(page, 'Log in');

    await page.getByTestId('hp-url').fill(`${ECHO}/me`);
    await page.getByTestId('hp-header-name-0').fill('Authorization');
    await page.getByTestId('hp-header-value-0').fill('Bearer {{token}}');
    await saveCurrentAs(page, 'Who am I');

    // A flow, which arrives with the auth-then-GET example sketched in.
    await page.getByTestId('hp-flows-card').evaluate((el) => ((el as HTMLDetailsElement).open = true));
    await page.getByTestId('hp-flow-new').fill('Log in then fetch');
    await page.getByTestId('hp-flow-add').click();
    await expect(page.getByTestId('hp-flow-step')).toHaveCount(2);
    // The starter rule is already there — this is the thing the plan asked for.
    await expect(page.getByTestId('hp-rule-path-0-0')).toHaveValue('token');
    await expect(page.getByTestId('hp-rule-name-0-0')).toHaveValue('token');

    await page.getByTestId('hp-step-request-0').selectOption({ label: 'Log in' });
    await page.getByTestId('hp-step-request-1').selectOption({ label: 'Who am I' });

    await page.getByTestId('hp-flow-run').click();

    // Step one produced the token…
    await expect(page.getByTestId('hp-step-extracted').first()).toContainText('flow-token-abc');
    await expect(page.getByTestId('hp-step-status-0')).toContainText('200');
    // …and step two got in with it, which is only possible if it was carried.
    await expect(page.getByTestId('hp-step-status-1')).toContainText('200');
    await expect(page.getByTestId('hp-step-record-1')).toContainText('the authenticated one');
    await expect(page.getByTestId('hp-step-failure-1')).toHaveCount(0);

    // The live run shows the real token; the STORED copy does not. A token is
    // a live credential, and a flow row rides backups.
    const rows = await app.dump('http_flows');
    expect(JSON.stringify(rows), 'a live token reached the stored row').not.toContain(
      'flow-token-abc'
    );
    expect(JSON.stringify(rows)).toContain('••••••••');
    await expect(page.getByTestId('hp-flow-record-note')).toContainText('recorded copy does');
  });

  test('a flow records both steps onto one row, and nothing else', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/http-playground/');

    await page.getByTestId('hp-url').fill(`${ECHO}/auth`);
    await saveCurrentAs(page, 'Log in');

    await page.getByTestId('hp-flows-card').evaluate((el) => ((el as HTMLDetailsElement).open = true));
    await page.getByTestId('hp-flow-new').fill('One step');
    await page.getByTestId('hp-flow-add').click();
    await page.getByTestId('hp-step-remove-1').click();
    await page.getByTestId('hp-step-request-0').selectOption({ label: 'Log in' });

    const before = await app.dumpAll();
    await page.getByTestId('hp-flow-run').click();
    await expect(page.getByTestId('hp-step-status-0')).toContainText('200');

    const after = await app.dumpAll();
    // Running writes the record onto the flow row and touches nothing else.
    expect(Object.keys(after)).toEqual(Object.keys(before));
    for (const [store, rows] of Object.entries(after)) {
      if (store === 'http_flows') continue;
      expect(rows, `${store} changed during a flow run`).toEqual(before[store]);
    }
    const flow = after.http_flows![0] as { last_run: { records: unknown[]; ok: boolean } };
    expect(flow.last_run.ok).toBe(true);
    expect(flow.last_run.records).toHaveLength(1);
  });

  /** The record has to be safe to back up, which means masked on the way in. */
  test('a recorded run never holds the secret it sent', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/http-playground/');

    const value = 'sk-live-NEVER-IN-A-RECORD';
    await addSecret(page, 'token', value);

    await page.getByTestId('hp-url').fill(`${ECHO}/json`);
    await page.getByTestId('hp-header-name-0').fill('Authorization');
    await page.getByTestId('hp-header-value-0').fill('Bearer {{token}}');
    await saveCurrentAs(page, 'Send the secret');

    await page.getByTestId('hp-flows-card').evaluate((el) => ((el as HTMLDetailsElement).open = true));
    await page.getByTestId('hp-flow-new').fill('Secret carrier');
    await page.getByTestId('hp-flow-add').click();
    await page.getByTestId('hp-step-remove-1').click();
    await page.getByTestId('hp-step-request-0').selectOption({ label: 'Send the secret' });
    await page.getByTestId('hp-flow-run').click();
    await expect(page.getByTestId('hp-step-status-0')).toContainText('200');

    // The stored row: masked. Not "masked when drawn" — masked in the data.
    const rows = await app.dump('http_flows');
    expect(JSON.stringify(rows), 'the secret reached the stored record').not.toContain(value);
    expect(JSON.stringify(rows)).toContain('••••••••');

    // And the backup, for the same reason and by the same construction.
    const backup = await app.call<unknown>('exportData');
    expect(JSON.stringify(backup)).not.toContain(value);
  });

  test('a failed step halts the run, in place', async ({ app }) => {
    const { page } = app;
    // /__echo/me answers 401 without the token; a 401 is a logged resource error.
    app.expectConsoleError(/Failed to load resource.*401/i);
    await app.goto('/tools/http-playground/');

    // A step that needs `{{token}}` with nothing to supply it.
    await page.getByTestId('hp-url').fill(`${ECHO}/me`);
    await page.getByTestId('hp-header-name-0').fill('Authorization');
    await page.getByTestId('hp-header-value-0').fill('Bearer {{token}}');
    await saveCurrentAs(page, 'Needs a token');

    await page.getByTestId('hp-flows-card').evaluate((el) => ((el as HTMLDetailsElement).open = true));
    await page.getByTestId('hp-flow-new').fill('Doomed');
    await page.getByTestId('hp-flow-add').click();
    await page.getByTestId('hp-step-request-0').selectOption({ label: 'Needs a token' });
    await page.getByTestId('hp-step-request-1').selectOption({ label: 'Needs a token' });

    await page.getByTestId('hp-flow-run').click();
    await expect(page.getByTestId('hp-step-failure-0')).toContainText('could not be resolved');
    await expect(page.getByTestId('hp-step-failure-0')).toContainText('token');
    // The second step was never attempted — no record was even started.
    await expect(page.getByTestId('hp-step-record-1')).toHaveCount(0);
  });

  test('a flow can be walked one step at a time', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/http-playground/');

    await page.getByTestId('hp-url').fill(`${ECHO}/auth`);
    await saveCurrentAs(page, 'Log in');
    await page.getByTestId('hp-url').fill(`${ECHO}/me`);
    await page.getByTestId('hp-header-name-0').fill('Authorization');
    await page.getByTestId('hp-header-value-0').fill('Bearer {{token}}');
    await saveCurrentAs(page, 'Who am I');

    await page.getByTestId('hp-flows-card').evaluate((el) => ((el as HTMLDetailsElement).open = true));
    await page.getByTestId('hp-flow-new').fill('Walked');
    await page.getByTestId('hp-flow-add').click();
    await page.getByTestId('hp-step-request-0').selectOption({ label: 'Log in' });
    await page.getByTestId('hp-step-request-1').selectOption({ label: 'Who am I' });

    await expect(page.getByTestId('hp-flow-next')).toHaveText('Run first step');
    await page.getByTestId('hp-flow-next').click();
    await expect(page.getByTestId('hp-step-status-0')).toContainText('200');
    // One step ran, and only one.
    await expect(page.getByTestId('hp-step-record-1')).toHaveCount(0);

    await expect(page.getByTestId('hp-flow-next')).toHaveText('Run step 2');
    await page.getByTestId('hp-flow-next').click();
    // The value from the first step survived the pause between them.
    await expect(page.getByTestId('hp-step-status-1')).toContainText('200');
    await expect(page.getByTestId('hp-step-record-1')).toContainText('the authenticated one');
  });

  test('an extracted value only reaches the environment when asked', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/http-playground/');

    await page.getByTestId('hp-url').fill(`${ECHO}/auth`);
    await saveCurrentAs(page, 'Log in');

    await page.getByTestId('hp-flows-card').evaluate((el) => ((el as HTMLDetailsElement).open = true));
    await page.getByTestId('hp-flow-new').fill('Keeper');
    await page.getByTestId('hp-flow-add').click();
    await page.getByTestId('hp-step-remove-1').click();
    await page.getByTestId('hp-step-request-0').selectOption({ label: 'Log in' });
    await page.getByTestId('hp-rule-save-0-0').check();
    await page.getByTestId('hp-flow-run').click();
    await expect(page.getByTestId('hp-step-extracted')).toContainText('flow-token-abc');

    // Ticking "save" offers the write; it does not perform it.
    const beforeSave = await app.dump('http_environments');
    expect(JSON.stringify(beforeSave)).not.toContain('flow-token-abc');

    await page.getByTestId('hp-save-value-token').click();
    await expect(page.getByTestId('hp-notice')).toContainText('written into');
    const afterSave = await app.dump('http_environments');
    expect(JSON.stringify(afterSave)).toContain('flow-token-abc');
  });

  /**
   * 0.4.0's security pass (Phase 7, item 4), as one assertion instead of five.
   *
   * The individual specs each prove one path keeps a secret out of storage.
   * This one drives a secret through EVERY path the release added — resolved
   * into a live request, saved into a request template, echoed back by the
   * server, recorded by a flow, exported as an environment, exported as a
   * backup — and then asserts the value appears nowhere in the whole database
   * or the backup envelope. It fails if anyone adds a sixth path and forgets.
   */
  test('a secret survives no path into storage, whatever it is put through', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/http-playground/');

    const VALUE = 'sk-live-TOUCHES-EVERYTHING-4242';
    await addSecret(page, 'token', VALUE);

    // 1. Resolved into a live request whose server echoes headers straight back.
    await page.getByTestId('hp-url').fill(`${ECHO}/json`);
    await page.getByTestId('hp-header-name-0').fill('Authorization');
    await page.getByTestId('hp-header-value-0').fill('Bearer {{token}}');
    await page.getByTestId('hp-send').click();
    await expect(page.getByTestId('hp-body')).toContainText(VALUE); // live view: real

    // 2. Saved as a request template.
    await saveCurrentAs(page, 'Carries the secret');

    // 3. Recorded by a flow, against that same echoing route.
    await page.getByTestId('hp-flows-card').evaluate((el) => ((el as HTMLDetailsElement).open = true));
    await page.getByTestId('hp-flow-new').fill('Everything');
    await page.getByTestId('hp-flow-add').click();
    await page.getByTestId('hp-step-remove-1').click();
    await page.getByTestId('hp-step-request-0').selectOption({ label: 'Carries the secret' });
    await page.getByTestId('hp-flow-run').click();
    await expect(page.getByTestId('hp-step-status-0')).toContainText('200');

    // Now: every store, read raw, tombstones and all.
    const everything = await app.call<Record<string, unknown[]>>('rawDumpAll');
    expect(
      JSON.stringify(everything),
      'the secret reached an exported store'
    ).not.toContain(VALUE);

    // And the backup envelope, which is the file that leaves the machine.
    const backup = await app.call<unknown>('exportData');
    expect(JSON.stringify(backup), 'the secret reached the backup').not.toContain(VALUE);

    // It really is still there and still working — this is not passing
    // because the secret was quietly lost somewhere.
    const secretsStore = await app.call<{ value: string }[]>('rawDump', 'http_secrets');
    expect(secretsStore.map((row) => row.value)).toContain(VALUE);
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
