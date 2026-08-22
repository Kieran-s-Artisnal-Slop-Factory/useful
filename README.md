# useful

An offline-only, local-first app there is no server, no account, and no network dependency — each visitor's data lives in their own browser.

## What's in it

- **Time** — countdown timers (sound/vibration/notifications, alarm loop),
  stopwatch with laps, timezone conversion with city lookup.
- **Scheduler** — events and TODOs across list, kanban and month-calendar
  views, with recurrence, comments and due notifications.
- **Images** — converter, resizer, compressor (target size or percentage),
  background remover (on-device segmentation model), layered SVG editor,
  layered raster editor with EXIF viewing/editing, pixel-art sprite editor,
  and base64 encoding for text and files (data URLs, with the type read from
  the bytes rather than the label).
- **Calculators** — number bases and bit operations, photography equivalence
  and light stops, file-transfer times, napkin math (a formula becomes a
  little calculator, and then a function in Python, JavaScript, Go or Rust),
  and three text tools — a diff by line, word or character that also writes
  the patch, word similarity scored five ways with the working shown, and text
  analysis with counts, readability scores and case transformations.
- **Generators** — theme builder and colour conversion, gradients,
  glassmorphism, regex snippets for four languages, QR create and read,
  secrets (passwords, keys, tokens, identifiers), logos (seeded avatars and
  identicons, or an icon/emoji badge), hashing (MD5 through SHA-3 and SHAKE,
  with HMAC, salt and pepper), encryption (AES with a password, RSA key pairs,
  ECDH key agreement, bcrypt and a one-time pad), JWTs (decode, verify,
  sign), ASCII art (a picture as characters, or words as a banner in one of
  fourteen vendored FIGlet fonts), file trees (built by hand or read back
  from a pasted `ls`, `dir` or `tree` listing) and crontab (an expression
  read back in English with its next runs, a builder, a systemd timer, and
  where the line actually goes) and placeholders (filler text from two
  corpora, and eight seeded image generators including nine hand-drawn
  scenes — all drawn on the device, nothing fetched) and a Docker Compose
  builder (services, networks, volumes, secrets and configs through controls
  that explain each field, nine stack templates and ten service snippets, a
  best-effort importer that lists what it cannot represent, and the warnings
  that stop a file which will not do what it looks like it does).
- **Notes** — a notebook of linked markdown notes: WYSIWYG or raw source
  over one string, `[[wiki links]]` with computed backlinks and aliases that
  survive renames, footnotes, mermaid diagrams, KaTeX maths, pasted images,
  nested notes (folders are notes), tick-boxes in the library that export,
  tag, move or delete many notes at once without leaving the note you are
  writing, and export to Markdown, one self-contained HTML file, or PDF
  through the print dialog.
- **Playgrounds** — a SQL playground running real SQLite or Postgres in the
  tab, and a configuration playground that validates, prettifies and extracts
  schemas from JSON/YAML, tabulates a document into the same searchable data
  grid, converts between JSON, YAML, TOML and CSV, generates sample documents,
  and emits parsers and generators in four languages or as a web component.

Everything runs locally: no account, no server, no telemetry.

## Tables

- `preferences` — singleton, field-merged; per-tool defaults (timer completion
  defaults, last-used timezone pair, last-used photography sensor format, the
  image tools' JPG quality, the last-open SVG-editor document, the last SQL
  playground engine, the config playground's last mode and open schema, the
  notebook's open note and editor mode; the Preferences page shows what has
  been remembered)
- `timers` — countdown timers; running timers store an absolute `end_at`
  deadline, so nothing writes per tick
- `stopwatch` — singleton; start epoch + accumulated elapsed + lap list
- `events` — calendar events (title, start/end, all-day). Repeating events
  keep the rule on the row and expand VIRTUALLY: one row draws every
  occurrence, nothing is materialized. Cancelled occurrences are listed in
  `exdates`; a single occurrence edited on its own becomes an ordinary row
  carrying `series_id` + `original_start`, which shadows the series' copy
- `todos` — field-merged; title, markdown, due date/time, priority, fixed
  three-state workflow, recurrence rule (successor spawned on complete, never
  on render), fractional `rank` for kanban ordering
- `todo_comments` — child rows with a foreign key to `todos`
- `svg_documents` — named SVG-editor documents: canvas size, background, and
  the layer stack as plain JSON (text-only, so documents round-trip backups
  byte-identically)
- `sprites` — named pixel-art documents: grid size, the rows as an array of
  strings, and a character → colour legend. Text only, for the same reason
- `napkin_templates` — a napkin-math formula: its name and description, the
  formula as both LaTeX and MathJSON, and one field per free variable with its
  type and constraints
- `napkin_calculations` — one set of inputs run through a template, with the
  result. Keyed to its template, and deleted with it
- `sql_playgrounds` — one SQL-playground workspace per engine, keyed by the
  engine id (`sqlite` / `pglite`): the editor buffer and an optional SQL
  snapshot of the database. The live database is in a Web Worker's memory; only
  the SQL needed to rebuild it is stored
- `config_schemas` — a config-playground schema: its name, format (`json` /
  `yaml`), the Field/Type table as a JSON tree, and the parse-mode document
  text it was extracted from. Text only, so it rides backups byte-identically
- `compose_projects` — a named Docker Compose project: the whole model
  (services, networks, volumes, secrets, configs) as one JSON column. The
  model is the source of truth and the YAML is a projection of it, so nothing
  stored is text that could drift from the editor. **A compose file can carry
  secrets** — environment variables, database passwords, inline config content
  — and this store rides the plain-JSON backup like every other, which the
  page says out loud
