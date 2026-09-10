# Placeholders

`/tools/placeholders/` — filler text and filler images, both seeded, both drawn here. A stateless Svelte island over four pure modules; nothing is written to IndexedDB and nothing is fetched.

_Describes the code as of v0.5.0 (schema v16) — verify against source when in doubt._

## File map

| Path | Role |
| --- | --- |
| [random.ts](../../../src/lib/random.ts) | The app's one seeded PRNG, plus `seedFrom`, `randomInt`, `pick`, `shuffled` |
| [text.ts](../../../src/lib/placeholder/text.ts) | Both corpora and the text generator |
| [images.ts](../../../src/lib/placeholder/images.ts) | The nine image generators, and batches |
| [scenes.ts](../../../src/lib/placeholder/scenes.ts) | The fifteen hand-drawn scenes |
| [thumbnails.json](../../../src/lib/placeholder/thumbnails.json) | The picker's nine example pictures (160×90 data URIs), rendered from the defaults by [tools/build-placeholder-thumbs.mjs](../../../tools/build-placeholder-thumbs.mjs) and committed; they do not follow the controls |
| [size.ts](../../../src/lib/placeholder/size.ts) | Ratios, presets and the aspect lock |
| [PlaceholdersApp.svelte](../../../src/components/apps/PlaceholdersApp.svelte) | The page |
| [placeholders.spec.ts](../../../tests/local/placeholders.spec.ts), [placeholder.test.ts](../../../src/lib/placeholder/placeholder.test.ts) | Playwright and Vitest |

## One PRNG, lifted

`mulberry32` was written for the config playground's example-data generator. It has a second caller now, so it lives in [random.ts](../../../src/lib/random.ts) and `config/generate.ts` re-exports it — two copies would be two answers to "what does seed 42 produce", and a seed exists precisely so there is one.

`seedFrom()` turns arbitrary text into a 32-bit seed (FNV-1a), except for a typed integer, which is used as itself: someone typing `42` means 42.

## Text

Two corpora, and the licence question is why there are exactly two:

- **Lorem ipsum** — the standard scrambled-Cicero word list, public domain, so text generated here matches text generated anywhere else.
- **Office speak** — written in this repository as a small **grammar** (opener, subject, verb phrase, adjective, noun, closer) rather than a bag of buzzwords. Meeting-speak is recognisable by its shape, and a shuffled word list just reads as noise. Nothing in the output is a phrase lifted from an existing site.

The traditional opening is only offered for the corpus it belongs to: the generator ignores `startWithLorem` for office speak and the page hides the checkbox there.

### There is no third, AI-generated corpus

Asked for twice — 0.3.0's Q11 and 0.4.0's Phase 6 — and rejected twice, the second time **after building it**. A distilgpt2-class ONNX model (81 MB) was run through the `onnxruntime-web` this repo already ships, with a hand-written GPT-2 BPE tokenizer and a KV-cached sampling loop.

It cannot follow a prompt: it is a base LM, so "write a product description for a coffee mug" yields either sixty newlines or `" a coffee mug for a coffee mug for a coffee mug…"`. The smallest instruction-tuned model that *can* is ~115 MB (SmolLM2-135M-Instruct) — five times this entire application, and the purpose-built on-device family starts at 206 MB (LFM2.5-230M q4) — and generation runs at about five seconds a paragraph against instant for the corpora, while losing the seeded reproducibility that makes a re-generate a no-op diff.

Full transcripts, the measured size table, and the conditions that would flip the answer are in [far-fetched.md](../plans/far-fetched.md).

## Images

Nine generators, all SVG-first, all seeded. SVG because a placeholder is mostly flat colour and geometry — it stays a few kilobytes at any size, where a 4000-pixel PNG of a grey rectangle is megabytes of nothing — and because the PNG/JPG exports then rasterize the same document through [convert.ts](../../../src/lib/img/convert.ts) rather than having a second drawing path.

