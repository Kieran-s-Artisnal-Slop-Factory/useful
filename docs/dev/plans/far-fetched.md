# Far-fetched

Ideas that were asked for, taken seriously, and **not** built — with the
reason, and where possible with the measurement that produced it.

This file exists because a "no" with nothing behind it gets re-litigated every
release. [version-3-phased.md](version-3-phased.md) has pointed here since
0.3.0; it is written now because 0.4.0's Phase 6 produced the first entry with
real numbers attached.

A "no" here is not permanent. Each entry says what would have to change.

---

## Placeholder text from an in-browser LLM

**Asked for:** twice — 0.3.0 (Q11) and 0.4.0 (Q4, Phase 6). "An in-browser LLM
to generate text via a prompt" on the placeholders page.

**Verdict: no.** 0.3.0 answered from reasoning. 0.4.0's plan said that was not
good enough — *"it gets a real prototype this time instead of a verdict from
the armchair"* — so one was built. The answer did not change, and now it has
evidence under it.

### What was measured

Sizes are the real `Content-Length` of the ONNX files, taken from the
HuggingFace API on 2026-08-31, not estimates:

| Model | Follows instructions? | Smallest ONNX weights | + tokenizer | Total |
| --- | --- | --- | --- | --- |
| distilgpt2 (int8) | **no** — base LM | 81.0 MB | ~1 MB | ~82 MB |
| gpt2 124M (int8) | no | 122.4 MB | ~1 MB | ~123 MB |
| **SmolLM2-135M-Instruct (q4f16)** | yes | 111.8 MB | 3.4 MB | **115.2 MB** |
| SmolLM2-135M-Instruct (int8) | yes | 129.4 MB | 3.4 MB | 132.8 MB |
| LFM2.5-230M (q4) | yes | 201.3 MB | 4.5 MB | 205.9 MB |
| LFM2.5-350M (q4f16) | yes | 243.2 MB | 3.1 MB | 246.5 MB |
| LFM2.5-350M (q4) | yes | 280.0 MB | 3.1 MB | 283.3 MB |
| LFM2.5-350M (int8) | yes | 486.3 MB | 3.1 MB | 489.6 MB |
| Qwen2.5-0.5B-Instruct (q4) | yes | 749.7 MB | 6.7 MB | 756.4 MB |
| LFM2.5-1.2B-Instruct (q4f16) | yes | 725.1 MB | 3.1 MB | 728.2 MB |

**115 MB is the floor**, and it belongs to SmolLM2-135M-Instruct. Nothing
instruction-tuned that runs in a browser is smaller.

For scale, from this repo's own precache audit:

- **the entire app**, every route and every lazy chunk: **22.4 MB**
- the largest existing opt-in download (background remover: U²-Net + ORT
  wasm): **15.8 MB**
- the threshold at which the TODO itself says a download needs an opt-in:
  **10 MB**

So the smallest model that can follow a prompt at all is **five times the
whole application**, for filler text.

### The purpose-built on-device models, specifically

The obvious objection to the table above is that distilgpt2 is a 2019 base
model and the question should be asked of something built for this — Liquid
AI's LFM2/LFM2.5 family being the current answer, instruction-tuned and
designed for edge inference. That objection is **right about the model and
does not change the outcome**, so it is worth writing down rather than
leaving for someone to raise again:

- The quality argument against distilgpt2 — cannot follow a prompt, loops —
  does **not** apply to LFM2.5. It would very likely produce good filler.
- It fails the other half of the bar, harder. `LFM2.5-350M` q4f16 is
  **246.5 MB**: eleven times this whole application, sixteen times the
  largest opt-in download it already has.
- Going smaller in the same family does not rescue it. `LFM2.5-230M` q4 is
  the smallest LFM2.5 ONNX at any size — **205.9 MB**, still nine times the
  app, and a 230M model is no longer obviously better than SmolLM2-135M at
  half the bytes.
- The wasm caveat makes it worse in practice. `q4f16` assumes fp16, which is
  a WebGPU path; the honest wasm-safe choice is q4 (283 MB) or int8
  (490 MB), and WebGPU is not something a tool like this can require.

So the ranking by *quality per megabyte* changes with LFM2.5, and the verdict
does not: the smallest thing that can do the job is 115 MB, the best thing
that can do the job well is ~246 MB, and the job is lorem ipsum.

