/**
 * Background removal — the browser half: asset delivery and inference
 * (plan §3.4). Pure math lives in pipeline.ts.
 *
 * Delivery model, and why it looks like this:
 *  - Both assets are SELF-HOSTED (vendored by tools/build-bg-assets.mjs) and
 *    excluded from the service worker's install precache, so an install stays
 *    small for the ~everyone who never opens this tool.
 *  - They are downloaded on an explicit user gesture, with progress, and kept
 *    in a Cache Storage bucket the SW also reads from — one online visit and
 *    the tool works offline forever after.
 *  - That bucket is NOT named with the app's cache prefix on purpose: the SW
 *    purges `useful-cache-*` on every version bump, and re-downloading 15MB
 *    because a stylesheet changed would be indefensible.
 *  - The model and the runtime's wasm are handed to ONNX Runtime as BYTES we
 *    already hold (env.wasm.wasmBinary), so the two big files are never
 *    fetched twice; only ORT's 20KB loader module is imported by URL, and the
 *    SW serves that from the same bucket when offline.
 */
import { href } from '../paths';
import { MODEL_SIZE, type SegmentRunner } from './pipeline';

/** Shared with public/sw.js — keep the two in sync if it ever changes. */
export const MODEL_CACHE = 'useful-models-v1';

export interface BgAsset {
  url: string;
  /** Expected size, so progress works even without a Content-Length. */
  bytes: number;
  label: string;
}

/**
 * ORT's loader module. The bundled build is documented as inlining it, but in
 * a production bundle it still ends up importing it as a sibling URL that
 * nothing emits — so we host it, name it here, and hand ORT the path below.
 */
export const ORT_LOADER_URL = href('/ort/ort-wasm-simd-threaded.mjs');

/** Sizes are the vendored files' real sizes (public/models/PROVENANCE.txt). */
export const BG_ASSETS: BgAsset[] = [
  { url: href('/models/u2netp.onnx'), bytes: 4_574_861, label: 'U²-Net model' },
  { url: href('/ort/ort-wasm-simd-threaded.wasm'), bytes: 11_210_254, label: 'ONNX Runtime' },
  { url: ORT_LOADER_URL, bytes: 20_856, label: 'ONNX Runtime loader' },
];

export const BG_TOTAL_BYTES = BG_ASSETS.reduce((sum, a) => sum + a.bytes, 0);

export interface DownloadProgress {
  /** 0..1 across ALL assets, weighted by their expected sizes. */
  ratio: number;
  received: number;
  total: number;
  label: string;
}

function cacheStorage(): CacheStorage | null {
  // Absent in insecure contexts and in some private-browsing modes; the tool
  // still works there, it just re-downloads each session.
  try {
    return typeof caches !== 'undefined' ? caches : null;
  } catch {
    return null;
  }
}

/** True when every asset is already in the cache (i.e. the tool works offline). */
export async function assetsReady(): Promise<boolean> {
  const store = cacheStorage();
  if (!store) return false;
  try {
    const cache = await store.open(MODEL_CACHE);
    for (const asset of BG_ASSETS) {
      if (!(await cache.match(asset.url, { ignoreVary: true }))) return false;
    }
    return true;
  } catch {
    return false;
  }
}

/** Drop the cached assets (Settings → "remove downloaded model"). */
export async function clearAssets(): Promise<void> {
  const store = cacheStorage();
  if (!store) return;
  try {
    await store.delete(MODEL_CACHE);
  } catch {
    // nothing cached / storage blocked — already in the desired state
  }
}

/**
 * Fetch one asset with byte-level progress and store it. Cached copies are
 * returned without touching the network, so this doubles as "load it".
 */
async function loadAsset(
  asset: BgAsset,
  onChunk: (bytes: number) => void
): Promise<ArrayBuffer> {
  const store = cacheStorage();
  const cache = store ? await store.open(MODEL_CACHE).catch(() => null) : null;
  const hit = await cache?.match(asset.url, { ignoreVary: true });
  if (hit) {
    onChunk(asset.bytes); // already here: count it as fully received
    return await hit.arrayBuffer();
  }
  const response = await fetch(asset.url);
  if (!response.ok) throw new Error(`${asset.label}: HTTP ${response.status}`);
  // Cache the untouched response, then stream our own clone for progress —
  // a Response body can only be consumed once.
  const forCache = response.clone();
  const reader = response.body?.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  if (reader) {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      received += value.byteLength;
      onChunk(value.byteLength);
    }
  } else {
    const buffer = new Uint8Array(await response.arrayBuffer());
    chunks.push(buffer);
    received = buffer.byteLength;
    onChunk(received);
  }
  const bytes = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  if (cache) await cache.put(asset.url, forCache).catch(() => undefined);
  return bytes.buffer;
}

