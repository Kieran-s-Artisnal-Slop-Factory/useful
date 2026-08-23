# useful — Version 0.3.0 plan (phased)

What 0.3.0 adds, split into phases that can each cut a release on their own.
The feature list comes from [version-3.md](version-3.md), which stays as the
raw wish-list; this file is the reviewed version of it — the same features with
the technology chosen, the impossible parts named, and the order they can be
built in. Where the two disagree, this file is the later thought.

Written 2026-08-21 against the shipped 0.2.1 code: schema **v12**, `CACHE_NAME`
**`useful-cache-v18`**, 24 registered tools, `VERSION` already reads `0.3.0`,
and `CHANGELOG.md` carries an empty `0.3.0 (unreleased)` stanza opened by this
planning pass.

> **Progress:** phases are marked DONE in the overview table and on their own
> heading as they land. Everything else is still plan.

---

## Standing checklist — applies to EVERY phase

Inherited from [version-2.md](version-2.md), which inherited items 1–5 from
[plan-phases.md](plan-phases.md). Unchanged, and repeated here so a phase can be
worked from this file alone:

1. **If the data model changed:**
    1. All three schema files move in lockstep: [types.ts](../../../src/lib/db/types.ts),
       an **appended, `contains()`-guarded** migration in
       [db.ts](../../../src/lib/db/db.ts), and the `TABLES` mirror in
       [schema.ts](../../../tests/local/helpers/schema.ts) (plus the Tables
       section of [README.md](../../../README.md)).
    2. No sync regressions: every write goes through
       [repo.ts](../../../src/lib/db/repo.ts) (`patch()` for edits,
       `putSingleton` for singletons), rows stay JSON-native, page load writes
       nothing. `npm test` green **including the trust gate**.
    3. The new store rides backup export/import automatically — verify the
       round-trip test picked it up.
2. **Tests:** pure logic gets Vitest; anything touching UI + data layer gets a
   Playwright spec driving the real UI and asserting isolated deltas through the
   oracle. Both suites pass.
3. **CHANGELOG.md:** entries under the current unreleased version's `Features` /
   `Bug Fixes` / `Other` headings. Note the DB version whenever a migration
   ships.
4. **PWA:** new pages added to `SHELL` in [sw.js](../../../public/sw.js) +
   `CACHE_NAME` bumped; new tools registered in
   [registry.ts](../../../src/lib/registry.ts) with an icon in
   [icons.ts](../../../src/lib/icons.ts); links built with `href()`.
5. **Accessibility:** keyboard operability and AA contrast for anything new. The
   sweep in [a11y.spec.ts](../../../tests/local/a11y.spec.ts) reads its routes
   from the registry, so registering the tool is what enrols it.
6. **Docs:** every user-visible feature gets its page under [docs/dev/](../)
   and [docs/user/](../../user/). The dev page carries a mermaid diagram for
   anything with more than one moving part; the user page leads with the
   gotchas.

One addition for this release, because 0.3.0 is the first one where a tool
handles key material:

7. **Nothing secret is persisted.** The crypto pages (hashing, encryption, JWT)
   write nothing to IndexedDB — not keys, not plaintext, not tokens — and their
   specs assert `dumpAll()` is byte-identical before and after the whole
   session, the same way [secrets.spec.ts](../../../tests/local/secrets.spec.ts)
   does today. A backup is one plain JSON file; a private key that reached it
   would be a private key in the user's downloads folder forever.

---

## Decisions taken up front

Settled; the phases below assume them. Each records why, because the reasons are
the part that ages.

1. **Everything stays self-hosted, and nothing calls out.** No runtime CDN, no
   API. Every tool in this release is pure client-side computation — which is
   also why "look up this word", "fetch this image" and "check this hash against
   a breach list" are not features here.
2. **Hand-roll the small engines; import the large ones.** Same rule as 0.2.0.
   Myers diff, the edit-distance family, the readability metrics, MD5/SHA-2/
   SHA-3, the cron parser, the tree renderer and the placeholder generators are
   each a few hundred lines of pure, testable logic with published test vectors —
   they get written here and unit-tested against those vectors. Only two
   imports are proposed in the whole release: `bcryptjs` (Phase 6) and `figlet`
   (Phase 8), and both are argued at their phase.
3. **WebCrypto does the real cryptography.** `crypto.subtle` covers SHA-1/256/
   384/512, HMAC, PBKDF2, AES-GCM, RSA-OAEP, RSASSA-PKCS1-v1_5, RSA-PSS, ECDSA
   and ECDH. Hand-rolled implementations are for the algorithms it does **not**
   have (MD5, SHA-224, SHA-3) and for the teaching visualizations. Writing our
   own AES would be a strictly worse AES.
4. **`crypto.subtle` needs a secure context.** `https:` and `localhost` have it;
   a `dist/` folder opened as `file://` does not, and neither does plain `http:`
   to a LAN address. Every page that uses it feature-detects once and says which
   parts are unavailable and why, rather than throwing at the first click. The
   hand-rolled digests keep working there, which makes the split visible instead
   of mysterious.
5. **Text is segmented with `Intl.Segmenter`, not with regexes.** Graphemes,
   words and sentences all come from the platform (Chrome 87+, Firefox 125+,
   Safari 14.1+), so "characters" means what a reader means by characters —
   emoji, combining marks and non-Latin scripts included — and the counts do not
   quietly disagree with the transformations. A regex fallback covers the
   feature-detect miss and is labelled approximate where it matters.
6. **A count that cannot be right is not shown.** SMOG needs 30 sentences to
   mean anything, a syllable count is a heuristic, and `String.length` is UTF-16
   code units rather than characters. Each of those is stated on the page next
   to the number, not in a footnote — the same voice the YAML 1.1 traps get in
   the config playground.
7. **New tools write nothing unless they own documents.** Only the Docker
   Compose builder owns documents in this release (`compose_projects`, one
   migration, v13). Everything else is stateless, with at most a remembered
   default on the `preferences` singleton.
8. **Vendored assets carry provenance.** Figlet fonts and any premade vector art
   land through a `tools/build-*.mjs` script that records author, license and
   checksum in a `PROVENANCE.txt`, exactly like
   [build-bg-assets.mjs](../../../tools/build-bg-assets.mjs) and
   [build-math-assets.mjs](../../../tools/build-math-assets.mjs). A font whose
   header carries no license does not ship.
9. **Existing plumbing is reused, not re-grown.** Downloads through
   [exportFile.ts](../../../src/lib/exportFile.ts), archives through
   [zip.ts](../../../src/lib/zip.ts), rasterization through
   [convert.ts](../../../src/lib/img/convert.ts), SVG through
   [build.ts](../../../src/lib/svg/build.ts), tables through
   [DataTable.svelte](../../../src/components/DataTable.svelte), highlighting
   through [prism.ts](../../../src/lib/prism.ts), seeded randomness through the
   mulberry32 PRNG already in
   [generate.ts](../../../src/lib/config/generate.ts) (lifted to
   `src/lib/random.ts` the first time a second caller needs it).

---

## Open questions

Answers change what gets built. Each has a default the phase can proceed on if
nobody answers.