### What was run

A working prototype, not a thought experiment: `Xenova/distilgpt2`
`decoder_model_merged_quantized.onnx` (81 MB) through the
`onnxruntime-web` this repo already ships, with a hand-written GPT-2
byte-level BPE tokenizer and a KV-cached sampling loop. The pipeline was
verified correct — a plain continuation prompt produced fluent, grammatical
English, which does not happen with a broken tokenizer or a mismanaged cache.

Then, on the actual task:

```
PROMPT  Write a short product description for a ceramic coffee mug.
OUTPUT  (sixty newlines)

PROMPT  Write a product description for a ceramic coffee mug:
OUTPUT  " a coffee mug for a coffee mug for a coffee mug for a coffee mug…"

PROMPT  Our accounting software helps small businesses
OUTPUT  " small businesses businesses businesses accounting for small
         businesses accounting for small businesses accounting for…"
```

A second pass gave the model every advantage — few-shot framing with two
worked examples, a repetition penalty, tuned temperature and top-p. The
few-shot case responded by reproducing one of the examples verbatim. Every
case degenerated into a loop.

Speed, on a fast desktop CPU: **~2.2 s per 70 tokens**, so roughly five
seconds for one paragraph.

### Why the answer is no

1. **It cannot do the thing that was asked.** The request is "generate text
   *via a prompt*". A distilgpt2-class model is a base language model with no
   instruction tuning — it continues text, it does not follow instructions,
   and the transcripts above are what that looks like. This is a property of
   the model class, not a tuning problem.
2. **The tier that can follow a prompt starts at 115 MB.** Against a 22.4 MB
   app, for placeholder text — and the models actually designed for on-device
   use, which would be the ones worth having, start at 206 MB.
3. **Quality is worse than what already ships.** The corpora produce
   `Lorem ipsum dolor sit amet, consectetur…` and *"Going forward, the
   leadership team needs to socialise the strategic roadmap before we circle
   back"*. Both are instant, both are correct every time. Degenerate loops are
   not an improvement at any download size.
4. **It would cost properties the corpora have.** Generation is seeded through
   [random.ts](../../../src/lib/random.ts), so the same seed gives the same
   text and re-generating is a no-op diff. It is also instant. A five-second
   wait for worse filler is a bad trade twice over.

### What would change it

- An instruction-following model **under ~15 MB** that produces coherent prose
  — the size band the background remover already proved people will accept.
  Nothing at that size does this today; the smallest is ~8× it, and the trend
  in this family is towards *better small models*, not *smaller good ones*.
- Or the browser growing a built-in text model behind a standard API, so the
  bytes are not this app's to ship. `window.ai` / the Prompt API is the thing
  to watch: it would move this from "download 115 MB" to "call a function",
  and the answer flips the day it is broadly available. It is not, yet.
- Or a decision that this tool is allowed to be an order of magnitude bigger
  than it is, for this one feature. That is a project-shape decision, not a
  technical one, and it is the honest way to say yes if someone wants to:
  the delivery machinery is already built and proven by the background
  remover — opt-in gesture, progress, a Cache Storage bucket outside the
  service worker's purge prefix, listed and deletable in the Offline panel.
  Nothing about Phase 6's scope items 2–4 is hard. Only the number is.

Until then the seeded corpora stay the whole feature, and the placeholders
page does not pretend otherwise.

---

## Escaping CORS with a desktop build

**Asked for:** 0.4.0's TODO — "push someone towards downloading the app
version" when a request fails CORS.

**Verdict: no**, and it shipped as an explanation instead (0.4.0 decision 6,
Q3). There is no desktop build to point at, and installing the PWA changes
nothing: an installed web app is still a browser page under the same rules,
so a prompt to install it would be a lie. A Tauri or Electron wrapper whose
webview fetches without CORS is real work with its own release train and its
own update story.

**What would change it:** a decision to actually ship and maintain a desktop
build, as a project, not as a footnote to a browser tool.

---

## The HTTP playground

Listed here by 0.3.0 and **built** in 0.4.0 (phases 3–5). Kept in this file as
a note rather than deleted: it is the entry that shows a "far-fetched" verdict
is about the moment, not forever. What changed was scope — the thing that made
it tractable was accepting that CORS could not be escaped and building the
explanation into the tool instead of fighting it.
