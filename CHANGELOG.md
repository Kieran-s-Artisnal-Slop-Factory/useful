# 0.2.0 (unreleased)

## Features

- **Napkin math** (`/tools/napkin-math/`): write a formula and get a little
  calculator for it. Its variables become typed input fields — whole number or
  not, positive-only or not, zero allowed or not, required or not — the result
  updates as you type, and named calculations save beside the formula so you
  can come back to the numbers you ran through it. Templates live in a
  searchable library, and export and import as JSON.
  - **The fields come from the engine, not from a tree walk.** A sum from 1 to
    `n` asks for `n` and not its index; π r² asks for `r` and not π. Walking
    the expression gets both wrong and asks you to supply a value for pi.
  - **Code generation** turns a template into a real function in **Python,
    JavaScript, Go or Rust**, with the description as its docstring, the fields
    as typed parameters, and each field's rules as guard clauses — so the
    generated function refuses what the page refuses. Or into a
    **dependency-free web component**: one `.js` file, no build step, styleable
    from outside with `::part()`. A test loads that generated file in a real
    page and checks it computes the same answer the app did.
  - **An operator the generator has no rule for is refused by name** rather
    than guessed at. An integral is a perfectly good formula with no
    plain-function form, and the tool says so instead of emitting something
    that looks right.
  - **Where a language disagrees with the maths, the generated file carries a
    helper.** This page rounds a half away from zero; Python rounds to even and
    JavaScript rounds upward, so `-2.5` would otherwise come back as three
    different numbers. The remainder of a negative number is the same story in
    three of the four languages.

- **The SQL playground's two tables became real data grids.** retoken's
  `DataTable` is ported, and both the query results and the database browser now
  have a search box, an AND/OR filter tree (so `A AND (B OR C)` is expressible,
  not just a list), sortable headers, paging and CSV export. The **200-row
  results cap and the "add a LIMIT" hint are gone**, and so is the 50-row sample
  the browser used to show.
  - The two run in opposite modes, because of where the rows already are. The
    **results** grid works client-side over rows `exec` already returned, so
    filtering and sorting cost nothing. The **browser** compiles its filter tree
    to a parameterized `WHERE`, its sort to `ORDER BY`, and pages with a keyset
    seek when the table has a single-column primary key — so a million-row table
    pages without ever sending a million rows.
  - **The row count under the browser is now the real one.** It used to report
    the size of the 50-row sample it had fetched.
  - **A query that returns no rows now shows its columns.** A new
    `execDescribed` asks the engine what the result set's shape is, so
    `select id, name from t where 1 = 0` renders an empty grid with two headers
    rather than reading as a broken query.
  - None of it is saved: filters, sort and page reset when you switch tables,
    switch engines or reload. Loading a page and looking around still writes
    nothing at all.