| # | Question | Needed by | Default if unanswered |
|---|----------|-----------|-----------------------|
| Q1 | The TODO files Diff / Similarity / Analysis under **Calculators**. They are text tools, not arithmetic. New **Text** category, or Calculators as written? | Phase 0 | **ANSWERED 2026-08-22: Calculators, exactly as the TODO has it.** No new category. Category is one field in the registry and routes do not encode it, so this stays reversible |
| Q2 | Generators would reach 16 tools by the end of this release. Split the DevOps-flavoured ones (Docker Compose, Crontab, File tree) into their own category? | Phase 9 | **No** — Generators as the TODO has it, revisited at Phase 14 if the sidebar reads badly |
| Q3 | Base64 sits under **Images** in the TODO but handles text as well. | Phase 4 | **ANSWERED 2026-08-22: Images**, with `text`/`encode`/`decode`/`data url` aliases so search lands either way |
| Q4 | MD5, SHA-224 and SHA-3 are not in WebCrypto. Hand-roll, or take `js-md5` + `js-sha3` (or `hash-wasm`)? | Phase 5 | **Hand-roll** in `src/lib/hash/`, against RFC 1321 / FIPS 180-4 / FIPS 202 vectors. ~450 lines total, no new dependency, and the vectors make it provable |
| Q5 | bcrypt cannot be hand-rolled sanely (Eksblowfish + 4 KB of S-box tables). Import `bcryptjs`, or offer PBKDF2 only? | Phase 6 | **`bcryptjs`** (MIT, pure JS, ~25 KB) in a Web Worker, cost capped at 12, with a progress state — a cost-14 hash on the main thread freezes the tab for seconds |
| Q6 | "Diffie-Hellman" — WebCrypto has ECDH, not classic finite-field DH. | Phase 6 | **Both, honestly labelled:** ECDH/X25519 for the real key agreement, plus a small-number BigInt visualizer (Alice/Bob/shared secret with 3-digit primes) marked as a teaching toy that is not secure |
| Q7 | JWT EdDSA (Ed25519) is in WebCrypto only on recent browsers. | Phase 7 | **Feature-detect**; when absent the algorithm is listed and disabled with the reason, never silently missing |
| Q8 | ASCII text art: import `figlet`, or hand-roll the FLF parser and its smushing rules? | Phase 8 | **Import `figlet`** (MIT, ~50 KB, lazy) and vendor only fonts whose licence we verified. Smushing rules are where a hand-rolled renderer produces subtly wrong output that no test we would think to write catches |
| Q9 | Does the Compose builder need to **import** an existing `docker-compose.yml`? | Phase 12 | Export-first in Phase 12; **best-effort import in Phase 13**, which reports every key it could not represent instead of dropping it |
| Q10 | Template starter projects: vendor the hello-world sources in the repo, or link out? | Phase 13 | **Vendor** them as string constants (a few KB each), zipped client-side by `zip.ts`; frameworks whose scaffolding rots (Astro, Next.js, SvelteKit, TanStack) ship README steps instead, as the TODO already says |
| Q11 | Placeholder text via a tiny in-browser LLM? | Phase 11 | **No** — moved to [far-fetched.md](far-fetched.md). The smallest usable model is an order of magnitude larger than the whole app, and a seeded corpus is better placeholder text anyway |
| Q12 | Premade vector scenes (nature / sports / city) — author them or source CC0? | Phase 11 | **Author them in-repo** as hand-written SVG, three per theme. Provenance for art we drew is one line; provenance for scraped art is a research project |
| Q13 | Which cron dialect? | Phase 10 | **Vixie/POSIX five-field + `@macros`.** Six-field (seconds) dialects are named as unsupported rather than half-parsed |
| Q14 | Hashing input: text only, as the TODO says, or files too? | Phase 5 | Text only for 0.3.0. Files need chunked reads and a progress model; noted as out of scope, not forgotten |

---

## Phase overview

| Phase | Goal | New deps | DB | Notes |
|-------|------|----------|----|-------|
| 0 ✅ | Groundwork: version drift, shared text + base64 modules | — | — | **DONE 2026-08-22.** Unblocks 1–4, 7 |
| 1 ✅ | Diff | — | — | **DONE 2026-08-22.** |
| 2 ✅ | Similarity | — | — | **DONE 2026-08-22.** Shares Phase 0's tokenizer |
| 3 ✅ | Text analysis | — | — | **DONE 2026-08-22.** |
| 4 ✅ | Base64 | — | — | **DONE 2026-08-22.** |
| 5 ✅ | Hashing (+ HMAC, salt & pepper) | — | — | **DONE 2026-08-22.** Unblocks 6, 7 |
| 6 ✅ | Encryption & key exchange | `bcryptjs` | — | **DONE 2026-08-22.** |
| 7 ✅ | JWT | — | — | **DONE 2026-08-22.** Built on Phase 5's key plumbing |
| 8 ✅ | ASCII art (image + text) | `figlet` | — | **DONE 2026-08-22.** Vendors 14 fonts; the build refuses unlicensed ones |
| 9 ✅ | File tree | — | — | **DONE 2026-08-22.** Six listing formats in, four ways out |
| 10 ✅ | Crontab | — | — | **DONE 2026-08-22.** Parser, builder, next runs, systemd timer |
| 11 ✅ | Placeholders (text + images) | — | — | **DONE 2026-08-22.** Two corpora, eight image generators, nine drawn scenes |
| 12 ✅ | Docker Compose builder | — | **v13** | **DONE 2026-08-22.** `compose_projects`; model in, YAML out |
| 13 ✅ | Docker Compose templates | — | — | **DONE 2026-08-22.** 9 stacks, 10 snippets, best-effort import |
| 14 | Hardening + release | — | — | Last |

Twelve new tool pages, one migration, two dependencies. The migration number
assumes this order; the migration list is append-only, so whoever lands a store
first takes v13.

---

## Phase 0 — Groundwork — DONE (2026-08-22)

**Goal:** the shared modules Phases 1–4 and 7 all import, and the release
bookkeeping that is wrong today. Nothing user-visible except the version fix.

**Scope:**

1. **Version drift, again.** `VERSION` reads `0.3.0`,
   [package.json](../../../package.json) reads `0.2.1` — the same drift Phase 0
   of 0.2.0 fixed once already. Sync it. (The `0.3.0 (unreleased)` stanza in
   [CHANGELOG.md](../../../CHANGELOG.md) was opened by this planning pass, so
   every phase already has somewhere to write.)
2. **`src/lib/text/tokenize.ts`** — the one segmentation layer, used by Phases
   1, 2, 3 and 11:
   `graphemes()`, `words()`, `sentences()`, `paragraphs()`, `lines()`, all over
   `Intl.Segmenter` with a documented regex fallback; `syllables(word)` (vowel
   groups, silent-e, `-le` ending, common suffix exceptions — explicitly a
   heuristic); and `sizes(text)` returning graphemes / code points / UTF-16
   units / UTF-8 bytes as four distinct numbers, because they disagree and the
   disagreement is the interesting part.
3. **`src/lib/encode/base64.ts`** — `encodeText`/`decodeText` (through
   `TextEncoder`/`TextDecoder`, never bare `btoa` on a Unicode string),
   `encodeBytes`/`decodeBytes`, base64url variants, strict validation that names
   *where* an input stops being base64, optional MIME line-wrapping at 76, and
   data-URL parse/build. `toBase64`, `toBase64Url` and `HEX` currently live in
   [secrets.ts](../../../src/lib/gen/secrets.ts); they move here and `secrets.ts`
   re-exports, so no call site changes and there is one implementation.
4. **Registry categories: none added** (Q1, answered). Diff, Similarity and
   Text analysis register under **Calculators**, and Base64 under **Images**,
   exactly as the TODO files them. `registry.test.ts` asserts every category is
   one of the known ones, so an invented category would have failed the suite
   rather than quietly appearing in the sidebar.
5. **Docs drift.** Forty-two doc pages said "as of v0.2.1 (unreleased)";
   0.2.1 shipped on 2026-08-21. All of them now read `v0.3.0 (unreleased;
   schema v13)`, and [build-and-tooling.md](../build-and-tooling.md)'s two
   version paragraphs name the right headings again.

**Data model:** none.

**Tests:** unit — 39 new cases. `tokenize.ts`: a ZWJ family is one grapheme
(3 / 11 / 17 for the same string), hyphenated and apostrophised words stay
whole, CJK segments without spaces, `Mr. Smith` and `J. R. R. Tolkien` are not
split while `…etc. Then` still is, text with no terminator is one sentence, and
the syllable heuristic is pinned **including the four words it gets wrong**, so
a rule change cannot move every readability score in silence. `base64.ts`: the
RFC 4648 vectors, `café` (where `btoa` throws), both alphabets, a 76-column
body, all 256 byte values round-tripped, and the reported offset of the first
character that was not base64. Playwright — the existing suites stay green
unchanged.

**Docs:** [architecture.md](../architecture.md) gained a row per new module,
[testing.md](../testing.md) a row per new unit file, and
[build-and-tooling.md](../build-and-tooling.md) its version paragraphs.

**Left for later, deliberately:** four more hand-rolled base64 encoders survive
in [assets.ts](../../../src/lib/notebook/assets.ts),
[formulaMarkup.ts](../../../src/lib/codegen/formulaMarkup.ts),
[mathFonts.ts](../../../src/lib/notebook/mathFonts.ts) and
[exportFile.ts](../../../src/lib/exportFile.ts). They are byte-level, correct,
and covered by slow specs; folding them into the shared module is a Phase 14
job, not a groundwork one. (The shared encoder was measured against the chunked
`btoa` path they use — 190 ms vs 159 ms for 4 MB, byte-identical output — so
there is no performance argument for keeping them.) *Done in Phase 14 — and the
shared module came out faster than `btoa` in the process; see there.*