- `notes` — field-merged; a notebook note: title, markdown body, aliases (old
  titles kept so `[[links]]` keep resolving), tags, and a `parent_id` pointing
  at another note — folders are notes, so the sidebar is one tree. Backlinks
  are computed from bodies, never stored
- `note_assets` — images pasted into a note, as base64 with their size. Keyed
  to the note and deleted with it; a child store so listing notes never
  carries image bytes, and capped per asset because a backup is one JSON file

Every table also carries bookkeeping fields (`id`, `updated_at`,
`deleted_at`, `server_seq`) that power soft deletes and keep the door open
to adding a sync backend later without a data migration.

## Quickstart

```sh
npm install
npm run dev                   # http://localhost:4321
```

## Build & deploy

```sh
npm run build                 # static output in dist/
```

Host `dist/` anywhere static files can live: Netlify, GitHub Pages,
Cloudflare Pages, or any web server. No runtime required. Serving under a
sub-path (e.g. GitHub Pages)? Set `base` in `astro.config.mjs` — every link,
the service worker, and the manifest already resolve through it.

## Offline & installability

A service worker (registered only in production builds — `npm run build` /
`npm run preview`, never in dev) precaches the whole app so it loads with no
network and updates itself when the network is available.

Installing the app offers, once, to download everything it can run without a
network — the pages you have not opened, the background remover's model, the
maths fonts napkin math and the notebook draw with, and each SQL engine. The
same panel is in Settings → Offline, and can be re-run any time.

One exception, by design: the **Background remover**'s machine-learning assets
(`public/models/u2netp.onnx` + `public/ort/`, ~15.8 MB) are excluded from the
precache. The tool downloads them on an explicit click, with progress, into
their own Cache Storage bucket (`useful-models-v1`) that app version bumps
never purge — so it needs one online visit, and works offline from then on.
Both files are self-hosted and vendored into the repo; regenerate them with
`node tools/build-bg-assets.mjs --force` (licenses and checksums are recorded
in `public/models/PROVENANCE.txt`). The SQL playground's engines behave the
same way — each is fetched the first time it is picked, and cached afterwards.

## Backups

The only copy of the data is the browser it was created in. Use Settings →
Backup to export/import everything as one JSON file.

## Documentation

[docs/](docs/README.md) is the map. [docs/dev/](docs/dev/) documents every
system for maintainers — start with
[architecture.md](docs/dev/architecture.md), then the data layer, app shell,
service worker, notification engine, design system, testing and per-tool pages.
[docs/user/](docs/user/) documents each feature for users, and every page ends
in the gotchas that feature carries.

Planning documents live in [docs/dev/plans/](docs/dev/plans/) — they record
intent at a point in time and are not maintained against the code.

## Versioning & releases

The current version is the entire content of [VERSION](VERSION) (plain semver,
starting at 0.1.0 — `cat VERSION` in scripts/CI), with history in
[CHANGELOG.md](CHANGELOG.md). To cut a release:

1. **Bump VERSION** — patch (0.1.0 → 0.1.1) for fixes, minor (0.1.0 → 0.2.0)
   for new features, major for breaking changes. A schema change that needs a
   migration is at least a minor bump.
2. **Add a dated section to CHANGELOG.md** (newest first) describing what
   changed — call out schema changes explicitly, since users carry their data
   across versions in their browser.
3. **Commit.**

```sh
git add VERSION CHANGELOG.md && git commit -m "Release $(cat VERSION)"
```

## Architecture notes

- Pages are thin Astro wrappers mounting one Svelte 5 root component with
  `client:only="svelte"`; state is component-local runes (`$state`/`$derived`).
- `src/lib/db/types.ts` — entity interfaces + object-store map.
- `src/lib/db/db.ts` — IndexedDB migrations (append-only, never edit shipped ones).
- `src/lib/db/repo.ts` — CRUD helpers; reads filter tombstones, writes stamp
  `updated_at`, deletes are soft. `put`/`bulkPut` JSON round-trip each row so a
  Svelte 5 `$state` proxy (unclonable by IndexedDB) can't throw
  `DataCloneError` — always write through these, never `getDB().put` directly.
  Single-row tables (settings/profile) use `getSingleton`/`putSingleton`.
- `src/lib/db/export.ts` — JSON backup export/import.

Versions are pinned to ranges proven together (Astro 7 / Svelte 5 / idb 8);
major upgrades may change generated-code assumptions.

## Evolving the schema

The schema lives in three places that must change together:

1. `src/lib/db/types.ts` — entity interfaces + store map.
2. A new migration appended in `src/lib/db/db.ts` (never edit a shipped
   migration; guard every `createObjectStore` with
   `objectStoreNames.contains()`).
3. The `TABLES` mirror in `tests/local/helpers/schema.ts` — this is what
   extends the backup round-trip, isolation and invariant suites to the new
   store. A store missing here is a store nothing tests.

Plus the Tables section above, and [docs/dev/data-layer.md](docs/dev/data-layer.md).

For tables meant to hold ONE logical row (user settings, a profile), use the
`getSingleton`/`putSingleton` helpers in `src/lib/db/repo.ts` rather than
`withSyncFields()` — they write under one fixed id, so if you ever regenerate
with the sync backend enabled, every device converges on the same row instead
of each minting its own UUID copy.
