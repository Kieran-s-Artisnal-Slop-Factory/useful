# Placeholders

**Placeholders** (under Generators, or Ctrl/Cmd+K) makes filler text and filler images. Everything is drawn on your device — no image is ever downloaded — and nothing is saved.

_Describes the code as of v0.5.0 (schema v16) — verify against source when in doubt._

## Filler text

Two kinds:

- **Lorem ipsum** — the classic, the same word list every other lorem generator uses.
- **Office speak** — written for this app: *"Going forward, the steering committee need to socialise the cross-functional action items before the next sprint."*

Choose paragraphs, sentences or words, set a count, and copy or download. **Wrap paragraphs in `<p>`** gives you HTML instead of plain text.

The **seed** is what makes it repeatable: the same seed always produces the same text, so you can regenerate the exact same filler tomorrow, or on another machine.

## Filler images

Nine generators, all of them drawn from your settings. Each one in the picker carries a small example of its default look, so you can see what a generator does before choosing it; the big preview below is the one that follows your controls.

| Generator | What it looks like |
| --- | --- |
| Plain colour | A rectangle. The honest placeholder. |
| Colour with a caption | A heading and sub-heading, centred and sized to fit. |
| Gradient | Linear or radial, your colours. |
| Noise | Fine grain, tinted, optionally blurred. |
| Flow field | Streamlines curving through the frame. Set how many. |
| Layered geometry | Many small overlapping translucent shapes. Set how solid they are. |
| Cut planes | A few big diagonal slabs that fill the frame, in colours built from your background. |
| An icon | Any of about two thousand Lucide icons, on any background, at any size. |
| A drawn scene | Fifteen hand-drawn pictures — five each of nature, sport and city. |

Set the **size** directly, or use a ratio button (16:9, 4:3, 3:2, 1:1, 9:16) or a size preset. With **Keep the aspect ratio** ticked, typing one side moves the other and leaves what you typed alone.

## Getting them out

- **Download** — as SVG (tiny at any size), PNG or JPG.
- **Download the batch** — *n* variations as one `.zip`, named so they sort in order.
- **Copy the SVG** — the markup, to paste straight into a page.

## Gotchas

- **The seed is the whole trick.** Change the seed for a different picture with the same settings; keep it to get the same one back. A batch is just the seed varied per image, so image 3 of a batch is what that seed draws on its own.
- **SVG scales, PNG does not.** A 4000-pixel PNG of a gradient is megabytes; the SVG is under a kilobyte and looks right at any size. Only reach for PNG or JPG when something downstream cannot read SVG.
- **A caption is fitted, not wrapped.** A very long heading gets small rather than moving onto a second line.
- **There is no conic gradient here.** SVG does not have one — the gradient tool's conic option cannot be drawn into a file, so it is missing rather than quietly turned into something else.
- **The icon set is big.** About 2 MB, fetched the first time you pick the icon generator and never before, so the other eight generators cost nothing.
- **The photo links leave the app.** The last card links to Unsplash, Pexels, Pixabay and placehold.co — those are external sites. Everything else here works with no network at all. Read each site's licence before shipping someone else's photograph: "free to download" and "free to use in your product" are different sentences.
- **Nothing is saved.** Reloading starts fresh — but the same seed and settings bring the same result back.
- **There is no "write it with AI" mode, on purpose.** It was tried: a small language model was actually downloaded and run against this, twice across two releases. The models small enough to be worth downloading cannot follow an instruction — they continue text rather than responding to it, and ask one for a product description and you get a paragraph looping on itself. The smallest one that *can* follow a prompt is about 115 MB, roughly five times the size of this whole app — and the models actually built for running on your device, which would be genuinely good at this, are 206 MB and up. The corpora here are instant, and the same seed gives the same text every time, which a model would not. If browsers ship a built-in text model behind a standard API, that changes; the reasoning and the sample output are in `docs/dev/plans/far-fetched.md`.
