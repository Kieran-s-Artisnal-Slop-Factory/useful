# Napkin math

Self-documenting back-of-the-envelope calculations at `/tools/napkin-math/`: type a formula, get typed input fields, run named calculations against it, keep a library of templates, and generate code from any of it in Python, JavaScript, Go, Rust or as a dependency-free web component.

_Describes the code as of v0.5.0 (schema v16) — verify against source when in doubt._

## File map

| Path | Role |
| --- | --- |
| [NapkinMathApp.svelte](../../../src/components/apps/NapkinMathApp.svelte) | The tool: library sidebar, template editor, fields, calculations, code card, export/import. |
| [MathField.svelte](../../../src/components/MathField.svelte) | The `<math-field>` wrapper. Three settings here are load-bearing — see below. |
| [napkin/engine.ts](../../../src/lib/napkin/engine.ts) | The Compute Engine, wrapped: `parseFormula`, `evaluateFormula`, `boxJson`, and the non-canonical `parseRaw` / `boxRaw` the image export needs. |
| [napkin/model.ts](../../../src/lib/napkin/model.ts) | Fields, `reconcileFields`, `checkValue`. Pure, so it tests without loading 37 MB of maths library. |
| [napkin/transfer.ts](../../../src/lib/napkin/transfer.ts) | Import and export, with the validation an untrusted document needs. |
| [napkin/substitute.ts](../../../src/lib/napkin/substitute.ts) | The middle row of the picture: `substituteJson`, `usableValues`, `substitutedLatex`. |
| [napkin/exportImage.ts](../../../src/lib/napkin/exportImage.ts) | The SVG builder: `layoutRow`, `buildCalculationSvg`, `fontFaceRules`, `formatNumberLatex`, `imageFilename`, `EXPORT_THEMES`. |
| [raster/svgToPng.ts](../../../src/lib/raster/svgToPng.ts) | `svgToPngBlob` — a self-contained SVG string through a blob URL, an `<img>` and a canvas. Shared, not napkin-specific. |
| [codegen/expression.ts](../../../src/lib/codegen/expression.ts) | MathJSON → an expression, per language, with precedence. |
| [codegen/functions.ts](../../../src/lib/codegen/functions.ts) | The whole file: docstring, typed parameters, guard clauses, helpers. |
| [codegen/identifiers.ts](../../../src/lib/codegen/identifiers.ts) | Symbol → a legal identifier, per language, with collision resolution. |
| [codegen/webcomponent.ts](../../../src/lib/codegen/webcomponent.ts) | The dependency-free custom element. |
| [codegen/latex.ts](../../../src/lib/codegen/latex.ts) | The mathfield's LaTeX reduced to readable Markdown maths for a comment. |
| [codegen/formulaMarkup.ts](../../../src/lib/codegen/formulaMarkup.ts) | The formula as self-contained typeset HTML + CSS + embedded faces, for the web component (`renderFormula`) and for the image export (`renderFormulaSet`). |
| [MathField.svelte](../../../src/components/MathField.svelte) `insert()` | Puts a skeleton at the cursor, through the mathfield's own `insert` command. |
| [CodeBlock.svelte](../../../src/components/CodeBlock.svelte) | Read-only source, highlighted by Prism. |
| [CodeInput.svelte](../../../src/components/CodeInput.svelte) | A textarea with a highlighted underlay, for the import box. |
| [math/fonts.ts](../../../src/lib/math/fonts.ts) | The vendored KaTeX faces and their offline bundle. |
| [tools/build-math-assets.mjs](../../../tools/build-math-assets.mjs) | Vendors those faces into `public/math/` with provenance. |

Both libraries are `import()`ed inside [MathField.svelte](../../../src/components/MathField.svelte)'s
mount, so only this page pays for them: `mathlive` is 801 KB (217 KB gzip) and
`@cortex-js/compute-engine` is 2.53 MB (695 KB gzip) — the engine is a full computer-algebra
system and the larger half of the pair.

## What we measured

The plan for this phase was written from the libraries' type definitions. Several of its claims turned out to be wrong, and each correction below came from running the real thing rather than reading about it. They are recorded because the wrong version is the plausible one.

### `expr.compile()` does not exist

The open question for this phase was whether the code generator needed compiler-quality output or whether a hand-written emitter would do, on the grounds that `compile()` builds JavaScript at run time and so self-disables under a strict CSP. In `@cortex-js/compute-engine` 0.115 the method is not there at all. The hand-written emitter is not the better of two options; it is the only one. (There is a `ce.jit` setting, but nothing on the evaluation path used here builds code: the whole probe suite runs clean under `node --disallow-code-generation-from-strings`.)

### Evaluation substitutes; it must not assign

The plan said to evaluate "with a pushed scope per calculation". That leaks:

