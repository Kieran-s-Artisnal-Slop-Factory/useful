/**
 * Version 0.3.0 text tools — Diff (phase 1), Similarity (phase 2) and Text
 * analysis (phase 3).
 *
 * All three are stateless, so the standing assertion on every one of them is
 * that using the page writes NOTHING: `dumpAll()` before, `dumpAll()` after,
 * byte-identical. What is checked beyond that is the arithmetic the page
 * claims — the counts, the alignment, the patch — because the unit tests own
 * the algorithms and these own the wiring between them and the screen.
 */
import { test, expect } from './helpers/app';

const LEFT = 'one\ntwo\nthree\nfour\nfive\n';
const RIGHT = 'one\n2\nthree\nfour\nfive\nsix\n';

const clipboard = (page: import('@playwright/test').Page) =>
  page.evaluate(() => navigator.clipboard.readText());

test.describe('diff', () => {
  test('lines up two texts, and comparing writes nothing', async ({ app }) => {
    const { page } = app;
    const before = await app.dumpAll();
    await app.goto('/tools/diff/');

    // Nothing typed yet: an empty state rather than an empty table.
    await expect(page.getByTestId('diff-empty')).toBeVisible();

    await page.getByTestId('diff-left').fill(LEFT);
    await page.getByTestId('diff-right').fill(RIGHT);

    await expect(page.getByTestId('diff-insertions')).toHaveText('+1');
    await expect(page.getByTestId('diff-deletions')).toHaveText('−0');
    await expect(page.getByTestId('diff-changed')).toHaveText('1 changed line');

    // Six rows: five paired lines plus the added one.
    const rows = page.getByTestId('diff-row');
    await expect(rows).toHaveCount(6);
    await expect(rows.nth(1)).toHaveAttribute('data-kind', 'replace');
    await expect(rows.nth(5)).toHaveAttribute('data-kind', 'insert');

    // The changed row shows the changed WORD, not just a changed line.
    await expect(rows.nth(1).locator('del')).toHaveText('two');
    await expect(rows.nth(1).locator('ins')).toHaveText('2');

    expect(await app.dumpAll()).toEqual(before);
  });

  test('the options change what counts as different, never what is shown', async ({ app }) => {
    const { page } = app;
    const before = await app.dumpAll();
    await app.goto('/tools/diff/');

    await page.getByTestId('diff-left').fill('  Hello World  \n');
    await page.getByTestId('diff-right').fill('hello world\n');
    await expect(page.getByTestId('diff-row').first()).toHaveAttribute('data-kind', 'replace');

    await page.getByTestId('diff-ignore-case').check();
    await page.getByTestId('diff-whitespace').selectOption('edges');
    const row = page.getByTestId('diff-row').first();
    await expect(row).toHaveAttribute('data-kind', 'equal');
    // The original spacing is still on screen — normalization is for comparing.
    await expect(row.locator('td').nth(1)).toHaveText('Hello World');

    expect(await app.dumpAll()).toEqual(before);
  });

  test('word and character modes diff prose as one stream', async ({ app }) => {
    const { page } = app;
    const before = await app.dumpAll();
    await app.goto('/tools/diff/');

    await page.getByTestId('diff-left').fill('the quick brown fox');
    await page.getByTestId('diff-right').fill('the quick red fox');

    await page.getByTestId('diff-granularity').selectOption('word');
    const flow = page.getByTestId('diff-flow');
    await expect(flow.locator('del')).toHaveText('brown');
    await expect(flow.locator('ins')).toHaveText('red');
    await expect(page.getByTestId('diff-insertions')).toHaveText('+1');

    await page.getByTestId('diff-granularity').selectOption('character');
    await expect(page.getByTestId('diff-flow')).toBeVisible();

    expect(await app.dumpAll()).toEqual(before);
  });

  test('two loaded files that differ only in line endings say so', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/diff/');

    // CRLF can only arrive from a file: an HTML textarea normalises its value
    // to LF, so no amount of typing can produce the difference this note is
    // about. Loading is how it happens in life, and how it is tested.
    await page.getByTestId('diff-left-file').setInputFiles({
      name: 'unix.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('a\nb\n'),
    });
    await page.getByTestId('diff-right-file').setInputFiles({
      name: 'windows.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('a\r\nb\r\n'),
    });

    await expect(page.getByTestId('diff-ending-note')).toContainText('only in their line endings');
    await expect(page.getByTestId('diff-ending-note')).toContainText('LF');
    await expect(page.getByTestId('diff-ending-note')).toContainText('CRLF');
  });

  test('a binary file is refused by name', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/diff/');
    await page.getByTestId('diff-left-file').setInputFiles({
      name: 'photo.png',
      mimeType: 'image/png',
      buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00]),
    });
    await expect(page.getByTestId('diff-file-error')).toContainText('photo.png');
    await expect(page.getByTestId('diff-left')).toHaveValue('');
  });

  test('the patch is a real unified diff, and copies', async ({ app }) => {
    const { page } = app;
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    const before = await app.dumpAll();
    await app.goto('/tools/diff/');

    await page.getByTestId('diff-left').fill(LEFT);
    await page.getByTestId('diff-right').fill(RIGHT);

    const patch = page.getByTestId('diff-patch');
    await expect(patch).toContainText('@@ -1,5 +1,6 @@');
    await expect(patch).toContainText('-two');
    await expect(patch).toContainText('+2');

    // Fewer context lines means more hunks, and the header line counts move.
    await page.getByTestId('diff-context').fill('1');
    await expect(patch).toContainText('@@ -5 +5,2 @@');

    await page.getByTestId('diff-copy').click();
    await expect(page.getByTestId('diff-copy')).toHaveText('Copied');
    expect(await clipboard(page)).toContain('--- original');

    expect(await app.dumpAll()).toEqual(before);
  });

  test('swap and clear do what they say', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/diff/');
    await page.getByTestId('diff-left').fill('left side');
    await page.getByTestId('diff-right').fill('right side');

    await page.getByTestId('diff-swap').click();
    await expect(page.getByTestId('diff-left')).toHaveValue('right side');
    await expect(page.getByTestId('diff-right')).toHaveValue('left side');

    await page.getByTestId('diff-clear').click();
    await expect(page.getByTestId('diff-left')).toHaveValue('');
    await expect(page.getByTestId('diff-empty')).toBeVisible();
  });

  test('identical texts are called identical', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/diff/');
    await page.getByTestId('diff-left').fill(LEFT);
    await page.getByTestId('diff-right').fill(LEFT);
    await expect(page.getByTestId('diff-summary')).toContainText('identical');
  });
});

