# Generators

Six small tools that turn a few inputs into something you can copy or download: Themes (color conversion, harmonies and a CSS theme builder), Gradients, Glassmorphism, Regex snippets, QR code and Clip path. They all work offline and remember nothing — reload the page and you start from the defaults.

_Describes the code as of v0.5.0 (schema v16) — verify against source when in doubt._

## Themes

**Convert a color.** Type any CSS color into the box — `#1e3a5f`, `rgb(30 58 95)`, `hsl(210 52% 25%)`, `oklch(0.35 0.07 250)`, `rebeccapurple` — or pick one with the picker beside it. The table below shows the same color in every spelling (hex, rgb, hsl, hwb, lab, lch, oklab, oklch), each with its own Copy button. If the color is exactly one of the CSS named colors, the name is shown too.

**Harmonies.** Under the table, four rows of swatches built from your color on the classic color wheel: complementary, monochromatic, analogous and tetradic. Click any swatch to copy its hex.

**Theme builder.** Give it one to five colors — primary, secondary, accent, neutral, base — and it produces a block of CSS variables for a complete light-and-dark theme. Each role has a light slot and a dark slot; anything left blank (shown as "auto") is derived: blank light slots come from the primary, blank dark slots come from that role's light value. "Use color above as primary" copies the converter's color into the primary slot. Padding and border-radius knobs are emitted as variables too. The preview window (card, accordion, table, form fields) is styled by exactly the CSS you will copy; the auto / light / dark switch only changes which half of each pair the preview shows. Under the swatches the builder lists any role that is hard to see against the theme's own background in either scheme, with the contrast ratio. **Copy CSS** puts the whole `:root { … }` block on the clipboard.

## Gradients

Pick linear, radial or conic; set the angle (linear and conic) or the shape (radial); tick Repeating if you want it. Edit the colour stops — each has a colour field with a picker and an optional position in percent (leave it blank and the browser spaces the stops evenly). Add stops with "+ Add stop"; you can remove down to two. The preview and the `background: …;` line update together; **Copy CSS** copies the declaration.

## Glassmorphism

Start from a preset (frosted light / medium / strong, dark frosted, iOS clear, blue / amber / rose tint) or dial it in: backdrop blur, tint colour and opacity, backdrop saturation, border opacity, corner radius and a drop shadow. The panel is previewed over a busy backdrop; **Copy CSS** copies the block, `-webkit-backdrop-filter` included.

## Regex snippets

Type a regular expression and tick the flags you need (ignore case, multiline, dot matches newline). You get:

- A **Test** box: paste sample text and matches are highlighted in place, with a table of positions and captured groups. Capturing groups are colour-coded — group 1 wears the same colour in the highlighted text and in the table, and named groups show their name.
- **Snippets** for JavaScript, Python, Go and Rust — compile, match and find-all — with the pattern escaped correctly for each language and the flags translated. Each card has a Copy button.
- A **Symbol reference** table you can filter by symbol or meaning.

If the pattern does not compile, the error is shown and the snippets and tester disappear until you fix it.

## QR code

**Create.** Type text or a URL; the code redraws as you type. Choose a size (128 to 1024 px), an error-correction level (L/M/Q/H — higher survives more damage but makes a denser code), and the code and background colours. Then **Download PNG**, **Download SVG**, **Copy PNG** or **Copy SVG text**.

**Read.** Upload an image containing a QR code, or — if your device has a camera — click **Scan with camera**, allow access when the browser asks, and hold the code up. The decoded text appears below; if it is a web address you also get an "Open link" link that opens in a new tab.

## Clip path

Builds a CSS `clip-path:` line and shows it applied to a sample so you can see the cut before you copy it. Pick a kind along the top:

