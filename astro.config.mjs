// @ts-check
import { defineConfig } from 'astro/config';

import svelte from '@astrojs/svelte';

// https://astro.build/config
export default defineConfig({
  // Serving under a sub-path (e.g. GitHub Pages at https://you.github.io/useful/)?
  // Uncomment and set the base — every in-app link, the service worker, and the
  // manifest already resolve through it (src/lib/paths.ts). Leave it off when
  // serving at the domain root (the default, and how the backend serves it).
  // base: '/useful',
  integrations: [svelte()],
  vite: {
    // onnxruntime-web (background remover) ships its own wasm loader and
    // expects to resolve it relative to itself. Pre-bundling rewrites that
    // dynamic import to a .vite/deps path that 404s at runtime, so the dev
    // server must serve the package as-is; src/lib/bg/runtime.ts pins the
    // loader path for the production build.
    optimizeDeps: { exclude: ['onnxruntime-web'] }
  }
});
