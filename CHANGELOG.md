# 0.6.0 (unreleased)

## Features

* Napkin Math's image export lets you turn each row's caption off on its own and reword it — "With your values" can become "At current market rate" for one picture. Each row in the dialog now has a caption checkbox and a text box beside its row toggle, and a **Reset captions** button restores the three defaults. A blank caption draws no caption line at all. Like the theme and PNG size this is an export option, not template data: nothing is saved.
* Napkin Math's image export can draw more than one calculation in the same picture — option 1 next to option 2 of a rental, say. A **Compare with** section in the dialog lists the saved calculations of any template with this exact formula; **Add** puts one in the picture with its saved name as its caption (editable per entry, and the entry says which values it uses), and a **Title for this calculation** box captions the current one. The formula is drawn once, then one values row per calculation, then one result per calculation captioned `Result — <title>`. Comparisons are re-substituted and re-evaluated from their saved values, live only for the session, and write nothing; with none added the picture is exactly what it was.
* **Daily Calories** now asks you to read a warning before the form unlocks: the tool is not medical advice, a doctor should be consulted before acting on any figure, and the equations are population estimates. Pressing **I have read and understand the risks** stores `calorie_risk_acknowledged_at` in preferences so the page asks once per browser. **Not now** or Escape closes the dialog without saving anything and leaves the form locked behind a **Read the warning** button. Page load itself still writes nothing.
* **Photography** gained a **Compare two photos** card: pick two photos and it reads their EXIF (f-number, shutter, ISO, focal length, camera) to show each one's EV100 and how many stops — and how many times — more light one received than the other, one dial at a time with the equation and the substituted numbers. A photo without exposure tags says which tags are missing. The EXIF parser loads only once a photo is chosen, the files stay in the browser, and nothing is saved.
* Added **Pomodoro** under Time: focus rounds and breaks on a cycle (25 / 5 / 15 minutes, four rounds, all editable), with Start, Pause, Resume, Skip and Reset, a progress ring, round dots and today's completed count. The notification engine drives it like a timer — a banner such as "Focus round 2 of 4 done — break time" with the same sound, vibration and notification options — and waits for you between phases unless **Start the next phase automatically** is on. It is one singleton row (schema **v17**, `pomodoro`) that rides backups like everything else; nothing is written while a phase runs, so reloads never drift it.
* Added **Clip path** under Generators: a CSS `clip-path` builder with 25 polygon presets (every shape from the cssportal generator plus design.dev's chevron and pointed message) whose points you drag on a live preview — double-click an edge to add a point, right-click a handle to remove one — and circle, ellipse, blinds and wave modes driven by sliders. Blinds and waves come out as a percent `polygon()` (one outline can trace several strips by doubling back along a zero-width seam), so every line fits an element of any size; waves also offer a `path()` spelling with a note that it is pixel-bound. Drop your own image on the preview to see it clipped. Nothing is saved.
* **Clip path**'s preview is now a 4 : 3 box instead of a tall one that filled the column and stretched every shape, and an **Aspect ratio** menu beside it (1 : 1, 4 : 3, 3 : 2, 16 : 9, 9 : 16, 3 : 4, 2 : 3, 21 : 9) shows the same cut on the box you actually mean to clip — the CSS line never changes with it. The sample is a solid orange by default rather than a gradient; a **Fill** switch offers Solid (with a colour field), Gradient (two colours and an angle) or Image (the existing picker and drop target). Still nothing is saved.
* **Placeholders** batches can now differ per image. A **Vary across the batch** panel under the batch count offers one rule per checkbox: a size per image (a table that follows the batch count, first row first image), a random background, and per generator a random ink, a random seed, a gradient angle offset (wrapping at 360°), random stops that never match each other, a linear/radial kind cycle, grain and blur deltas, a line-count delta (wrapping past 400), an opacity delta, an icon size delta (wrapping past 95%), a random Lucide icon per image, and a random drawn scene from the groups or individual scenes you allow. Rules are seeded like everything else, so the same seed gives the same batch again, and a batch with nothing ticked is exactly what it was before.
* **Placeholders** gained two image generators. **Mosaic** lays square tiles in a palette of one to four colours you choose, with a share of them cut out to the background in seeded patches; block size and cut-out ratio are sliders. **Swirl** draws a smooth two-tone logarithmic spiral in the first two palette colours, with the number of turns and the arm width to set. Both are seeded like the rest, and the batch panel can shuffle the palette per image or draw a fresh one.
* **Placeholders** batch panel, after feedback: the sizes table gained a **Randomize sizes** tick that fills every row with seeded sizes (long side 200–2000), either keeping the aspect ratio of the size above or changing it too, plus an include tick per row with **all** / **none** — an image left out keeps the base size, and the numbers stay editable. The mosaic gained **block size** and **cut-out** deltas per image, clamped to the sliders. The swirl's two colours are now named **Swirl colour** and **Background colour** with nothing to add or remove, and when the palette rule is set to shuffled the colours being reordered appear right under it, bound to the same state as the generator panel.
* **Placeholders**' shuffled palette now deals from a **pool** of its own (feedback round 2). With the rule set to shuffled, the fields under it are no longer the generator's two or four colours but a list you can add to (up to eight) and remove from; it starts as the generator's colours and then stays as you leave it across generator switches. The mosaic takes as many colours from the pool per image as its palette holds, the swirl takes its swirl colour and background colour — so a pool bigger than one image can hold gives every image a different pick, not just a different order. Seeded like everything else; a pool left as it started is exactly the old shuffle. The mosaic's **Add a colour** button also disappears at four colours instead of sitting there disabled.
* Napkin Math's image export now draws comparisons **side by side**: the title and the formula once across the top, then one column per calculation — its caption and values, then `Result — <title>` and the answer — laid out left to right in the order they were added, aligned at the top, with the picture as wide as the columns need. With no comparison added the picture is byte-for-byte what it was, and a unit test holds the single-calculation SVG to that.

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
