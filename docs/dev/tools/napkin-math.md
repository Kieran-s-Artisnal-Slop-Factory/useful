# Napkin math

Self-documenting back-of-the-envelope calculations at `/tools/napkin-math/`: type a formula, get typed input fields, run named calculations against it, keep a library of templates, and generate code from any of it in Python, JavaScript, Go, Rust or as a dependency-free web component.

_Describes the code as of v0.2.0 (unreleased; schema v10) — verify against source when in doubt._

## File map

| Path | Role |
| --- | --- |
| [NapkinMathApp.svelte](../../../src/components/apps/NapkinMathApp.svelte) | The tool: library sidebar, template editor, fields, calculations, code card, export/import. |
| [MathField.svelte](../../../src/components/MathField.svelte) | The `<math-field>` wrapper. Three settings here are load-bearing — see below. |
| [napkin/engine.ts](../../../src/lib/napkin/engine.ts) | The Compute Engine, wrapped: `parseFormula`, `evaluateFormula`, `boxJson`. |
| [napkin/model.ts](../../../src/lib/napkin/model.ts) | Fields, `reconcileFields`, `checkValue`. Pure, so it tests without loading 37 MB of maths library. |
| [napkin/transfer.ts](../../../src/lib/napkin/transfer.ts) | Import and export, with the validation an untrusted document needs. |
| [codegen/expression.ts](../../../src/lib/codegen/expression.ts) | MathJSON → an expression, per language, with precedence. |
| [codegen/functions.ts](../../../src/lib/codegen/functions.ts) | The whole file: docstring, typed parameters, guard clauses, helpers. |
| [codegen/identifiers.ts](../../../src/lib/codegen/identifiers.ts) | Symbol → a legal identifier, per language, with collision resolution. |
| [codegen/webcomponent.ts](../../../src/lib/codegen/webcomponent.ts) | The dependency-free custom element. |
| [codegen/latex.ts](../../../src/lib/codegen/latex.ts) | The mathfield's LaTeX reduced to readable Markdown maths for a comment. |
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

An **odd root** is refused rather than emitted. The engine says `(-8)^(1/3)` is `-2`; every target language's `pow` says `NaN`. There is no portable spelling, so the generator says so instead of producing something that is wrong for negative inputs only.

Each field's constraint becomes a **guard clause** — `ValueError` in Python, `RangeError` in JavaScript, an `error` return in Go, `Result::Err` in Rust — so a generated function refuses what the page refuses. Labels and descriptions are free text and reach four kinds of comment, so they go through `commentSafe`, which neutralises the sequences that would end a comment early and spill the rest into the file as code.

### Identifiers

A symbol is stripped to ASCII letters, digits and underscores; an empty or digit-leading result gets a `v` in front; the result is cased per language (snake for Python/Go/Rust, camel for JavaScript); a reserved word gets a trailing underscore; and a collision gets `_2`, `_3`, … in the symbols' own order, so the first symbol keeps the plain name and a regenerated file never renames a parameter.

### The web component

One `.js` file, no imports, no external URL, no build step. Every element carries a `part` attribute and the stylesheet is three rules, so the host page styles it with `::part()` and has nothing to override. It re-checks its inputs against the same rules before computing, and emits a `napkin-result` event.

A Playwright case **loads the generated file in a real page**, drives its inputs, and asserts it produces the same number the app showed. A golden-file test cannot catch a generated syntax error; this does.

The formula is shown as plain LaTeX text. `generateWebComponent` takes an optional `formulaMarkup` argument and MathLive's SSR entry (`mathlive/ssr`, 397 KB) exports `convertLatexToMarkup`, so pre-rendering it is one call away — but the seam is deliberately left unwired. That markup is KaTeX spans that need MathLive's static stylesheet **and** the twenty faces to look like anything; a host page has neither, so the pre-rendered version would render worse than the plain text it replaced, and shipping the CSS and fonts alongside would end the "one file, no dependencies" promise the component exists for. The argument is there for a caller that does have those assets.

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

## Known limits

- **Numbers only.** MathJSON has no string arithmetic, so a text field could never take part in the formula it is attached to. A field's *description* is free text, but it is documentation — it never reaches the maths.
- **One formula per template**, and one result. No intermediate named steps.
- **Built-in text shortcuts are off**, which is a real loss: `pi` no longer becomes π as you type. Type `\pi` instead, or use the virtual keyboard. The alternative was letting a variable called `sqrtish` silently corrupt the formula.
- **`\mathrm{}` on a single letter renames it.** The editor's rule only fires on two or more letters, so this cannot happen by typing — but a formula pasted in through the import box can carry it, and `x_upright` is what the engine will call it.
- **The generated code is a starting point, not a library.** It has no tests, no packaging, and no float-precision story beyond what the language gives you.
- **The web component shows its formula as text, not typeset.** See above — the
  markup would need a stylesheet and 263 KB of fonts the host page does not have.
- **An imported template's MathJSON is re-derived from its LaTeX**, never trusted, so a hand-edited file whose two halves disagree cannot mislead the generator. The consequence is that importing needs the engine loaded.