**CHANGELOG:** Other.

---

## Phase 1 — Diff — DONE (2026-08-22)

**Goal:** compare two texts and see exactly where they differ.

**Scope:**

1. **`src/lib/diff/myers.ts`** — Myers O(ND) diff over an array of tokens,
   returning a list of `{ type: 'equal' | 'insert' | 'delete', tokens }`. Token
   arrays come from Phase 0: lines, words, or graphemes.
2. **Three granularities**, switchable: **line**, **word**, **character**.
   Line diff additionally computes a word-level diff inside each changed line
   pair, which is what makes a one-character change readable instead of two red
   lines.
3. **Two layouts**: side-by-side (aligned gutters, synchronized scroll) and
   inline (unified). Colour is never the only signal — `+`/`−` markers and
   `<ins>`/`<del>` semantics carry it for anyone who cannot see the tint, and
   both themes hit AA on the highlight backgrounds.
4. **Options:** ignore leading/trailing whitespace, ignore all whitespace,
   ignore case, and treat trailing newline / CRLF differences explicitly (a file
   that differs only in line endings must say so, not show an all-red diff).
5. **A summary line** — *n* insertions, *n* deletions, *n* changed lines,
   similarity as a percentage — and **copy as unified diff** (`---`/`+++`/`@@`
   hunks with configurable context), which is the form the result is usually
   wanted in.
6. Input from typing, paste, or dropping two files (read as text; a binary file
   is refused by name).

**Data model:** none.

**Tests:** unit — 24 cases across `myers.test.ts` and `text.test.ts`: the
paper's own `ABCABBA`/`CBABAC` example at cost 5, a hundred random pairs
reconstructed in both directions, the head/tail trim, the `key` indirection,
the truncation fallback still being applicable, and the unified diff compared
against hand-written `diff -u` output including `\ No newline at end of file`.
Playwright — 8 cases in `text-tools.spec.ts`, each asserting `dumpAll()` is
unchanged.

**One thing the plan did not know:** the line-ending note can only fire for a
LOADED file. An HTML `<textarea>` normalises its value to LF, so no amount of
typing or pasting can put a CRLF into the comparison — the spec drives it
through `setInputFiles`, and both doc pages say so.

**Docs:** `docs/dev/tools/text-tools.md` (new; grows through Phases 2–3),
`docs/user/text-tools.md`. Registered under **Calculators** (Q1).

**CHANGELOG:** Features.

---

## Phase 2 — Similarity — DONE (2026-08-22)

**Goal:** one word against many, scored by several algorithms, with the working
shown.

**Scope:**

1. **`src/lib/text/edit.ts`** — the algorithm family from
   [speyl](https://github.com/Descent098/speyl) (MIT, the same author's Go
   library), ported as pure functions with both raw distance and a normalized
   0–1 similarity:
    - **Levenshtein** (DP), insert/delete/substitute, normalized by
      `max(len)`;
    - **Damerau-Levenshtein**, adding adjacent transposition;
    - **Indel** — insertions and deletions only, no substitution, normalized by
      `len(a) + len(b)`; the LCS metric under another name, and worth saying so
      on the page;
    - **Jaro** — matching window `floor(max(len)/2) - 1`, transpositions
      halved;
    - **Jaro-Winkler** — Jaro plus prefix scaling (`p = 0.1`, prefix capped at
      4). *(The TODO's "Jado" is Jaro; Jaro-Winkler comes along because it is
      four lines on top and is what most spell-checkers actually use.)*
2. **Arbitrary comparison list.** One input word, *n* comparison words (typed
   one per line, or pasted), results in the app's `DataTable` — sortable by any
   algorithm's column, so "which algorithm disagrees with the others" is one
   click.
3. **The visualizer**, per algorithm and per word pair — this is the point of
   the tool:
    - Levenshtein / Damerau / Indel: the DP matrix, drawn as a grid, with the
      traceback path highlighted and each step labelled (match / substitute /
      insert / delete / transpose). Stepping through the path is keyboard
      operable, and the matrix collapses to a scrollable region for long words.
    - Jaro / Jaro-Winkler: the matching window drawn over both words, matched
      characters joined, transposed pairs marked, and the three terms of the
      formula printed with the numbers filled in.
4. **A performance note** taken from speyl's own benchmarks: Jaro is the fast
   one, recursive Levenshtein is thousands of times slower. The tool caps the
   matrix visualization at a word length where a grid is still a grid, and says
   so.

**Data model:** none.

**Tests:** unit — 20 cases: the published pairs (`kitten`/`sitting` = 3,
`MARTHA`/`MARHTA` Jaro 0.944444 and Jaro-Winkler 0.961111, `DIXON`/`DICKSONX`
0.766667 / 0.813333, Indel on `ABCD`/`ACBD` = 2), symmetry, identity,
empty-string edges, grapheme counting, and the traceback's op sequence for
`kitten`→`sitting`. Playwright — 8 cases including stepping the matrix, the
Damerau swap, the Jaro formula, sorting, and the two limits. Zero DB writes on
every one.

**Corrected while building:** the plan said `CA`/`ABC` is 2 under Damerau. That
is the UNRESTRICTED distance; this ships optimal string alignment (the variant
almost every library means), where it is 3 — pinned in the tests, because
"which Damerau" is exactly the kind of thing that gets changed silently.

**Docs:** the shared text-tools pages; the dev page carries a mermaid diagram of
the DP traceback.

**CHANGELOG:** Features.

---

## Phase 3 — Text analysis — DONE (2026-08-22)

**Goal:** paste text, learn about it, and transform it.

**Scope:**

1. **Counts**, all from Phase 0's tokenizer: characters (graphemes) with and
   without spaces, code points, UTF-16 units, UTF-8 bytes, words, unique words,
   sentences, paragraphs, lines. Reading and speaking time at stated
   words-per-minute rates.
