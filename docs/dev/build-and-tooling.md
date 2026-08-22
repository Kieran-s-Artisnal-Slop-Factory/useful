# Build and tooling

Eight npm scripts, seven `.mjs` scripts under `tools/`, and one CI workflow. `astro build` emits a static `dist/` with no runtime; everything third-party is either bundled by Vite or vendored into `public/` and committed, so a fresh clone builds a working app with no network access. This page covers what each command really does, what each generator script produces and when to re-run it, the dependency and payload rules, how the site deploys under a sub-path, and the release procedure.

_Describes the code as of v0.2.1 (unreleased; schema v12) — verify against source when in doubt._

## File map

| File | Role |
|---|---|
| [package.json](../../package.json) | Scripts, dependency ranges, `engines.node >= 22.12.0`, the `overrides` pin. |
| [astro.config.mjs](../../astro.config.mjs) | Svelte integration, the commented-out `base`, `vite.optimizeDeps.exclude` for `onnxruntime-web`. |
| [svelte.config.js](../../svelte.config.js) | `vitePreprocess()` and nothing else — `lang="ts"` in `.svelte` files goes through Vite. |
| [tsconfig.json](../../tsconfig.json) | `astro/tsconfigs/strict`, `include: ['.astro/types.d.ts', '**/*']`, `exclude: ['dist']`, `types: ['node']`. |
| [playwright.config.ts](../../playwright.config.ts) | The data-integrity suite; see [testing.md](testing.md). |
| [vitest.config.ts](../../vitest.config.ts) | `include: ['src/**/*.test.ts']`. |
| [tools/preview-server.mjs](../../tools/preview-server.mjs) | Foreground static server for `dist/`; what Playwright's `webServer` boots. |
| [tools/build-bg-assets.mjs](../../tools/build-bg-assets.mjs) | Vendors the segmentation model + ONNX Runtime into `public/`, writes `PROVENANCE.txt`. |
| [tools/build-city-dataset.mjs](../../tools/build-city-dataset.mjs) | Compacts a GeoNames dump into [cities.json](../../src/lib/time/cities.json). |
| [tools/build-image-fixtures.mjs](../../tools/build-image-fixtures.mjs) | Writes the two binary TIFF fixtures the image specs upload. |
| [tools/build-math-assets.mjs](../../tools/build-math-assets.mjs) | Vendors MathLive's twenty KaTeX faces, `mathlive-fonts.css` (verbatim) and a stripped `katex.css` into `public/math/`, writes its `PROVENANCE.txt`. |
| [tools/build-wordlist.mjs](../../tools/build-wordlist.mjs) | Vendors the EFF Long Wordlist (7,776 words, CC BY 3.0 US) into [wordlist.json](../../src/lib/gen/wordlist.json) for the passphrase generator. |
| [tools/audit-precache.mjs](../../tools/audit-precache.mjs) | Not a generator: statically replays the service worker's background crawl over `dist/` and reports what it would cache. |
| [.claude/launch.json](../../.claude/launch.json) | Dev-server entries for the agent harness. |
| [.github/workflows/astro.yml](../../.github/workflows/astro.yml) | Build + deploy to GitHub Pages. |
| [VERSION](../../VERSION) | The app version, plain semver, no trailing newline. |
| [CHANGELOG.md](../../CHANGELOG.md) | History, newest first. |

## Commands

| Command | Runs | Notes |
|---|---|---|
| `npm run dev` | `astro dev` | Dev server on 4321 by default. **No service worker** — [Layout.astro](../../src/layouts/Layout.astro) gates registration on `import.meta.env.PROD`. |
| `npm run build` | `astro build` | Static output in `dist/` (gitignored). Everything in `public/` is copied in verbatim. |
| `npm run preview` | `astro preview` | Serves the last build, service worker and all. Daemonizes itself under a non-TTY stdin — see below. |
| `npm run astro` | `astro` | CLI passthrough, e.g. `npm run astro -- --help`. |
| `npm test` (= `npm run test:data`) | `playwright test` | Builds first and drives `dist/`. Full detail in [testing.md](testing.md). |
| `npm run test:data:ui` | `playwright test --ui` | Same suite, interactive. |
| `npm run test:unit` | `vitest run` | `src/**/*.test.ts` in plain Node, no DOM. |

