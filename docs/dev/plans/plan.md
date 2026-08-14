# useful — Product Plan

The purpose of this project is to provide a set of standardized utilities that are installable offline as a PWA.

> Refined 2026-08-13. Changes from the original draft: fixed section numbering and typos; corrected the SVG-editor reference (the `local-sync-template` "editor" page is a database schema editor — the actual seed is the icon designer's layer-based SVG panel); recorded four product decisions (background remover model is lazy-downloaded, the raster image editor is session-only, photography calculators use total-light equivalence, timezone lookup bundles a city database) plus one platform-forced constraint (notifications fire only while the app is open — with no server there is no push, so the original's unqualified "show a notification" cannot be delivered for a closed app); and added the cross-cutting sections (data model, notifications & permissions, testing, navigation & search, accessibility, PWA/offline) that the feature list implies but never stated. Everything else from the original feature list is preserved.

## Features

### 1. Time

#### 1.1 Timers

1. Multiple concurrent timers, each with:
    1. A label
    2. A longer markdown description (rendered as sanitized HTML)
2. Completion actions, individually configurable per timer:
    1. Play a sound on completion
    2. Vibrate on completion (feature-detected; effectively Android-only — the toggle is hidden or annotated "on supported devices" elsewhere)
    3. Show a notification on completion
    4. The last-used completion settings are stored as defaults (on the `preferences` singleton) and auto-fill when creating or updating timers in future
