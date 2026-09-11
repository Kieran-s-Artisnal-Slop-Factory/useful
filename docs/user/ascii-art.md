# ASCII art

**ASCII art** (under Generators, or Ctrl/Cmd+K) turns a picture into characters, or your words into a big text banner. Everything happens on your device, and nothing is saved.

_Describes the code as of v0.6.0 (schema v17) — verify against source when in doubt._

## Words as a banner

Type into **Words** and the banner appears below. Each line you type becomes its own banner.

The **Font** card draws all thirty-seven fonts in *your* words, so you pick by looking rather than by name, grouped by what they are made of: stroke-drawn, script, shadowed, 3-D, block characters and decorative.

Every font records where it came from — **Where they came from** under the picker opens the provenance file, which names each font's author and the terms it ships under.

- **Spacing** decides how tightly letters pack. "Default" is what `figlet` does on a terminal; "Smushed" overlaps neighbouring letters by a column; "Full" gives every letter its own full-width cell.
- **Alignment** places the block left, centre or right — useful when a banner sits above other text.

## A picture as characters

Switch **Make art from** to *A picture* and choose an image (PNG, JPG, WebP, AVIF, SVG or TIFF).

- **Width** is in characters, not pixels — 80 is a terminal, 200 is a wide screen. The height follows automatically.
- **Characters** picks the ramp: 10 steps reads at a glance, 70 steps gives a fine gradient but wants a big output to show it.
- **Invert** is for light text on a dark background: without it, dark parts of your picture become heavy characters, which is backwards on a dark terminal.
- **Colour** switches from plain text to a coloured version — each character keeps the average colour of the patch it stands for. That colour only survives in the HTML and SVG copies, never in the plain text.

## Getting it out

Every output offers **Copy text** and **Download .txt**; pictures add **Copy HTML**, **Copy SVG**, **Download .svg** and **Download .png**. The PNG is a picture of the characters, so it looks the same wherever it lands.

## Gotchas

- **Character cells are about twice as tall as they are wide**, and this tool assumes that. Paste the text somewhere with roomier line spacing — some chat windows, slide decks — and the picture stretches. Use the SVG or PNG when the proportions have to hold.
- **It has to be a monospace font at the other end.** In a proportional font every row is a different width and the art collapses. Code blocks, terminals and `<pre>` are safe; a document body is not.
- **The plain text is a rectangle.** Every line is padded to the same width with spaces, which is what keeps a banner square inside a comment box — but it does mean trailing spaces exist. Some editors strip them on save and change the shape.
- **Very fine ramps need room.** The 70-step ramp at 40 characters wide mostly shows noise; give it 150 or more, or use the 10-step one.
- **Emoji and non-Latin text may not have glyphs.** FIGlet fonts carry ASCII and usually Latin-1. A character the font does not have comes out blank rather than as a substitute.
- **The colour disappears in the text copy.** That is not a bug in the copy — plain text has no colour. Use Copy HTML or the SVG.
- **Nothing is saved.** Not the picture, not your words, not the font you chose. Reloading starts fresh, and a backup file will never contain any of it.
