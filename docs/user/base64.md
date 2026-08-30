# Base64

**Base64** (under Images in the sidebar, or Ctrl/Cmd+K) turns text or a file into base64 and back again. Nothing you paste or choose is uploaded anywhere or saved — it is all done in the tab.

_Describes the code as of v0.4.0 (unreleased; schema v13) — verify against source when in doubt._

## Text

1. Leave **Working with** on *Text* and pick a **Direction**: encode, or decode.
2. Type or paste into the box. The result appears underneath as you type, with **Copy** and **Download**.
3. Three options change the output: the **URL-safe alphabet** (`-` and `_` instead of `+` and `/`), whether to **pad with `=`**, and whether to **wrap at 76 columns** the way email does.

If a string you are decoding is not base64, the page says so and points at the character where it stopped being base64, with the text either side of it.

## An image or a file

Switch **Working with** to *An image or a file*.

- **Encoding**: choose or drop a file. You get its real type, its size on disk, its size as base64, a preview if it is an image a browser can draw, and the `data:` URL. Four copy buttons cover what people actually paste: the data URL, the base64 on its own, a CSS `background-image` line, and an `<img>` tag.
- **Decoding**: paste raw base64 or a whole `data:` URL. The page identifies what the bytes are, previews it if it can, and offers a download with the right extension.

## Gotchas

- **Base64 is not encryption.** It is a way to carry bytes through something that only accepts text. Anyone can decode it, instantly, with no key.
- **It makes things a third bigger.** Every 3 bytes become 4 characters, so a 900 KB photo becomes about 1.2 MB of text. A data URL that size in a stylesheet is downloaded in full before the page renders and cannot be cached separately from it — the page warns you above a megabyte.
- **The type comes from the bytes, not from the label.** Paste a data URL that claims to be a JPEG but contains a PNG and this tool will tell you it is a PNG. That is deliberate: the label in a data URL is a claim, the bytes are the evidence.
- **Decoding text that is not text fails on purpose.** If the bytes decode but are not valid UTF-8, the page says so rather than showing a screen of replacement characters. Use the image side and download the file instead.
- **Nothing is saved.** Reloading the page starts empty.