- **Logo generator** (`/tools/logo-generator/`): square logos, app icons and
  avatars, ported from [retoken](https://github.com/Descent098/retoken)'s icon
  designer. **Generators** turn text into a picture — 31 DiceBear avatar styles
  or a Jdenticon identicon with its own hue, saturation, lightness, background
  and padding controls — and **Badge** composes one from a Lucide icon or an
  emoji on a coloured tile. Download SVG or PNG at any size, copy either to the
  clipboard, or hand the result to the SVG editor as a document to take apart.
  Nothing is stored: the output is a pure function of the settings, so the page
  writes to the database only when you press "Open in SVG editor".
  - Retoken's **Upload** and **SVG editor** tabs are not ported. This app already
    has image tools and a far better vector editor — both forks of the same
    lineage — so the logo hands off rather than carrying a second, weaker builder.
  - **The tool tells you what each style's licence asks for.** 14 of the 31
    DiceBear styles are MIT; 13 carry CC BY 4.0 artwork that must be credited
    wherever the logo appears; and 4 (avataaars and bottts, in both variants) ship
    under a bespoke "free for personal and commercial use" notice that is not an
    open-source licence. The map is committed data, because a browser cannot read
    `package.json` — so a unit test reads the installed packages and fails when an
    upgrade relicenses a style, rather than letting an owed attribution disappear.

- **Sprite editor** (`/tools/sprite-editor/`): pixel art on a character grid,
  ported from [retoken](https://github.com/Descent098/retoken). Every character
  in the grid paints one colour and the legend says which, so a sprite is a
  picture written as text — it reads as a diff, rides a backup unchanged, and
  pastes between projects. Drag or type to paint, arrow keys walk the grid, 4-48
  a side, eight animations in the preview, and fifteen creature examples to pull
  apart. Undo/redo covers everything, with one drag counting as one step however
  many pixels it crossed. Export as TXT, JSON, SVG or PNG (rasterized at its
  final size, so the pixels stay hard-edged), and import any sprite JSON —
  including retoken's own files.
- **Secrets** (`/tools/secrets/`): twenty-seven generators for passwords, keys,
  tokens and identifiers — strong and passphrase passwords, API keys, JWT
  signing secrets sized to their algorithm, AES keys, salts and IVs, Django /
  Laravel / Flask / WordPress secrets, UUID v4 and v7, MongoDB ObjectIds, Wi-Fi
  passphrases, TOTP secrets, recovery keys and backup codes. Each card shows how
  much entropy its value actually carries, computed from the alphabet and length
  in use. Nothing is stored, sent, or put in the address bar: values live in the
  tab until you replace them.
  - Characters are drawn by **rejection sampling** over `crypto.getRandomValues`.
    Taking a random byte modulo an 88-character alphabet — the obvious way, and
    what the site this catalogue came from does — makes the first 80 characters
    half again as likely as the last 8.
  - Identifiers are labelled as identifiers rather than given an entropy figure.
    A UUID is unique, not unguessable, and printing "122 bits" beside one invites
    somebody to use it as a session token.
  - **UUID v7** is offered beside v4: its first 48 bits are the timestamp, so ids
    sort by creation time instead of scattering through an index. There is no
    native API for it, so it is built here, counter included so two minted in the
    same millisecond still increase.
  - **No WEP**, and the page says why: it has been breakable in minutes since
    2007. The TODO asked for WEP and 160/504-bit WPA keys because
    randomkeygen.com used to offer them — that site has since been rebuilt and no
    longer does.
- **Week and day calendar views.** The calendar gained Month / Week / Day.
  Week and day lay the hours down the page: timed events sit at their time and
  are as tall as they are long, entries that overlap share the width side by
  side, and all-day events, multi-day spans and TODOs with no time sit in an
  all-day lane above the hours. Dragging onto the hours sets the **time** as well as the
  day — snapped to the quarter hour, with a line showing where it will land, and
  the event keeps its length — while a drop on the month grid still changes only
  the date. Every empty hour is a real button, so creating an event at a time is
  a keyboard path and not only a drag. All three grids share one position, so
  switching from month to week lands where you were looking rather than jumping
  back to today, and the choice is remembered in its own preference.
- **Week starts on Sunday or Monday**, your choice, in Preferences — read by the
  month grid and the week grid alike.
- A multi-day event now appears on every day it covers in the week and day
  grids. The month grid only ever showed it on its start day.
- A TODO with a time of day sits **at that time** in the week and day grids,
  beside the events, rather than in the all-day lane — the lane is for things
  with no time, so a TODO goes there only while it has a date and no time.
  Adding a time moves it out of the lane immediately, clearing one puts it
  back, and dragging one into the lane is a way to remove its time.
- **Events repeat.** A calendar event takes the same repeat rule TODOs have —
  every N days/weeks/months, or chosen weekdays — with an optional end date,
  and every occurrence shows on the calendar marked with a ↻. Only ONE row is
  ever stored: occurrences are computed as the calendar draws them, so a series
  that repeats forever costs the same as a one-off and there is no list of
  future copies to maintain. (A repeating TODO still spawns its successor when
  you complete it; an event has no "done", so it had to work the other way.)
- Changing or deleting one day of a series asks what it applies to — **this
  event**, **this and following**, or **all events** — with Google's semantics:
  a day you changed on its own keeps its own values when the series is edited
  later. Dragging one occurrence to another day is "this event", and costs
  exactly one new row; the series itself is not touched.
- A repeating event keeps its **time of day across daylight saving**: a 09:00
  meeting is at 09:00 on both sides of the change. Occurrences are worked out in
  the device's current timezone, so travelling moves the series to your new
  local time. "Every month" from the 31st gives Feb 28, Mar 31, Apr 30 — the
  step counts from the original date rather than compounding the clamp.
- Notifications understand series: the due scan asks for each event's next
  occurrence and keys its notice per occurrence, so next week's meeting is a
  separate banner and an occurrence you edited is not announced twice.
- TODO recurrence gained the same optional **Until** date, through a repeat
  editor now shared by both.

- **Image editor: colour fills carry transparency.** A fill layer takes any CSS
  colour you can write — `transparent`, `rebeccapurple`, `#ff000080`,
  `rgb(255 0 0 / 50%)`, `oklch(…)` — with an alpha slider, a preview swatch over
  a transparency checkerboard, and Transparent/White/Black shortcuts. The
  canvas always rendered these correctly; what was missing was any way to reach
  them, and a native colour picker that quietly flattened alpha every time you
  used it.
- **Transparent layers**: "+ Transparent layer" adds a fill that paints
  nothing — a hole to draw into, or a tint slot to fill in later. A blank
  canvas started as "Transparent" now gets a real `Background` layer too
  (previously it got no layers at all, which made the background the one thing
  in the document you could not recolour, hide or delete).
- The layer list's colour dots sit on a checkerboard, so a translucent or fully
  transparent fill reads as what it is instead of blending into the row.
- A colour that is not a colour now paints **nothing** instead of solid black.
  Canvas ignores an unassignable `fillStyle` and keeps whatever the context had,
  which in a fresh buffer is opaque black — so one typo in a fill, stroke, arrow
  or text colour used to drop a black rectangle over the picture.
- Exporting as JPG says so when the picture actually contains see-through
  pixels — read from the rendered image, not guessed from the layer list, so it
  is not on permanently for a document whose transparency is covered up.

## Bug Fixes

- **The post-install "make it work offline?" offer could come back after you
  answered it.** It recorded the answer only from the "Not now" button, so
  closing it with Escape left no trace and the next launch asked again — and
  finishing the download inside the dialog did not count as an answer either.
  Every exit from the dialog now records one, exactly once.
- **Importing a backup preselected the destructive option.** "Restore" (which
  empties every table the file covers before loading it) was the mode already
  chosen when you reached the Import button; **Merge** is now the default, and
  `importData()` defaults to merging too — a caller that forgets the argument
  should not be able to wipe a device. Restore is one click away and still
  behind its confirmation.
- Searching for "heic" no longer lands on the image converter, which cannot
  decode HEIC — an alias that takes you to a tool that will refuse your file is
  worse than no result.
- `SyncFields.field_updated_at` carried a comment claiming nothing consumed the
  per-field stamps yet. `foldFieldMerged` has consumed them since 0.1.0, and the
  data suite proves it; the comment now says what the code does.

## Other

- **Napkin math: saving a calculation no longer refuses silently.** The button
  was live, the template had never been written, and the only clue was a
  transient line at the far end of a long page. Saving a calculation now saves
  the formula with it — under "Untitled" if it has no name yet — and a template
  needs only a formula, not a name.
- Napkin math: fields gained a **description**, shown beside the input and
  carried into every language's generated docstring. `NapkinField` is inside a
  JSON column so this needed no migration, which is exactly why every reader
  normalises a field it loads.
- Napkin math: **whole-number** is a "No decimals" checkbox rather than a
  two-option dropdown, and an untouched required field no longer shows a
  complaint that crowds out its own description.
- Napkin math: the generated code, the live template JSON and the import box
  are **syntax-highlighted**. Prism for the read-only output; the import box
  keeps a real textarea with a highlighted underlay behind it, so selection,
  undo and paste all still work.
- **Generated docstrings follow each language's own convention**: NumPy-style
  sections for Python, the `# Parameters` block form for Go, terse `///` lines
  for Rust that leave the type to the signature, JSDoc for JavaScript. The
  formula is emitted as Markdown maths (`$\(costPerMonth*12\)*years$`) rather
  than the editor's `\left(\mathrm{...}\right)`.
- Two generator bugs found by reading the output: **Go identifiers were
  snake_case** (which `gofmt` will not fix and every linter flags — they are now
  camelCase with an exported function name), and **`toCamel` destroyed an
  existing camelCase name**, turning `costPerMonth` into `costpermonth` in both
  Go and JavaScript. Plus one that would not have compiled at all: **Rust
  cannot compare an `f64` with an integer literal**, so its guards now use
  `0.0`.
- **Sums, products and integrals now generate code.** Each becomes a small
  emitted loop helper taking the bounds and a closure over the bound index —
  `lambda x:` in Python, `(x) =>` in JavaScript, `func(x float64) float64` in
  Go, `|x: f64|` in Rust — so one helper per operation covers every occurrence
  and the closure captures the outer parameters itself. A bound index that
  would shadow a parameter is renamed. An integral is Simpson's rule with 1000
  intervals and the generated code says so: exact for low-order polynomials,
  approximate otherwise, which is also how this page evaluates one.
- The formula box gained **insert buttons** for sum, product, integral,
  fraction and root. Each drops a skeleton that already parses and already has
  bounds, so the field list appears at once — through the mathfield's own
  `insert` command, so it lands at the cursor rather than replacing the value.
- **The Code card forgets a formula when the formula changes.** Generated
  source, and especially a refusal like "this formula uses Sum", describes one
  formula; it used to stay on screen while the reader typed a different one,
  and after starting a new template. It now clears on every formula change, on
  opening another template, and on New.
- **The generated web component now shows a typeset formula**, not
  `$\(costPerMonth*12\)*years$` as text. The markup comes from
  `convertLatexToMarkup` in MathLive's main entry — already loaded on that page,
  so it costs nothing extra — and travels with MathLive's layout rules and the
  handful of KaTeX faces the formula actually needs, embedded as `data:` URIs
  inside the component's shadow root. Which faces those are is measured by
  rendering into a throwaway shadow root and reading back the computed
  `font-family`, rather than mapped from class names that would go stale. A
  plain-name formula is one face and about 48 KB; a fraction with single-letter
  variables is two and about 71 KB. A test loads the result on a page that has
  never seen MathLive and asserts it renders and makes no network requests.
- The generated web component **no longer says "x is required" before anyone has
  typed anything** — an empty required box means "no answer yet", the same rule
  the page itself now follows.
- The generated web component's header shows a **worked styling example**
  instead of naming its parts in prose, and a field description becomes the
  `title` on its input.
- Database schema **v10**: new `napkin_templates` (name, description, formula as
  both LaTeX and MathJSON, fields as JSON) and `napkin_calculations`
  (`template_id` FK, name, values, result), plus a
  `preferences.napkin_last_template_id`. Both stores are JSON-native, so they
  ride backup export/import. Deleting a template soft-deletes its calculations
  first — a calculation whose template is gone is unreachable.
- New dependencies for napkin math: `mathlive` (MIT, 801 KB chunk, 217 KB
  gzip) and `@cortex-js/compute-engine` (MIT, 2.53 MB chunk, 695 KB gzip —
  it is a full computer-algebra system, and the larger half of the pair). Both
  are `import()`ed inside the mathfield wrapper's mount, so no other route pays
  for them, and the **offline footprint grows by roughly 3.6 MB** once the
  service worker's crawl has cached both. **The Compute Engine is a
  direct dependency, not a transitive one**: MathLive bundles no import of it
  and looks it up on a global instead, so without importing it explicitly
  `getValue('math-json')` silently returns an empty expression.
- The **20 KaTeX faces** (263 KB) are vendored into `public/math/` by a new
  `tools/build-math-assets.mjs`, with per-file hashes in a provenance file that
  a unit test checks the byte total against. They get their own cache bucket
  (`useful-fonts-v1`) outside the app-cache prefix, so a cache-version bump does
  not evict them, and their own entry in Settings → Offline — the service
  worker's asset crawl walks fingerprinted chunks and cannot find a file
  referenced from a stylesheet's `url()`. Service worker cache bumped to **v15**.
- **MathLive's 259 built-in text shortcuts are switched off.** Any one whose
  trigger appears inside a variable name fires mid-word and corrupts the
  formula: typing `sqrtish` produced `\mathrm{\sqrt{ish}}` and typing
  `count*rate` produced `\mathrm{count\cdot rate}`, neither of which parses.
  Dropping only the offending entry fixed one case and not the other, and a
  shortcut timeout fixed neither. The cost is that `pi` no longer becomes π as
  you type; `\pi` and the virtual keyboard still do.
- The keypress sounds (227 KB of `.wav`) are never fetched, and a Playwright
  check asserts it — including on the "plonk" path an invalid keystroke takes.
- **Two bugs fixed in the port rather than inherited**, both in retoken's
  paging:
  - `SELECT count(*)` ran on every cursor seek. It is the one full scan left in
    that path, it is exactly what keyset paging exists to avoid, and its result
    was dead in that mode. It now runs only when a page number needs it, and the
    footer's row count is a separate, unfiltered count run once per table
    selection rather than once per page.
  - A NULL in the sort column made **Next** serve page one forever. The seek
    builder returned an empty clause for three unrelated situations — page one,
    no key value, and a NULL sort value — and only the first is benign; the
    other two produced a query byte-identical to page one while the pager
    believed it had advanced. It now reports `seekable: false` and the caller
    falls back to `LIMIT/OFFSET` under the *keyset* ordering, so the fallback
    page's boundaries line up with the pages either side of it.
- **Postgres needs `::text` before a text operator.** `lower()`, `trim()`,
  `ILIKE` and `~*` all take text, and Postgres raises rather than coercing when
  handed a `uuid`, an enum or `json` — which every table with a non-integer
  primary key hit on the first filter. The cast is applied to the identifier
  only, never to the bound placeholder (`$1::text` confuses parameter type
  inference) and never in the keyset seek (a bare `"id" > $1` is what
  index-seeks). SQLite emits no cast.
- **`toNumber('100 USD')` used to be `NaN`.** The strip pattern read `+-e` as a
  character range, keeping `A`-`Z` and `a`-`e`, so a number filter against a
  string-money column silently matched nothing. Fixed, with an explicit
  no-digits guard — stripping correctly makes `'abc'` reduce to `''`, and
  `Number('')` is `0`. `'100 EUR'` is still `NaN`, because a trailing `E` is a
  legal exponent marker.
- **Blanks now sort last in both directions**, agreeing with the `NULLS LAST`
  the SQL side emits either way. The comparison function was already right; its
  caller negated it for a descending sort.
- New shared module `src/lib/table/` (`types`, `format`, `filter`, `csv`,
  `to-sql`) with 193 ported Vitest cases, plus `src/lib/sql/table-schema.ts` (8)
  and a new `src/lib/sql/infer-schema.ts` (12). It has exactly one consumer
  today and imports nothing outward, so it stays a self-contained layer.
- Worker protocol gains `execDescribed` and `tableMeta`, both optional on
  `DatabaseSession` so an engine without them degrades to `exec`/`tableData`.
  `tableMeta` is what stops the browser fetching and discarding 50 rows on every
  table switch and after every run.
- New dependencies for the logo generator: `@dicebear/core` + `@dicebear/collection`
  (MIT code; 31 styles as one 2.0 MB lazy chunk, 672 KB gzip), `jdenticon` (MIT,
  328 KB chunk) and `lucide-static` (ISC, ~2,000 icons, 826 KB chunk). All three
  sit behind `import()` and each memo is cleared on failure, so a flaky fetch
  retries instead of wedging the tab; only DiceBear arrives with the page,
  because its avatar is the default view. The service worker's background crawl
  precaches them, so the **offline footprint grows by roughly 2.8 MB**.
- Service worker: `tools/logo-generator/` added to the precached shell, cache
  bumped to **v14**.
- The **EFF Long Wordlist** (7,776 words, CC BY 3.0 US) is vendored for the
  passphrase generator by a new `tools/build-wordlist.mjs`, which refuses to
  write unless it parses exactly 7,776 unique words. It is 78 KB and only one
  card needs it, so it loads separately from the page.
- `dragdrop.ts` hands each drop zone its own element to its `onOver`/`onDrop`
  callbacks. The pointer event they already received is the window-level move,
  so its `currentTarget` is not the zone and cannot be measured — which is what
  a drop that means "08:15 on Thursday" needs.
- Database schema **v9**: new `sprites` store (name, size, rows, legend);
  `preferences` gains `sprite_last_doc_id`. Text-only, so sprites ride backup
  export/import like SVG documents. Nothing read from a stored row is trusted:
  the grid is squared and the legend filtered to single characters mapping to
  colours the strict allowlist accepts, because a backup is hand-editable.
- Database schema **v8**: `events` gains `recurrence`, `exdates`, `series_id`
  and `original_start`, plus an index on `series_id`. Existing rows are read
  with defaults rather than rewritten — a backfill on load would be a write on
  load. Backups from v8 will not import into 0.1.0 builds, as designed.
- **Colour fields can carry alpha.** `ColorField` gained opt-in `alpha` and
  `showSwatch` props: a slider that edits the alpha channel, and a preview
  swatch over a transparency checkerboard. A native `<input type="color">`
  cannot express alpha and used to flatten it away on every pick — it now
  preserves whatever alpha is set. Both props default off, so the six existing
  callers are unchanged.
- `setAlpha()` and `resolveFillStyle()` in the colour library: the first
  replaces a colour's alpha and re-emits it **in the spelling it was written
  in** (hex stays hex, `oklch()` stays `oklch()`, a named colour becomes
  `rgb(… / a)` while translucent and takes its name back at alpha 1); the
  second returns a canvas-safe fill or `null`, so an unparseable colour can be
  skipped rather than silently painted opaque black.
- The accessibility sweep now derives its route list from the tool registry
  instead of a hand-maintained copy beside it. A page forgotten in that list
  used to ship unaudited while the suite stayed green; registering a tool is now
  all it takes to be audited.
- `--font-mono` is defined. Ten files asked for it and nothing declared it: two
  had no fallback and silently inherited. It is an alias of the (monospace)
  body face, so nothing looks different today, and one line changes if that ever
  stops being true.
- A shared `.checkerboard` utility for transparency backdrops, replacing the
  copy-paste gradient that had spread to four components.
- `package.json`'s version had drifted to `0.1.0` while `VERSION` said `0.2.0`;
  they are back in step.

- **The app is documented.** [docs/](docs/README.md) now carries a page per
  system for maintainers and a page per feature for users — 9 `docs/dev`
  overview pages (architecture, data layer, preferences, app shell, design
  system, service worker and offline, notification engine, testing, build and
  tooling), 9 `docs/dev/tools` pages, 11 `docs/user` pages that each end in the
  gotchas that feature carries, and an index. 39 mermaid diagrams cover the
  flows worth drawing (the backup import algorithm, the service worker's fetch
  handler and warm crawl, recurrence and rank ordering, the raster compositor,
  the SQL worker protocol, autosave and its flush paths); every diagram was
  parsed with mermaid itself and every internal link resolved, mechanically.
  Each page was written from the source and then fact-checked against it by a
  second pass, which is where most of the corrections came from.
- **0.2.0 is planned**: [docs/dev/plans/version-2.md](docs/dev/plans/version-2.md)
  splits the TODO's feature list into twelve phases that can each cut a release
  on their own, with the decisions taken up front (self-hosting, lazy engines,
  virtual recurrence expansion, one sanitized markdown path, `window.print()`
  for PDF), sixteen open questions each with a default, and per phase: scope,
  data-model delta, dependencies with their real sizes and licences, tests, docs
  and CHANGELOG lines. The hand-drawn UI sketches for napkin math and the
  configuration playground are kept alongside it in
  [docs/dev/plans/sketches/](docs/dev/plans/sketches/).
- README: added a Documentation section, and corrected "the schema lives in two
  places" to three — the `TABLES` mirror in `tests/local/helpers/schema.ts` is
  what extends the round-trip, isolation and invariant suites to a new store, so
  a store missing there is a store nothing tests.

# 0.1.0 (2026-08-15)

- Initial release: data model created (`preferences`) and project generated with [local-sync-template](https://github.com/Descent098/local-sync-template).

## Features

- App shell: collapsible sidebar (grouped by category, collapse state persisted, off-canvas drawer with hamburger below 64rem) replaces the flat navbar; existing Settings and Preferences pages retained.
- Quick-action palette: `ctrl+k` / `cmd+k` (plus a visible header search button for touch) with fuzzy search, full keyboard navigation, focus trap, and focus restore.
- Tool registry (`src/lib/registry.ts`): single source of truth (name, aliases, category, route, icon) driving the sidebar, the home screen tiles, and the palette — adding a tool there is all future phases need for navigation and search.

- Blueprint design system (plain CSS): light theme is dark-blue ink on white drafting paper, dark theme is chalk-white lines on a cyanotype blue field. Two-scale graph-grid page background, content column framed as a drawing sheet (heavy rule + dashed offset trim mark) that signs off with a title-block footer (`SHEET UF-001 · REV A`), square corners everywhere, letterspaced uppercase drafting annotations, corner registration marks on cards, hatched disabled states, ink-wash overlay scrims, and a single amber "stamp" accent reserved for state and identity (focus rings, active markers, the brand arc). Branding: drafting-compass favicon (plus a dedicated maskable variant that survives circular masks), compass wordmark glyph, `DWG · UF-001` sheet code, and matching PWA manifest colors. Contrast verified numerically in both themes (text ≥ 4.7:1 AA, control boundaries ≥ 3.8:1).
- Stroke-icon system replacing emoji: hand-inlined Lucide glyphs (`src/lib/icons.ts`) rendered by a small `Icon.svelte` in the sidebar, home tiles, and palette; a unit test guards that every registry icon key resolves.
- **Timers** (`/tools/timers/`): multiple concurrent countdown timers with labels and markdown descriptions, per-timer completion actions (sound, vibration where supported, notification with in-context permission), pause/resume, and finished timers kept as re-runnable presets. Running timers store an absolute deadline — no per-tick writes, so they survive reload, navigation, and background-tab throttling without drift. Saving a timer remembers its completion settings as the defaults for the next one.
- **Timer alarm engine**: an always-mounted island (persisted across view transitions) fires sound/vibration/notifications while the app is open in any tab, and surfaces completions that elapsed while the app was closed (or the machine slept) as MISSED banners on the next visit. Documented limit: with no server there is no push, so nothing can fire while the app is fully closed.
- **Stopwatch** (`/tools/stopwatch/`): start/pause/resume/reset with lap list (splits + totals), persisted as a singleton so it keeps counting across reloads; writes happen only on user actions.
- **Timezones** (`/tools/timezones/`): convert a wall-clock time between any two IANA zones using the browser's built-in tz database (DST-correct), with fuzzy zone search, "my zone" shortcuts, swap, and offset labels; the last-used pair is remembered. Arbitrary-city lookup ships via a bundled GeoNames dataset (~34k cities with population ≥ 15k, CC BY 4.0; regenerate with `tools/build-city-dataset.mjs`) loaded lazily as its own ~1.4MB chunk on first city search and cached for offline by the service worker. Zone validity is checked by Intl constructibility, not list membership, so alias zones like `Europe/Kyiv` work end to end.
- Timer options: a **Save & start** button arms the timer in one step; a per-timer **Delete when finished** option makes one-shot timers clean themselves up after firing (soft-delete — the tombstone and the completion banner both survive). Both are remembered in the preferences defaults alongside the completion actions.
- Alarm loop: a finished timer keeps ringing/vibrating until its banner is dismissed or the timer is used again (Run again / Reset interrupt it), capped by a configurable duration (`timer_alarm_seconds`, 1–25s, default 25). The banner itself persists until dismissed and pulses while ringing.
- Editable Preferences panel: timer completion defaults, the alarm duration, and a new `auto_remember_based_on_last_value` switch (on by default) are now set directly on the Preferences page; with auto-remember off, saving a timer no longer overwrites the chosen defaults. Last-used values (timezone pair) display read-only.
- Database schema v3: new `timers` store and `stopwatch` singleton; `preferences` gains timer-default and last-zone-pair fields. Backups from older versions import cleanly; backups from v3 are rejected by older builds as designed.
- **Scheduler** (`/tools/scheduler/`): events and TODOs in one tool with three views — list, kanban board (fixed TODO → In progress → Completed columns), and a month calendar showing events plus dated TODOs. TODOs carry markdown descriptions, due date with optional time, priority, per-TODO due notifications, and threaded timestamped comments (child rows). Recurring TODOs are donetick-style: the rule lives on the TODO, and completing one creates exactly one successor inside that action — never on render (oracle-verified: reloads write nothing). Board ordering uses fractional rank keys, so reordering a card writes exactly one row (arrow buttons; drag is a future refinement). Deleting a TODO tombstones it and its comments. The last-used view is remembered.
- Scheduler notifications ride the persistent engine: a banner (and system notification, where permitted) fires at a TODO's due time and an event's start while the app is open; the due scan keeps its fired-state in memory and never writes.
- Database schema v4: new `events`, `todos` (field-merged, indexed on status/due date), and `todo_comments` (foreign key to `todos`) stores.
- Scheduler detail modal (native `<dialog>`, focus-trapped): creating a TODO/event now opens a modal, and clicking an existing item — a calendar entry, a list title, or a board card title — opens it in READ view (rendered markdown, attributes, and the TODO's comment thread) with a pencil to switch to edit. Calendar entries gained true drag-and-drop rescheduling (events keep their time of day and shift their end by the same delta; TODOs move their due date; one row per drop, same-day drops write nothing) and wiki-style hover previews showing rendered markdown after a short delay.
- Board drag-and-drop: cards drag between columns (running the same complete path as the buttons, so recurrence still spawns) and reorder positionally within a column — one row written per drop, no-op drops write nothing. The arrow buttons remain for keyboard users.
- **Programming** (`/tools/number-conversion/`): binary, octal, decimal and
  hexadecimal kept in sync as you type, with an 8/16/32/64 bit-width selector
  governing padding, ranges and the operations (bitwise NOT, one's complement,
  two's complement — signed and unsigned readings shown side by side; negative
  decimals encode as two's complement). Every conversion and operation has a
  "by hand" explainer drop-down. BigInt throughout, so 64-bit values are exact.
- **Photography** (`/tools/photography/`): total-light equivalent-settings
  calculator across Micro 4/3 (2.0×), APS-C (1.5×), Canon APS-C (1.6×) and full
  frame — focal × crop, f-number × crop, ISO × crop², shutter unchanged, with
  displayed values snapped to the standard 1/3-stop scales — plus a light-stop
  calculator comparing a second set of settings exactly (shutter `log2(t1/t2)`,
  ISO `log2(i1/i2)`, aperture `2·log2(N1/N2)`, sensor `2·log2(crop1/crop2)`)
  with per-component wording and image-brightness vs total-light totals.
  Explainers clarify the equivalence model. The last-used sensor format is
  remembered in preferences (picking it is the only write the tool ever makes).
- **File transfer** (`/tools/file-transfer/`): time estimate from a file size
  (KB/MB/GB/TB) and a network speed with bits-vs-bytes explicit in the unit
  selector (Kbps/Mbps/Gbps vs KB/s / MB/s), decimal units throughout, an
  optional protocol-overhead percentage, and the link speed spelled both ways
  (e.g. "100 Mbps = 12.5 MB/s"). A bits-vs-bytes explainer included.
- Sidebar/palette gained the Calculators category (three tools above); service
  worker shell extended accordingly.
- **Colors** (`/tools/colors/`): convert any CSS color — hex, rgb(a), hsl, hwb,
  lab, lch, oklab, oklch, and the 148 named colors — between every spelling at
  once, with a native color-picker input, per-format copy buttons, exact-name
  detection, and an out-of-sRGB-gamut flag. Conversions implemented per CSS
  Color 4 (Lab/LCH on D50, OKLab via LMS) as dependency-free unit-tested TS,
  with the named-color table verified against the browser.
- **Gradients** (`/tools/gradients/`): linear/radial/conic CSS gradient builder
  with angle/shape controls, repeating variants, multi-stop editing (optional
  positions, add/remove), a live preview and one-click copyable CSS — the
  preview and the copied text come from the same pure builder function.
- **Glassmorphism** (`/tools/glassmorphism/`): frosted-panel generator with
  backdrop blur, tint (any CSS color) + opacity, saturation, border opacity,
  radius and shadow controls, previewed over a busy backdrop and copyable as a
  CSS block (with the `-webkit-` prefix included).
- **Regex snippets** (`/tools/regex/`): paste a regex + flags, get idiomatic
  compile / match / find-all snippets for Go, Rust, JavaScript and Python with
  correct per-language escaping (Python raw strings with quote juggling, Go
  backtick literals, Rust `r#"…"#` fencing, JS literal slash-escaping), flag
  mapping (`/ims`, `re.IGNORECASE | …`, inline `(?ims)`), `(?<name>)` →
  `(?P<name>)` (and `\k<name>` → `(?P=name)`) rewriting for Python, and a
  construct scanner that warns on the Go/Rust snippets when the pattern uses
  lookahead/lookbehind/backreferences their RE2-family engines don't support.
  Snippets are syntax-highlighted with the bundled Prism.
- **QR code** (`/tools/qr/`): creator (text/URL, four sizes, all four
  error-correction levels, live SVG preview) with PNG/SVG download and
  copy-as-PNG / copy-as-SVG-text via a new shared export/copy pipeline
  (`src/lib/exportFile.ts`, reused by the image phases later), plus a reader
  that decodes uploaded images and — where a camera exists — live camera scans
  (`qr-scanner`, fully offline, permission requested in-context on click with
  upload as the graceful fallback). Decoded URLs render as clickable links but
  are never auto-opened.
- Sidebar/palette gained the Generators category (five tools above); service
  worker shell extended and cache bumped.
- **Image converter** (`/tools/image-converter/`): SVG, AVIF, WebP, TIFF, PNG
  or JPG in — PNG or JPG out (deliberately no WebP/AVIF outputs; canvas
  encoding for them isn't broadly supported). PNG↔JPG are constrained to the
  sensible direction, SVG rasterizes at a chosen width (aspect preserved),
  TIFF decodes via the bundled `utif2` (~50KB) and fails gracefully on exotic
  variants, JPG output flattens transparency onto white and has a quality
  control, and everything happens on-device. Download plus copy — clipboard
  images are always PNG and the button says so.
- **Image resizer** (`/tools/image-resizer/`): exact dimensions (with aspect
  lock deriving the other edge) or percentage scaling, PNG/JPG export with the
  shared conventions.
- **Image compressor** (`/tools/image-compressor/`): recompress JPG (quality)
  and PNG (re-encode), optional longest-edge cap, with before/after file sizes
  and the percentage saved.
- The three image tools share a remembered JPG-quality default
  (`convert_jpg_quality` on the preferences singleton — their only database
  write; the images themselves never touch IndexedDB by design).
- Sidebar/palette gained the Images category; service worker shell extended
  and cache bumped to v8.
- QR creator: code and background colors are now customizable (color pickers
  wired through to both the SVG preview and the PNG/SVG exports), with a
  scannability warning when the pair is inverted (light-on-dark) or too low
  contrast for reliable scanning.
- Regex tool grew a live tester (regex101-style): paste sample text and see
  matches highlighted in place with a match table (positions, numbered and
  named groups, lazy-safe zero-length handling, capped at 500 matches), plus a
  filterable symbol reference table — six categories of tokens with plain-word
  meanings and examples.
- Glassmorphism: eight one-click presets (light/medium/strong frosted, dark
  frosted, iOS-style clear-and-refractive, and blue/amber/rose color tints);
  tint and border opacity are now dialed in percent.
- **Colors is now Themes** (same `/tools/colors/` route): on top of the format
  conversions it adds color-theory harmonies on the classic wheel
  (complementary, monochromatic, analogous, tetradic — click a swatch to copy)
  and a CSS theme builder: up to five swatch colors (primary/secondary/accent/
  neutral/base, blanks derived from the primary), padding and border-radius
  knobs, automatic light/dark variants emitted as `:root` custom properties
  with `light-dark()`, WCAG-picked on-colors, and a live preview window
  (card, accordion, table, plaintext, form fields) driven by the exact same
  variable string the Copy button emits — with an auto/light/dark scheme
  toggle.
- Color inputs everywhere gained synced native pickers (a shared `ColorField`:
  free-form CSS color text + a picker swatch that shows the resolved color and
  writes hex back) — gradient stops, the glassmorphism tint, and every theme
  role slot.
- Theme builder: BOTH halves of every `light-dark()` pair are now editable per
  role (blank still means derived — the dark slot derives from the role's
  light value, lifting lightness until it clears 3:1 on the actual dark
  surface), and the builder audits every brand role against the theme's own
  background per scheme, listing WCAG 1.4.11 contrast warnings under the
  swatch.
- Scheduler list view: drag-and-drop reordering (grab the ⠿ handle or the
  row). The list now shows YOUR order — the same fractional rank the board
  columns use, so rearranging either view rearranges both; completed todos
  sink to the bottom, one row written per drop, no-op drops write nothing,
  and a drop strip below the table moves an item to the end. (The list
  previously auto-sorted by due date; the manual order replaces that.)
- Theme builder roles (primary/secondary/accent/neutral/base) each render as
  their own card, so the five color pairs read as separate objects instead of
  a run-together grid.
- Regex tester: capturing groups are color-coded — group N wears the same
  color in the highlighted sample text (sub-spans inside each match, computed
  from real group indices via the `d` flag, lookahead spans clamped) and in
  the match table, where named groups now merge with their number ("year:
  2024" instead of a duplicate "$1" chip) so each group reads as one color.
- Syntax highlighting for fenced code blocks in all rendered markdown (Prism, statically bundled — TypeScript/JavaScript, Python, Go, Rust, Bash, JSON, SQL, YAML, HTML/CSS), colored with the blueprint ink palette in both themes.
- **SVG editor** (`/tools/svg-editor/`): a layer-based vector editor grown from
  the local-sync-template icon designer — arbitrary canvas size (16–4096, any
  aspect), optional transparent background, and eight layer kinds: rect,
  ellipse, triangle, star, text, pasted SVG markup (ids re-homed, root paint
  preserved, scaled to fit), line segments with straight/quadratic/cubic
  bezier options, and free-form polygons (start as a regular n-gon, then drag
  vertices, add/remove points Illustrator-style). Layers have independent
  width/height, rotation, and fill/stroke/stroke-width; the canvas offers
  hit-test selection, drag positioning, rotation-aware corner resize handles,
  and vertex/control-point handles; arrows nudge, Delete removes, and
  undo/redo (buttons or ctrl+z / ctrl+shift+z / ctrl+y, 100 steps) walks
  coalesced snapshots. Documents are named rows in the new `svg_documents`
  store — layers stored as plain JSON, so they reopen fully editable, survive
  backup round-trips byte-identically, and autosave (debounced, exactly one
  row) with the last-open document resumed on return. Export as SVG (download
  or copy-as-text), or PNG/JPG rasterized at a chosen width (aspect-derived
  height, JPG quality slider, clipboard always PNG, labeled).
- **Image editor** (`/tools/image-editor/`): a session-only layer-based raster
  editor (never touches the database by design — binary data cannot
  round-trip the JSON data layer). Start from an image (the first import
  becomes the base layer and sets the canvas size) or from a blank canvas
  (any size, colored or transparent); add further image layers; resize the
  canvas any time; zoom in/out for precise brush work. Layers form a
  two-level tree: every top-level layer has its own opacity and blend mode
  (normal, multiply, overlay, soft light, hard light, color), and effect
  layers — eraser strokes, crops, darken/lighten/blur regions — nest UNDER a
  layer to affect only it (crop one photo without cropping the canvas) or sit
  at top level to affect everything below. Layers drag-and-drop to reorder or
  nest (⤵/⤴ from the keyboard), toggle visibility, and delete non-destructively
  (deleting a crop un-crops). Image layers rotate in 90° steps about their
  own center, carrying their sub-layers. Marks: smoothed brush strokes, arrows
  with sized heads, editable text, and rectangular region adjustments — each
  with numeric fields for keyboard editing. Metadata: an EXIF viewer (exifr)
  for the base image, strip-all-by-default exports, and optional embedding of
  edited artist/copyright/description/date tags into JPG exports via
  piexifjs — GPS and all other original tags can never pass through, and the
  UI states exactly which exports carry metadata. Export with a chosen file
  name as PNG or JPG (quality slider); clipboard copies are always PNG,
  labeled.
- Image editor, round 2: the layer tree is now any depth — **group layers**
  hold anything (images included) and composite as one with their own
  opacity/blend, nest inside each other, and can be created empty ("+ Group")
  or wrapped around the selected layer; **color-fill layers** paint the whole
  canvas at top level and, nested under a layer, tint only that layer (all
  content children are now clipped to their parent — a brush stroke on a photo
  stays on the photo); a blank canvas's background is a real fill layer
  ("Background") that can be recolored, hidden, or removed; **on-canvas scale
  handles** on the selected image layer (Move tool: corners keep the aspect
  ratio, edges stretch one axis; sub-layers scale along); **drag-and-drop
  anywhere in the tree** — drop on a row's top/bottom edge to place above/below
  it, on its middle to nest inside it, with a grip and above/below/into
  highlights (⤵/⤴ remain the keyboard path, now at any depth); and long file
  names truncate with an ellipsis instead of widening the panel.
- SVG editor polygons: each vertex can bend the edge to the next vertex with a
  draggable bezier control ("Curve edge" on the selected point) — the layer
  renders as a closed `<path>` while any edge is curved and stays a plain
  `<polygon>` (byte-identical to before) otherwise.
- SVG editor boolean subtract: "Subtract another layer from this one" cuts the
  chosen cutter's silhouette out of the selected layer — a stroked line splits
  a square into two rectangles, text punches letters, a pasted icon stamps its
  shape — using SVG's own compositing (luminance mask + a flood filter that
  blackens any cutter regardless of its colors), baked into a pasted-SVG layer
  positioned exactly over the original (both originals consumed; one undo).
- Image compressor targets: besides manual quality/cap, aim for a percentage
  of the original size or a max file size in KB. The tool searches for
  settings that meet the budget (JPG: quality first, never below 20, then
  dimensions; PNG: dimensions only, being lossless) and reports the outcome
  honestly — including "target NOT reachable" with the smallest allowed
  encode — with a standing notice that a target may not be possible.

- **Background remover** (`/tools/background-remover/`): cuts the subject out of
  a photo with a segmentation model that runs entirely in the browser — the
  picture is never uploaded. The model (U²-Net small, Apache-2.0) and its
  runtime (ONNX Runtime Web, MIT) are self-hosted and downloaded on an explicit
  "Download model (15.8 MB) for offline use" click with a progress bar, then
  kept in their own cache so the tool works offline afterwards (and can be
  removed again from the same card). Live preview over a transparency
  checkerboard, two cleanup knobs (cut off faint edges, soften edge) that
  re-tune the existing mask without re-running the model, a transparent or
  solid-colour background, a mask view, and PNG/JPG export plus copy-as-PNG
  through the shared pipeline. JPG with a transparent background says so
  instead of silently whitening it.
- Image editor: **Remove background** on any image layer, using the same model.
  The result is a mask layer nested under that image, so it cuts only that
  layer (not the whole canvas), can be inverted to keep the background instead,
  moves/scales/rotates with the image it is stuck to, and deleting it brings
  the background straight back — nothing is baked.

- Image editor **undo/redo**: ↶ / ↷ buttons beside the zoom controls plus
  `ctrl+z` / `ctrl+y` (and `ctrl+shift+z`), covering everything in the session —
  layers, tools, canvas size, background removal. Discrete actions are their own
  step; a brush stroke, a slider drag or a burst of typing collapses into one.
  Snapshots share the decoded bitmaps rather than copying them, so history costs
  geometry, not pixels.
- Image editor **Restore brush** (un-erase): paints the original pixels back
  wherever you brush, undoing part of an eraser stroke or part of a removed
  background without undoing the whole layer. Like every other effect it is a
  layer — it can be nested, reordered, hidden or deleted, and it acts on
  whatever sits below it.
- Background remover **touch-up brushes**: "bring back" and "cut away" paint
  directly on the preview when the model gets an edge wrong. Strokes are kept as
  their own layer on top of the mask, so the cutoff/feather sliders and even
  re-running the model leave your corrections intact; "Clear touch-ups" restores
  the model's own mask.

- **SQL playground** (`/tools/sql-playground/`, new **Playgrounds** category):
  a real database in the browser tab — SQLite (sqlite-wasm) or Postgres
  (PGlite), both running in a Web Worker with nothing uploaded anywhere. A
  CodeMirror editor with the picked engine's dialect and keyword completion
  (Ctrl+Enter runs), a results grid, a table browser with column types and
  primary keys, import (a `.sql` script or the engine's own binary image,
  sniffed by its header, with the current database restored if the script
  fails part-way) and export (SQL to clipboard or file, binary image, JSON —
  schema + data or schema only). Ported from
  [retoken](https://github.com/Descent098/retoken); persistence was rebuilt on
  this app's data layer, so a workspace rides backups like any other row.
- **"Make it work offline?"** — installing the app now offers, once, to
  download everything it can run without a network: the pages you have not
  opened, the background remover's model, and each database engine, each with
  its size and its own progress. The same panel lives in Settings → Offline for
  later, and reports when it last finished.

## Bug Fixes

- Image converter preview squashed tall/wide images to the preview box's own
  ratio: the `<img>` was a stretched flex child (`align-items: stretch`) with a
  `max-height`, so its width came from the container and only the height was
  clipped. It now opts out of the stretch (`align-self: flex-start`) with
  `object-fit: contain` as belt-and-braces; regression-tested with a real
  portrait AVIF fixture and a canvas-generated tall PNG.
- SVG editor: color edits made through the shared color field never
  committed — not saved, not undoable, while the status still read "Saved"
  (`ColorField` gained an `oncommit` hook that fires when an edit is
  finalized). Clearing a numeric layer/canvas field no longer persists `null`
  (an emptied number input): commits revert invalid numerics to the last
  committed value and heal sizes to ≥ 1, load-time normalization coerces
  stored bad numerics too. User-typed colors are attribute-escaped when the
  document is built (a stray quote used to blank the whole preview and could
  inject markup into an exported file), and an emptied background reads as
  transparent instead of rendering black. The debounced autosave now flushes
  on `pagehide`/`visibilitychange` (a hard reload within 400ms of an edit lost
  it), persists the last committed snapshot rather than live bound values,
  ignores results for a document that was closed or swapped while the write
  was in flight, and the keyboard listener is registered synchronously so a
  fast navigation away can no longer leak it. Adding a polygon point after
  undo with a stale vertex index crashed; vertex indices reset on
  undo/redo and are bounds-checked. Line/polygon hit-testing uses the true
  bounding box (points become one-sided after vertex drags; the old
  mirrored box stole clicks from neighbours). Export width tolerates an
  emptied field.
- Image editor: an off-canvas marquee drag committed an inflated region
  (`clampRect` slid the rect inward keeping its size; it now intersects
  edge-by-edge, so a drag past the edge keeps exactly the on-canvas span);
  blur regions bled the sharp original back in near their edges (the
  snapshot now includes surrounding context so the filter has real pixels
  to blur); a second touch pointer no longer hijacks an in-flight stroke
  (gestures are pinned to their pointer id); "New session" asks before
  discarding crop/rotation-only work; the marquee overlay's dash scale is
  driven by a ResizeObserver instead of a layout read inside the render
  effect. Playwright specs tightened: the "GPS never survives" fixture now
  actually carries GPS (the assertion was vacuous), the whole-session
  zero-write window starts before the page loads, and crop dimensions are
  bounded on both sides.
- Prism grammar files are global-dependent side-effect scripts; once two modules
  (markdown rendering and the regex tool) imported them, Rollup could split the
  grammars into a shared chunk that executes before the Prism core, crashing
  hydration with `Prism is not defined`. All Prism imports now flow through a
  single `src/lib/prism.ts` whose import order is guaranteed. (This crash is
  also what briefly broke every scheduler interaction — including calendar
  drag-and-drop — since the scheduler island imports the markdown renderer;
  the drag suite now additionally covers the realistic hover-preview-then-drag
  sequence and true list-reorder interactions as regression guards.)

- The Playwright suite could never run under Astro 7: `astro preview` daemonizes itself when stdin is not a TTY, so Playwright's webServer saw the process exit and aborted every run. Replaced with a dependency-free foreground static server (`tools/preview-server.mjs`).
- The test hook 404'd in production builds: the layout's unbundled inline script dynamically imported `../lib/testHook.ts`, which resolves against the page URL and does not exist in `dist/`. The loader is now a bundled module script (`installTestHookIfEnabled` in `src/lib/testMode.ts`); the hook chunk is still only fetched when test mode is enabled.
- The shipped v1 migration iterated the live `STORES` map, so appending any store-creating migration would have crashed fresh installs (`ConstraintError`: store created twice). v1 is frozen to literals, and every future migration must guard with `objectStoreNames.contains()` (convention documented in `src/lib/db/db.ts`; v2 now guards too).
- Astro's ClientRouter wipes `<html>` attributes on every client-side navigation, silently reverting the pinned theme and the sidebar collapse. The layout's pre-paint script now re-applies both on `astro:after-swap` (regression-tested with a client-side navigation, not just full reloads).
- `put`/`bulkPut` stamped `field_updated_at` entries for sync bookkeeping keys (`updated_at`, `deleted_at`) on field-merged stores; stamps are now limited to domain fields, and `putSingleton` explicitly stamps `deleted_at` when it revives a tombstone.
- Desktop layout gap: the topbar was pushed right by the sidebar's body padding, leaving a dead square above the open sidebar. The topbar is now fixed and full-bleed; the sidebar starts flush beneath it.

- **Deleting a row kept its contents.** A delete tombstoned the row in place
  with every field intact, so a deleted timer's label and notes stayed in
  IndexedDB — and turned up in every exported backup. Tombstones now keep only
  sync bookkeeping (id, clocks, delete stamp, per-field stamps), and database
  **v6** sweeps the ones already stored, leaving their clocks untouched so the
  cleanup can never beat a real edit from another device.
- **Drag and drop did nothing on a touchscreen or pen** — in all three
  scheduler views and in the image editor's layer tree. Those all used the HTML5
  drag-and-drop API, which only ever fires for a mouse; the failure is silent,
  which is how a mouse-driven test suite kept passing over it. Everything now
  runs on pointer events (`src/lib/dragdrop.ts`), so mouse, touch and pen share
  one path: grab handles (⠿ on list rows, board cards and layer rows; calendar
  entries themselves) own the gesture on touch so the page still scrolls, a drag
  only starts after 5px of travel so clicks stay clicks, Escape cancels, and the
  app draws its own drag ghost.

- Dark theme: `--color-danger` sat at 4.0:1 against the card surface, under AA
  for text — every error message in the app was the hardest thing on screen to
  read. Lightened to 4.8:1, with the whole token palette now checked
  numerically in both schemes by the accessibility sweep.
- Heading structure: card titles were `h3` directly under the page's `h1`, and
  the theme builder's preview card injected a stray `h4`, so a screen reader's
  document outline skipped levels on most pages. Card titles are now `h2`, and
  the preview's mock title is styled text rather than a heading.

## Other
- Database schema v7: new `sql_playgrounds` store — one workspace per engine
  (editor buffer + optional SQL snapshot), keyed by the engine id;
  `preferences` gains `sql_last_engine`, `offline_prompt_seen` and
  `offline_ready_at`. Test schema mirror and README Tables updated; the store
  rides backup export/import automatically.
- Service worker: `tools/sql-playground/` added to the precached shell, cache
  bumped to v11, and a new message channel (`useful-warm`) that runs the asset
  crawl on demand, unpaced, reporting progress — the pacing exists to protect a
  host while the app boots, and someone who explicitly asked to download
  everything is waiting for it.
- New dependencies for the playground: `@sqlite.org/sqlite-wasm`,
  `@electric-sql/pglite`, `codemirror` + `@codemirror/lang-sql`. All lazy: the
  home page, and every tool that is not the playground, pull none of them —
  enforced by a new payload-discipline suite that watches the real network.
- Phase 9 hardening suites: an accessibility sweep over EVERY registered page
  (accessible names, form labels, image alt text, one `h1`, no skipped heading
  levels, plus token contrast in both themes and the keyboard path through the
  palette and disclosures), payload discipline (heavy bundles stay lazy, the
  install precache stays shell-only), and an offline audit that downloads the
  app, cuts the network, and loads a page the profile has never visited.
- Undo/redo lives in `src/lib/raster/history.ts`, a snapshot stack that
  deep-copies the layer tree but passes canvases through by reference (the SVG
  editor's JSON-based history would have turned every bitmap into `{}`), with
  structural signatures for coalescing; unit-tested with fake bitmaps.
- The background remover's brush maths (`applyPaint`) is pure and unit-tested
  alongside the rest of the pipeline: keep strokes win over the model, remove
  strokes win over keep strokes, and a paint layer left over from another image
  reads as unpainted rather than as NaN alpha.
- Test hook gains `closeDb()` so a migration test can tear the database down and
  rebuild it at an older version (an open connection blocks `deleteDatabase`
  forever). The v6 sweep is covered end to end: a fat tombstone written against
  a v5 database is stripped on the next load, clocks intact.
- Scheduler and image-editor specs now drive real pointer drags instead of
  Playwright's `dragTo()` (which exercises the HTML5 pipeline no touchscreen
  has), plus three new touch-drag cases — list, board and calendar — driven
  through CDP touch events.

- Background remover assets are vendored, not fetched from a CDN:
  `tools/build-bg-assets.mjs` downloads `public/models/u2netp.onnx` (from the
  rembg release of the Apache-2.0 U²-Net conversion) and copies ONNX Runtime
  Web's wasm + loader out of `node_modules`, then writes
  `public/models/PROVENANCE.txt` with sources, licenses, sizes and SHA-256s.
  BriaAI RMBG and `@imgly/background-removal` were rejected on licensing.
- Service worker: `tools/background-remover/` added to the precached shell,
  cache bumped to v10, and a dedicated cache-first rule for `models/` + `ort/`
  that stores them in `useful-models-v1` — a bucket outside the `useful-cache-`
  prefix, so a version bump never purges 15.8 MB of downloaded model, and
  stale-while-revalidate never re-fetches it in the background. The assets are
  deliberately absent from the install precache. New `scissors` icon and
  Images-category registry entry for the tool.
- New dependency `onnxruntime-web` (MIT), imported lazily so it only loads for
  someone who actually removes a background. Vite's dep optimizer is told to
  leave it alone (`optimizeDeps.exclude`) and the runtime pins ORT's loader
  path, because both the dev server and the production bundle otherwise
  resolve it to a URL nothing serves.
- Pre/post-processing lives in `src/lib/bg/pipeline.ts` as pure typed-array
  maths (bilinear resample both ways, the U²-Net normalization, mask rescale,
  cutoff/feather, alpha application) and is unit-tested in node against a
  mocked runner; `src/lib/bg/runtime.ts` owns asset caching and the session.
  Playwright drives the REAL model end to end: not-downloaded state, cut-out
  pixels in the exported PNG, cleanup knobs re-tuning without a second
  inference pass, an opaque JPG over a chosen colour, a run with the browser
  taken offline, and the editor's nested mask (including invert and delete);
  all of it inside zero-write windows, since the tool has no store of its own.

- Database schema v5: new `svg_documents` store (name, canvas size, background,
  layers as JSON); `preferences` gains `svg_last_doc_id` (last-open SVG-editor
  document, resumed on reopen). Test schema mirror and README Tables updated;
  the store rides backup export/import automatically.
- Service worker: `tools/svg-editor/` and `tools/image-editor/` added to the
  precached shell; cache bumped to v9. Registry gains both tools (Images
  category) with new hand-inlined Lucide `pen-tool` and `brush` icons.
- New dependencies: `exifr` (EXIF read) and `piexifjs` (JPEG EXIF write,
  loaded lazily at export time); pure SVG/raster geometry libs
  (`src/lib/svg/`, `src/lib/raster/`) unit-tested in node, with the seed's
  paste-hardening regression tests ported alongside. The compressor's
  target-size search (`src/lib/img/targetSize.ts`) is pure over an injected
  encoder and unit-tested with synthetic size curves. The raster layer tree
  (`locateLayer`/`moveLayer`/`removeLayer`/`flattenLayers`) and the
  about-center image rotation with children are unit-tested too.
- Test fixtures: real sample files added under `tests/local/fixtures`
  (portrait AVIF, large PNG/JPG/TIFF/WebP/SVG samples) for image-tool specs;
  the AVIF one now exercises the converter's native-decode branch directly.
- Accessibility: image-editor tools have keyboard paths (numeric crop entry,
  coordinate fields for text/arrow/image/region layers, ⤵/⤴ nest buttons);
  layer rows in both editors expose `aria-pressed` for the selection.
- View transitions: Astro `<ClientRouter />` in the shared layout; the chrome island is persisted across navigations and tracks the active page via `astro:page-load`.
- `preferences` is now flagged `singleton` + `fieldMerge` in both `src/lib/db/types.ts` and the test mirror `tests/local/helpers/schema.ts`; the Preferences page is a read-only view of remembered per-tool defaults (writes go through `putSingleton` only). No IndexedDB migration needed (flags are app-level metadata).
- Unit test runner added: Vitest via `npm run test:unit`, with tests for the fuzzy matcher and registry; Playwright specs added for sidebar/drawer/palette navigation (including "client-side navigation writes nothing").
- The orphaned-FK sabotage proof now runs against a synthetic schema, so the trust gate exercises all five oracle proofs even while the real schema has no foreign-key tables.
- `package.json` version synced to `VERSION` (0.1.0); README Tables section updated for the `preferences` flags.
- Accessibility hardening from the phase review: the closed mobile drawer leaves the tab order and accessibility tree (`visibility` rides with the transform); `aria-expanded` reflects the actual per-viewport state; the search button keeps an accessible name when its label is visually hidden; the palette handles IME composition, contains focus against stray clicks, announces result counts via a live region, and scrolls the keyboard selection into view; Escape closes one overlay layer at a time; the page behind an open overlay no longer scrolls; media queries use range syntax (no dead zone at fractional zoom); control boundaries use a new `--border-strong-color` token meeting WCAG 1.4.11 (3:1) in both themes.
- `.gitignore` now covers Playwright's `test-results/` and the trust-gate's `tests/local/.results/`.
- Per-field merge folding on backup merge-import: field-merged stores (currently `preferences`) now fold row-by-row per field — the copy with the newer per-field stamp wins each field, so a backup from one device no longer clobbers the one field this device changed. Tombstone rules unchanged (a fold never resurrects a deletion); folded rows are re-queued for future sync. Covered by three new oracle-audited tests.
- Shared sanitized markdown renderer (`src/lib/markdown.ts`, marked + DOMPurify) — backup-JSON import is an injection vector into rendered HTML, so every markdown field renders through it.
- `field_updated_at` docs clarified: stamps are written since this phase but per-field merge folding on backup import lands with Phase 1 (tracked in `plan-phases.md`), which is when `preferences` gains its first real fields.
- Design-review hardening: the amber stamp demoted from recurring structural labels (sidebar/home section headers, table headers now use pencil ink) so it stays a stamp; the annotation voice consolidated behind shared tokens (`--font-size-eyebrow`, `--tracking-*`); hover reads as a line-weight change instead of a soft glow; dark-theme warning color split from the stamp; palette descriptions hidden below 30rem instead of crushing to ellipsis; dead `Accordion.svelte` template component removed; service worker `CACHE_NAME` bumped to v3 with both favicon variants precached.

- Refined `docs/dev/plans/plan.md`: fixed numbering/typos, corrected the SVG-editor reference to the `local-sync-template` icon designer's layer panel, recorded product decisions (lazy-downloaded background-removal model, session-only raster image editor, total-light photography equivalence, bundled city→timezone dataset, app-open-only notifications), and added cross-cutting sections for the data model, notifications/permissions, testing, PWA/offline, and accessibility.
- Added `docs/dev/plans/plan-phases.md`: splits the refined plan into 10 shippable phases (0–9) with per-phase scope, data-model/migration changes, test obligations, and a standing checklist encoding the schema/sync/test/CHANGELOG rules from `docs/dev/plans/TODO`.
