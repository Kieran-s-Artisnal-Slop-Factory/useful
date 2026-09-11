# 0.6.0 — September 11th, 2026

> **Database migration:** v17 runs automatically on first launch. It adds one store (`pomodoro`) and does not modify existing data. Migrations are per browser/device because data is stored locally.

> **One new persistent preference:** `calorie_risk_acknowledged_at`, written once when the calorie warning is accepted.

## Features

* Added **Pomodoro** under Time
  * Focus rounds and breaks on a cycle: 25 / 5 / 15 minutes and four rounds by default, all editable.
  * Start, Pause, Resume, Skip and Reset, a progress ring, round dots, and today's completed count.
  * The notification engine drives it like a timer, with the same sound, vibration and notification options.
  * Waits between phases unless **Start the next phase automatically** is on. One singleton row that rides backups.
* Added **Clip path** under Generators
  * 25 polygon presets (every cssportal shape plus design.dev's chevron and pointed message) with draggable points; double-click an edge to add one, right-click a handle to remove it.
  * Circle, ellipse, blinds and wave modes on sliders. Blinds and waves come out as percent `polygon()`, so the line fits any element; waves also offer a pixel-bound `path()`.
  * The preview is a 4 : 3 box with an aspect-ratio menu, filled with a solid colour (orange by default), a two-colour gradient with an angle, or an image you drop on it.
* **Napkin Math** image export
  * Each row's caption can be turned off on its own or reworded for one picture, with a **Reset captions** button.
  * **Compare with** draws saved calculations of the same formula side by side: the formula once, then one column per calculation with its caption, values and `Result — <title>`. The current calculation can be titled too.
  * Comparisons are re-substituted and re-evaluated from their saved values, live only for the session. With none added the picture is byte-for-byte what it was.
* **Daily Calories** asks you to read a warning before the form unlocks
  * Not medical advice, consult a doctor before acting on any figure, and the equations are population estimates.
  * **I have read and understand the risks** is remembered per browser; **Not now** leaves the form locked behind a **Read the warning** button.
* **Photography** gained a **Compare two photos** card
  * Reads f-number, shutter, ISO, focal length and camera from each photo's EXIF and shows its EV100.
  * Shows how many stops, and how many times, more light one photo received, one dial at a time with the equation and substituted numbers.
  * A photo without exposure tags says which tags are missing. The parser loads only once a photo is chosen; nothing is saved.
* **Placeholders** batches can vary per image
  * A **Vary across the batch** panel with one rule per checkbox: a size per image (typed, or seeded random sizes keeping or changing the ratio, with an include tick per row), background, ink, seed, gradient angle offset, stops and kind cycle, grain and blur deltas, line-count delta, opacity delta, icon size delta and random icon, allowed drawn scenes, and mosaic block-size and cut-out deltas.
  * Every rule is seeded, so the same seed gives the same batch; a batch with nothing ticked is exactly what it was before.
* **Placeholders** gained **Mosaic** and **Swirl** generators
  * Mosaic lays square tiles in one to four colours with a share cut out to the background in seeded patches; block size and cut-out ratio are sliders. The add-colour button disappears at four.
  * Swirl draws a two-tone logarithmic spiral from a **Swirl colour** and a **Background colour**, with turns and arm width to set.
  * The batch panel's palette rule can shuffle from a pool of up to eight colours, edited right under the rule, or draw fresh colours per image.

## Bug Fixes

* Napkin Math's evaluator now checks the imaginary part directly when deciding whether an answer is real, because Compute Engine 0.128 no longer sets `isReal` on plain numeric literals; without this every result read as "not a real number".

## Other

* Widened the page to 81rem so side-by-side calculator layouts have room.
* Updated dependencies: Compute Engine 0.128.6, mermaid 12.0.0, React 19.3.0, sqlite-wasm 3.53.4, lucide-static 1.44.0, and Vitest 5.0.0. Vitest 5 resolves cleanly with the existing `@emnapi/core` override, which unblocked the update that 0.5.0 could not make.
* Held back two majors: `@dicebear/core` 10 has no matching `@dicebear/collection` release yet, and TypeScript 7 is outside the peer range of `@astrojs/svelte`. Both stay on their current majors until upstream catches up.
* CI moved to `actions/checkout@v7`, `setup-node@v7`, `configure-pages@v6`, `upload-pages-artifact@v5` and Node 24 (the LTS line).
* The service worker's background crawl cap rose from 600 to 700 files: the 0.6.0 build reaches 603, and `tools/audit-precache.mjs` reported the cap cutting the run short.
* Two generated JPEG fixtures with known exposure EXIF (`tools/build-exposure-fixtures.mjs`) back the photo comparison tests, because the existing photo fixture carries no exposure tags.

# 0.5.0 — September 9th, 2026

> **No migrations in this release.** Schema remains at **v16**. Existing data and backups are unchanged. The only new persistent preference is the calorie calculator's unit system.

## Features

* Added **Color Extractor** under Images
  * Extracts and ranks major colours from an image.
  * Uses OKLab colour clustering.
  * Copies colours in four CSS formats.
  * Exports palettes as Themes.
* **Generators › Themes** can now load colour roles from URL parameters.
* **Napkin Math** can export calculations as SVG or PNG images.
  * Includes the formula, substituted values, and answer.
  * Supports light and dark themes.
* Added **Daily Calories** calculator.
  * Supports Mifflin–St Jeor, revised Harris–Benedict, and Katch–McArdle.
  * Includes activity multipliers and gain/loss targets.
  * Shows calculations step by step.
  * Warns about aggressive targets without blocking them.

## Bug Fixes

* Fixed missing `napkin_last_template_id` coverage in the schema mirror and backup tests.

## Other

* Updated 15 dependencies, including Astro 7.3.2, Svelte 5.57.0, Playwright 1.63.0, and onnxruntime-web 1.29.0.
* Kept Vitest 4.1.10 because npm cannot currently resolve 4.1.11 with the project's `@emnapi/core` override.

# 0.4.0 — August 31st, 2026

> **Database migrations:** v14, v15, and v16 run automatically on first launch. They only add stores and do not modify existing data. Migrations are per browser/device because data is stored locally.

> **HTTP secrets:** API keys are stored separately and excluded from backups and exports.

## Features

* Added **HTTP Playground**

  * Build and send HTTP requests.
  * Validate JSON and form bodies.
  * Inspect request headers and response types.
  * Preview HTML in a sealed frame.
  * Diagnose common request failures, including CORS and mixed content.
* Added **media previews** for images, PDFs, video, and audio.
* Added **syntax highlighting** for JSON, HTML, XML, CSS, JavaScript, and Markdown.
* Added **saved requests, environments, variables, and secrets**.

  * Supports `{{name}}` variables.
  * Missing variables block requests with an explanation.
  * Secrets are never included in backups or exports.
* Added **multi-step HTTP flows**

  * Chain requests together.
  * Extract values from responses.
  * Run flows step-by-step or as a whole.
  * Sensitive values are masked in stored run history.
* Improved **CORS diagnosis** with more specific error explanations.
* Added **Add N variables** for quickly creating missing variables.
* Expanded file detection to support **WebM, FLAC, M4A, and additional MP4 formats**.
* Added **Web Playground**

  * HTML, CSS, JavaScript, TypeScript, Emmet, console output, saved sessions, and ZIP export.
* Added Web Playground preview layouts:

  * Side-by-side
  * Editor only
  * Preview only
  * Near-fullscreen
* Added **Operation Visualizer** to the programming calculator.
* Added **search, pagination, and scrolling** to link pickers.
* Expanded **placeholder generators** with more controls, scenes, and 37 FIGlet fonts.
* Added **Docker Compose Builder** with templates, snippets, import/export, and validation.
* Added **Crontab** and **File Tree** tools.
* Expanded **ASCII Art**

  * Image-to-text conversion
  * FIGlet banners
  * Additional fonts
  * More export formats
* Added **JWT, Encryption, Hashing, Base64, Text Analysis, Similarity, and Diff** tools.
* Added shared **text/tokenization and Base64** libraries.

## Improvements & Fixes

* Decided against in-browser AI placeholder text generation due to model size and quality constraints.
* Reduced HTTP Playground initial page load by **446 KB** through lazy-loading CodeMirror and syntax grammars.
* Improved browser test reliability.
* Improved service-worker activation and offline asset handling.
* Improved accessibility across new tools.
* Updated documentation and version information.
* Added extensive validation and test coverage for new tools and migrations.

# 0.3.0 — August 22nd, 2026

## Features

* Added **Docker Compose** project generation, templates, snippets, import/export, and validation.
* Added **Notebook drawings** with Excalidraw support.
* Added generator previews and more placeholder options.
* Expanded the **ASCII Art** font library.
* Added **placeholder image generators** and seeded generation.
* Redesigned the sidebar with **Productivity, Security, and DevOps** categories.
* Consolidated **Settings** navigation.

## Improvements & Fixes

* Improved offline support and service-worker caching.
* Consolidated Base64 handling.
* Improved documentation, accessibility, and test coverage.
* Fixed various UI, worker, and performance issues.

# 0.2.1 — August 21st, 2026

* Added **JSON/YAML/TOML/CSV conversion** to the Configuration Playground.
* Improved **Notebook** note creation, editing, bulk operations, and navigation.
* Improved **Secrets** organization.
* Added reusable collapsible and custom-header cards.

# 0.2.0 — August 21st, 2026

* Added **Notebook**

  * Markdown/WYSIWYG editing
  * Nested notes
  * Wiki links
  * Footnotes
  * Diagrams
  * Math
  * Images
  * Export
* Added **Notebook bulk operations** for export, tagging, moving, and deletion.
* Added linked-note navigation and automatic aliases.
* Improved Markdown rendering and editor tooling.
* Added offline-safe storage and improved data migrations.

# 0.1.0

* Initial release.