| Generator | How it is drawn |
| --- | --- |
| Plain colour | One `<rect>` |
| Colour with a caption | `fitFontSize()` sizes the heading from the width and the character count, so a caption never overflows the frame |
| Gradient | A [GradientDef](../../../src/lib/gen/gradient.ts) mapped onto SVG gradient elements, with the same 90° offset the gradient tool's preview uses |
| Noise | `feTurbulence` → desaturate → `feFlood` + `feComposite` (arithmetic `k1=1`) to tint, optional blur. The filter carries the page's seed so the grain is reproducible |
| Flow field | Streamlines through three sine terms with seeded phases — smooth everywhere, a dozen lines of arithmetic, and indistinguishable from real Perlin noise at this scale. `density` is the line count, clamped to 10–400: past that the lines stop reading as lines and the file stops being small |
| Layered geometry | 5–9 translucent seeded polygons. `opacity` is the CENTRE of the range each shape draws from, not a flat value — shapes all at one opacity stop looking layered and start looking like a single stencil |
| Cut planes | 4–6 quadrilateral slabs on one jittered angle, each long enough to run off both edges, under a shared drop shadow. Its palette comes from `harmonise(background)` — two neighbouring hues plus a dark and a light — because a few big slabs in unrelated colours look like a mistake where a dozen small ones look playful, and because it gives the Background picker something to do beyond filling the gaps |
| An icon | Any Lucide icon at `iconScale` (0.1–0.95 of the shorter side), loaded through the logo generator's own loader so there is one copy of the 2 MB set in the bundle, and only on this generator |
| A drawn scene | One of fifteen, below |

**SVG has no conic gradient.** The generator offers linear and radial and says why the third is missing rather than quietly drawing something else.

## The scenes

Fifteen hand-written SVG scenes — five Nature, five Sport, five City — in [scenes.ts](../../../src/lib/placeholder/scenes.ts). Authored here for the reason the plan gives: provenance for art we drew is one sentence, and provenance for art scraped off the web is a research project.

Each is drawn in a 160×90 box and placed as a nested `<svg>` with `preserveAspectRatio="xMidYMid slice"`, which is what lets one drawing fill any frame — the proportions hold and the frame crops, exactly like `object-fit: cover`. A background rect is painted behind it so a crop never shows through.

## Sizes and batches

The aspect lock reads the ratio from the size **before** the edit and recomputes the side that was *not* just typed in — a lock that recomputes the field someone is holding fights the person using it.

A batch is the same settings with the seed varied per item (`seed`, `seed-2`, `seed-3`…), so item *n* of a batch is exactly what typing that seed produces on its own — a batch is not a separate code path. Files are named `<generator>-<w>x<h>-<index>.<ext>`, zero-padded to the batch size so a file listing sorts the way the batch was made, and zipped through [zip.ts](../../../src/lib/zip.ts). Rasterizing runs one at a time: fifty canvases at once is how a tab runs out of memory.

Test hooks are prefixed `ph-`: `ph-mode`, `ph-corpus`, `ph-count`, `ph-unit`, `ph-text-seed`, `ph-lorem-start`, `ph-html`, `ph-text`, `ph-text-counts`, `ph-copy-text`, `ph-download-text`, `ph-generators`, `ph-gen-<id>`, `ph-bg`, `ph-fg`, `ph-seed`, `ph-frequency`, `ph-blur`, `ph-density`, `ph-opacity`, `ph-icon-scale`, `ph-heading`, `ph-subheading`, `ph-grad-kind`, `ph-grad-angle`, `ph-grad-stop-<i>`, `ph-icon-search`, `ph-icon-name`, `ph-icons`, `ph-icon-<Name>`, `ph-scene-<id>`, `ph-width`, `ph-height`, `ph-lock`, `ph-size-note`, `ph-ratios`, `ph-ratio-<id>`, `ph-sizes`, `ph-output-card`, `ph-preview`, `ph-format`, `ph-batch`, `ph-download`, `ph-download-batch`, `ph-copy-svg`, `ph-links-card`, `ph-feedback`.