```
x/y at 7 and 2   -> 3.5
x/y at 10 and 5  -> 2
x/y with NO values at all -> 2      <- the previous answer
expr.unknowns afterwards  -> []     <- the formula's variables are gone
```

`ce.parse()` declares a formula's unknowns in the **global** scope, so `ce.assign()` inside a pushed scope mutates that global binding and `popScope()` does not undo it. A symbol that was never parsed before the push *is* scoped correctly, which is why an isolated test of the mechanism passes and the real sequence does not.

[engine.ts](../../../src/lib/napkin/engine.ts) uses `expr.subs()` instead. It leaves the parsed expression untouched, returns a symbolic result when a value is missing — which is exactly the "not ready to answer" signal the UI needs — and costs about 7 microseconds against 5.8 milliseconds to construct a fresh engine.

### A numeric-looking result can be complex or infinite

| expression | isNumberLiteral | re | im | isFinite | isReal | isNaN |
|---|---|---|---|---|---|---|
| `3.5` | true | 3.5 | 0 | true | true | false |
| `sqrt(-4)` | true | **0** | 2 | true | false | false |
| `1/0` | true | Infinity | Infinity | false | false | false |
| `0/0` | true | NaN | 0 | false | true | true |

Reading `.re` alone would display **0** for the square root of a negative. A result is accepted only when it is `isNumberLiteral && isReal && isFinite && !isNaN`.

### MathLive's built-in inline shortcuts corrupt variable names

This is the finding that shaped the editor. MathLive ships 259 text shortcuts, and any one whose trigger appears **inside** a variable name fires mid-word and desynchronises the replacement span:

| typed | default | `inlineShortcuts = {}` |
|---|---|---|
| `capital+x` | fine | fine |
| **`sqrtish+x`** | `\mathrm{\sqrt{ish+x}}` — does not parse | `\mathrm{sqrtish}+x` |
| **`count*rate`** | `\mathrm{count\cdot rate}` — does not parse | `\mathrm{count}*\mathrm{rate}` |

Dropping only the `*` entry fixes `count*rate` and not `sqrtish`; a short `inlineShortcutTimeout` fixes neither. So the wrapper clears the whole table. In a tool whose premise is multi-letter named variables, the built-ins are actively hostile — they turn a valid formula into one that does not parse, without saying so. LaTeX commands typed with a backslash still work (`count \times rate` parses correctly), and the virtual keyboard still offers symbols.

The assignment has to happen **after** the element is connected; before that MathLive throws "Mathfield not mounted".

### The hook is offered every suffix, longest first

Typing `count` offers `["co"]`, then `["cou","ou"]`, then `["coun","oun","un"]`, then `["count","ount","unt","nt"]`. The first non-empty return wins, and MathLive replaces the previous expansion with the longer one as typing continues — so a plain identifier rule yields `\mathrm{count}`, not `\mathrm{co}\mathrm{un}\mathrm{t}`. The plan's stated fear does not reproduce.

Single characters are never offered, which matters because **`\mathrm{}` on a single letter parses as a different symbol**: `\mathrm{x}` is `x_upright`, not `x`. The wrapper's rule requires two or more letters anyway, so a single letter is never renamed behind the user's back.

### The font stylesheet beats `fontsDirectory`

`public/math/mathlive-fonts.css` ends with `:root{--ML__static-fonts:true}`, which tells MathLive's own loader to stand down. Measured on a production build:

| | faces fetched | HEAD requests |
| --- | --- | --- |
| stylesheet + `fontsDirectory = null` | **2** | 0 |
| `fontsDirectory = '/math/fonts'` | 20 | 1 |

With the stylesheet the browser pulls faces on demand through `font-display: swap`. `soundsDirectory = null` suppresses all five keypress `.wav` files, including on the "plonk" path an invalid keystroke takes; a Playwright case asserts zero `.wav` requests.

## Data model — migration v10

| | |
| --- | --- |
| `napkin_templates` | `name`, `description`, `formula_latex`, `formula_json` (json), `fields` (json) |
| `napkin_calculations` | `template_id` (FK → `napkin_templates`, indexed), `name`, `values` (json), `result` (real, nullable) |
| Preference | `napkin_last_template_id` — the template to reopen |

Both stores are JSON-native, so they ride backup export/import unchanged. Deleting a template soft-deletes its calculations first: a calculation whose template is gone is unreachable, and the data-integrity oracle checks the foreign key.

**Nothing is written on load.** Opening the page reads the remembered template id and its row; typing a formula, editing fields and evaluating write nothing. The first write is the explicit Save.

## Where the fields come from

```mermaid
flowchart TD
  A["LaTeX from the mathfield"] --> B["ce.parse"]
  B --> C{"is the top level an equation?"}
  C -->|yes| D["take the right-hand side"]
  C -->|no| E["use it as it stands"]
  D --> F{"isValid?"}
  E --> F
  F -->|no| G["say the formula does not parse; keep the old fields"]
  F -->|yes| H["expr.unknowns"]
  H --> I["reconcileFields: keep what survived, add what is new, drop what is gone"]
```

