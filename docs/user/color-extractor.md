# Color extractor

Hand it a picture and it tells you which colours are actually in it: a strip of swatches sized by how much of the image each covers, a table of every value in hex, rgb, hsl and oklch, and a CSS theme built from them. It sits under **Images** in the sidebar, beside the other [image tools](images.md). Nothing is uploaded and no picture is stored.

_Describes the code as of v0.5.0 (unreleased; schema v16) — verify against source when in doubt._

## Gotchas

- **You can paste an image anywhere on the page.** Copy a screenshot, press Ctrl/Cmd+V with this tool open, and it loads, wherever the cursor happens to be. No other tool here does that, so nobody guesses it. Pasting text into a box still behaves normally; the paste is taken only when the clipboard carries an image. Dropping a file and the file picker work too: PNG, JPG, WebP, AVIF, TIFF and SVG, up to 50 MB.
- **The colour count is a request, not a promise.** Ask a two-colour logo for eight and you get the two it has, with a line under the strip saying so. It will not pad the palette out with black to reach your number. The box takes 2 to 16.
- **The same image and the same count always give the same palette.** Nothing here is random, so nudge the number up to see what a seventh colour would be, then bring it back down and land exactly where you started.
- **Transparent areas are skipped, not counted as black.** A logo on a transparent background gives you the logo's colours and nothing else; anything less than half opaque is ignored. If every pixel is transparent, the page tells you there is nothing to read.
- **The theme it exports is the same file the Themes generator makes.** Same five roles, same CSS block — its caveats, `light-dark()` included, are on the [Generators](generators.md) page. **Open in Themes** carries your colours across if you want harmonies, per-role dark values and the rest of those controls; roles left on *auto* arrive blank and derive the same way there.
- **"auto (derived)" means a colour was grown from your primary, not taken from your image.** That is why the surface roles, base and neutral, are so often left on it. Base sits behind every page in the theme, and an image with no near-grey has nothing quiet to put there — a flat graphic's most common colour behind everything gives a garish theme that trips contrast warnings on arrival. Derived, base becomes a pale tint of the primary instead. Overrule it if you like — each menu lists the whole palette, and **Reset to suggestion** puts everything back.
- **Nothing is saved.** No history, no recent palettes, no remembered settings — reload and you are back to an empty drop box. Copy or download what you want before you leave.

## Getting the colours out

Click a swatch to copy its hex. In the table every value is its own button, so you can take one colour's `oklch()` spelling alone. **Copy all as a list** gives the hex codes one per line; **Copy as CSS variables** gives a numbered `:root` block. The percentages are each colour's share of the picture, measured on a scaled-down copy, so they are close rather than exact.

In the theme card, the light / dark / auto switch only changes which half of the theme you are previewing, and any role hard to see against the theme's own background is listed with its contrast ratio — advice, not a lock.

## What the five roles are for

- **Primary** — buttons, links, the thing meant to be noticed. Suggested from the most common colour in the image that is not a grey.
- **Secondary** — supporting colour for second-rank buttons and headings. Suggested from the next most common non-grey.
- **Accent** — the loudest colour, for highlights and badges that should jump out. Suggested from the most vivid colour, often not a common one.
- **Neutral** — the grey behind muted text, borders and quiet chrome. Suggested from a mid-lightness grey.
- **Base** — the page background, which every other role is judged against, and the reason the tool is cautious with it.