2. **Difficulty**, the three metrics from
   [readn](https://github.com/Descent098/readn) (MIT):
    - **Flesch reading ease** `206.835 − 1.015(words/sentences) −
      84.6(syllables/words)`, with the band it falls in;
    - **Flesch-Kincaid grade** `0.39(words/sentences) + 11.8(syllables/words) −
      15.59`;
    - **Automated Readability Index** `4.71(chars/words) + 0.5(words/sentences)
      − 21.43` — the one that needs no syllable guessing, which is why readn
      calls it the most reliable of the three;
    - **SMOG** `1.0430 √(polysyllables × 30/sentences) + 3.1291`, **shown only
      at 30+ sentences** and otherwise replaced by the reason it is missing.
   Each metric has an `Explainer` giving the formula with this document's own
   numbers substituted in, and the whole card carries readn's caveat: syllable
   and sentence counting are heuristics, numerals and non-English text are not
   handled, and a score is a smell rather than a measurement.
3. **Frequency**: top words and top *n*-grams in a `DataTable`, with a
   stop-word toggle.
4. **Transformations**, applied to the pasted text, each with copy and download:
   sentence case, Capitalize Each Word, lowercase, UPPERCASE, ~~strikethrough~~
   (U+0336 combining overlay, with a note that it is a text effect and some
   fonts drop it), w i d e   t e x t (spaced, plus a full-width `Ａ Ｅ` variant),
   and sPoNgEbOb case (alternating over letters only, skipping non-letters so the
   rhythm survives punctuation). Every transform runs over graphemes, so an
   emoji or a combining mark cannot be split in half.
5. A **live** panel: counts update as you type (debounced), transformations on
   demand.

**Data model:** none. (`preferences` may remember the last words-per-minute
setting; one field, mirrored per the standing checklist.)

**Tests:** unit — 28 cases. Each formula is checked against arithmetic done by
hand on one fixed sentence (Flesch 117.6675, Flesch-Kincaid −2.035, ARI
−4.0033), SMOG is `null` under thirty sentences and 13.0238 at exactly thirty,
n-grams do not cross a full stop, and every transformation is run over an emoji
and an accented letter. Playwright — 5 cases including the SMOG note counting
down, the stop-word toggle, and the transformations leaving the source text
untouched. Zero DB writes.

**One thing the plan did not anticipate:** sentence case cannot use
`sentences()`. The Unicode rules refuse to break before a lower-case word, which
is right for counting and exactly wrong for a transformation whose input is
usually all lower case — so it walks the text itself while still asking the
shared tokenizer whether the word before the stop was a title. Both doc pages
say so.

**Docs:** the text-tools pages; the user page leads with "these scores are
heuristics".

**CHANGELOG:** Features.

---

## Phase 4 — Base64 — DONE (2026-08-22)

**Goal:** text and images to base64 and back, without the traps.

**Scope:**

1. **Text mode:** encode/decode, standard and URL-safe alphabets, padding
   on/off, optional 76-column wrapping. Decoding a broken string reports the
   offset where it stopped being base64 rather than returning mojibake — `atob`
   fails silently in ways that look like data.
2. **Image encode:** drop or pick an image, get raw base64 **and** a
   `data:` URL, with the MIME type read from the file's magic bytes rather than
   its extension. Copy either, download the base64 as a `.txt`, and copy as a
   ready-made CSS `url()` or `<img src>`.
3. **Image decode:** paste raw base64 or a data URL, see the decoded image
   previewed, and download it with the extension its sniffed type deserves.
   Input that decodes but is not an image says exactly that.
4. **The size story, on the page:** base64 is ~33 % larger than the bytes it
   encodes (4 characters per 3 bytes), the encoded size is shown next to the
   original, and anything over a megabyte gets a plain warning about what a data
   URL that size does to a stylesheet, a clipboard and a backup file.
5. Everything runs through Phase 0's module, so the notebook's asset handling
   and the secrets page share one base64 implementation with this page.

**Data model:** none.

**Tests:** unit — Phase 0's base64 tests plus a new
[sniff.test.ts](../../../src/lib/encode/sniff.test.ts): every image format the
app handles, container brands matched through their wrappers (a `WEBP` tag
without `RIFF` is not a WebP), PDF/ZIP/gzip/WOFF2, SVG recognised only when the
text really opens as XML, and the text/binary fallbacks. Playwright — 8 cases,
all zero-write.

**Grown beyond the plan, on purpose:** the plan said "MIME type read from the
file's magic bytes". That turned into
[sniff.ts](../../../src/lib/encode/sniff.ts), a table-driven identifier shared
by both directions — which is what lets a data URL that *claims* `image/jpeg`
while containing a PNG be reported as a PNG. The label in a data URL is a
claim; the bytes are the evidence, and the spec pins that.

**Docs:** `docs/dev/tools/base64.md`, `docs/user/base64.md`.

**CHANGELOG:** Features.

---

## Phase 5 — Hashing — DONE (2026-08-22)

**Goal:** every hash the TODO asks for, plus the honesty about what a hash is
for.

**Scope:**

1. **`src/lib/hash/`** — one module per algorithm, all pure, all taking and
   returning bytes:
    - **SHA-1, SHA-256, SHA-384, SHA-512** through `crypto.subtle.digest`;
    - **SHA-224** hand-rolled (FIPS 180-4: the SHA-256 core with different
      initial values, truncated to 224 bits) — WebCrypto does not have it;
    - **SHA-3-224/256/384/512** hand-rolled (FIPS 202, Keccak-f[1600], `0x06`
      padding), with **SHAKE128/256** falling out of the same core for free;
    - **MD5** hand-rolled (RFC 1321), shipped **with** a banner saying it has
      been collision-broken since 2004 and belongs on checksums, not on
      anything that matters.
   Each has its published test vectors as a table-driven unit test — empty
   string, `abc`, the million-`a` case (kept behind a slow-test flag), and the
   NIST byte-oriented vectors.
2. **HMAC** for every SHA-2 variant through `crypto.subtle`, with the key as
   text, hex or base64.
3. **Output formats:** hex (upper/lower), base64, base64url, and a
   space-grouped form for reading aloud. Copy on each.
4. **Salt and pepper**, where they mean something: a salt field (random-fill
   button reusing `randomBytes` from `secrets.ts`, or typed), a pepper field,
   and a visible statement of the composition order actually used
   (`H(pepper || salt || message)`, shown as a formula that updates with the
   fields).
5. **The refusal that has to be on this page:** salted SHA-256 is not password
   storage. The card says so and links to Phase 6's bcrypt and to PBKDF2, which
   is in WebCrypto and is the standards-track answer. A hashing tool that lets
   someone leave believing they have built a password store has done harm.
6. **Secure-context degradation** (decision 4): where `crypto.subtle` is
   missing, the SHA-2 family greys out with the reason, and MD5 / SHA-3 / SHA-224
   keep working because they are ours.

**Data model:** none. Nothing on this page is written anywhere (checklist 7).

**Tests:** unit — 21 cases across
[digest.test.ts](../../../src/lib/hash/digest.test.ts) and
[index.test.ts](../../../src/lib/hash/index.test.ts). Every algorithm is checked
**twice**: against the published vectors (RFC 1321, FIPS 180-4, FIPS 202) and
against Node's OpenSSL across the block boundaries — the constants catch a
mistyped implementation, the cross-check catches a mistyped constant. It earned
its keep immediately: MD5's third-round shift table was transposed, and the
RFC's own vectors caught it on the first run. Playwright — 7 cases, each
asserting the database is byte-identical afterwards.

**Two things the plan under-specified:**

1. **HMAC covers everything, not just the SHA-2 family.** WebCrypto's HMAC does
   SHA-1/2; the generic construction over the local digests covers MD5,
   SHA-224 and SHA-3 — using each algorithm's own block size (144/136/104/72
   for SHA-3, not 64). Both paths are checked against OpenSSL.
2. **SHA-256 survives an insecure context**, because this app implements it
   too. `available(id)` answers per algorithm rather than per page, so the
   degradation is precise instead of "crypto is off".

**Docs:** `docs/dev/tools/hashing.md` (algorithm sources, which come from
WebCrypto and which are ours, and why), `docs/user/hashing.md` (leads with
"hashing is not encryption, and salted SHA is not password storage").

**CHANGELOG:** Features.

---

## Phase 6 — Encryption & key exchange — DONE (2026-08-22)

**Goal:** the encrypt half of the TODO's "Hash & Encrypt", built on WebCrypto,
with the teaching parts clearly marked as teaching parts.

**Scope:**

1. **AES-GCM**: key from a password via **PBKDF2** (iteration count shown and
   adjustable, salt generated per encryption) or from raw key bytes; a fresh
   random 96-bit IV per operation, never reused; output as one self-describing
   bundle (`salt`, `iv`, `ciphertext`, parameters) in base64 so a decrypt has
   what it needs. AES-GCM rather than AES-CBC because it authenticates, and
   unauthenticated encryption is a bug that takes years to surface.
