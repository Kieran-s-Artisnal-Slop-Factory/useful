# SVG editor

A layered vector drawing tool under **Images** in the sidebar (or Ctrl/Cmd+K). A document is a canvas size, a background, and a stack of layers — rectangles, ellipses, triangles, stars, lines, polygons, text, and SVG markup you paste in. You move and shape layers on the canvas by dragging handles, and every finished change is saved for you a moment later. Documents stay editable forever because the shapes themselves are stored, not a picture of them; you export SVG, PNG or JPG whenever you want a file.

_Describes the code as of v0.2.0 (unreleased; schema v7) — verify against source when in doubt._

## Documents

The first screen is the document browser. Type a name and press **Create** — you get a 256 × 256 white canvas with no layers — or click an existing document's name to reopen it, newest first. **Delete** asks first and removes it. **All documents** at the top right takes you back.

Whichever document you had open last reopens automatically the next time you visit the page.

**Saving happens on its own.** After every finished change — a drag you let go of, a field you leave, a colour you commit, a button you press — the editor waits a fraction of a second and then saves. The line beside the Undo/Redo buttons reads **Saving…** and then **Saved**. Leaving the page, hiding the tab or switching documents saves immediately rather than losing the pending write. Half-typed values do not get saved: only settings you have actually committed are written.

The **Canvas** card holds the document's own settings: **Name**, **Width** and **Height** (16 to 4096 px), a **Transparent** tick box, and a **Background** colour when it is not transparent.

## Layers

The buttons at the top of the **Layers** card add one of eight kinds:

| Kind | What it is |
| --- | --- |
| Rect | A rectangle, with an adjustable corner radius |
| Ellipse | An oval — width and height are independent |
| Triangle | An apex-up triangle filling its box |
| Star | A five-pointed star |
| Line | Two endpoints, optionally bent into a curve |
| Polygon | A shape with movable points, starting as a pentagon |
| Text | A short piece of text, up to 64 characters |
| Paste SVG | SVG markup you paste in, scaled to fit its box |

New layers land in the middle of the canvas, sized to about half the shorter canvas edge, in amber (a line gets an amber stroke and no fill; text starts white). The layer list shows the topmost layer first; ▲ brings a layer forward, ▼ sends it back, ✕ deletes it.

Selecting a layer opens the **Layer** card: position (X, Y), size, rotation, **Fill** and **Stroke** (each with an on/off tick and a colour), stroke width, and then whatever else that kind has — corner radius for a rectangle, the text and a **Bold** tick for text, curve settings for a line, point tools for a polygon, a markup box for a pasted SVG. For text, "Width" is called **Box width** and "Height" is the **Font size**.

A pasted SVG keeps its own colours: it is scaled to fit the layer's box and the Fill control does not apply to it. The markup needs a proper `<svg>` root or the layer says so and draws nothing.

## Moving, resizing and rotating

Click a layer on the canvas, or in the list, to select it. Then:

- **Drag anywhere on it** to move it. Its centre stays on the canvas, so a large layer can still hang over the edge.
- **Drag a corner square** to resize. Resizing works in the layer's own rotated frame, and the opposite corner stays put.
- **Rotation** is a slider from −180° to 180°, turning the layer about its own centre.
- **Arrow keys** nudge the selection by 1 unit, or 10 with Shift held.
- **Delete** or **Backspace** removes the selected layer, **Escape** deselects.

Selection is by rectangle, not by outline: the topmost layer whose box contains the point wins, so clicking the hollow middle of a ring still selects the ring, and a small layer hiding under a big one is easiest to reach from the layer list.

**Undo** and **Redo** are buttons, and Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z and Ctrl/Cmd+Y. Up to 100 steps are kept.

## Curves and polygon points

A **line** has a **Curve** setting: Straight, Curved (1 control) or Curved (2 controls). Each control appears on the canvas as a round handle joined to the line by a dashed guide; drag it to shape the curve. The two endpoint handles are draggable too.

A **polygon** shows a round handle for every point. Drag them to reshape it, and use:

- **Add point** — inserts a new point after the selected one (or the last one).
- **Remove point** — disabled at three points; a polygon never goes below that.
- **Curve edge** / **Straighten edge** — bends the edge leaving the selected point, giving it its own draggable handle, or removes the bend again.
- **Reset as regular** — replaces the points with a regular 3-, 4-, 5-, 6-, 7-, 8-, 10- or 12-sided shape, sized to the layer's box.

Click a point to select it first; the line under the buttons says which point is selected and how many there are.

## Subtract

With more than one layer in the document, a selected layer gains **Subtract another layer from this one**. Choose the cutter and its silhouette is punched out of the selected layer.

It works between any two kinds, because it cuts by shape rather than by geometry: a stroked line slices a rectangle in two, text punches letters out of a shape, a pasted icon stamps its outline. The result replaces both layers with a single baked layer at the base's place in the stack.

## Exporting

The **Export** card writes a file from exactly what the canvas shows.

- **SVG** — **Download** saves the markup, **Copy SVG text** puts it on the clipboard as text.
- **PNG** and **JPG** — set a **Width (px)** from 16 to 8192 and the height follows the canvas proportions (the line beside it shows the result). JPG adds a quality setting. **Download** saves the picture, **Copy (always PNG)** puts it on the clipboard.

The filename comes from the document name, with characters a filesystem will not take replaced by underscores, falling back to `drawing`. Exporting changes nothing about the document.

## Gotchas

- **Documents are saved automatically and live in this browser only.** There is no account and no server. They survive restarts and are included in Settings → Backup, but clearing site data or using a different browser or device means they are not there. Export a file for anything you cannot afford to lose.
- **Deleting a document is permanent from your side** and is only confirmed once.
- **Subtract consumes both layers.** The base and the cutter are both gone, and the result is baked markup — no more points, no fill control, nothing parametric. One undo brings both originals back, but once you close the document that history is gone.
- **JPG loses transparency.** A transparent background, or anything see-through in the drawing, is flattened onto white in a JPG export. Export PNG or SVG to keep it. The Export card says so when JPG is selected.
- **Clipboard images are always PNG.** With PNG or JPG selected, the copy button hands over a PNG whatever you picked. SVG copies as text, not as an image.
- **Undo history is per open document and only in memory.** Opening another document, or reloading, starts a fresh history. Nothing is lost — the saved document is your last committed state — but you cannot step back past the moment you opened it.
- **Typed values only count when you leave the field.** The canvas updates as you type, but nothing is committed, undoable or saved until the field loses focus. Emptying a number field and leaving it puts the last committed value back rather than accepting a blank.
- **Text is not measured.** Its Box width is only a hint for the selection rectangle and for subtract; the text itself is drawn at the font size, centred, and can spill outside the box.
- **Pasted markup is embedded as it is.** Whatever you paste ends up in the exported file. Two pastes from the same source will not clash over internal names, but style rules inside a pasted block are not isolated and can affect other pasted layers. Nothing pasted ever runs as code in the app.
- Canvas size is limited to 16–4096 px and export width to 8192 px; anything outside is pulled back into range when you commit it.
- A line always draws a visible stroke — turning its stroke off falls back to amber rather than making it invisible.
- The only thing the page remembers outside the documents themselves is which document you had open last, listed on the Preferences page. Deleting that document simply means the browser opens on the document list next time.
