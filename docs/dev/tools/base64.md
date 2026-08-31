# Base64

`/tools/base64/` — text and files in and out of base64, in four combinations: (text | image) x (encode | decode). A stateless Svelte island over [base64.ts](../../../src/lib/encode/base64.ts) and [sniff.ts](../../../src/lib/encode/sniff.ts); it writes nothing at any point.

_Describes the code as of v0.4.0 (unreleased; schema v16) — verify against source when in doubt._

## File map

| Path | Role |
| --- | --- |
| [base64.ts](../../../src/lib/encode/base64.ts) | Encode/decode both alphabets, validation with an offset, sizing, `data:` URL parse and build |
| [sniff.ts](../../../src/lib/encode/sniff.ts) | Magic-number file identification: what these bytes actually are |
| [Base64App.svelte](../../../src/components/apps/Base64App.svelte) | The page |
| [base64.astro](../../../src/pages/tools/base64.astro) | Route shell |
| [registry.ts](../../../src/lib/registry.ts) | Sidebar/palette entry (`base64`, category `Images`) |
| [base64.spec.ts](../../../tests/local/base64.spec.ts) | Playwright |
| [base64.test.ts](../../../src/lib/encode/base64.test.ts), [sniff.test.ts](../../../src/lib/encode/sniff.test.ts) | Vitest |

## Why this exists at all

`btoa` and `atob` are the platform's own base64 and both are traps.

- **`btoa` throws on anything above U+00FF.** `btoa('café')` is a `DOMException`, and the recipe the internet still hands out for it (`btoa(unescape(encodeURIComponent(s)))`) leans on a function deprecated since ES3. Text here goes through `TextEncoder`, always UTF-8.
- **`atob` does not reliably fail.** Fed something that is not base64 it returns whatever it could make of the input, and mojibake that looks like data costs far more than an error. Every decode here is validated first, and the error carries **the offset in the original string** — the one fact needed to fix a pasted token.

## Sniffing, not trusting

A file extension is a claim; `File.type` is the operating system's guess from that claim; a pasted base64 blob has neither. So the type shown — for an uploaded file and for decoded bytes alike — comes from `sniff()` reading the first bytes.

That is why pasting `data:image/jpeg;base64,<a PNG>` reports **PNG image**: the label in the URL is not evidence, and `base64.spec.ts` pins that behaviour.

Container formats are matched by brand rather than wrapper: RIFF entries (`WEBP`, `WAVE`) are only accepted when the first four bytes really are `RIFF`, and ISO base media entries match `ftyp` + brand at offset 4. SVG is the odd one out — it is XML and has no magic number — so it is checked last, on the decoded head, and only when the text opens with `<?xml`, a comment, a DOCTYPE or `<svg`.

## The page

Two `<select>`s (mode and direction) rather than four tabs, because the four combinations are two independent questions. Everything else follows from them.

- **The size cost is on screen, not in a footnote.** Encoding shows "5 B in -> 8 B of base64 (60% larger)"; a file over a megabyte gets a note about what a data URL that size does to a stylesheet, a cache and a clipboard.
- **The offending character is highlighted** in the decode error, with the twelve characters either side of it, because "invalid character at 5" is only half an answer.
- **Copy has four shapes** for an encoded image: the data URL, the base64 alone, a CSS `background-image` declaration, and an `<img>` tag — the four things people actually paste.

Test hooks are prefixed `b64-`: `b64-mode`, `b64-direction`, `b64-input`, `b64-output`, `b64-empty`, `b64-error`, `b64-size`, `b64-urlsafe`, `b64-padding`, `b64-wrap`, `b64-copy`, `b64-download`, `b64-file`, `b64-file-note`, `b64-kind`, `b64-bytes`, `b64-encoded-size`, `b64-preview`, `b64-large`, `b64-dataurl`, `b64-copy-dataurl`, `b64-copy-raw`, `b64-copy-css`, `b64-copy-img`, `b64-download-text`, `b64-paste`, `b64-decode-kind`, `b64-decode-size`, `b64-decode-preview`, `b64-decode-not-image`, `b64-decode-download`, `b64-decode-error`, `b64-decode-empty`.
