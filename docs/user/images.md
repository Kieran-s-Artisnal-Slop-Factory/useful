# Images

Four file-in/file-out tools under **Images** in the sidebar (or Ctrl/Cmd+K): **Image converter** changes a picture's format, **Image resizer** changes its dimensions, **Image compressor** makes the file smaller (by hand or to a size you name), and **Background remover** cuts the subject out with a segmentation model that runs on your own device. All four decode the picture, work on it in the tab, and hand you a PNG or a JPG. Nothing is uploaded, and no picture is ever stored — the only thing remembered is the JPG quality you last used. The two layered editors in the same category have their own pages: [SVG editor](svg-editor.md) and [image editor](image-editor.md).

_Describes the code as of v0.4.0 (unreleased; schema v13) — verify against source when in doubt._

## Image converter

Pick a file — SVG, AVIF, WebP, TIFF, PNG or JPG — and choose an output format. The preview sits on a checkerboard so transparency is visible, and the line under it gives the output filename, its size and its dimensions.

Only PNG and JPG can be written, and the offered direction depends on what you brought in:

| Input | You can save it as |
| --- | --- |
| PNG | JPG |
| JPG | PNG |
| SVG, WebP, AVIF, TIFF | PNG or JPG |

WebP and AVIF are missing from the output list on purpose. Browsers read both, but they do not all write them, so the tool sticks to the two formats every browser encodes reliably: PNG (lossless, keeps transparency) and JPG (smaller, opaque). PNG→PNG and JPG→JPG are not offered because they would do nothing.

An SVG has no fixed pixel size, so choosing one adds a **Rasterize at width (px)** box (16 to 8192). Height follows the drawing's own proportions.

Choosing JPG adds a **JPG quality** box (1–100, 85 to start). Then **Download**, or **Copy (always PNG)**.

## Image resizer

Accepts PNG, JPG, WebP and AVIF. Two modes:

- **Dimensions** — type a width and a height in pixels. **Lock aspect ratio** is ticked to start; with it on, the edge you did not type follows from the original proportions, so the last edge you edited wins.
- **Percentage** — one number from 1 to 1000. Over 100 enlarges.

Then pick PNG or JPG (a `.jpg` input starts on JPG, everything else on PNG), set the JPG quality if you chose JPG, and **Download** or **Copy (always PNG)**. There is no preview here — the line above the buttons gives the output dimensions and the resulting file size, which is the thing worth watching.

## Image compressor

Accepts PNG and JPG. The output format follows the input — a PNG stays a PNG, a JPG stays a JPG — so there is no format picker. **Before** and **After** sizes are shown side by side with the change as a percentage, and "After" is the real encoded file, not an estimate.

**Manual settings** gives you the levers directly: **JPG quality** (JPG inputs only) and an optional **Cap longest edge** in pixels, which leaves the picture alone if it is already smaller than the cap.

The other two **Target** choices name a size and let the tool find settings that meet it:

- **Percent of original size** — 1 to 100 % of the file you picked.
- **Max file size** — a number of KB (decimal: 500 KB means 500 000 bytes).

In target mode the edge cap disappears and the quality box becomes **Max JPG quality** — a ceiling the search will not exceed. A JPG is squeezed by lowering quality first, never below 20, and only then by shrinking the dimensions. A PNG is lossless, so shrinking the dimensions is its only lever; converting it to a JPG in the converter usually saves far more.

The search re-encodes the picture repeatedly, which is why "Searching…" appears and why the outcome line says how many encodes it tried. It reports one of two things honestly:

- **Target reached** — with the quality it settled on (JPG only) and, if it had to shrink the picture, the scale.
- **Target NOT reachable — this is the smallest allowed encode** — the budget is below anything the format can produce within the limits above. The file you download is still the smallest allowed result, just over your number.

## Background remover

Finds the subject a photo is about and cuts everything else away. The model runs in your browser; the picture never leaves the device.

**Model.** The first time, the tool fetches about 15.8 MB — the segmentation model plus the WebAssembly runtime that executes it. **Download model (15.8 MB) for offline use** does it deliberately with a progress bar; otherwise the first run downloads it. After that the state line reads "Ready — the model is cached, so this tool works offline", and **Remove downloaded model** deletes it again. The same download is offered as "Background remover model" in Settings → Offline, and the image editor's per-layer background removal uses the same files.

**Running.** Pick a picture (PNG, JPG, WebP or AVIF) and press **Remove background**. A big picture can take a few seconds. Afterwards the line above the preview gives the dimensions, how much of the picture was kept as a percentage, and how long the run took.

