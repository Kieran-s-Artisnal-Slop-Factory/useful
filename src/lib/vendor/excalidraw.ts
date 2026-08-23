/**
 * The one import of `@excalidraw/excalidraw`, behind a module of our own.
 *
 * Exists for a chunk name. The package's entry is `dist/prod/index.js`, so
 * left to itself the bundler emits its code as `prod.<hash>.js` and
 * `chunk-XXXX.<hash>.js` — names nothing can recognise, which made the
 * `/excalidraw/i` matcher in payload.spec.ts vacuous. A dynamic import of THIS
 * module gives the chunk this module's name, `excalidraw.<hash>.js`, and
 * because nothing else imports the package its code lands in the same chunk.
 * (A rolldown `codeSplitting` group was tried first and rejected: with
 * dependencies included it pulled shared helpers into the 4.8 MB chunk, so
 * every page imported it; without them it clashes with Astro's
 * `preserveEntrySignatures`.)
 */
export * from '@excalidraw/excalidraw';