3. Persistence: timers live in IndexedDB. A running timer stores its **absolute end timestamp** (`end_at`); a paused timer stores remaining milliseconds. Display recomputes from the wall clock — there are **no per-tick writes** — so timers survive reload, navigation, and background-tab throttling without drift. Finished timers remain as re-runnable presets until deleted.
4. Platform limitation (applies to all notifications in this app — see [Notifications & permissions](#notifications--permissions)): completion actions fire only while the app is open in some tab or installed-PWA window. Completions that elapse while the app is closed are surfaced as "missed" on next open.

#### 1.2 Timezone conversion

1. Pick two timezones (both defaulting to the user's current zone), set a time in one, and see the corresponding time in the other. DST-correct via the browser's built-in IANA database (`Intl.DateTimeFormat`) — no tz data shipped.
2. Look up what timezone is active for a location, fully offline:
    1. Fuzzy search over the browser's IANA zone list (`Intl.supportedValuesOf('timeZone')`, ~400 principal cities)
    2. Plus a bundled GeoNames-derived city → timezone dataset (cities with population ≥ 15k, a few MB) for arbitrary-city lookup. Lazy-loaded as its own chunk on first use of the lookup, then cached for offline.
    3. "Use my current timezone" via `Intl.DateTimeFormat().resolvedOptions().timeZone`
3. Stateless aside from remembering the last-used zone pair in preferences.

#### 1.3 Stopwatch

1. Standard lap semantics: start / pause / resume / reset, with a lap list.
2. One stopwatch, persisted as a singleton row (start epoch + accumulated elapsed + laps) so it survives reload and navigation. Writes happen only on user actions (start/pause/lap/reset), never per tick.

### 2. Scheduler

An interface to manage events and TODOs, inspired by JIRA/Linear and [donetick](https://donetick.com/) (visual and interaction inspiration only — no custom statuses or columns in v1).

#### 2.1 Events

1. Title (required), optional markdown description
2. Start date and time; optional end time or all-day flag
3. No recurrence for events in v1 (recurrence is TODO-only, as originally specified)

#### 2.2 TODOs

1. Title
2. Markdown-based description
3. Due date: a calendar date with an optional time
4. Priority (low / medium / high / urgent)
5. Workflow: TODO → In Progress → Completed (three fixed states)
6. Comments: an append-only list of timestamped comments (JIRA-style), each rendered as markdown and individually editable/deletable. Stored as child records with a foreign key to the TODO — not as an array on the TODO row — so edits stay isolated and the FK integrity checks in the test oracle apply.
7. Recurring TODOs, donetick-style: the recurrence rule lives on the TODO (every N days/weeks/months, or specific weekdays — no full RRULE). **Completing a recurring TODO marks that row completed and creates exactly one successor row** (linked via `recurrence_parent_id`) inside the same explicit user action. Occurrences are never materialized as a side effect of rendering a page (see [Data model](#data-model) — the test suite enforces "page load writes nothing").

#### 2.3 Views

1. Calendar view (month first; week/day are nice-to-haves) showing events and dated TODOs
2. List view and kanban board (three fixed columns matching the workflow), with a toggle between them. Undated TODOs appear in list/kanban only.
3. Kanban drag-reorder uses a per-card rank key, so reordering one card writes exactly one row.

#### 2.4 Notifications

1. Same completion-action settings as timers (sound / vibrate / notification): global defaults plus a per-item toggle
2. Fire at the due time (TODOs with a time set) or event start; date-only items produce no timed notification
3. Same platform limitation as timers: fires only while the app is open; missed items are surfaced on next open

### 3. Images

#### 3.1 SVG editor (layer-based)

1. A layer-based SVG editor with basic tools to create SVGs.
2. Start from the **layer-based icon SVG editor** in `local-sync-template` — `src/components/generate/icon/SvgPanel.svelte` plus `src/lib/icon/model.ts` and `src/lib/icon/build.ts` (layer stack with z-order, drag positioning, pure-function SVG composition, hardened paste/namespace utilities). **Not** the template's "editor" page (`src/pages/editor.astro`), which is a database schema editor.
3. Generalize the seed: user-set canvas/viewBox size (not fixed 256×256), independent per-layer width/height, on-canvas hit-testing/selection with drag handles, and undo/redo.
4. Layer kinds: the seed's shapes (rect, circle, triangle, star, text), pasted-SVG layers (copy-pasted SVGs added as layers), plus new drawing tools:
    1. A line segment tool with bezier control-point options
    2. A free-form shape where you specify the number of edges and can re-organize/edit the points afterward (Illustrator-style)
5. Fill and stroke options for layers where they make sense (fill color, stroke color, stroke width).
6. Persistence: named documents in IndexedDB (`svg_documents`; layers stored as JSON — text-only, so they round-trip the data layer and JSON backup cleanly). Resume on reopen.
7. Export to SVG or PNG/JPG (rasterized at a chosen size):
    1. Downloadable
    2. Copyable:
        1. SVG as text (`clipboard.writeText`)
        2. As an image: the clipboard receives PNG (the async Clipboard API only accepts `image/png` for images — a JPG *download* stays JPG; the UI labels this)

#### 3.2 Raster image editor (layer-based)

1. **Session-only workspace** (decision): import → edit → export. Projects do not persist across sessions — binary image data cannot pass through the JSON-round-trip data layer (see [Data model](#data-model)), and base64 persistence would bloat rows and backups. Revisit as its own design if needed.
2. Tools: crop, rotate, eraser, paintbrush, draw arrows, add text layers, darken, lighten, blur portions (region select)
3. Metadata:
    1. View all EXIF/metadata (read via `exifr`)
    2. One-click strip-all (privacy)
    3. Edit common JPEG tags (artist, copyright, date, description; GPS removal), re-embedded on JPEG export via `piexifjs`
    4. Canvas re-encoding strips metadata by default; the UI states which exports carry metadata. Metadata *editing* is scoped to JPEG output as a v1 decision (PNG does have an `eXIf` chunk and text chunks, but library support for writing them is thin — defer, don't treat as impossible).
4. Export as PNG or JPG (quality slider for JPG):
    1. Downloadable
    2. Copyable (clipboard receives PNG, labeled as above)

#### 3.3 Converters

1. SVG, AVIF, WebP, or TIFF → PNG or JPG
2. PNG → JPG
3. JPG → PNG
4. Notes: deliberately no WebP/AVIF *outputs* (canvas AVIF encoding is not broadly supported). AVIF/WebP decode natively in current browsers; TIFF needs a small bundled decoder (`utif2`, ~50KB) and fails gracefully on exotic variants; SVG is rasterized at a user-chosen output size. Single file at a time; JPG quality slider.

#### 3.4 Background remover

1. ML-based, fully client-side (onnxruntime-web-class runtime + segmentation model), all assets **self-hosted** — never a third-party CDN.
2. **Decision:** the model (~30MB quantized) is lazy-downloaded on first use of the tool with a visible "Download model (~30MB) for offline use" state, then runtime-cached by the service worker. It is excluded from the install precache, so installs stay light; the tool needs one online visit before it works offline.
3. Verify the model license before adoption (prefer permissive — e.g. Apache-2.0 U²-Net family; `@imgly/background-removal` and BriaAI RMBG have restrictive terms).
4. Fallback: the manual eraser in the image editor.

#### 3.5 Resizer

1. Resize raster images (target dimensions or percentage, aspect-ratio lock), export with the standard download/copy conventions.

#### 3.6 Compressor

1. Recompress JPG (quality slider) and PNG (re-encode, optional dimension cap), with before/after file-size display, export with the standard download/copy conventions.

### 4. Calculators

Organized in sub-categories:

#### 4.1 Coding

1. Number conversion:
    1. Convert between binary, hexadecimal, octal, **and decimal** representations
    2. A bit-width selector (8/16/32/64) governing the operations
    3. Operations: two's complement, one's complement, bitwise NOT (an open set — more can be added)
    4. Each conversion and operation has a clickable drop-down explaining how to do it by hand

#### 4.2 Photography

1. Equivalent settings calculator:
    1. Set the sensor format (micro 4/3 — crop 2.0, APS-C — crop 1.5 with a Canon 1.6 option, full-frame — crop 1.0)
    2. Set focal length, **aperture**, shutter speed, and ISO
    3. See the **total-light-equivalent** settings across the other formats: focal length × crop, f-number × crop, ISO × crop², shutter unchanged (e.g. 20mm f/2.8 on micro 4/3 ≈ 40mm f/5.6 at 4× the ISO on full-frame). Displayed values snap to the standard 1/3-stop scale.
    4. An explainer drop-down clarifies the model — per-area *exposure* is identical across formats at the same settings; what differs is total light gathered (noise/depth-of-field equivalence).
2. Light stop calculator:
    1. Dial in the same settings as the equivalent settings calculator, plus a second set of settings
    2. See the difference in stops, computed exactly: shutter `log2(t1/t2)`, ISO `log2(i1/i2)`, aperture `2·log2(N1/N2)`, sensor `2·log2(crop1/crop2)` (micro 4/3 vs APS-C is ~0.8 stop of total light — the original plan's "~-1/3 stop" example did not match any standard model and is superseded by this definition)

#### 4.3 Networks

1. File transfer calculator:
    1. Put in the size of a file (unit selector: KB/MB/GB/TB)
    2. Put in the approximate network speed (unit selector: Kbps/Mbps/Gbps and KB/s / MB/s — bits vs bytes made explicit)
    3. Get a time estimate for the transfer (decimal units throughout; optional overhead % field, default 0)

### 5. Generators

#### 5.1 CSS

1. Color conversion:
    1. Convert between any CSS standard color format — hex, RGB(A), HSL, HWB, Lab, LCH, OKLab, OKLCH, named colors — with a color-picker UI (e.g. take a hex or RGBA and convert to OKLCH or RGB)
2. Gradient generator:
    1. CSS gradient builder (linear/radial/conic, multi-stop) with live preview and copyable CSS
3. Glassmorphism generator:
    1. Backdrop blur / transparency / border controls with live preview and copyable CSS

#### 5.2 Regex

1. Take a regex (and flags) and generate idiomatic compile / match / find-all snippets for:
    1. Go
    2. Rust
    3. JS
    4. Python
2. Correct escaping per language (Python raw strings, Go backtick literals, Rust `r#"..."#`, JS regex literals) and flag mapping; `(?<name>)` groups are rewritten to `(?P<name>)` for Python.
3. A small construct scanner detects RE2-incompatible features (lookahead/lookbehind, backreferences) and shows a warning on the Go/Rust snippets (their standard engines don't support them) instead of silently emitting broken code.

#### 5.3 QR code

1. Creator:
    1. Text input, with URLs as the primary use case
    2. Size and error-correction level options
    3. Export as PNG and SVG using the standard download/copy conventions
    4. Reference implementation: <https://kieranwood.ca/components/stacks/astro-svelte/editors/qr-code-generator/>
2. Reader:
    1. Upload an image
    2. Or use the camera (permission requested in context; upload remains the fallback if denied). Decoder: `qr-scanner` (uses the native `BarcodeDetector` fast path where available, JS fallback elsewhere) — fully offline.
    3. See the data in the QR code
    4. If it's a link, render it as a clickable link as well (but never auto-open it)

### 6. Quick-action panel

1. `ctrl+k` (`cmd+k` on macOS) brings up a quick-action panel (like Spotlight on macOS) to access any tool quickly by name. A visible search button in the header opens the same panel on touch devices.
2. Backed by a **static tool registry** (name, aliases/keywords, category, route, icon) compiled into the build — the registry is the single source of truth that also drives the sidebar navigation, so search and nav can never drift. Matching is client-side fuzzy matching (name matches ranked first).
3. Pagefind is not used: the built pages are empty `client:only` shells, so there is no static HTML content for it to index — the registry *is* the statically generated search index. (Pagefind remains an option later if full-text page search is ever wanted.)

## Technical details

The project was initially generated with [local-sync-template](https://github.com/Descent098/local-sync-template). It already has all of the necessary pieces to be a fully working installable PWA (IndexedDB data layer with sync bookkeeping, JSON backup, service worker, Playwright data-integrity suite). Key technical guidance:

1. The site MUST be fully statically buildable and must not rely on any server.
2. Everything should be componentized into either an Astro or Svelte component.
3. Layout: a collapsible sidebar navigates the features, grouped by category; each feature lives on its own page. The existing Settings and Preferences pages are retained and reachable from the sidebar (Backup is a section of the Settings page, not its own route). Below a stated breakpoint the sidebar collapses to an off-canvas drawer with a hamburger toggle; all tools remain usable at 360px width.
4. Use view transitions (Astro `<ClientRouter />`) so page changes feel native. Islands are destroyed and remounted on navigation, so **all tool state derives from IndexedDB** (absolute timestamps, not component memory). One small always-mounted timer/notification engine island lives in the shared layout with `transition:persist` so timer alarms fire while the user browses other tools.
5. The quick-action panel uses the static tool registry described in [§6](#6-quick-action-panel) (statically generated at build time, satisfying the "static search index" requirement without pagefind).
6. Plain CSS — no Tailwind or frameworks. Use the existing design tokens in `src/styles/theme.css` and utility classes in `src/styles/global.css`.
7. Theme: construction-blueprint design system (decided 2026-08-13, superseding the original amber-accent look). Light theme is dark-blue ink on white drafting paper; dark theme is chalk-white lines on a cyanotype blue field. The language: a two-scale graph grid behind the content, the content column framed as a drawing sheet (heavy rule + faint offset outer rule), square corners everywhere, letterspaced uppercase mono annotations, corner registration marks on cards, and a single amber "stamp" accent for section labels, focus rings, and markers. All tokens in `theme.css` via `light-dark()`; new tools must build from these tokens.
8. Markdown rendering (timer descriptions, TODO bodies, comments): `marked` (GFM on) piped through `DOMPurify` before insertion — sanitization matters because backup-JSON import is an injection vector into rendered HTML.

### Data model

IndexedDB is the source of truth (see `README.md`). New persistent stores this plan introduces:

| Store | Kind | Shape (domain fields; every row also carries the sync fields `id`, `updated_at`, `deleted_at`, `server_seq`) |
|---|---|---|
| `timers` | multi-row | `label` text, `description_md` text, `duration_ms` int, `end_at` timestamp\|null (absolute deadline while running), `paused_remaining_ms` int\|null, `state` `'idle'\|'running'\|'paused'\|'done'`, `sound`/`vibrate`/`notify` booleans |
| `stopwatch` | singleton | `started_at` timestamp\|null, `elapsed_before_pause_ms` int, `laps` json, `state` text |
| `events` | multi-row | `title` text, `description_md` text\|null, `start` timestamp, `end` timestamp\|null, `all_day` boolean, `notify` boolean; index on `start` |
| `todos` | multi-row, `fieldMerge` | `title` text, `description_md` text, `due_date` date\|null, `due_time` text\|null, `priority` text, `status` `'todo'\|'in_progress'\|'completed'`, `completed_at` timestamp\|null, `recurrence` json\|null (rule on the todo), `recurrence_parent_id` text\|null → `todos`, `rank` text (fractional ordering key for kanban), `notify` boolean; indexes on `status`, `due_date` |
| `todo_comments` | multi-row | `todo_id` text → `todos`, `body_md` text |
| `svg_documents` | multi-row | `name` text, `width`/`height` int, `layers` json (array of `{id, name, z, kind, params, fill, stroke, visible}` — JSON-native only) |
| `preferences` | singleton, `fieldMerge` | extended with per-tool defaults: timer completion defaults, last-used timezone pair, last-used sensor format, converter quality, board view prefs, etc. |

**Stateless tools (no store):** timezone converter (aside from the prefs fields above), all image converters, background remover, resizer, compressor, the raster image editor (session-only by decision), all calculators, all generators (CSS, regex, QR), and the quick-action panel. Roughly 15 of the ~20 tools never touch the database — do not add tables reflexively.

**Rules for every schema change** (the schema lives in *three* places that move in lockstep):

1. `src/lib/db/types.ts` — entity interface + `STORES` entry (indexes, `singleton`, `fieldMerge` flags)
2. A new migration **appended** in `src/lib/db/db.ts` (never edit a shipped one). Every store-creating migration must guard with `if (!db.objectStoreNames.contains(name))`: the shipped v1 migration iterates the *live* `STORES` map, so an unguarded `createObjectStore` in a later migration throws `ConstraintError` on fresh installs. Batch one migration per plan phase, not one per tool.
3. `tests/local/helpers/schema.ts` — the test oracle's `TABLES` mirror (column types, nullability, `references`, `singleton`, `fieldMerge`). Once mirrored, the generic suite (backup round-trip with hostile values, patch isolation, tombstones, FK invariants) covers the new store automatically.

Plus: update the Tables section of `README.md`, and record the change in `CHANGELOG.md` (a schema change is at least a minor version bump; note the new DB version, since backup import rejects files with `schemaVersion` newer than the app).

**Write-path rules (sync hygiene):**

1. All writes go through `src/lib/db/repo.ts` — never `getDB().put` — so every change lands in the sync outbox.
2. Use `patch()` for edits (it re-reads fresh inside the transaction; whole-row `put` from a stale snapshot reverts concurrent changes).
3. Singletons (`stopwatch`, `preferences`) only via `getSingleton`/`putSingleton`.
4. Rows must be JSON-native: ISO strings not `Date`s, and **no `Blob`s/typed arrays/`Map`s/`Set`s** — `repo.ts` JSON-round-trips every caller-supplied row (to strip Svelte `$state` proxies), which silently destroys binary data. This is why the raster image editor is session-only.
5. **Page load writes nothing** — the test suite asserts a full DB dump is identical across page loads. Recurring TODOs materialize successors only inside the explicit complete action; timers/stopwatch write only on user actions and never per tick.

### Notifications & permissions

1. Hard platform limit: with no server there is no Web Push, and the Notification Triggers API is dead. **Sound/vibration/notifications fire only while the app is open** in some tab or installed-PWA window. On next open, the app detects and surfaces timers/TODOs/events that completed while closed. This limitation is documented in the UI wherever notification settings appear.
2. Notifications are shown via `registration.showNotification()` from the service-worker registration (the `new Notification()` constructor throws on Android Chrome). Permission is requested in context, from a user gesture, the first time a user enables a notification action — never on page load.
3. Vibration is feature-detected (`'vibrate' in navigator`) and effectively Android-only; the toggle is hidden or annotated elsewhere. Sound keeps an `AudioContext` resumed from the enabling user gesture so autoplay policy can't block playback at fire time. On iOS, web-app notifications exist only for installed home-screen apps (16.4+) and are push-oriented — treat notifications there as best-effort and sound as the reliable channel.
4. Camera (QR reader) permission is requested in context; denial degrades gracefully to upload-only.
5. Every permission denial and unsupported capability has a graceful, explained fallback.

### Testing

1. **Unit tests (Vitest via `npm run test:unit` — neither exists yet; added in Phase 0):** all pure calculation/conversion logic lives in plain TS modules under `src/lib/` with unit tests — number-base conversion and bit operations, photography equivalence/stop math, transfer-time math, color conversions, regex construct scanner and snippet escaping, recurrence next-occurrence math, timezone/city lookup search, SVG geometry/composition helpers.
2. **Playwright (existing harness):** per-feature specs drive the real UI, then assert through the test hook (`window.__useful`) and oracle helpers — e.g. creating a timer writes exactly one row (`assertIsolatedDelta`); "remember defaults" touches only the `preferences` singleton; a kanban drag writes only the moved card's `rank`; completing a recurring TODO creates exactly one successor and is idempotent; SVG documents survive save → reload byte-identically; exports perform zero DB writes.
3. Features that touch both frontend and the data layer need both kinds of coverage (UI spec + unit tests) — this is a standing requirement from `docs/dev/plans/TODO`.
4. The trust-gated data-integrity suite (`npm test`) must stay green; keeping the `TABLES` mirror current is what extends its generic coverage to each new store.

### PWA / offline

1. Every new page is added to the `SHELL` precache list in `public/sw.js`, and `CACHE_NAME` is bumped on meaningful service-worker changes.
2. Large lazy assets follow the "download for offline" pattern: the background-removal model and the city→timezone dataset load on first use and are runtime-cached; they are excluded from the install precache.
3. Acceptance bar: after one online install, everything except not-yet-downloaded lazy assets works in airplane mode.

### Accessibility

1. WCAG AA contrast for the amber-accent theme in both light and dark.
2. Full keyboard operability — including the quick-action panel (focus trap, arrow navigation, focus restore on close) and kanban interactions (keyboard move between columns).
3. ARIA live-region announcements for timer/stopwatch state changes and long-running operations (model download, conversions).

### Versioning & releases

Per `README.md` and `docs/dev/plans/TODO`: `VERSION` is authoritative (plain semver); every change lands in `CHANGELOG.md` under the current unreleased version's **Features / Bug Fixes / Other** headings (bump the version and open a new heading if the latest one has a release date). Schema changes are at least a minor bump and call out the new DB version. One-time cleanup: sync `package.json`'s `version` (currently 0.0.1) to `VERSION` (0.1.0).
