# useful — Version 0.5.0 raw notes

The wish-list for 0.5.0 as it came out of [TODO](TODO), plus the appendices
that belong to the release rather than to any one phase. The reviewed,
sequenced version of the feature list is [version-5-phased.md](version-5-phased.md);
where the two disagree, that file is the later thought.

_Describes the code as of v0.5.0 (unreleased; schema v16) — verify against source when in doubt._

## The list, as asked for

- **Maintenance** — check all dependencies and do updates.
- **Images › Colour extractor** — generate a palette from an image; copy or
  upload an image and extract the major colours; pick how many; export the
  palette as a CSS theme in the same format as Generators › Themes, with the
  same component preview; copy each colour individually.
- **Calculators › Daily calorie calculator** — plan daily calorie needs
  against a gain or lose goal.
- **Calculators › Napkin Math** — export a calculation as an image: the
  typeset formula with the variables replaced by their values, a preview
  button, PNG or SVG output. *(Phase 3; not in the first sitting.)*

Two standing constraints came with the list and shaped several decisions:
usability wins over accessibility where the two genuinely collide, because
this is a personal app rather than one being handed to people with access
needs; and dev documentation carries mermaid diagrams and code references so
a reader can get from the prose to the line.

---

## Appendix A — the dependency audit

Run 2026-09-09 against the 0.4.0 lockfile, with `npm outdated` captured before
anything moved. Twenty-two packages were behind. The rule for this release was
minors and patches applied, majors listed with a verdict — the conservative
option, chosen because a broken toolchain costs more than a version number is
worth.

### Applied (fifteen, all within their existing ranges)

`@codemirror/state` 6.7.1 → 6.7.4 · `@codemirror/view` 6.43.8 → 6.43.11 ·
`@electric-sql/pglite` 0.5.5 → 0.5.8 · `@playwright/test` 1.56.0 → 1.63.0 ·
`@types/node` 22.10.2 → 22.20.2 · `@types/react` 19.2.18 → 19.3.0 ·
`@types/react-dom` 19.2.4 → 19.3.0 · `astro` 7.0.6 → 7.3.2 ·
`dompurify` 3.4.13 → 3.4.15 · `katex` 0.18.4 → 0.18.7 ·
`lucide-static` 1.33.0 → 1.43.0 · `marked` 18.0.9 → 18.0.12 ·
`mermaid` 11.17.0 → 11.17.2 · `onnxruntime-web` 1.22.0 → 1.29.0 ·
`svelte` 5.56.4 → 5.57.0

The suite was green before and after: 2,221 unit tests and a full production
build on the old tree, the same on the new one. `onnxruntime-web` and
`lucide-static` are the two worth re-checking by eye if anything looks wrong
later — both crossed many minor versions in one step, and they own the
background remover and every icon in the app respectively.

### Deferred, with reasons

| Package | Have | Latest | Verdict |
| --- | --- | --- | --- |
| `vitest` | 4.1.10 | 5.0.0 (4.1.11 for the patch) | **Blocked, not declined.** Even the 4.1.11 *patch* cannot be installed: npm 11.5.1 crashes with `Cannot read properties of null (reading 'edgesOut')` inside arborist's `#loadPeerSet` while resolving vitest's peer tree against this project's `@emnapi/core` override. Reproduced on `npm update`, on `npm update --save`, and on a bare `npm install vitest@4.1.11`; every other package installs fine. 4.1.10 runs the whole suite green, so this is a papercut rather than a risk. The override has no recorded reason — see the TODO's "For human" list |
| `typescript` | 6.0.3 | 7.0.2 | Deferred. A compiler major under Astro 7 and Svelte 5 is its own piece of work with its own regression surface, and nothing in 0.5.0 wants it |
| `react` / `react-dom` | 18.3.1 | 19.3.0 | Deferred. React is here only because `@excalidraw/excalidraw` needs it; upgrading means clearing Excalidraw's peer range first, and the app itself renders no React |
| `@dicebear/core` | 9.4.3 | 10.7.0 | Deferred. Drives the logo generator's seeded avatars. A major there can change generated output, which would silently alter every avatar someone has already saved a seed for |
| `@cortex-js/compute-engine` | 0.115.0 | 0.128.0 | Deferred. A 0.x minor is a breaking change by semver, and this is the engine napkin math parses and substitutes with — Phase 3 builds directly on `expr.subs()`, so moving it mid-release would confound any bug found there |
| `@sqlite.org/sqlite-wasm` | 3.53.0-build1 | 3.53.4-build1 | Deferred. The prerelease-tagged range does not admit the newer build without an explicit version pin, and the SQL playground has no complaint against the one it has |

### Note on the type mismatch

`react` sits at 18 while `@types/react` sits at 19 — a real major mismatch,
and the audit's most eye-catching finding. It is also harmless here: no file
in `src/` imports React or its types, and the packages exist solely to satisfy
Excalidraw's peer dependency. Correcting it means either dragging React
forward (an Excalidraw question) or the types back (churn for a library this
app does not compile against). Left as it is, recorded here so the next audit
does not rediscover it as news.

### Vulnerabilities

`npm audit` reports 14 (11 moderate, 3 high) after the update, all in
transitive build-time dependencies. None is reachable from the shipped
`dist/`, which is static files with no server: there is no request path, no
user input reaching a build tool, and nothing executes at deploy time. Not
addressed in this release; worth a look when one of them lands in a runtime
dependency rather than a toolchain one.