`expr.unknowns` is the whole trick. It already excludes bound indices and constants, so a sum from 1 to `n` asks for `n` and not `i`, and `\pi r^2` asks for `r` and not π. Walking the MathJSON tree reports both and asks the user to supply a value for pi.

A formula written as an equation — `total = qty × unit` — parses as `["Equal", "total", …]`, which would otherwise make `total` an input asking for the answer. The right-hand side is taken instead.

`reconcileFields` keeps the settings of every variable that survived an edit, so adding one term to a five-variable formula does not reset the other five. A variable the formula stopped mentioning loses its field, because it would be asked for and then ignored — the editor says which ones went.

## The code generator

The emitter is hand-written and deliberately incomplete: an operator outside its table raises `UnsupportedOperator`, which the UI shows **by name**. Emitting a plausible-looking function for a node nobody checked is the failure this design exists to avoid.

The languages disagree with the engine in ways that are easy to miss and impossible to see in the output:

| | CE | Python | JavaScript | Go | Rust |
|---|---|---|---|---|---|
| `Round(2.5)` | 3 | 2 (banker's) ✗ | 3 ✓ | 3 ✓ | 3 ✓ |
| `Round(-2.5)` | -3 | -2 ✗ | **-2** ✗ | -3 ✓ | -3 ✓ |
| `Mod(-7, 3)` | 2 | 2 ✓ | -1 ✗ | -1 ✗ | -1 ✗ |
| `x ** y` | — | `**` | `**` | `math.Pow` (no operator) | `.powf` |
| `Min(a,b,c)` | variadic | `min(…)` | `Math.min(…)` | folds to pairs | `.min().min()` |

So Python and JavaScript get a `_round` helper, and JavaScript, Go and Rust get a `_mod` helper. Each is emitted only when the expression calls it. `Divide` is always real division, so Python emits `/` and never `//`.

Two more shapes worth knowing: `e^x` and `\exp(x)` are the **same** MathJSON node (`["Power","ExponentialE","x"]`), so the emitter recognises that base and writes `exp`; and a bare `Log` means base 10, with the base as an optional second argument.

### One helper table, because two was a bug

`Sum` produced a call to `_sum` that was never defined, and the component threw `ReferenceError` on the first keystroke. The cause was duplication: [functions.ts](../../../src/lib/codegen/functions.ts) held `HELPER_SOURCE` for the four languages, and [webcomponent.ts](../../../src/lib/codegen/webcomponent.ts) kept its own hand-written copy of two of them. Adding a helper to the emitter updated one list and left the other alone, and nothing anywhere compared them.

`HELPER_SOURCE` is now exported and the web component reads its JavaScript column. A unit test also walks the generated source and asserts that **every `_name(` it calls has a matching `function _name(`** — a general guard rather than one case, so the next helper added is covered without anyone remembering to cover it.

### Sums, products and integrals become loops

`Sum`, `Product` and `Integrate` are the three heads that are not expressions — they need a loop, and an expression emitter has nowhere to put one. Each becomes a call to a small emitted helper taking the bounds and **a closure over the bound index**, which every one of the four languages can express:

| | closure |
| --- | --- |
| Python | `lambda x: …` |
| JavaScript | `(x) => …` |
| Go | `func(x float64) float64 { return … }` |
| Rust | `\|x: f64\| …` |

Closing over the index is what makes one helper per operation enough, rather than one generated function per occurrence with its free variables threaded through by hand — the closure captures the outer parameters itself.

The index is named through the same `identifierMap` as everything else, **with the outer names in play**, so a formula that binds `x` while a field is also called `x` gets `x_2` for the index rather than silently shadowing the parameter inside the loop. The engine would not produce that, but an imported file could.

An integral is **Simpson's rule with 1000 intervals, and the generated code says so** — exact for polynomials up to cubic, approximate for everything else. That is not a corner cut: the Compute Engine integrates numerically too (`\int_2^3 x^2` comes back as `6.33333333333333303727 ± 0.00000000000000000019`), so the generated function and the page agree to about the same tolerance. Claiming a closed form would be the dishonest option.

Two shapes to know:

- `["Sum", body, ["Limits", index, lower, upper]]`, and the same for `Product`. A `Limits` node is required — an unbounded sum has no range to walk, so it is refused rather than given an invented one.
- `Integrate` wraps its body **sometimes**: `\int x^2 dx` parses to `["Integrate", ["Function", ["Block", body], "x"], …]` while `\int x \, dx` gives the bare body. Both reach the emitter and both are unwrapped.

An **odd root** is refused rather than emitted. The engine says `(-8)^(1/3)` is `-2`; every target language's `pow` says `NaN`. There is no portable spelling, so the generator says so instead of producing something that is wrong for negative inputs only.

Each field's constraint becomes a **guard clause** — `ValueError` in Python, `RangeError` in JavaScript, an `error` return in Go, `Result::Err` in Rust — so a generated function refuses what the page refuses. Labels and descriptions are free text and reach four kinds of comment, so they go through `commentSafe`, which neutralises the sequences that would end a comment early and spill the rest into the file as code.

### Identifiers

A symbol is stripped to ASCII letters, digits and underscores; an empty or digit-leading result gets a `v` in front; the result is cased per language (snake for Python/Go/Rust, camel for JavaScript); a reserved word gets a trailing underscore; and a collision gets `_2`, `_3`, … in the symbols' own order, so the first symbol keeps the plain name and a regenerated file never renames a parameter.

### The web component

One `.js` file, no imports, no external URL, no build step. Every element carries a `part` attribute and the stylesheet is three rules, so the host page styles it with `::part()` and has nothing to override. It re-checks its inputs against the same rules before computing, and emits a `napkin-result` event.

A Playwright case **loads the generated file in a real page**, drives its inputs, and asserts it produces the same number the app showed. A golden-file test cannot catch a generated syntax error; this does.

### The formula is typeset, and travels with everything it needs

Showing `$\(costPerMonth*12\)*years$` met the letter of "self-contained" and not the spirit — the app shows a typeset formula, so the thing it hands you should too. Three parts have to travel together, and [formulaMarkup.ts](../../../src/lib/codegen/formulaMarkup.ts) assembles them:

1. **The markup.** `convertLatexToMarkup` is exported from MathLive's **main** entry, which this page has already loaded — so this costs nothing extra. (The `mathlive/ssr` entry would have been another 397 KB for the same function.)
2. **The layout rules.** `mathlive/static.css`, inlined as a string at build time and placed inside the component's shadow root, which scopes it both ways: a host page cannot break the formula, and the formula cannot leak rules into the host page.
3. **The faces.** KaTeX markup *positions* glyphs with CSS but *draws* them with the KaTeX fonts, which a host page has none of.

Only the faces the formula actually uses are embedded, as `data:` URIs. Which ones those are is **measured, not guessed**: the markup is rendered into a throwaway shadow root carrying the same layout CSS the component will carry, and every span's computed `font-family` is read back. A table mapping MathLive's class names onto faces would go stale the first time the library renamed one.

The shadow root in that probe is load-bearing. Measuring against the napkin page's ambient styles answers a different question and answers it wrongly: this page has the KaTeX faces registered document-wide, so every span resolves to a KaTeX family whether or not the rules would have travelled. That mistake produced a component that rendered perfectly here and fell back to a serif everywhere else.

MathLive's static CSS carries its own `@font-face` block pointing at `url(fonts/KaTeX_*.woff2)` — relative, so resolved against whatever page the component lands on. It is stripped, or every host would serve a row of 404s and sometimes prefer the broken rules over the embedded ones.

The faces are **opt-out**. `Include the maths fonts` is on by default, because one file that works anywhere is the right default; turning it off drops a typical component from 78 KB to 15 KB and moves the faces to a stylesheet the page links once. `@font-face` belongs to the document rather than to a shadow root, so a single `<link>` reaches inside every component on the page — that shared file carries **all twenty** faces rather than one formula's, because the point of sharing it is that it works for all of them. Without any faces a component still lays out correctly (the positioning is pure CSS); it just draws in the page's serif.

| formula | faces | file |
| --- | --- | --- |
| `(costPerMonth·12)·years` | 1 (`KaTeX_Main`) | 48 KB |
| `x/y + z` | 2 (`KaTeX_Main`, `KaTeX_Math`) | 71 KB |

A Playwright case generates a component, then loads it on `/tools/photography/` — a page that has never seen MathLive — and asserts the host had no KaTeX faces beforehand, that every family the markup resolves to is loaded afterwards, and that the component made **no network requests at all**.

The formula is shown as plain LaTeX text. `generateWebComponent` takes an optional `formulaMarkup` argument and MathLive's SSR entry (`mathlive/ssr`, 397 KB) exports `convertLatexToMarkup`, so pre-rendering it is one call away — but the seam is deliberately left unwired. That markup is KaTeX spans that need MathLive's static stylesheet **and** the twenty faces to look like anything; a host page has neither, so the pre-rendered version would render worse than the plain text it replaced, and shipping the CSS and fonts alongside would end the "one file, no dependencies" promise the component exists for. The argument is there for a caller that does have those assets.

## The image export

**Export image** sits in the **Calculations** card, under Save, behind a dashed rule. It had a card of its own at first, which put a heading and a paragraph between the answer and the button that turns the answer into a picture; saving a calculation and picturing it are the same kind of act and belong together. It draws the current calculation: the formula, the same formula with the values written into it, and the result. The dialog previews it live and offers **Download SVG**, **Download PNG** and **Copy PNG**. The whole feature arrives on that first click and not before.

```mermaid
flowchart TD
  A["formulaLatex, exactly as typed"] --> R
  B["substitutedLatex in substitute.ts"] --> R
  C["formatNumberLatex of the result"] --> R
  R["three rows: a caption and a LaTeX string"] --> S
  S["renderFormulaSet in formulaMarkup.ts: convertLatexToMarkup per row, one stylesheet, each face embedded once"] --> M
  M["layoutRow: laid out in an off-screen shadow root, geometry read back"] --> G
  G["drawRow: text, rect and nested svg primitives"] --> V
  V["buildCalculationSvg returns a self-contained SVG string"] --> D["downloadImageSvg writes the .svg"]
  V --> P["svgToPngBlob in raster/svgToPng.ts"]
  P --> E["encodeCanvas, then downloadBlob or copyPng"]
```

`renderFormulaSet` exists rather than three calls to `renderFormula` because three rows of one calculation share almost every face: rendered separately and concatenated, `KaTeX_Math-Italic` would be pasted into the file once per row that happens to use it. The union is measured first and each face embedded once.

Nothing is measured until `document.fonts.ready` resolves: sized against a fallback serif, every row comes out the wrong width and the picture is clipped.

The preview is an `<img>` of a blob URL rather than inlined markup. That is the safe choice — an SVG inside an `<img>` cannot run script, and this markup is derived from user-typed LaTeX — and the honest one: it is the same pipeline the PNG goes through, so a preview that draws is a PNG that will draw.

### The dialog

A native `<dialog>`, opened with `showModal()` from an effect rather than from the click handler, because `showModal()` is what brings the backdrop, the focus trap and Escape. Its state is local to the export and never touches the template: the three rows (`imageRows`, see below), `showImageTitle`, `imageTheme`, `imageTransparent`, `imageDecimals`, `imageScale`. The result row is offered only when there is a result to put in it, and **Export image** is not rendered at all until the formula parses — it sits outside the `fields.length === 0` branch on purpose, so a formula with no free variables (`2+2`) still offers a picture even though it has nothing to fill in.

`rebuildImage` runs on open and on any option change — but only while the dialog is open — and carries an `imageToken` for the same reason the parse and evaluate paths do: a slow render must not overwrite a newer one. Closing revokes the blob URL and drops the SVG. Nothing here reads or writes a row: the export renders the calculation on screen and adds no data model of its own.

Three actions come off the built SVG: `downloadImageSvg` (`downloadText`, `image/svg+xml`), `downloadImagePng` and `copyImagePng`, the last two sharing one `rasterize()` that puts any refusal from `svgToPngBlob` into the dialog's error line rather than throwing it.

### The captions (0.6.0 Phase 1)

Each row's caption can be turned off on its own and reworded. The per-row state in [NapkinMathApp.svelte](../../../src/components/apps/NapkinMathApp.svelte) is `imageRows: Record<'formula' | 'substituted' | 'result', { show, captionOn, caption }>`, with the defaults (`Formula`, `With your values`, `Result`) in `DEFAULT_CAPTIONS`. The **Rows** fieldset draws one line per row from the `IMAGE_ROWS` list — the row checkbox (`napkin-image-row-*`, unchanged from 0.5.0), a **caption** checkbox (`napkin-image-caption-on-*`) and a text box (`napkin-image-caption-*`) that is disabled while either checkbox is off. **Reset captions** (`napkin-image-captions-reset`) restores the three defaults and turns every caption back on; it leaves the row toggles alone.

`rebuildImage` hands the renderer `rowLabel(key)` — the trimmed caption when it is on, `''` when it is off — and never a different row shape, so `CalculationRow` did not change. `captionText` in [exportImage.ts](../../../src/lib/napkin/exportImage.ts) is the one place that decides what a caption is: trimmed, upper-cased, and the empty string for blank or whitespace, which `buildCalculationSvg` reads as "no caption line at all" (no `<text>`, and no `LABEL_HEIGHT + LABEL_GAP` added to the picture). It is a pure function precisely so the blank case is covered by Vitest rather than only by the Playwright pass that measures real glyphs.

Captions are **per-session** (plan Q1), like the theme, transparency, decimals and scale: they are not written to the template, and closing the dialog does not reset them. Saving them on the template would mean a new optional `export_captions` field, a mirror row in `schema.ts` and a `patch()` on save — cheap to add later, and not asked for yet.

### There is no `<foreignObject>` in the output, and there must never be one

This is the single most important fact on this page, because the version with one is the obvious version.

The plan said to lay the typeset rows out as HTML inside `<foreignObject>` and rasterise that with a canvas. Measured in Chromium, **it cannot work**: drawing *any* SVG containing a `<foreignObject>` onto a canvas taints it, and `toBlob()` then throws `SecurityError: Tainted canvases may not be exported`. A trivial one-element `<foreignObject>` with no external references at all is enough to trigger it. The plan expected trouble from Safari only; the truth is that shipping it as planned would have given the dialog a PNG button that always failed.

So the browser is still the typesetter — nothing here understands maths — but the markup is laid out once and then **read back as geometry**, and the output is `<text>`, `<rect>` and nested `<svg>`. That rasterises in every engine and scales without a second render. A Playwright case asserts the absence directly:

```
expect(svg).not.toContain('<foreignObject');
```

Anyone "simplifying" this back to embedded HTML will find every test green except that one, and a PNG button that throws.

One consequence worth knowing: `svgToPngBlob`'s WebKit refusal (`foreignObjectSupport`, `WEBKIT_REFUSAL`) only fires when the SVG it is handed actually contains a `<foreignObject>`. This picture never does, so the napkin export never reaches that branch and the dialog offers PNG everywhere.

Two more properties the output has to keep, both because an `<img>` rendering an SVG may not fetch anything:

- **The faces travel as `data:` URIs.** A font referenced by URL falls back to a serif silently.
- **`fontFaceRules` keeps only the `@font-face` rules** out of the rendered CSS. The layout rules position HTML and cannot affect `<text>` and `<rect>`, so carrying them would add about 30 KB to every picture for nothing.

Colours are literals from `EXPORT_THEMES`, never `var(--…)`: an SVG file has no `:root` to inherit from, and a picture is a thing you send to someone whose theme is not yours. A unit test asserts every value in both palettes is a plain hex.

### `expr.subs()` is not how you get "the formula with your values in"

It reads like the answer — the evaluator already uses it — but it does not substitute, it **partially evaluates**. Measured against the real Compute Engine:

| formula | values | `expr.subs()` gives | the row should read |
|---|---|---|---|
| `sqrt(x² + y²)` | 3, 4 | `5` | `\sqrt{3^2+4^2}` |
| `costPerMonth × 12 × years` | 25, 3 | `900` | `25×12×3` |

Those are answers, and the answer is the row underneath — the middle row would have been a duplicate of the bottom one.

String replacement on the LaTeX is the other plausible wrong answer: replacing `rate` also hits the `rate` inside `\text{separate}`, and replacing `x` hits the `x` in `\max`. A formula is a tree, not a string.

[substitute.ts](../../../src/lib/napkin/substitute.ts) walks the MathJSON tree instead and swaps symbol nodes for number nodes. `substituteJson` is pure and exported so the walk tests without loading 2.5 MB of engine: element 0 of an application is the operator head and is never a variable, and all four shapes MathJSON can take — a bare string, the `{sym}` long form, an array application, the `{fn}` long form — are covered.

### The parse and the re-render are non-canonical

`parseRaw` and `boxRaw` in [engine.ts](../../../src/lib/napkin/engine.ts) exist for this one caller. Everything else wants the canonical form, because that is what evaluates. Here canonicalising rewrites the author's formula on the way in:

| written | canonical form | renders as | raw form renders as |
|---|---|---|---|
| `a - b`, with b = −7 | `["Add", "a", ["Negate", "b"]]` | `5 + 7` | `5 - (-7)` |
| `1 + rate` | reordered to `rate + 1` | `0.05 + 1` | `1 + 0.05` |
| `costPerMonth × 12 × years` | `12 × costPerMonth × years` | `12 × 25 × 3` | `25 × 12 × 3` |

`5 + 7` is not a lie about the arithmetic, but it is not the formula anyone typed, and the picture's whole claim is that it shows your formula.

The row is **refused rather than shown** when the round trip does not come back clean. `substitutedLatex` returns a reason instead of LaTeX when the output carries `\error`, `\mathtip`, `__unit__` or `\operatorname{\_\_`, when nothing has a value yet, or when none of the named inputs appear in the formula. The dialog puts that reason under the preview and draws one row fewer. A picture captioned "your calculation" that quietly contains `\operatorname{__unit__}` is worse than a shorter one.

A single letter wrapped in `\mathrm{}` parses as a *different* symbol — `\mathrm{x}` is `x_upright` — so `aliases()` accepts both spellings for the same field name. The editor never emits that form, but an imported formula can carry it.

### Three traps in reading geometry back out of a browser

Each of these cost time, each would cost it again, and each fails quietly rather than loudly.

| trap | what happens if you do the obvious thing |
|---|---|
| **The baseline has to be measured.** `layoutRow` inserts a zero-size inline-block with `vertical-align: baseline` after each text node, reads its `top`, and removes it — that element sits exactly on the line's baseline. | Every arithmetic estimate from the font size and the line box drifts, and the rows sit visibly off their own line. |
| **MathLive paints a fraction bar with `.ML__frac-line::after`.** So `hasPaintedPseudo` checks the element *and* both pseudo-elements, and counts a painted box as a rule only when it is a hairline of 4 px or less — a background on a tall box is a highlight, and painting it would cover the glyphs. | An element scan that reads borders and background colours finds **nothing**. The first working version drew fractions as two numbers with no line between them. |
| **KaTeX splits a word across text runs to kern it.** `revenue` is drawn as `re`, `v`, `enue` in three separate `<text>` elements. | A spec asserting `toContain('revenue')` against the SVG source fails on a picture that is perfectly correct. The Playwright helper `previewGlyphs` joins every `<text>` body first — the captions and the title are single runs and *can* be matched in the source, the maths cannot. |

### It is behind a dynamic import, guarded both ways

`rebuildImage`, `downloadImageSvg` and `rasterize` all `import()` their modules at the moment they are needed: the SVG builder, the substituter and its non-canonical engine calls, and the rasteriser. The napkin page already carries MathLive and the Compute Engine — it should not also carry a dialog most visits never open.

[payload.spec.ts](../../../tests/local/payload.spec.ts) asserts **both directions**, because a guard that can never fire is not a guard: the export's chunk must not load on a page that only opened the tool, and it must load once the dialog is opened. It finds that chunk by searching the real build for the baseline probe's inline style, `width:0;height:0;vertical-align:baseline` — a string only this feature carries. A guessed chunk name is how the CodeMirror guard sat inert for several releases, and a MathLive class name would be useless here because the editor bundle carries those on purpose.

### What the tests cover

- [substitute.test.ts](../../../src/lib/napkin/substitute.test.ts) — the tree walk in Vitest against plain JSON, then `substitutedLatex` against the **real** engine for the cases that decide whether the feature is honest: the square root that must stay a square root, the subtraction that must stay `5-(-7)`, `\mathrm{rate}` next to `\mathrm{rated}`, and each refusal.
- [exportImage.test.ts](../../../src/lib/napkin/exportImage.test.ts) — the arithmetic and naming around the builder. `formatNumberLatex` groups thousands with `\,` rather than a comma, because the row above it is rendered by the Compute Engine, which writes `\,`; four digits stay unbroken, since `1,000` reads worse than `1000` in a formula. `imageFilename` cannot emit a separator or a traversal. `captionText` turns blank and whitespace into no caption, which is what the dialog's caption toggle relies on.
- [napkin-math.spec.ts](../../../tests/local/napkin-math.spec.ts) — `layoutRow` and `buildCalculationSvg` measure real text, so they live in Playwright: no `<foreignObject>`, no non-`data:` `url(`, no `var(--`, a fraction drawing more than one `<rect>`, the middle row carrying `12500` and `4750` while the bottom row carries `7750`, a PNG whose IHDR is exactly 3× the preview at 3× and which is too large to be blank, every dialog control carrying an accessible name, and **zero writes** across the whole flow.

## Offline

The twenty KaTeX faces (262,804 bytes with their stylesheet) live in their own cache bucket, `useful-fonts-v1`, deliberately **outside** the app-cache prefix so a `CACHE_NAME` bump does not evict them. They are stable, unfingerprinted `public/` files that the service worker's `_astro/` crawl can never find — it matches fingerprinted chunk URLs and does not parse CSS `url()` — so they register their own `OfflineBundle` and are fetched cache-first with no revalidation.

`MATH_FONT_BYTES` is checked by a unit test against `public/math/PROVENANCE.txt`, so a re-vendor that changes sizes fails the suite rather than quietly lying to the download dialog.

## Docstrings follow each language, not one house style

A generated function is read by whoever pastes it, in their own editor, with their own tooling. So each language gets the convention its tooling expects rather than one shape repeated four times:

| | Convention |
| --- | --- |
| Python | NumPy style — a summary line, `Parameters` / `Returns` / `Raises` sections, each underlined to exactly its own length |
| Go | The `speyl/algorithms` house form: a summary line, then `# Parameters` and `# Returns` blocks whose entries are indented one space so godoc renders them as a block |
| Rust | `///` lines, deliberately terse — the parameter name, its description, and the one constraint a type cannot express. The signature already says `f64`, so nothing repeats it |
| JavaScript | JSDoc, `@param` and `@returns` |

The formula goes into every one of them through [latex.ts](../../../src/lib/codegen/latex.ts), which strips the markup that only a renderer needs — `\mathrm{}` around each multi-letter name, `\left(` / `\right)` sizing — and wraps the result in `$…$`. It is a readability pass, not a converter: anything it has no rule for is left exactly as it was, because a half-understood rewrite is worse than the raw source.

Two identifier rules worth knowing, both learned from reading the output:

- **Go gets camelCase and an exported name.** `gofmt` will not fix a snake_case identifier and every Go linter flags one, so `total_cost` was not merely un-idiomatic.
- **`toCamel` goes through snake_case first.** Splitting a name on underscores alone leaves `costPerMonth` as one part, and lowercasing that part gives `costpermonth` — a name nobody typed. This affected JavaScript too.

And one that is a compile error rather than a style note: **Rust cannot compare an `f64` with an integer literal**, so its guard clauses use `0.0`.

## Syntax highlighting

Prism, not CodeMirror. The generated code and the live JSON are read-only output that nobody edits, so an editor would cost a couple of hundred kilobytes and a focus trap for nothing; Prism's grammars are already bundled once for the regex tool and the markdown renderer, and `global.css` already inks `.token.*` in the blueprint palette.

The import box is the awkward one, because it *is* edited. [CodeInput.svelte](../../../src/components/CodeInput.svelte) keeps a real `<textarea>` — native selection, undo, paste, and the accessibility a contenteditable throws away — makes its text transparent while leaving the caret opaque, and puts an identically laid-out `<pre>` underneath. Everything that affects where a glyph lands is declared once for both layers, and the scroll positions are synced.

One detail that is not obvious: the underlay's content ends with an extra newline. A textarea always reserves a line past its content, and without matching it the underlay is exactly one line shorter — which nothing shows until someone scrolls to the bottom and the highlight slides out of step with the text it sits behind.

## The Code card holds one formula's worth of state

Generated source, and especially a refusal like "this formula uses Factorial", describes **one** formula. Leaving either on screen after the formula has moved on is a statement about something that no longer exists — which is exactly what it did: an error raised for a sum stayed up while the reader typed a completely different formula, and again after they started a new template.

`resetGenerator()` clears the source, the error and the size note, and runs from `onFormulaChange` (before the `await`, so a slow parse cannot leave a stale error up), from `openTemplate`, and from `newTemplate`.

## Insert buttons

`\sum_{x=1}^{n}\left(x\right)` is not something anyone types from memory, and a half-finished one does not parse — so the formula card carries buttons for sum, product, integral, fraction and root. Each inserts a skeleton that **already parses and already has bounds**, so the field list appears immediately and the reader edits a working formula instead of fighting an incomplete one.

They go in through the mathfield's own `insert` command rather than by splicing the value string: only the field knows where the caret is, and rebuilding the value would move it to the end and drop the selection. The command mutates the field without firing `input`, so the wrapper pushes the new value out by hand afterwards.

The index is `x`, not `i` — a bare `i` is the imaginary unit to the Compute Engine.

## Known limits

- **Numbers only.** MathJSON has no string arithmetic, so a text field could never take part in the formula it is attached to. A field's *description* is free text, but it is documentation — it never reaches the maths.
- **A generated integral is approximate**, and a generated sum or product rounds its bounds to whole numbers. Both are stated in the emitted comments.
- **One formula per template**, and one result. No intermediate named steps.
- **Built-in text shortcuts are off**, which is a real loss: `pi` no longer becomes π as you type. Type `\pi` instead, or use the virtual keyboard. The alternative was letting a variable called `sqrtish` silently corrupt the formula.
- **`\mathrm{}` on a single letter renames it.** The editor's rule only fires on two or more letters, so this cannot happen by typing — but a formula pasted in through the import box can carry it, and `x_upright` is what the engine will call it.
- **The generated code is a starting point, not a library.** It has no tests, no packaging, and no float-precision story beyond what the language gives you.
- **An imported template's MathJSON is re-derived from its LaTeX**, never trusted, so a hand-edited file whose two halves disagree cannot mislead the generator. The consequence is that importing needs the engine loaded.
- **The image export's rounding is its own.** There is no precision preference anywhere in this app, so the plan's "formatted through the page's existing precision setting" had nothing to hook into. The dialog offers `auto` — `String(number)`, exactly what the page shows — or 0 to 4 decimals, and that choice changes the picture and nothing about the calculation. Inventing an app-wide setting from an export dialog is the wrong place to start one.
- **The substituted row is refused, not approximated.** When the non-canonical round trip comes back with an engine error marker, the row is dropped and the reason is shown under the preview. Some formulas therefore produce a two-row picture with an explanation attached rather than the three rows the dialog offers.
- **The picture carries its own fonts, so it is a few tens of KB** — the dialog states the figure. Only the faces the three rows actually resolve to are embedded, so a one-face formula is far smaller than a mixed one, but there is no way to make it small *and* have it render correctly on a machine without KaTeX installed.
- **The title's width is estimated, not measured** — `title.length * 8.2` — because it is drawn as plain sans-serif `<text>` and never goes through `layoutRow`. A long title in a wide-glyph name can sit closer to the right edge than the padding claims.