There is no typecheck script and `@astrojs/check` is not a dependency, so `tsconfig.json` governs the editor and Vite's transpilation only — a type error does not fail `npm run build`.

### Dev is not production

Four things differ, and all four have bitten this codebase:

- **No service worker in dev.** Offline, precache and install behaviour cannot be reproduced there.
- **`onnxruntime-web` is served unbundled** (`optimizeDeps.exclude` in [astro.config.mjs](../../astro.config.mjs)). Pre-bundling rewrites the package's own dynamic import of its wasm loader to a `.vite/deps` path that 404s at runtime.
- **The ORT loader path is pinned for production only.** [runtime.ts](../../src/lib/bg/runtime.ts) sets `ort.env.wasm.wasmPaths.mjs` to the hosted copy under `import.meta.env.PROD`; in dev a module import of a file in `public/` is exactly what a dev server refuses to serve, and the unbundled package resolves its own loader out of `node_modules` fine.
- **Chunking is the production bundler's.** The Prism grammar-ordering crash (`Prism is not defined`) only ever appeared in a built bundle; [prism.ts](../../src/lib/prism.ts) is the single entry point that keeps it fixed.

Reproduce anything offline-, payload- or background-remover-shaped against `dist/`:

```sh
npm run build && node tools/preview-server.mjs --port 4330 --dir dist
```

### Dev servers in `.claude/launch.json`

Two configurations, both `npm run dev`:

| Name | Command | Port |
|---|---|---|
| `useful-dev` | `npm run dev` | 4321 |
| `useful-dev-alt` | `npm run dev -- --port 4335` | 4335 |

They differ only in the port; the alt entry is there for when 4321 is already taken by another session's server. Neither is used by the test suite — Playwright boots its own server on 4330.

## Generator scripts

All of them are plain Node ESM, run directly (`node tools/<name>.mjs`), with no npm script wrapping them. None of them runs on install or on build: **their outputs are committed**, and the scripts exist to refresh those outputs, not to produce them at build time. (`preview-server.mjs` and `audit-precache.mjs` are not generators; they are described at the end of this section.)

### `build-math-assets.mjs` — the maths faces and stylesheets

```sh
node tools/build-math-assets.mjs [--force]
```

Copies MathLive's twenty KaTeX `.woff2` faces and `mathlive-fonts.css` (verbatim — its relative `url(fonts/…)` resolve beside the `fonts/` directory, and its trailing `:root{--ML__static-fonts:true}` is what tells MathLive's own font loader to stand down) into `public/math/`, and writes `public/math/katex.css`: KaTeX's `katex.min.css` with every `@font-face` block removed, because the MathLive faces ARE the KaTeX faces and the notebook needs only the ~20 KB of layout rules. `PROVENANCE.txt` beside them records source, version, bytes and SHA-256 for each of the 22 files (282,448 bytes together), and `MATH_ASSETS` / `MATH_FONT_BYTES` in [fonts.ts](../../src/lib/math/fonts.ts) must agree with it — [fonts.test.ts](../../src/lib/math/fonts.test.ts) checks that. Deliberately not vendored: `mathlive-static.css` (the library injects those rules itself), the keypress `.wav` sounds (switched off; a Playwright case asserts none is fetched) and the compute engine (plain JavaScript, so Vite bundles it). Re-run with `--force` when `mathlive` or `katex` is upgraded.

### `build-wordlist.mjs` — the passphrase word list

```sh
node tools/build-wordlist.mjs [--force]
```