test.describe('similarity', () => {
  test('scores every candidate five ways, and scoring writes nothing', async ({ app }) => {
    const { page } = app;
    const before = await app.dumpAll();
    await app.goto('/tools/similarity/');

    await expect(page.getByTestId('sim-empty')).toBeVisible();

    await page.getByTestId('sim-word').fill('kitten');
    await page.getByTestId('sim-candidates').fill('sitting\nmitten\nbanana');

    const rows = page.getByTestId('sim-row');
    await expect(rows).toHaveCount(3);

    // Sorted by Jaro to start with, so the closest word leads.
    await expect(page.getByTestId('sim-best')).toContainText('mitten');

    const mitten = rows.filter({ has: page.locator('th', { hasText: 'mitten' }) });
    await expect(mitten.getByTestId('sim-levenshtein')).toContainText('1 edit');
    const sitting = rows.filter({ has: page.locator('th', { hasText: 'sitting' }) });
    await expect(sitting.getByTestId('sim-levenshtein')).toContainText('3 edits');
    await expect(sitting.getByTestId('sim-indel')).toContainText('5 edits');

    expect(await app.dumpAll()).toEqual(before);
  });

  test('sorting by an algorithm reorders the table', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/similarity/');
    await page.getByTestId('sim-word').fill('kitten');
    await page.getByTestId('sim-candidates').fill('sitting\nmitten\nbanana');

    await page.getByTestId('sim-sort-indel').click();
    await expect(page.getByTestId('sim-best')).toContainText('mitten');
    await expect(page.getByTestId('sim-row').first()).toHaveAttribute('data-word', 'mitten');

    // Banana is nobody's neighbour, so it is last under every algorithm.
    await expect(page.getByTestId('sim-row').last()).toHaveAttribute('data-word', 'banana');
  });

  test('the matrix shows the cheapest route, one step at a time', async ({ app }) => {
    const { page } = app;
    const before = await app.dumpAll();
    await app.goto('/tools/similarity/');
    await page.getByTestId('sim-word').fill('kitten');
    await page.getByTestId('sim-candidates').fill('sitting');

    await page.getByTestId('sim-algorithm').selectOption('levenshtein');
    await expect(page.getByTestId('sim-distance')).toHaveText('Distance: 3');
    await expect(page.getByTestId('sim-step-text')).toContainText('Step 1 of 7');
    await expect(page.getByTestId('sim-step-text')).toContainText('Substitute "k" with "s"');

    await page.getByTestId('sim-step-next').click();
    await expect(page.getByTestId('sim-step-text')).toContainText('Step 2 of 7');
    await expect(page.getByTestId('sim-step-text')).toContainText('Keep "i"');

    // The last step of this alignment is the inserted g.
    for (let i = 0; i < 5; i += 1) await page.getByTestId('sim-step-next').click();
    await expect(page.getByTestId('sim-step-text')).toContainText('Step 7 of 7');
    await expect(page.getByTestId('sim-step-text')).toContainText('Insert "g"');
    await expect(page.getByTestId('sim-step-next')).toBeDisabled();

    expect(await app.dumpAll()).toEqual(before);
  });

  test('Damerau charges one edit for a swap and shows it', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/similarity/');
    await page.getByTestId('sim-word').fill('teh');
    await page.getByTestId('sim-candidates').fill('the');

    await page.getByTestId('sim-algorithm').selectOption('levenshtein');
    await expect(page.getByTestId('sim-distance')).toHaveText('Distance: 2');
    await page.getByTestId('sim-algorithm').selectOption('damerau');
    await expect(page.getByTestId('sim-distance')).toHaveText('Distance: 1');
    // The alignment keeps the t, then swaps the pair — so the swap is step 2.
    await expect(page.getByTestId('sim-step-text')).toContainText('Step 1 of 2');
    await page.getByTestId('sim-step-next').click();
    await expect(page.getByTestId('sim-step-text')).toContainText('Swap');
  });

  test('a pasted document is refused rather than scored', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/similarity/');
    await page.getByTestId('sim-word').fill('word '.repeat(60));
    await page.getByTestId('sim-candidates').fill('other');
    await expect(page.getByTestId('sim-over-limit')).toContainText('words, not documents');
    await expect(page.getByTestId('sim-row')).toHaveCount(0);
  });

  test('a long pair keeps its scores but drops the grid', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/similarity/');
    await page.getByTestId('sim-word').fill('a'.repeat(45));
    await page.getByTestId('sim-candidates').fill('b'.repeat(45));
    await page.getByTestId('sim-algorithm').selectOption('levenshtein');
    await expect(page.getByTestId('sim-too-long')).toBeVisible();
    await expect(page.getByTestId('sim-matrix')).toHaveCount(0);
    // The score itself is still exact.
    await expect(page.getByTestId('sim-levenshtein')).toContainText('45 edits');
  });

  test('Jaro shows the window, the matches and the formula it used', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/similarity/');
    await page.getByTestId('sim-word').fill('MARTHA');
    await page.getByTestId('sim-candidates').fill('MARHTA');

    await page.getByTestId('sim-algorithm').selectOption('jaro');
    await expect(page.getByTestId('sim-window')).toHaveText('±2');
    await expect(page.getByTestId('sim-matches')).toHaveText('6');
    await expect(page.getByTestId('sim-transpositions')).toHaveText('1');
    await expect(page.getByTestId('sim-formula')).toContainText('0.9444');

    await page.getByTestId('sim-algorithm').selectOption('jaro-winkler');
    await expect(page.getByTestId('sim-prefix')).toHaveText('3');
    await expect(page.getByTestId('sim-formula')).toContainText('0.9611');
  });

  test('a candidate list longer than the cap says what it left out', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/similarity/');
    await page.getByTestId('sim-word').fill('kitten');
    await page
      .getByTestId('sim-candidates')
      .fill(Array.from({ length: 205 }, (_, i) => `word${i}`).join('\n'));
    await expect(page.getByTestId('sim-dropped')).toContainText('5 more were left out');
    await expect(page.getByTestId('sim-row')).toHaveCount(200);
  });

  test('picking a row moves the working to that pair', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/similarity/');
    await page.getByTestId('sim-word').fill('kitten');
    await page.getByTestId('sim-candidates').fill('sitting\nmitten');

    await page.getByTestId('sim-pick-sitting').click();
    await page.getByTestId('sim-algorithm').selectOption('levenshtein');
    await expect(page.getByTestId('sim-distance')).toHaveText('Distance: 3');

    await page.getByTestId('sim-pick-mitten').click();
    await expect(page.getByTestId('sim-distance')).toHaveText('Distance: 1');
  });
});

