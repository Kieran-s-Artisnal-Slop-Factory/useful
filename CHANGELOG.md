# 0.4.0 — Unreleased

## Features

* Added an **HTTP Playground**: build a request, send it, and read the response. Flags the headers a browser silently refuses to send, checks a JSON body before sending, shows exactly how a form body is encoded, works out what a response really is from its bytes rather than its Content-Type, previews HTML in a sealed frame, and explains a failed request — including telling CORS apart from mixed content.
* Added **media previews** to HTTP responses. Images, PDFs, video and audio can be shown in the page behind a button — nothing is decoded until you press it, the format is decided by the response's bytes rather than its Content-Type, and a format no browser can draw says so instead of offering a blank box.
* Added **syntax highlighting** for JSON, HTML, XML, CSS, JavaScript and Markdown response bodies, with the body shown plain (and a note saying why) when it is too large or too dense to colour safely.
* Added **saved requests, environments, variables and secrets** to the HTTP playground. Write `{{name}}` anywhere in a URL, header, body or form field and it resolves at send time from the active environment, then Global. A name that resolves nowhere blocks the send and says which field it was in, rather than quietly becoming an empty string. **Secret values are stored apart from everything else and never reach a backup, an export or a saved request** — a saved request keeps the placeholder, not the value. Database version 15.
* Added **multi-step flows** to the HTTP playground: run several requests in order and carry values between them, with explicit rules that read a value from a response body, header or status and name it for later steps. Run a flow whole or walk it one step at a time; a failed step halts the run with the reason in place. Each flow keeps its most recent run, and response bodies are capped at 256 KB in storage only. **A saved record never holds a live credential**: the request is masked before the record is built, any secret a server echoes back is removed, and values the run itself extracted — a fetched token and everywhere it was then sent — are taken out of the stored copy. The run on screen shows all of them; the saved copy shows `••••••••`, and the page says so. Database version 16.
* Improved the HTTP playground's **CORS diagnosis**. A host that has already answered during the session is no longer met with "most likely CORS" — the page says outright that the host is fine and this one resource is not shared, and stops calling it a guess. Both the failure card and the explainer now name the case that most often looks like a broken client: servers commonly attach the CORS header to images and media only, so a `.png` works and a `.csv` from the same directory does not.
* Added an **Add N variables** button under the URL. When a request names `{{variables}}` that no environment or secret supplies, it creates them all in one go, empty and ready to fill in. Empty values are flagged everywhere they could bite — listed above the variables table, shown as `(empty)` in it, and named in the send blocker when the blank one is inside the URL.
* Extended file sniffing to recognise **WebM, FLAC, M4A** and the remaining MP4 brands, so those responses are identified rather than reported as unrecognised bytes.
* Added a **Web Playground** with HTML, CSS, JavaScript, live preview, console output, Emmet, TypeScript support, saved sessions, and ZIP export.
* Added **preview layouts** to the web playground: side-by-side, editor only, preview only, and a near-fullscreen modal.
* Added an **Operation Visualizer** to the programming calculator, showing step-by-step arithmetic, bitwise operations, shifts, carries, and overflow.
* Added **search, pagination, and scrolling** to link pickers.
* Expanded **placeholder generators** with more controls, scenes, and 37 FIGlet fonts.
* Added a full **Docker Compose builder** with templates, snippets, import/export, validation, and helpful warnings.
* Added **Crontab** and **File Tree** tools.
* Expanded **ASCII Art** with image-to-text conversion, FIGlet banners, additional fonts, and multiple export formats.
* Added **JWT**, **Encryption**, **Hashing**, **Base64**, **Text Analysis**, **Similarity**, and **Diff** tools.
* Added a shared **text/tokenization and Base64** library used across the new tools.

## Improvements & Fixes

* **Decided against** generating placeholder text with an in-browser AI model, after building and running one rather than guessing. A distilgpt2-class model cannot follow a prompt at all — it continues text rather than responding to it — and the smallest model that can is around 115 MB — five times the size of this entire app — while the purpose-built on-device models (LFM2.5) start at 206 MB and their 350M at 246 MB, so picking a better model makes the size worse rather than better. The seeded lorem ipsum and office-speak corpora remain the whole feature: instant, reproducible, and better. The measurements and sample output are written up in `docs/dev/plans/far-fetched.md`, including what would have to change for the answer to be different.
* Fixed flaky browser tests and improved test reliability.
* Improved service-worker activation and offline asset handling.
* Improved accessibility across the new tools.
* Improved documentation and brought version information up to date.
* Added extensive validation and test coverage for the new tools and database migrations.

# 0.3.0 — August 22nd, 2026

## Features

* Added **Docker Compose** project generation, templates, snippets, import/export, and validation.
* Added **Notebook drawings** with Excalidraw support.
* Added generator previews and additional placeholder options.
* Expanded the **ASCII Art** font library.
* Added **placeholder image generators** and seeded generation.
* Added a redesigned **sidebar** with Productivity, Security, and DevOps categories.
* Added **Settings** consolidation and navigation improvements.

## Improvements & Fixes

* Improved offline support and service-worker caching.
* Consolidated Base64 handling across the application.
* Improved documentation, accessibility, and test coverage.
* Fixed various UI, worker, and performance issues.

# 0.2.1 — August 21st, 2026

* Added **JSON/YAML/TOML/CSV conversion** to the configuration playground.
* Improved **Notebook** note creation, editing, bulk operations, and navigation.
* Added improved **Secrets** organization.
* Added reusable collapsible and custom-header cards.

# 0.2.0 — August 21st, 2026

* Added the **Notebook** with Markdown/WYSIWYG editing, nested notes, wiki links, footnotes, diagrams, math, images, and export.
* Added **Notebook bulk operations** for export, tagging, moving, and deletion.
* Added linked-note navigation and automatic aliases.
* Added Markdown rendering improvements and editor tooling.
* Added offline-safe storage and improved data migrations.

# 0.1.0

* Initial release.
