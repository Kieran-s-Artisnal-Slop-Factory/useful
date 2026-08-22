# Image editor

A layered photo editor under **Images** in the sidebar (or Ctrl/Cmd+K), for annotating and touching up a picture: crop, rotate, draw, arrows, text, blur, background removal, and a metadata panel. Nothing is ever baked in — every mark is a layer, so deleting a crop un-crops and deleting a background mask brings the background back. It is deliberately **session-only**: the whole document lives in this browser tab and is gone the moment you leave, so exporting is the only way to keep anything.

_Describes the code as of v0.3.0 (unreleased; schema v12) — verify against source when in doubt._

## Starting

Two ways in:

- **Start from an image** — PNG, JPG, WebP, AVIF, TIFF or SVG. The first image becomes the bottom layer, sets the canvas size, and is the one whose metadata the panel reads.
- **Start from a blank canvas** — a width and a height up to 8192 px, either **Transparent** or a background colour. A colour becomes a real layer named "Background", which you can hide, recolour or delete later.

Once you are in, **Add image layer** brings more pictures in as extra layers, **Resize canvas** changes the document size, and **New session** throws everything away (after a confirmation, if you have layers). Zoom is the −, **+**, **Fit** and **100%** buttons; it changes only how big the picture looks, never the picture.

## Layers and nesting

The layer list shows the topmost layer first. Each row has an eye to hide it, ▲ and ▼ to move it, ⤵ and ⤴ to nest it under the layer below or lift it back out, and ✕ to delete it. You can also drag a row: dropping on the top or bottom edge of another row places it above or below, and dropping on the middle nests it inside. **Remove all** clears the list.

Layers come in two sorts, and the difference is the thing worth understanding:

- **Content layers** put pixels on the canvas: images, brush strokes, arrows, text, colour fills, and groups.
- **Effect layers** change what is already there: eraser, restore, crop, darken, lighten, blur, and the background mask.

**An effect nested under a layer changes only that layer. The same effect at top level changes everything below it.** Crop an image with the crop nested under it and the image is cropped inside an unchanged canvas; put the crop at top level and the whole picture is cropped. The same is true of erasers, blurs and everything else in that list. Content nested under a layer is clipped to it, so a colour fill under a photo tints only the photo.

The line under the tool buttons always says where new marks will land — "the whole canvas (top level)", the name of the selected layer, or the group you are inside — and offers **Deselect** to get back to the whole canvas. Groups can hold anything, images included; images themselves can only sit at top level or inside a group.

Selecting a layer opens **Layer settings**: its name, **Opacity**, a **Blend mode** (Normal, Multiply, Overlay, Soft light, Hard light, Color), and the numbers for its kind. Image layers also get **⟳ Rotate 90°** and, with the Move tool, eight square handles on the canvas — corners keep the aspect ratio, edges stretch one axis, and sub-layers scale along with the image.

## Tools

| Tool | What it does |
| --- | --- |
| Move | Select a layer by clicking it; drag to move it. An image carries its sub-layers. |
| Crop | Drag a rectangle (or type one and press **Set**), then **Apply crop**. |
| Brush | Draws a smooth stroke in the tool colour and size. |
| Eraser | Rubs out. Under a layer it erases just that layer; at top level, everything below. |
| Restore | Un-erases: paints the original pixels back wherever you brush. |
| Arrow | Drag from tail to head. |
| Text | Type into **Text to place**, then click where you want it. |
| Darken / Lighten | Drag a rectangle to tint it, at a **Strength** you set. |
| Blur | Drag a rectangle to blur it, at a **Strength** you set. |

Rotation, crops and scaling are all recorded as instructions rather than applied to pixels, so nothing degrades and everything is reversible by deleting the layer that did it.

## Removing a background

Select an image layer and press **Remove background**. The first run downloads about 15.8 MB — the same segmentation model the [background remover](images.md) tool uses, kept in its own storage and shared between the two — with a percentage in the status line.