2. **RSA-OAEP**: generate a key pair (2048/3072/4096), export public and private
   as PEM (SPKI / PKCS#8) and JWK, import either, encrypt and decrypt — with the
   size limit stated plainly (a 2048-bit OAEP-SHA-256 key encrypts at most 190
   bytes; longer input is refused with the number, not truncated). The
   hybrid-encryption pattern is explained where the refusal appears.
3. **Key exchange (Q6):** ECDH (P-256/384/521) and X25519 where the browser has
   it, generating two parties' keys and deriving the shared secret in the page,
   plus a **small-number finite-field visualizer** (BigInt, three-digit prime)
   showing g, p, a, b, A, B and the shared secret, labelled as a demonstration
   that is not secure and never handling real input.
4. **bcrypt** (Q5) via `bcryptjs` in a Web Worker — hash with a cost slider
   (4–12, capped, with the measured time shown), and verify a password against
   an existing `$2a$`/`$2b$` hash. The worker exists because a cost-12 hash in
   pure JS blocks the main thread long enough to look like a crash. The card
   states what bcrypt's 72-byte input limit does to long passphrases.
5. **One-time pad**: XOR with a key generated at exactly the message's length
   from `crypto.getRandomValues`, output as hex/base64, and three warnings that
   are the whole lesson — the key must be as long as the message, must never be
   reused, and must reach the other party some other way. Reusing a key in the
   UI is refused rather than warned about.
6. **Everything stays in the tab and nothing is stored** (checklist 7),
   including a deliberate absence: no "save this key pair" button.

**Data model:** none.

**New dependency:** `bcryptjs` (MIT), imported inside the worker only, with a
matcher in [payload.spec.ts](../../../tests/local/payload.spec.ts) so it cannot
creep into the main bundle.

**Tests:** unit — 19 cases in
[crypto.test.ts](../../../src/lib/crypto/crypto.test.ts): the bundle format and
its round trip, a flipped ciphertext bit refused (which is the whole argument
for GCM), a fresh salt and IV on every run, the OAEP limit at 2048 and 4096
bits, PEM wrapping at 64 columns, both sides of ECDH agreeing on every curve
the runtime has, a third party deriving something different, `modPow` where a
double would overflow, and the pad refusing a short key. Playwright — 7 cases,
each asserting the database is byte-identical afterwards, plus a payload case
proving `bcryptjs` does not arrive until someone asks for a hash.

**Answered by building it:** Q5 and Q6 both took their defaults —
`bcryptjs` in a worker with the cost capped at 12, and ECDH beside a
three-digit-prime demonstration that says in two places that it is not a
cipher.

**Docs:** `docs/dev/tools/encryption.md` (which primitive, which WebCrypto call,
why GCM, why the worker), `docs/user/encryption.md` (leads with "this is for
learning and for small one-off jobs; it is not a key-management system").

**CHANGELOG:** Features.

---

## Phase 7 — JWT — DONE (2026-08-22)

**Goal:** [jwt.io](https://www.jwt.io/)'s featureset, offline.

**Scope:**

1. **Decode** as you type: header, payload and signature split and
   syntax-highlighted through `prism.ts`, with the registered claims (`iss`,
   `sub`, `aud`, `exp`, `nbf`, `iat`, `jti`) pulled into a table where the
   timestamps are rendered as absolute dates *and* relative ages, and an expired
   or not-yet-valid token is called out at the top. Decoding never verifies —
   the page says which of the two it has done, because confusing them is the
   classic JWT bug.
2. **Verify** with a secret (HMAC) or a public key (PEM/JWK), and **sign** a
   header+payload into a token. Algorithms: **HS256/384/512**,
   **RS256/384/512**, **PS256/384/512**, **ES256/384/512** through WebCrypto,
   and **EdDSA** feature-detected (Q7).
3. **The attack notes**, on the page: `alg: none` is refused rather than
   rendered as valid; an algorithm-confusion attempt (verifying an `HS256` token
   against an RSA public key) is named; and the standing reminder that a JWT
   payload is signed, not encrypted — anyone holding the token can read it, and
   the page proves it by decoding without a key.
4. Reuses Phase 0's base64url and Phase 5's HMAC plumbing; generates HMAC
   secrets through the existing `JWT_BYTES` sizing in
   [secrets.ts](../../../src/lib/gen/secrets.ts), so the two pages agree on what
   a JWT secret should weigh.

**Data model:** none.

**Tests:** unit — 16 cases in
[jwt.test.ts](../../../src/lib/crypto/jwt.test.ts): the specification's own
example token verifying with its published secret, the claim table's dates,
`alg: none`, algorithm confusion, verifying with a private key refused, and a
sign-then-verify round trip for **every** asymmetric algorithm the runtime
supports (RS/PS/ES256-512, and EdDSA where present). Playwright — 6 cases,
zero-write, including the one that matters most: a tampered payload still
decodes and stops verifying.

**Q7 took its default:** EdDSA is feature-detected, listed and disabled with
the reason where Ed25519 is absent rather than silently missing.

**Docs:** `docs/dev/tools/jwt.md`, `docs/user/jwt.md`.

**CHANGELOG:** Features.

---

## Phase 8 — ASCII art — DONE (2026-08-22)

**Goal:** pictures and words as text.

**Scope:**

1. **Image mode**, hand-rolled: draw the image to a canvas at the target
   character width, compensate for the ~2:1 cell aspect ratio, map luminance to
   a character ramp (a 10-step and a 70-step ramp, invertible), and emit
   monospace text. Options: width in characters, ramp, invert, colour
   (plain text, or HTML/SVG with per-character colour), background. Copy as
   text, download as `.txt`, and — for the coloured modes — download as SVG or
   PNG through [convert.ts](../../../src/lib/img/convert.ts).
2. **Text mode** via `figlet` (Q8), lazily imported, with **at least a dozen
   vendored fonts** covering the four the TODO names: a blocky 3-D one, a
   stroke-based one, one with flames, and one built from `█`. Fonts are
   installed by a new `tools/build-figlet-fonts.mjs` that copies each `.flf`,
   reads the author/licence lines out of its header, writes
   `public/figlet/PROVENANCE.txt` with a checksum per font, and **fails the
   build** if a font has no licence statement — which is the TODO's "make sure
   you can source the licenses" turned into something a person cannot forget.
3. Font picker with a live preview of the typed text in each font (rendered
   lazily as the list scrolls), layout options figlet supports (`fitted`,
   `full`, `smush`), and horizontal alignment.
4. The fonts are small enough to precache with the shell; the `figlet` chunk
   gets a `payload.spec.ts` matcher so it stays out of the main bundle.

**Data model:** none. (`preferences` may remember the last font.)

**New dependency:** `figlet` (MIT).

**Tests:** unit — 46 cases across
[image.test.ts](../../../src/lib/ascii/image.test.ts) (ramp shape and
monotonicity, luminance, the cell-aspect compensation, box averaging proved on
a one-pixel checkerboard, alpha compositing, invert, the clamps),
[render.test.ts](../../../src/lib/ascii/render.test.ts) (SVG geometry,
`textLength` on plain rows and explicit `x` on coloured ones, colour-run
grouping, XML escaping, the CSS-colour filter, alignment) and
[provenance.test.ts](../../../src/lib/ascii/provenance.test.ts) (the FIGfont
header parser including a space hardblank and `tlf2a`, the licence matcher, the
**refusal path**, Latin-1 transcoding, and the vendored files re-checksummed
against the catalogue). Playwright — 8 zero-write cases in
[ascii-art.spec.ts](../../../tests/local/ascii-art.spec.ts): a gradient PNG
converted to an exact 80×20 rectangle that runs dark to light, invert, the
width knob, colour mode and the SVG/PNG/txt downloads, plus the picker drawing
a row only once it is scrolled to. One more in
[payload.spec.ts](../../../tests/local/payload.spec.ts) holds `figlet` to a
single lazy chunk and the picker to fewer than fourteen font fetches.

**Q8 took its default:** `figlet` is imported rather than hand-rolled, and only
fonts whose own header states redistribution terms are vendored — fourteen of
them, covering all four shapes the TODO named (3D Diagonal, the stroke family,
Fire Font-k, and Pagga/Future from block characters). Several obvious
candidates are absent *because* the gate works: `ANSI Shadow` records its author
as `?`, and `Bloody` names only its converter.

**As built, two things the plan did not anticipate:**

1. Two of the block fonts are **TOIlet** fonts (`tlf2a`), and one of them uses a
   **space as its hardblank** — so the header fields have to be read from
   `slice(6)` rather than by splitting the signature line.
2. Three fonts are Latin-1, and the browser reads a `.flf` with
   `Response.text()`. They are transcoded to UTF-8 at vendoring time, with the
   fact recorded in `PROVENANCE.txt`.

**Docs:** `docs/dev/tools/ascii-art.md` (including the font licence table),
`docs/user/ascii-art.md`.

**CHANGELOG:** Features, plus an Other note for the `v26` cache bump — this is
the first release whose install precache carries fonts.

---

## Phase 9 — File tree — DONE (2026-08-22)

**Goal:** build a file tree by hand or from a directory listing, and get it back
as text or as a picture.

**Scope:**

1. **The model** (`src/lib/tree/model.ts`): nested nodes with name, kind and
   children — JSON-native, so it can be exported and re-imported as one file.
2. **Three ways in:** an interactive builder (add file, add folder, rename,
   drag to re-parent through the existing
   [dragdrop.ts](../../../src/lib/dragdrop.ts), delete); **paste a listing** —
   `ls`, `ls -R`, `ls -1`, `dir`, `dir /b /s`, and `tree`'s own output — each
   sniffed and parsed, with what could not be parsed reported by line rather
   than dropped; and paste an indented text tree.
3. **ASCII output** in the [asciitools](https://asciitools.com/tree) shape:
   `├──`, `└──`, `│`, with a pure-ASCII fallback (`|--`, `` `-- ``) for
   terminals that mangle box drawing. Options: trailing `/` on folders; emoji
   **either** by folder/file split (📂 / 📄) **or** by extension (a rule table,
   defaulted with a dozen common types and editable); root shown, hidden, shown
   as `.`, or renamed; full paths instead of names.
4. **Image output**: the same tree drawn as monospace SVG through
   [build.ts](../../../src/lib/svg/build.ts) — copyable as markup, downloadable
   as SVG, and rasterized to PNG through the shared converter. Emoji render in
   the SVG through the system font, with the caveat stated: an SVG that leaves
   this machine renders emoji in whatever font the reader has.
5. Copy and download for every output.

**Data model:** none — a tree is typed in one sitting and exported as JSON if it
is worth keeping. (Revisit only if a library turns out to be wanted.)

**Tests:** unit — 57 cases across
[model.test.ts](../../../src/lib/tree/model.test.ts) (every edit proved not to
mutate its input, the three cycle refusals in `move`, sorting, `fromEntries`
inferring folders and promoting a file that turned out to have children, and
the import validator naming the node it refused),
[parse.test.ts](../../../src/lib/tree/parse.test.ts) (all six formats against
output shaped exactly as the real commands print it — volume banners, `.` and
`..`, `File(s)` summaries and all — plus the sniffer, the root-name rule and
the warnings) and [render.test.ts](../../../src/lib/tree/render.test.ts) (both
charsets to the character, the last-child corner, deep nesting, all four root
modes, full paths, both emoji modes, an edited rule table, and a dotfile having
no extension). Playwright — 14 zero-write cases in
[file-tree.spec.ts](../../../tests/local/file-tree.spec.ts), including a real
pointer drag that re-parents a file, a drag refused for putting a folder inside
itself, and the `.json` export read back into the same tree.

**Two things the plan did not anticipate, both now in the code:**

1. **Depth is read from the column the name starts at**, not by counting
   connectors. That is what makes ONE parser read Unix `tree`, Windows `tree
   /f` (which indents files with no connector at all), this app's own ASCII
   fallback, and a hand-typed indented tree.
2. **The SVG renderer needed a way to stop fitting rows to the grid.**
   `asciiSvg` pins each row with `textLength` so a picture holds its shape;
   an emoji is two cells wide, so a tree row containing one gets squeezed and
   the branch columns stop lining up. Phase 8's renderer grew a `fitRows`
   option for exactly this, and the canvas is sized with a `displayWidth()`
   that counts cells rather than UTF-16 units.

**Deviation from the scope:** the image output goes through Phase 8's
[ascii/render.ts](../../../src/lib/ascii/render.ts) rather than a second
monospace renderer over [svg/build.ts](../../../src/lib/svg/build.ts) (which it
uses for escaping). One renderer means an option added to the text output is in
the SVG and the PNG for free.

**Docs:** `docs/dev/tools/file-tree.md`, `docs/user/file-tree.md`.

**CHANGELOG:** Features.

---

## Phase 10 — Crontab — DONE (2026-08-22)

**Goal:** [crontab.guru](https://crontab.guru/) with the parts that site leaves
out — where the line goes, and what bites.

**Scope:**

1. **`src/lib/cron/parse.ts`** — the five Vixie fields (minute, hour, day of
   month, month, day of week) with `*`, lists, ranges, steps, three-letter month
   and day names, and the `@yearly`/`@annually`/`@monthly`/`@weekly`/`@daily`/
   `@midnight`/`@hourly`/`@reboot` macros. Errors carry the field and the
   character offset.
2. **Plain-English description** ("At 04:05 on Sunday"), built from the parse
   tree so it cannot drift from what the expression means.
3. **The next *n* runs**, computed in the browser's timezone, with the note that
   cron runs in the *machine's* zone and that DST makes 02:30 daily either skip
   or repeat once a year.
4. **The day-of-month / day-of-week trap**, which is the one nobody knows:
   when both fields are restricted, Vixie cron runs when **either** matches, not
   both. `0 0 13 * 5` is the 13th *and* every Friday. The tool detects that
   shape and says so in the description, and there is a unit test for it.
5. **A builder** — dropdowns and checkboxes per field that write the expression,
   and an expression that writes the dropdowns back.
6. **Where to put it**, as a real section rather than a link: `crontab -e` for a
   user crontab (no user column), `/etc/crontab` and `/etc/cron.d` (which take a
   user column — the most common paste-it-in mistake), `/etc/cron.{hourly,
   daily,weekly,monthly}` needing executable scripts with no extension for
   `run-parts`, and systemd timers as the modern alternative with an equivalent
   `OnCalendar=` line generated beside the cron line. Plus the two environment
   facts that cause most "it works in my shell" reports: cron's `PATH` is
   nearly empty, and `%` in a command means newline unless escaped.
7. Presets for the common schedules, and copy for the line and the timer unit.

**Data model:** none.

**Tests:** unit — 40 cases in
[cron.test.ts](../../../src/lib/cron/cron.test.ts): every syntax form and every
macro, `5/10` read the way Vixie reads it, error offsets, the description for
each shape, next runs across month ends (`0 0 31 * *` skipping February), leap
years (`0 0 29 2 *`), the DOM/DOW OR rule proved against a real November, an
expression that never runs, the `OnCalendar=` translation and its refusal, and
the builder round-tripping every preset unchanged. Playwright — 15 zero-write
cases in [crontab.spec.ts](../../../tests/local/crontab.spec.ts), including the
caret under the exact bad character and the builder working in both directions.

**Three things the plan did not anticipate, all now in the code and its tests:**

1. **Sunday is 0 AND 7, and the fold has to happen after ranges expand.**
   Normalising the 7 while reading a value makes `5-7` — Friday, Saturday,
   Sunday — look like a range that runs backwards, and it gets refused.
2. **"Restricted" means "does not begin with a star"**, which is the test Vixie
   cron itself makes, not "matches fewer than every value". `0-6` in
   day-of-week matches every day and is still restricted — and that is what
   switches the day rule to OR. The wrong definition would hide the trap in the
   one case people hit.
3. **The builder needs one piece of state the text cannot carry.** Choosing
   "Specific" before ticking anything writes `*` (an empty selection is not an
   expression), which reads straight back as "Every" and snaps the control shut
   before the first checkbox can be clicked. The chosen mode is remembered per
   field until the expression is edited by hand.

**Beyond the scope, because it fell out of the parse tree:** a pasted whole
crontab line keeps its command, and the page says cron will run it with `sh -c`.

**Docs:** `docs/dev/tools/crontab.md`, `docs/user/crontab.md` (leads with the
DOM/DOW trap and the `PATH` surprise).

**CHANGELOG:** Features.

---

## Phase 11 — Placeholders — DONE (2026-08-22)

**Goal:** one page, two modes: filler text and filler images.

**Scope — text:**

1. **Lorem ipsum** from the standard public-domain corpus, and an **office-speak
   corpus written for this repo** (Q11/Q12 reasoning: the wording on
   officeipsum.com is someone else's writing; a corpus we author is a licence
   question that never comes up). Controls: paragraphs / sentences / words,
   "start with *Lorem ipsum dolor sit amet*", plain text or `<p>`-wrapped, and a
   seed so the same seed gives the same text — the config playground's
   mulberry32 PRNG, lifted to `src/lib/random.ts` on this first second use.

**Scope — images:**

2. **Generators**, all seeded and all SVG-first:
    - **Random noise** — `feTurbulence` with frequency, blur, background and
      noise colour;
    - **Flow field** — seeded streamlines with stroke and background colours;
    - **Material-design geometry** — layered translucent polygons in the style
      of the era;
    - **Gradients** — reusing [gradient.ts](../../../src/lib/gen/gradient.ts) so
      there is one gradient implementation in the app;
    - **Plain colour**, defaulting to grey;
    - **Plain colour with a heading and sub-heading**, centred and auto-fitted;
    - **A Lucide icon** on a configurable background with a configurable icon
      colour — `lucide-static` is already a dependency (the logo generator uses
      it), so this costs nothing new; user, mountain, camera and smiley are the
      TODO's four, and the full set is searchable;
    - **Premade vector scenes** (Q12) — three sketchbook nature, three sports,
      three city, hand-drawn as SVG in this repo.
3. **Settings:** width, height, aspect-ratio lock and presets (16:9, 4:3, 1:1,
   3:2), and a count for batch export.
4. **Export:** SVG as markup or file; **PNG/JPG** through
   [convert.ts](../../../src/lib/img/convert.ts); a batch of *n* as one `.zip`
   through [zip.ts](../../../src/lib/zip.ts), named by generator and index.
5. **A links card** to Unsplash, Pexels, placehold.co and Pixabay — plain
   external links, no fetching, marked as leaving the app (which otherwise never
   needs a network).

**Data model:** none. (`preferences` may remember the last size preset.)

**Tests:** unit — 30 cases in
[placeholder.test.ts](../../../src/lib/placeholder/placeholder.test.ts): the
PRNG deterministic per seed, text honouring its counts and clamps and the
corpus rule, every image generator **parsed** for size, structure and escaping,
the noise filter carrying the seed, the nine scenes each parsing and cropping
rather than distorting, batch naming and clamping, and the aspect maths.
Playwright — 11 zero-write cases in
[placeholders.spec.ts](../../../tests/local/placeholders.spec.ts), asserting
the preview's INTRINSIC size rather than its CSS box, plus one more in
[payload.spec.ts](../../../tests/local/payload.spec.ts) holding the icon set
off the other seven generators.

**Three things worth recording:**

1. **Parsing needed a parser.** The unit suite runs in node, which has no
   `DOMParser`, and a DOM library would be a dependency added for one file — so
   `placeholder.test.ts` carries a ~30-line XML parser. It catches exactly what
   `toContain` cannot: an unbalanced tag, a stray `<`, a mis-typed attribute.
2. **The lorem opening belongs to lorem.** Bolting "Lorem ipsum dolor sit amet"
   onto office speak reads as a bug; the generator ignores the flag for the
   other corpus and the page hides the checkbox there.
3. **SVG has no conic gradient.** The generator offers the two kinds SVG can
   draw and says why the third is missing, rather than drawing something else.

**Q11 and Q12 both took their defaults:** no in-browser model for the text (the
seeded corpus is better placeholder text anyway), and the scenes are authored
in-repo — nine of them, three per theme, as hand-written SVG.

**Docs:** `docs/dev/tools/placeholders.md`, `docs/user/placeholders.md`.

**CHANGELOG:** Features.

---

## Phase 12 — Docker Compose builder — DONE (2026-08-22)

**Goal:** build a valid `compose.yaml` through a UI that knows what each field
does — the largest piece of this release.

**Scope:**

1. **The model** (`src/lib/compose/model.ts`): services, networks, volumes,
   secrets and configs as plain JSON-native structures. The model is what is
   stored and what is emitted; the YAML is a projection of it, never the source
   of truth.
2. **Emit** through the `yaml` package (already a dependency), with keys in
   Compose-spec order rather than insertion order, so a re-emit produces a
   stable diff. Copy, and download as `compose.yaml`.
3. **The service editor**, progressive-disclosure exactly as the TODO lays it
   out — plain fields first, `Explainer`-wrapped advanced sections after:
    - **Container**: image (with tag), container name, user / UID:GID; advanced:
      working directory, entrypoint, command, tty, hostname, `stdin_open`,
      privileged, and `depends_on` (a dropdown of the other services, with
      `condition` = `service_started` / `service_healthy` /
      `service_completed_successfully`, plus `required` and `restart`).
    - **Lifecycle**: healthcheck (test, interval, timeout, retries, start
      period, start interval, disable), restart policy, and post-start /
      pre-stop hooks.
    - **Resources**: CPU and memory limits; advanced: CPU/memory reservations,
      PIDs limit, GPU and device reservations, shared memory size.
    - **Networking**: ports (host IP, ranges, TCP/UDP, long syntax), network
      selection and creation across bridge / host / ipvlan / macvlan; advanced:
      DNS, extra hosts, IPv4 and IPv6 addresses.
    - **Environment**: inline variables, `env_file`, `${VAR}` interpolation
      (with the `${VAR:-default}` forms explained), and secrets.
    - **Storage**: named and anonymous volumes, bind mounts, both with
      read-only; tmpfs.
4. **The warnings that stop bad files**, each next to the field that causes it:
   `network_mode: host` makes published ports meaningless (and the ports editor
   disables itself and says why); ipvlan and macvlan need a parent interface and
   do not work on Docker Desktop's VM — with their prerequisites summarized from
   the [ipvlan](https://docs.docker.com/engine/network/drivers/ipvlan/) and
   [macvlan](https://docs.docker.com/engine/network/drivers/macvlan/) docs;
   tmpfs is Linux-only; a `depends_on` cycle, a duplicate host port, and a
   referenced-but-undeclared named volume or network are each caught before
   export.
5. **The library**: named projects in a new `compose_projects` store, searchable,
   with export/import as JSON — the same shape the napkin-math and config
   playground libraries already have. **The page states that a compose file may
   contain secrets and that this store rides the plain-JSON backup**, because
   that is the one thing a user should decide knowingly.

**Data model:** **migration v13** — `compose_projects` (`indexes: []`), model as
JSON-native structures only. `types.ts`, `db.ts`, `TABLES` and the README Tables
section all move together.

**Tests:** unit — 31 cases in
[compose.test.ts](../../../src/lib/compose/compose.test.ts): the model
re-shaping anything at all (the generic data suite writes an ARRAY into every
json column), emit writing only what was set, both port and mount syntaxes, key
order — **including that re-emitting an unchanged project is byte-identical**,
which is the property the ordering exists for — and every validation rule.
Playwright — 18 cases in
[docker-compose.spec.ts](../../../tests/local/docker-compose.spec.ts): building
and editing write nothing, saving writes exactly one row with the
isolated-delta assertion naming it, a reload reopens the same project without
writing, delete is a tombstone, and the generic data suite picked the store up
through the `TABLES` mirror for the backup round trip.

**Two things worth recording:**

1. **A leftover Playwright server on 4330 makes the suite skip the build**
   (`reuseExistingServer`), so a fix appears not to take and the same test
   fails identically twice. Two five-minute runs were spent on that before
   `stat` on `dist/` against the source showed dist was ten minutes older.
2. **`not.toContainText` is the wrong assertion for an element that
   disappears** — the library block is hidden entirely when the last project
   goes, and a locator that resolves to nothing errors rather than passing.
   `toHaveCount(0)` on the specific row is the honest form.

**Docs:** `docs/dev/tools/docker-compose.md` (model → YAML pipeline, with a
mermaid diagram, and the validation rules), `docs/user/docker-compose.md` (leads
with the secrets-in-backups note, then host networking, bind-vs-named volumes,
`depends_on` waiting for started rather than ready, and macvlan prerequisites).

**CHANGELOG:** Features; DB v13 noted, and the 61 doc pages stamped
`schema v12` were moved to v13 in the same pass.

---

## Phase 13 — Docker Compose templates — DONE (2026-08-22)

**Goal:** somewhere to start, and something to steal from.

**Scope:**

1. **Stack templates** — a whole project as a starting point: WordPress + DB,
   Flask, Node.js, Astro, Django + PostgreSQL, Next.js, FastAPI, MERN, Go HTTP
   server. Each loads into the builder as a project, and each offers a
   **download** of a ready-to-run `.zip` (compose file + sources + README)
   assembled client-side by [zip.ts](../../../src/lib/zip.ts).
2. **Sources, or steps, per Q10:** Flask, FastAPI, Node.js, MERN and Go ship a
   hello-world source in the archive; Astro, Next.js, Django and SvelteKit-style
   stacks ship README steps that run the framework's own scaffolder, because
   vendored scaffolding is stale within a release. Every template records the
   image tags it pins and says, on the card, that tags move.
3. **Service snippets** — injected into whatever project is open rather than
   replacing it: Redis, PostgreSQL, Valkey, Flask, FastAPI, Next.js, Go
   stdlib, Go Fiber, SvelteKit, TanStack. Injection names the service uniquely
   if the name is taken, and adds any network or volume the snippet needs.
4. **Best-effort import** (Q9): paste or drop an existing `compose.yaml`, get it
   into the model, and get a report of every key the builder cannot represent —
   listed, not dropped, so the user can decide whether to keep editing here.

**Data model:** none beyond Phase 12's store.

**Tests:** unit — 81 cases in
[catalogue.test.ts](../../../src/lib/compose/catalogue.test.ts), table-driven
over **every** stack and snippet: each must validate with zero errors, emit a
document that parses, pin a tag on every image it uses, and survive a JSON
round trip through the store. Plus injection (renaming, volume declaration,
port moving), the archive read back with `zipEntries`, and the importer's
report. Playwright — 6 of the page's 18 cases cover this phase, including a
real `.zip` download whose `compose.yaml` parses.

**Two things the plan did not anticipate:**

1. **Injection had to move host ports as well as rename services.** Injecting
   the Go snippet into the starter project produced two services publishing
   8080 — a stack that fails at `up` time with "address already in use", which
   is a confusing thing to get from clicking "add Go". Only the host side
   moves; a port RANGE is left alone and the validator flags it instead,
   because silently rewriting what someone typed is worse than the warning.
2. **The round trip needed argv re-quoting.** `["sh", "-c", "a && b"]` joined
   with spaces and re-split is five arguments, so a template that imported
   cleanly re-emitted as a different command. Caught by asserting that every
   template survives emit → import → emit unchanged, not by reading the code.

**Docs:** the Compose pages carry the template catalogue and say that every tag
is pinned and every tag moves.

**CHANGELOG:** Features.

---

## Phase 14 — Hardening and release

**Goal:** the cross-cutting passes, then cut 0.3.0.

**Scope:**

1. **Accessibility sweep** over the twelve new pages — the registry-driven
   `a11y.spec.ts` audits them automatically, but the matrix visualizer, the diff
   gutters, the compose editor's disclosure tree and the ASCII font picker each
   need a hand-driven keyboard pass and an AA check in both themes.
2. **Offline audit**: fresh install → airplane mode → every new tool works. The
   figlet fonts and any vendored art must be in `SHELL` or in an
   [offline.ts](../../../src/lib/offline.ts) bundle; `tools/audit-precache.mjs`
   must be green.
3. **Payload pass**: `bcryptjs` and `figlet` confirmed lazy through
   `payload.spec.ts`; the hand-rolled hash and diff modules confirmed small
   enough not to need laziness.
4. **One base64, finally**: fold the four remaining hand-rolled encoders
   (notebook assets, formula markup, maths fonts, `dataUrlToBlob`) onto
   [base64.ts](../../../src/lib/encode/base64.ts) and re-run the specs that
   cover them — deferred out of Phase 0 on purpose, because each one is behind
   a slow suite.
5. **Sidebar review (Q2)** now that Generators is large — either it reads fine
   or the DevOps split happens here, where it is one field per tool.
6. **Docs**: [README.md](../../../README.md) "What's in it" and Tables sections;
   [docs/README.md](../../README.md) map; the per-tool pages written in each
   phase re-read as a set for consistency of voice.
7. **Release**: `VERSION` / `package.json` / CHANGELOG per the standing
   checklist, date the `0.3.0` heading, note DB v13 prominently since users
   carry their data in their browser.

**Data model:** none.

**Tests:** `npm test` and `npm run test:unit` fully green, trust gate reading
`self-verification N/N injected faults detected`; the manual offline and install
checklist recorded in the commit.

**CHANGELOG:** Other, plus the release itself.

**Progress (begun 2026-08-22, with the Excalidraw port landing the same
day):**

- **4 — one base64: done.** The four encoders are gone;
  [assets.ts](../../../src/lib/notebook/assets.ts) (`blobToBase64` /
  `base64ToBlob`), [formulaMarkup.ts](../../../src/lib/codegen/formulaMarkup.ts),
  [mathFonts.ts](../../../src/lib/notebook/mathFonts.ts) and
  [exportFile.ts](../../../src/lib/exportFile.ts) (`dataUrlToBlob`, now
  `parseDataUrl`) all call [base64.ts](../../../src/lib/encode/base64.ts). Doing
  it exposed what Phase 0's measurement had not: the shared DECODE was 30×
  slower than `atob` on a 2 MB asset (130 ms against 4), because `validate`,
  `decodedLength` and `decodeBytes` each ran a regex per character and the
  decoder grew a plain array. All three got an ASCII fast path over one
  `Int8Array` lookup table and the decoder a preallocated `Uint8Array`; the
  encoder stopped concatenating four strings per three bytes and writes codes
  into a byte buffer that one `TextDecoder('latin1')` turns into the string.
  Measured on the same 2 MB: encode 5 ms (was 127; `btoa` path 57), decode
  22 ms (was 130; `atob` 4). Byte-identical output, the 23 base64 cases and
  every unit file that touches the four callers green.
- **3 — payload pass: measured.** In the build: `bcrypt.*.js` 1.2 KB +
  `bcrypt-worker-*.js` 21 KB and `figlet.*.js` 16 KB are their own chunks and
  hold their place in `payload.spec.ts`'s `HEAVY` list; `HashApp.*.js` 18 KB
  and `DiffApp.*.js` 21 KB + `diff.*.js` 0.3 KB — small enough that laziness
  would cost a round trip to save nothing. Excalidraw joined the heavy list
  for real: its main chunk is now named (`excalidraw.*.js`, 1.1 MB, through
  a re-export facade in `src/lib/vendor/` — see the CHANGELOG) so the
  `/excalidraw/i` matcher that has stood guard since Phase 10 finally matches
  something.
- **2 — offline audit: the mechanical half.** `tools/audit-precache.mjs` over
  the build: 80 shell routes, 411 files / 22.4 MB reached by the crawl, the
  four engine wasm/data files (16.8 MB) correctly left to their bundles. The
  vendored Excalidraw faces joined the font bucket (`FONT_PREFIXES`) and the
  Offline panel (`drawing-fonts`, 439,576 bytes, with a unit test against its
  `PROVENANCE.txt`), the same way the maths faces did in Phase 10. The audit
  also caught a real bug: the crawl ran inside `activate`'s `waitUntil`, so
  navigations and worker-script loads hung until the first crawl finished —
  invisible at 0.2.0's graph size, minutes once Excalidraw's chunk fed the
  crawl hundreds of junk relative paths. Both halves are fixed (crawl started
  after activation, `ASSET_FILE` filter on what is enqueued; see the
  CHANGELOG) and the cache is `v32`. The fresh-install → airplane-mode walk
  through every new tool is still to do by hand.
- **1, 5, 6, 7 — not started.** The hand-driven keyboard / AA pass, the
  sidebar decision (Q2: Generators now lists fifteen tools — Logo generator,
  Hashing, JWT, Docker Compose, Placeholders, Crontab, File tree, ASCII art,
  Encryption, Secrets, Themes, Gradients, Glassmorphism, Regex snippets, QR
  code — which is the case the question anticipated), the README / docs-map
  re-read, and the release.

---

## Ordering

- **Phase 0 blocks 1, 2, 3, 4 and 7** — the tokenizer and the base64 module.
- **Phase 5 blocks 6 and 7** — the digest and key plumbing, and the
  secure-context degradation pattern every crypto page reuses.
- **Phase 12 blocks 13.**
- **Everything else is independent** and can be built in any order, by any
  number of people, after Phase 0.
- **Phase 14 is last.**

Suggested order if one person is working alone: 0 → 3 → 1 → 2 → 4 → 5 → 7 → 6 →
10 → 9 → 8 → 11 → 12 → 13 → 14. That front-loads the small self-contained tools
(so a release can be cut early), puts JWT next to the hashing work it shares
plumbing with, and leaves the two biggest builds — Compose and its templates —
for when the shared pieces have settled.

---

## Deliberately out of scope for 0.3.0

- **File hashing** (Q14) — needs chunked reads and a progress model; the text
  path ships first.
- **Argon2** — the better password hash, but it means a WASM bundle; bcrypt and
  PBKDF2 cover the teaching case.
- **A tiny in-browser LLM for placeholder text** (Q11) — moved to
  [far-fetched.md](far-fetched.md).
- **Six-field (seconds) cron dialects** (Q13) — named as unsupported.
- **Compose `deploy:` beyond resources** (swarm-only replicas, placement,
  update_config) — it does nothing under `docker compose up`, and offering it
  would teach the wrong thing.
- **Diff of anything but text** — no image, PDF or binary diff.
- **The HTTP playground** — still in [far-fetched.md](far-fetched.md).