/** Download (or read back) every asset, reporting combined progress. */
export async function loadAssets(
  onProgress?: (progress: DownloadProgress) => void
): Promise<{ model: ArrayBuffer; wasm: ArrayBuffer }> {
  let received = 0;
  const buffers: ArrayBuffer[] = [];
  for (const asset of BG_ASSETS) {
    buffers.push(
      await loadAsset(asset, (bytes) => {
        received += bytes;
        onProgress?.({
          // Servers can compress or the vendored size can drift — never let
          // the bar exceed 100% or run backwards.
          ratio: Math.min(1, received / BG_TOTAL_BYTES),
          received,
          total: BG_TOTAL_BYTES,
          label: asset.label,
        });
      })
    );
  }
  return { model: buffers[0]!, wasm: buffers[1]! };
}

// One session per page: creating it costs a wasm instantiation plus a 4.4MB
// graph parse, and nothing about it is per-image.
let sessionPromise: Promise<SegmentRunner> | null = null;

/**
 * Build (once) the runner the pipeline needs. `onProgress` only fires while
 * assets are actually downloading.
 */
export function getRunner(onProgress?: (progress: DownloadProgress) => void): Promise<SegmentRunner> {
  if (!sessionPromise) {
    sessionPromise = createRunner(onProgress).catch((err) => {
      sessionPromise = null; // a failed load must not poison later attempts
      throw err;
    });
  }
  return sessionPromise;
}

async function createRunner(onProgress?: (progress: DownloadProgress) => void): Promise<SegmentRunner> {
  const [{ model, wasm }, ort] = await Promise.all([
    loadAssets(onProgress),
    // The `/wasm` entry point is the CPU-only build — no WebGPU/WebNN code,
    // and only one wasm file behind it.
    import('onnxruntime-web/wasm'),
  ]);
  // Point ORT at OUR hosted copies. Left to itself the bundle imports
  // "./ort-wasm-simd-threaded.mjs" relative to its own chunk — a
  // /_astro/… URL no build step ever emits, which fails as "Failed to fetch
  // dynamically imported module". (A blob: URL built from bytes we already
  // hold would sidestep the fetch entirely, but a blob URL cannot act as the
  // base for the relative resolution the loader then does: "Invalid URL".)
  // The loader is a 20KB module the download step has already put in the
  // model cache, so the service worker serves it offline.
  // Dev is the exception: a module import of a file in public/ is exactly
  // what a dev server refuses to serve (it rewrites it to "…?import"), and
  // there the unbundled package resolves its own loader out of node_modules
  // perfectly well — so pin the path for production builds only.
  ort.env.wasm.wasmPaths = import.meta.env.PROD
    ? { mjs: ORT_LOADER_URL, wasm: href('/ort/ort-wasm-simd-threaded.wasm') }
    : { wasm: href('/ort/ort-wasm-simd-threaded.wasm') };
  // The 11MB of kernels are already in memory from that cache — hand them
  // over rather than making ORT fetch them again.
  ort.env.wasm.wasmBinary = wasm;
  // Threads need SharedArrayBuffer, which needs COOP/COEP headers a static
  // host cannot be assumed to send. Single-threaded SIMD is the portable path.
  ort.env.wasm.numThreads = 1;
  ort.env.logLevel = 'error';
  const session = await ort.InferenceSession.create(new Uint8Array(model), {
    executionProviders: ['wasm'],
    graphOptimizationLevel: 'all',
  });
  const inputName = session.inputNames[0]!;
  const outputName = session.outputNames[0]!;
  return async (input: Float32Array): Promise<Float32Array> => {
    const tensor = new ort.Tensor('float32', input, [1, 3, MODEL_SIZE, MODEL_SIZE]);
    const results = await session.run({ [inputName]: tensor });
    const data = results[outputName]!.data;
    return data instanceof Float32Array ? data : Float32Array.from(data as ArrayLike<number>);
  };
}

/** Test seam: drop the memoized session (used by nothing in production). */
export function resetRunner(): void {
  sessionPromise = null;
}