The result is a mask layer named "Background removed", nested under that image. Only that image is cut out; other layers are untouched. Deleting the mask brings the background straight back, and the mask moves, scales and rotates with its image.

The editor has no cutoff or feather sliders — corrections here are the Eraser and Restore tools, or the standalone background remover, which has brushes and sliders of its own.

## Metadata

The **Metadata (EXIF)** card lists what was found in the very first image you imported: camera, lens, dates, exposure, and anything else readable, in an expandable table. Images added later as extra layers are never read.

Two choices govern what an export carries:

- **Strip all metadata (default)** — the exported file has none at all.
- **Embed edited fields (JPG exports only)** — fills in **Artist**, **Copyright**, **Description** and **Date taken** from the boxes below, and nothing else.

Re-encoding an image strips everything by definition, so those four fields are not "kept" from the original — they are written fresh from what you typed, prefilled from the original where it had them. **GPS never survives**, in either mode. PNG exports never carry metadata at all.

## Exporting and undo

The **Export** card takes a **File name**, a format of PNG or JPG (with a quality setting for JPG), and gives you **Download** or **Copy (always PNG)**. The exported picture is always the full document size, whatever the zoom is set to.

**↶** and **↷** beside the zoom buttons undo and redo, as do Ctrl/Cmd+Z and Ctrl/Cmd+Y (or Ctrl/Cmd+Shift+Z). About sixty steps are kept. A whole brush stroke, a slider drag or a burst of typing counts as one step, while two separate additions count as two.

## Gotchas

- **This is session-only. Closing or reloading the tab loses everything.** There is no autosave, no document list and no recovery. Export what you want to keep, before you navigate away.
- **Nothing is written to the app's database.** Unlike the SVG editor, an image-editor session is not in Settings → Backup, does not sync, and leaves no trace. That is deliberate: a picture cannot round-trip the app's storage, and a document that saved its settings but lost its pixels would be worse than one that saved nothing.
- **Nothing is uploaded.** Decoding, editing, background removal and export all happen on this device.
- **Large images use memory,** and the whole layer stack is re-composited on every single change with nothing cached. A big canvas with many layers and effects — especially rotated images — will start to feel slow. Working at a sensible size is the fix.
- **"New session" is undoable, but only right then.** It counts as a step, so Ctrl/Cmd+Z on the start screen brings the discarded document back. Reloading the page does not.
- **Restore has to sit above what it is reversing.** It paints back the pixels as they were underneath it, so a restore stroke below an eraser or a background mask does nothing. A stroke you have just made is in the right place already; otherwise drag it higher in the list.
- **Only the first image's metadata is read.** Extra image layers are decoded and drawn, never inspected, and their metadata is not offered anywhere.
- **GPS can never pass through**, and neither can any original tag: only the four fields you can type, and only into a JPG.
- **A background mask is a snapshot of that moment.** It covers the image's rectangle as it was when the model ran; editing the image afterwards does not re-run it. Remove the mask and run it again if the image has changed a lot.
- **The numeric size boxes on an image resize the image alone.** Only the on-canvas handles carry its sub-layers (a crop, a mask) along with it.
- Colour fills have no outline to click, so select them from the layer list rather than the canvas.
- A colour fill takes any CSS colour you can write — `transparent`, `rebeccapurple`, `#ff000080`, `rgb(255 0 0 / 50%)` — plus a slider for how see-through it is, and Transparent/White/Black shortcuts. The colour's own transparency and the layer's opacity multiply, and the layer list shows only the opacity, so a 50%-transparent colour at 50% opacity is a quarter visible.
- Type something that is not a colour and the layer paints nothing at all (the box turns red). That is deliberate: it used to paint solid black over your picture.
- A crop rectangle under 4 × 4 px and an arrow shorter than about 8 px are ignored, so a stray click does not add an invisible layer.
- JPG exports flatten transparency onto white and clipboard copies are always PNG, exactly as in the other image tools. When the picture actually has see-through pixels and JPG is selected, the export card says so before you click.
