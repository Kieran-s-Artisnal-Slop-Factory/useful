# 0.6.0 (unreleased)

## Features

* Napkin Math's image export lets you turn each row's caption off on its own and reword it — "With your values" can become "At current market rate" for one picture. Each row in the dialog now has a caption checkbox and a text box beside its row toggle, and a **Reset captions** button restores the three defaults. A blank caption draws no caption line at all. Like the theme and PNG size this is an export option, not template data: nothing is saved.
* **Daily Calories** now asks you to read a warning before the form unlocks: the tool is not medical advice, a doctor should be consulted before acting on any figure, and the equations are population estimates. Pressing **I have read and understand the risks** stores `calorie_risk_acknowledged_at` in preferences so the page asks once per browser. **Not now** or Escape closes the dialog without saving anything and leaves the form locked behind a **Read the warning** button. Page load itself still writes nothing.
* **Photography** gained a **Compare two photos** card: pick two photos and it reads their EXIF (f-number, shutter, ISO, focal length, camera) to show each one's EV100 and how many stops — and how many times — more light one received than the other, one dial at a time with the equation and the substituted numbers. A photo without exposure tags says which tags are missing. The EXIF parser loads only once a photo is chosen, the files stay in the browser, and nothing is saved.
* Added **Pomodoro** under Time: focus rounds and breaks on a cycle (25 / 5 / 15 minutes, four rounds, all editable), with Start, Pause, Resume, Skip and Reset, a progress ring, round dots and today's completed count. The notification engine drives it like a timer — a banner such as "Focus round 2 of 4 done — break time" with the same sound, vibration and notification options — and waits for you between phases unless **Start the next phase automatically** is on. It is one singleton row (schema **v17**, `pomodoro`) that rides backups like everything else; nothing is written while a phase runs, so reloads never drift it.
* Added **Clip path** under Generators: a CSS `clip-path` builder with 25 polygon presets (every shape from the cssportal generator plus design.dev's chevron and pointed message) whose points you drag on a live preview — double-click an edge to add a point, right-click a handle to remove one — and circle, ellipse, blinds and wave modes driven by sliders. Blinds and waves come out as a percent `polygon()` (one outline can trace several strips by doubling back along a zero-width seam), so every line fits an element of any size; waves also offer a `path()` spelling with a note that it is pixel-bound. Drop your own image on the preview to see it clipped. Nothing is saved.

## Bug Fixes

## Other

* Widened the page to 81rem so side-by-side calculator layouts have room.
* Updated dependencies: Compute Engine 0.128.6, mermaid 12.0.0, React 19.3.0, sqlite-wasm 3.53.4, lucide-static 1.44.0, and Vitest 5.0.0. Vitest 5 resolves cleanly with the existing `@emnapi/core` override, which unblocked the update that 0.5.0 could not make.
* Held back two majors: `@dicebear/core` 10 has no matching `@dicebear/collection` release yet, and TypeScript 7 is outside the peer range of `@astrojs/svelte`. Both stay on their current majors until upstream catches up.
* Napkin Math's evaluator now checks the imaginary part directly when deciding whether an answer is real, because Compute Engine 0.128 no longer sets `isReal` on plain numeric literals.
* CI moved to `actions/checkout@v7`, `setup-node@v7`, `configure-pages@v6`, `upload-pages-artifact@v5` and Node 24 (the LTS line).

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