test.describe('text analysis', () => {
  const SAMPLE = 'The cat sat on the mat. The dog barked.';

  test('counts and scores the text, and writes nothing doing it', async ({ app }) => {
    const { page } = app;
    const before = await app.dumpAll();
    await app.goto('/tools/text-analysis/');

    await expect(page.getByTestId('ta-empty')).toBeVisible();
    await page.getByTestId('ta-text').fill(SAMPLE);

    await expect(page.getByTestId('ta-words')).toHaveText('9');
    await expect(page.getByTestId('ta-unique')).toHaveText('7 unique');
    await expect(page.getByTestId('ta-sentences')).toHaveText('2');
    await expect(page.getByTestId('ta-paragraphs')).toHaveText('1');
    await expect(page.getByTestId('ta-characters')).toHaveText(String(SAMPLE.length));

    // 206.835 - 1.015x4.5 - 84.6x1, rounded to one decimal.
    await expect(page.getByTestId('ta-flesch')).toHaveText('117.7');
    await expect(page.getByTestId('ta-band')).toContainText('Very easy');
    await expect(page.getByTestId('ta-fk')).toHaveText('-2.0');
    await expect(page.getByTestId('ta-ari')).toHaveText('-4.0');

    expect(await app.dumpAll()).toEqual(before);
  });

  test('SMOG says what it is waiting for instead of printing a number', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/text-analysis/');
    await page.getByTestId('ta-text').fill(SAMPLE);
    await expect(page.getByTestId('ta-smog')).toHaveText('\u2014');
    await expect(page.getByTestId('ta-smog-note')).toContainText('28 more sentences');

    await page.getByTestId('ta-text').fill('Beautiful difficult sentences appear regularly. '.repeat(30));
    await expect(page.getByTestId('ta-smog')).toHaveText('13.0');
    await expect(page.getByTestId('ta-smog-note')).toHaveCount(0);
  });

  test('the frequency table counts words, pairs, and can ignore the filler', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/text-analysis/');
    await page.getByTestId('ta-text').fill('the cat and the hat and the bat');

    const rows = page.getByTestId('ta-freq-row');
    await expect(rows.first()).toHaveAttribute('data-term', 'the');
    await expect(rows.first().locator('td').first()).toHaveText('3');

    await page.getByTestId('ta-freq-stop').check();
    await expect(page.getByTestId('ta-freq-row')).toHaveCount(3);
    await expect(page.getByTestId('ta-freq-row').first()).toHaveAttribute('data-term', 'bat');

    await page.getByTestId('ta-freq-stop').uncheck();
    await page.getByTestId('ta-freq-size').selectOption('2');
    await expect(page.getByTestId('ta-freq-row').first()).toHaveAttribute('data-term', 'and the');
  });

  test('transformations leave the original alone and copy out', async ({ app }) => {
    const { page } = app;
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    const before = await app.dumpAll();
    await app.goto('/tools/text-analysis/');

    await page.getByTestId('ta-text').fill('hello there. how are you?');
    await expect(page.getByTestId('ta-output-empty')).toBeVisible();

    await page.getByTestId('ta-transform-sentence').click();
    await expect(page.getByTestId('ta-output')).toHaveValue('Hello there. How are you?');
    // The text being measured is untouched by any transformation.
    await expect(page.getByTestId('ta-text')).toHaveValue('hello there. how are you?');

    await page.getByTestId('ta-transform-upper').click();
    await expect(page.getByTestId('ta-output')).toHaveValue('HELLO THERE. HOW ARE YOU?');

    await page.getByTestId('ta-transform-capitalize').click();
    await expect(page.getByTestId('ta-output')).toHaveValue('Hello There. How Are You?');

    await page.getByTestId('ta-copy').click();
    await expect(page.getByTestId('ta-copy')).toHaveText('Copied');
    expect(await clipboard(page)).toBe('Hello There. How Are You?');

    expect(await app.dumpAll()).toEqual(before);
  });

  test('the decorative transformations keep whole characters whole', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/text-analysis/');
    await page.getByTestId('ta-text').fill('Aesthetic');

    await page.getByTestId('ta-transform-wide').click();
    await expect(page.getByTestId('ta-output')).toHaveValue('A E S T H E T I C');

    await page.getByTestId('ta-transform-spongebob').click();
    await expect(page.getByTestId('ta-output')).toHaveValue('aEsThEtIc');

    await page.getByTestId('ta-text').fill('a\u{1F44D}\u{1F3FD}b');
    await page.getByTestId('ta-transform-wide').click();
    await expect(page.getByTestId('ta-output')).toHaveValue('A \u{1F44D}\u{1F3FD} B');
  });
});