Downloads the EFF Long Wordlist (7,776 words — five dice, 12.9 bits a word — CC BY 3.0 US, credited in the tool's UI) and writes [src/lib/gen/wordlist.json](../../src/lib/gen/wordlist.json), refusing any file that does not hold exactly 7,776 entries, because the entropy the passphrase card reports is computed from that count. The list is its own lazy chunk (78 KB) — see the secrets case in [payload.spec.ts](../../tests/local/payload.spec.ts).

### `build-bg-assets.mjs` — the background remover's ML assets

```sh
node tools/build-bg-assets.mjs          # skips files already present
node tools/build-bg-assets.mjs --force  # re-download / re-copy
```

Produces, in `public/`:

| Output | Bytes | Source | License |
|---|---|---|---|
| `models/u2netp.onnx` | 4,574,861 | Downloaded from the rembg release of the U²-Net (small) ONNX conversion | Apache-2.0 |
| `ort/ort-wasm-simd-threaded.wasm` | 11,210,254 | Copied verbatim from `node_modules/onnxruntime-web/dist/` | MIT |
| `ort/ort-wasm-simd-threaded.mjs` | 20,856 | Same | MIT |
| `models/PROVENANCE.txt` | — | Rewritten every run | — |

`PROVENANCE.txt` records source URL or npm version, license, byte count and SHA-256 for each of the three binaries, plus the regenerate command. It is rewritten on every run even when both halves were skipped, so it always describes the files actually on disk. The ORT version in it is read from `node_modules/onnxruntime-web/package.json`, so the copied files always match the installed package.

Re-run it when:

- **`onnxruntime-web` is upgraded** — with `--force`, because the vendored `.wasm`/`.mjs` must match the installed package version.
- A vendored file is missing or suspected corrupt (compare against the recorded SHA-256).

Without `--force` the script is a no-op for anything already present; it throws `onnxruntime-web is not installed — run npm install first` if `node_modules` is absent.

**After re-vendoring, update `BG_ASSETS` in [runtime.ts](../../src/lib/bg/runtime.ts).** It hardcodes the three byte counts so the download progress bar works without a `Content-Length`; they must equal the numbers in `PROVENANCE.txt`, and the total (15,805,971 bytes) is the "15.8 MB" the UI and [README.md](../../README.md) promise.

The model choice was a licensing decision: BriaAI RMBG and `@imgly/background-removal` were rejected because both carry non-commercial terms.

### `build-city-dataset.mjs` — the city → timezone dataset

```sh
node tools/build-city-dataset.mjs path/to/cities15000.txt
```

Takes an already-downloaded GeoNames `cities15000.txt` (from `cities15000.zip`, every city with population ≥ 15k, CC BY 4.0) as its only argument — the script does not fetch it — and writes [src/lib/time/cities.json](../../src/lib/time/cities.json) (1,450,311 bytes, ~34k rows, committed).

Each row is `[name, countryCode, ianaZone, population]`: columns 1, 8, 17 and 14 of the TSV, rows missing any of name/zone/country dropped, sorted population-descending so search can rank without sorting ("tokyo" means Tokyo, not Shinjuku). It exits 1 with a usage line when the argument is missing.

Re-run it only to refresh from a newer GeoNames dump. The consumer is [cities.ts](../../src/lib/time/cities.ts), which pulls the JSON through a dynamic `import()` so it stays its own ~1.4 MB chunk fetched on the first city search — keep it that way (`payload.spec.ts` watches for it).

### `build-image-fixtures.mjs` — binary test fixtures

```sh
node tools/build-image-fixtures.mjs
```

Writes two files into [tests/local/fixtures/](../../tests/local/fixtures/):

- `sample.tiff` — a valid 20×10 solid-red RGBA TIFF encoded with `utif2` (1,800 bytes).
- `broken.tiff` — 64 bytes: the little-endian TIFF magic `II*\0` followed by `0xAB` filler, for the graceful-failure case.

Both are committed. PNG/JPG/WebP inputs are encoded in-page with a canvas at test time and the SVG fixture is checked in as text, so this script covers only the formats the browser cannot mint. Re-run it only if the fixtures are lost or their shape needs to change; the other checked-in files in that directory (the large PNG/JPG/WebP/TIFF/SVG samples and the AVIF photo) are hand-added, not generated.

### `preview-server.mjs` — the static server for `dist/`

Not a generator. A dependency-free `node:http` server:

```sh
node tools/preview-server.mjs [--port 4330] [--dir dist]
```

- Binds `127.0.0.1` explicitly, to match the health-check URL in [playwright.config.ts](../../playwright.config.ts).
- Static-host trailing-slash semantics: `/x/` serves `x/index.html`; `/x` that resolves to a directory returns a 301 to `/x/` using the still-encoded pathname (a decoded one can be an invalid header value).
- Rejects `../` traversal with 403 by requiring the normalized path to stay inside the root.
- MIME map covers the built types including `.wasm`, `.webmanifest` and `.woff2`; anything else is `application/octet-stream`. Every response carries `cache-control: no-store`.

It exists because **`astro preview` cannot be used from Playwright**: Astro 7's preview daemonizes itself when stdin is not a TTY, so the runner sees the process exit and aborts the run ("Process from config.webServer exited early") while the orphaned daemon keeps the port. `npm run preview` is still the right thing for looking at a build by hand.

### `audit-precache.mjs` — what the service worker's crawl would cache

```sh
npm run build && node tools/audit-precache.mjs [--dir dist] [--top 15]
```

Not a generator and fetches nothing. It replays the background crawl in [public/sw.js](../../public/sw.js) statically over `dist/` — reading `SHELL`, `WARM_MAX_ASSETS` and `CRAWL_SKIP` out of the worker's source so it cannot drift from it — and prints what the crawl reaches (files and bytes by type, the largest entries), what under `_astro/` it does not reach, what `CRAWL_SKIP` left to the offline bundles, and the loose string literals that would 404. Exit 1 only when the cap would cut a run short. Run it against a fresh build before a release; the numbers in [service-worker-and-offline.md](service-worker-and-offline.md) are its output for 0.2.0.

## Vendored assets and the provenance rule

**Nothing is fetched from a CDN at runtime.** Every third-party asset is either bundled by Vite from `node_modules` or vendored into `public/` and committed to the repo. This is the "no server" invariant in [architecture.md](architecture.md) applied to assets, and it has three consequences worth stating as rules:

- **A fresh clone must build a working app with no network access.** That is why `public/models/`, `public/ort/`, `src/lib/time/cities.json` and the TIFF fixtures are all in git despite being generated.
- **Anything vendored gets a provenance record.** For the ML assets that is `public/models/PROVENANCE.txt` (source, license, bytes, SHA-256, regenerate command); for the city dataset it is the header comment in the generator and in [cities.ts](../../src/lib/time/cities.ts) (GeoNames, CC BY 4.0). License compatibility is checked **before** adoption, not after.
- **Files in `public/` are served from the app's own origin**, copied verbatim into `dist/`, so their URLs must be built with `href()` from [paths.ts](../../src/lib/paths.ts) to survive a sub-path `base`.

The 15.8 MB of ML assets are deliberately **excluded** from the service worker's install precache and live in their own `useful-models-v1` Cache Storage bucket that version bumps never purge — see [service-worker-and-offline.md](service-worker-and-offline.md) and [tools/background-remover.md](tools/background-remover.md).

## Dependency policy

**Self-hosted.** No CDN, no external origin, no telemetry. A dependency that only works by phoning home is not a candidate.

**Heavy things load lazily.** The rule is that no page pays for freight it does not use. As of this version:

| Freight | How it stays out of the way |
|---|---|
| `onnxruntime-web` | `await import('onnxruntime-web/wasm')` in [runtime.ts](../../src/lib/bg/runtime.ts) and [offline.ts](../../src/lib/offline.ts); the CPU-only `/wasm` entry point, one wasm file behind it |
| The U²-Net model + ORT wasm | Fetched only on an explicit click, into `useful-models-v1` |
| `@sqlite.org/sqlite-wasm`, `@electric-sql/pglite` | Imported inside module Web Workers ([worker.ts](../../src/lib/sql/worker.ts), [pglite-worker.ts](../../src/lib/sql/pglite-worker.ts)) that are constructed on demand |
| `@codemirror/lang-sql` | `await import()` in the SQL adapters |
| `cities.json` | `import('./cities.json')` on the first city search |
| `utif2`, `exifr`, `piexifjs` | `await import()` at the point of use (TIFF decode, EXIF read, JPEG EXIF write) |
| `@dicebear/core` + `@dicebear/collection`, `jdenticon`, `lucide-static` | Memoized `import()` per engine in [logo.ts](../../src/lib/gen/logo.ts), each memo cleared on failure so a flaky fetch retries. Only DiceBear loads with the logo page, because its avatar is that page's default view |
| `wordlist.json` | `import()` from the passphrase generator only |
| `smol-toml` | `await import()` inside `parseAs` / `serializeAs` in [config/convert.ts](../../src/lib/config/convert.ts), so it arrives only when someone picks TOML in the convert dialog — which is itself mounted only while open |
| `mathlive`, `@cortex-js/compute-engine` | `await import()` inside [MathField.svelte](../../src/components/MathField.svelte)'s mount, so only the napkin-math page pays. The KaTeX faces are vendored to `public/math/` and arrive through a stylesheet, on demand — two faces for a typical formula, not twenty |

**Payload discipline is tested, not trusted.** [payload.spec.ts](../../tests/local/payload.spec.ts) watches real network requests and fails if any `HEAVY` matcher (ONNX runtime, model, SQLite, PGlite, cities, CodeMirror, the YAML and TOML parsers, the EFF word list, DiceBear, Lucide, Jdenticon, MathLive, the Compute Engine, the KaTeX faces) is hit by a page that should not need it, or if the precache contains anything under `/models/` or `/ort/`. **A new heavy dependency needs a new matcher there** — a lazy import is one careless refactor from becoming eager.

**Versions are pinned to ranges proven together** (Astro 7 / Svelte 5 / idb 8); a major bump of any of them may break generated-code assumptions. `engines.node` is `>=22.12.0`.

**`overrides`** holds one pin, `@emnapi/core: 1.11.2`. It reaches the tree transitively through Astro's markdown pipeline (`astro` → `@astrojs/markdown-satteri` → `satteri` → its per-platform binaries → `@napi-rs/wasm-runtime` → `@emnapi/core`), where one branch asks for `1.11.1` and another for `^1.7.1 || ^2.0.0-alpha.4`; the override forces a single resolution. It was added in the same commit as the Pages workflow. The reason is not recorded anywhere in the repo — treat it as load-bearing for `npm ci` until someone proves otherwise.

## Deployment

`npm run build` produces a static `dist/` (gitignored). No runtime is required: host it on Netlify, GitHub Pages, Cloudflare Pages, or any web server that serves files.

### Base path

The site can be served at a domain root or under a sub-path. `base` is **commented out** in [astro.config.mjs](../../astro.config.mjs) — the checked-in default is root-served. Astro turns `base` into `import.meta.env.BASE_URL` (with a trailing slash, `'/'` at the root), and:

- Every app-absolute link and `navigate()` goes through `href()` in [paths.ts](../../src/lib/paths.ts).
- The service worker derives its own `BASE` from its registration scope.
- The manifest and the vendored asset URLs resolve through the same helper.

So switching hosts is a one-line change, and there are two places to make it: uncomment `base` in the config, **or** pass `--base` on the command line. CI does the latter.

### The GitHub Pages workflow

[.github/workflows/astro.yml](../../.github/workflows/astro.yml) — pushes to `master` or `main`, plus manual `workflow_dispatch`. Concurrency group `pages`, `cancel-in-progress: false` so a production deploy is never killed mid-flight.

1. `actions/checkout@v4`, then a package-manager detection step that picks npm (`npm ci`) from the lockfile.
2. `actions/setup-node@v4` with **Node 25** (the repo only requires ≥ 22.12.0) and lockfile-keyed caching.
3. `actions/configure-pages@v5`.
4. `npx --no-install astro build --site "https://kieranwood.ca" --base "/useful"`.
5. `actions/upload-pages-artifact@v3` on `dist/`, then `actions/deploy-pages@v5` in a second job.

**Neither test suite runs in CI.** Nothing gates the deploy on `npm test` or `npm run test:unit`; both are local obligations. Nor does CI run any of the `tools/*.mjs` generators — it builds from the committed assets, which is the whole reason they are committed.

## Release checklist

[VERSION](../../VERSION) is the single source of truth for the app version: the entire file content is the semver string, no trailing newline, so `cat VERSION` works in scripts. Nothing in `src/` reads it and no UI displays it — backups carry `DB_VERSION` (the IndexedDB schema version, currently 12), not the app semver, so a version bump alone never affects stored data.

To cut a release:

1. **Bump `VERSION`.** Patch for fixes, minor for new features, major for breaking changes. **A schema change that needs a migration is at least a minor bump.**
2. **Add a dated section to [CHANGELOG.md](../../CHANGELOG.md)**, newest first: `# x.y.z (YYYY-MM-DD)` with `## Features`, `## Bug Fixes` and `## Other` beneath it. Call out schema changes explicitly and name the DB version whenever a migration ships — users carry their data across versions in their own browser.
3. **Commit:** `git add VERSION CHANGELOG.md && git commit -m "Release $(cat VERSION)"`.

Between releases, the standing checklist in [plan-phases.md](plans/plan-phases.md) governs: entries go under the current **unreleased** heading; if the newest heading already has a release date (as `# 0.2.0 (2026-08-21)` does now), bump `VERSION` first and open a new `x.y.z (unreleased)` heading. The same checklist covers the rest of a change's obligations — three schema files in lockstep, every write through `repo.ts`, both suites green, new routes in `SHELL` in [public/sw.js](../../public/sw.js) with `CACHE_NAME` bumped, links through `href()`, keyboard operability and AA contrast.

**`package.json` `"version"` is kept in sync with `VERSION`** (both `0.2.0` as of the 0.2.0 release; the drift the 0.2.0 bump once left behind was closed in Phase 11). Nothing reads either at runtime, but a release that bumps one and not the other is a release that lies to `npm`, so step 1 above means both files.

The 0.2.0 release also re-ran the audits Phase 11 calls for, recorded in the release commit: the a11y sweep over all 28 registered routes (registry-derived, nothing added by hand), the payload guard against the real build (MathLive, DiceBear, Lucide, Milkdown, mermaid and KaTeX stay off every page that does not use them), the offline suite with the `math-fonts` bundle registered and sized, and a static audit of what the background crawl reaches from the shell ([tools/audit-precache.mjs](../../tools/audit-precache.mjs), described in [service-worker-and-offline.md](service-worker-and-offline.md)).

## Known limits and decisions

- **The build does not typecheck.** No `astro check`, no `tsc --noEmit` script. Types are enforced by the editor and by review.
- **CI builds but does not test.** A red suite still deploys. Running `npm test` locally before pushing is the only gate.
- **`base` lives in two possible places** — the config file and the CI command line — and they can disagree. The CI flag is authoritative for what is actually published.
- **Generated assets are committed, not built.** That trades repo size (~16 MB of ML binaries plus 1.4 MB of city data) for an offline-capable, network-free build. The alternative — fetching at build time — would make a fresh clone depend on a GitHub release URL staying up.
- **`tools/*.mjs` have no tests and no npm scripts.** They are run by hand, rarely, by a maintainer who reads the header comment first. Each one's header is the real documentation for its arguments.
- **The ORT vendoring is a workaround, not a preference.** The bundled ORT build claims to inline its loader, but the production bundle still resolves it as a sibling `/_astro/…` URL nothing emits; hosting the loader and pinning `wasmPaths` is the fix. If a future ORT release makes the bundled path work, both the vendoring and the pin can go.