- **Polygon.** Start from one of 25 presets — triangle, trapezoid, parallelogram, rhombus, pentagon to decagon, bevel, rabbet, left and right arrows, points and chevrons, star, cross, two message bubbles, close and frame — then shape it by hand. Drag the round handles on the preview to move points. Double-click an edge to add a point there, or double-click empty space to add one at the end. Right-click a handle to remove it (or focus it and press Delete); a **Remove point** button also appears for the handle you last touched. A focused handle moves with the arrow keys, 1 % at a time, 5 % with Shift. **Reset to preset** puts the last preset back. Shapes never go below three points.
- **Circle.** A radius and a centre, all in percent.
- **Ellipse.** Horizontal and vertical radii and a centre.
- **Blinds.** A number of equal strips with a gap between them, stacked top to bottom or side by side — the picture shows through the strips only.
- **Wave.** One edge of the box becomes a wave: how many waves, how tall (peak to trough), a phase to slide it along, the waveform (sine, triangle, square, sawtooth) and which edge (top or bottom).

The preview shows a gradient by default; choose an image with the file picker or drop one on the preview to see your own picture clipped. **Copy CSS** puts the `clip-path: …;` line on the clipboard. Every value is a percentage, so the same line fits an element of any size.

## Gotchas

- **Nothing here is saved.** These pages have no memory: reloading or navigating away resets every field to its default. Copy or download what you want to keep. (Unlike the timers, image tools or SQL playground, they do not add anything to the Preferences page.)
- **Out-of-gamut colours are clipped.** Colours that a screen cannot show — a very vivid `oklch()`, for example — are flagged "Outside the sRGB gamut" and every spelling below is the nearest displayable colour, not the exact one you typed.
- **The theme CSS uses `light-dark()`.** It only works in browsers that support that function (current major browsers do; older ones ignore those declarations, so the variables are undefined there). No fallback is generated. The copied block includes the `color-scheme: light dark;` line it needs — keep it.
- **Blank theme slots are derived, and junk counts as blank.** A slot that does not parse as a CSS colour is treated as empty and falls back to the derived value; the picker beside it shows the value actually in use.
- **Contrast warnings are advisory.** They compare each brand colour with the theme's own background at the 3:1 threshold used for interface components; they do not check body text.
- **Regex snippets are generated from the JavaScript engine's view of your pattern.** Go and Rust cannot do lookahead, lookbehind or backreferences; when your pattern uses them, those two snippets carry a warning instead of quietly broken code. Other engine differences are not detected. The live tester also runs on the JavaScript engine, so it will happily match a lookbehind that Go would reject.
- **The tester stops at 500 matches** and shows the first 50 rows in the table.
- **Inverted or low-contrast QR colours warn.** A light code on a dark background, or a pair with too little contrast, shows a warning because many scanners refuse such codes. The warning does not stop you exporting.
- **Copy PNG is always PNG.** The clipboard copy of the code is a PNG image; use Copy SVG text if you want the vector markup.
- **Camera permission is asked only when you click Scan**, never on page load. If you deny it, or no camera works, upload an image instead. Scanning stops after the first successful read; click Scan again for another. Leaving the page stops the camera.
- **Reading is fully local.** Uploaded and camera images never leave your device, and decoded links are shown but never opened for you.
- **Glassmorphism needs something behind it.** The blur only shows when the panel sits over other content — over a plain background it looks like a tinted box.
- **Clip path blinds and waves are polygons.** A single `polygon()` can hold several separate strips (its outline doubles back along the box edge between them), which is why the blinds line looks long. Waves are sampled — sixteen points per wave — rather than drawn as curves, so a very tall wave on a very large element shows faint straight segments. The wave kind also offers a `path()` spelling, but that one is in pixels and only fits a 100 × 100 px box; use the polygon unless you know you need it.
- **A circle's percent radius is measured against the box's diagonal**, not its width, so `circle(50%)` on a wide box is larger than half the width. That is how CSS defines it, not a quirk of the tool.
- **Handles stay inside the box.** You cannot drag a point past the edge of the preview, and the preview image is never saved — reload and it is gone.