**Tuning.** Everything below re-uses the result of that one run — none of it makes the model think again:

- **Cut off faint edges** (0–90 %) drops the haze around the subject without dimming the subject itself.
- **Soften edge** (0–8 px) blurs the boundary so the cut-out does not look stamped out.
- **Background** is Transparent or a **Solid colour** you pick.
- **Show the mask instead of the cut-out** shows what the model saw: white is kept, black is removed.

**Touch up by hand.** Set the brush to **bring back** or **cut away**, choose a size (4–200 px) and draw straight on the picture. Painted strokes are applied on top of the two sliders, so moving a slider — or running the model again — keeps your corrections. Where the two brushes overlap, "cut away" wins. **Clear touch-ups** removes both and leaves the model's own mask; picking a new picture clears them too.

**Saving.** **Save as** PNG (keeps transparency) or JPG (no transparency), set a JPG quality if relevant, then **Download** or **Copy (always PNG)**. The download filename is the original with `-no-bg` before the extension.

## Gotchas

### All four tools

- **Everything runs on your device.** Pictures are decoded, worked on and encoded in the browser tab. Nothing is uploaded, there is no server, and no picture is written to the app's database — so pictures do not appear in backups either. Close the tab and the only copies are the ones you downloaded.
- **JPG has no transparency.** Anything see-through is flattened onto white before a JPG is written, in every one of these tools. If you need the transparency, save a PNG.
- **Copies to the clipboard are always PNG,** no matter which format you picked — that is the only image type the clipboard reliably accepts, and the button says so. Copying can also fail outright (no clipboard permission, a browser that will not do images); you get "Copy failed — try downloading instead" rather than an error.
- **The JPG quality is remembered.** Setting it in the converter, resizer or compressor saves it as a shared default for all three, the moment you leave the box. It is the only thing these tools ever save, and it appears on the Preferences page under "Remembered values". The background remover's own quality is not remembered.
- **Sizes are decimal.** 1 KB is 1 000 bytes and 1 MB is 1 000 000, which is not what Windows Explorer means by those words.

### Converter

- **GIF and HEIC are not accepted.** Either one gives "Unsupported file type." Only SVG, AVIF, WebP, TIFF, PNG and JPG go in.
- **A multi-page TIFF loses everything but the first page,** and exotic TIFF compression is refused with a message rather than a broken picture.
- **An SVG is rendered by your browser,** at the width you name. Fonts and any external references inside it are subject to what the browser will load — what you see in the preview is what you get.
- The converter never offers PNG→PNG or JPG→JPG; use the compressor to re-encode a file in its own format.

### Resizer

- Enlarging past 100 % (or above the original pixel dimensions) invents no detail — it stretches what is there.
- With the aspect ratio locked, both boxes are derived from the *original* proportions, not from each other's current values, so nothing drifts as you type back and forth.

### Compressor

- **A target may simply not be reachable,** and the tool says so instead of pretending. JPG will not go below quality 20 and neither format will shrink below 5 % of the original edge length, so a very small budget on a very large picture ends in "Target NOT reachable".
- **PNG has only one lever.** A PNG target that needs a big cut can only be met by shrinking the picture; the note under the target says as much.
- Target mode re-encodes the whole picture for every probe, so it takes a moment on a large photo. Changing any setting mid-search abandons that search silently and starts the new one.
- The output format always follows the input. To turn a PNG into a JPG, use the converter.
- Re-compressing a JPG at a high quality can produce a *larger* file than the one you started with; the savings figure goes positive with a `+` when that happens.

### Background remover

- **The download is one-off but not permanent.** 15.8 MB is kept in its own storage, untouched by app updates, so one online visit is enough to make the tool work offline forever after. Clearing site data, or **Remove downloaded model**, means fetching it again. In a private window (or anywhere the browser refuses that storage) the files are re-fetched every session and the state line keeps saying "Not downloaded".
- **Fine detail is where it struggles** — flyaway hair, glass, and edges that barely contrast with what is behind them. That is what the touch-up brushes are for; the image editor can also erase and restore by hand.
- **It always finds *something*.** The model looks for the most salient object, so a picture with no obvious subject still gets a region highlighted rather than an empty result.
- Saving as JPG with a transparent background gives you a white background, and the tool warns before you do it. Pick a solid colour, or save a PNG.
- Sliders and brushes never re-run the model; only **Remove background** / **Run again** does. Running it again keeps your brush strokes.
