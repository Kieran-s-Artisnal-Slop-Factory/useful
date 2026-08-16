/**
 * "Download everything for offline use."
 *
 * The service worker caches what you visit, and crawls the rest slowly in the
 * background — fine for a browser tab, not good enough for someone who just
 * installed the app and is about to get on a plane. This module is the
 * explicit version: a list of bundles, what each weighs, and one call that
 * fetches the lot with progress.
 *
 * Each bundle is honest about what it can know. The app's own chunks are the
 * service worker's business (only it can see the whole asset graph), the
 * segmentation model reports precisely because it lives in a cache we own, and
 * the database engines can only be verified by starting them — so they simply
 * run, which is also what caches them.
 */
import { assetsReady, BG_TOTAL_BYTES, loadAssets } from './bg/runtime';

export interface OfflineBundle {
  id: string;
  label: string;
  /** What it is, in one line, for the dialog. */
  detail: string;
  /** Approximate download size in bytes; 0 when it cannot be known upfront. */
  bytes: number;
  /**
   * Already available offline? `null` means "cannot tell without trying",
   * which is the honest answer for anything cached under a hashed URL.
   */
  ready(): Promise<boolean | null>;
  run(onNote?: (note: string) => void): Promise<void>;
}

/** Ask the service worker to walk the whole asset graph, now, unpaced. */
function warmAppAssets(onNote?: (note: string) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const worker = navigator.serviceWorker?.controller;
    if (!worker) {
      // No worker (dev build, first load before activation, or a browser with
      // service workers off) — nothing to warm, and saying so beats hanging.
      resolve();
      return;
    }
    const onMessage = (event: MessageEvent) => {
      const data = event.data as { type?: string; fetched?: number; error?: string } | null;
      if (!data?.type?.startsWith('useful-warm')) return;
      if (data.type === 'useful-warm-progress') {
        onNote?.(`${data.fetched} files cached`);
        return;
      }
      navigator.serviceWorker.removeEventListener('message', onMessage);
      if (data.type === 'useful-warm-done') resolve();
      else reject(new Error(data.error ?? 'The service worker could not cache the app'));
    };
    navigator.serviceWorker.addEventListener('message', onMessage);
    worker.postMessage({ type: 'useful-warm' });
  });
}

/** Every page + chunk of the app itself, including tools never opened. */
const appBundle: OfflineBundle = {
  id: 'app',
  label: 'The app itself',
  detail: 'Every page and code chunk, including tools you have not opened yet.',
  bytes: 0,
  async ready() {
    return null; // the worker knows; asking again is cheap and idempotent
  },
  run: (onNote) => warmAppAssets(onNote),
};

/** The background remover's model + runtime (the heavy optional one). */
const modelBundle: OfflineBundle = {
  id: 'bg-model',
  label: 'Background remover model',
  detail: 'U²-Net plus the ONNX runtime, so the tool works with no network.',
  bytes: BG_TOTAL_BYTES,
  ready: () => assetsReady(),
  async run(onNote) {
    await loadAssets((p) => onNote?.(`${Math.round(p.ratio * 100)}%`));
    // The tool also imports ORT's own (small) JS chunk on first use.
    await import('onnxruntime-web/wasm');
  },
};

/**
 * A database engine. Booting one is the only way to pull its wasm, and it is
 * also the only way to prove it works — so this both caches and verifies.
 */
function engineBundle(id: 'sqlite' | 'pglite', label: string, bytes: number): OfflineBundle {
  return {
    id,
    label: `${label} engine`,
    detail: `The SQL playground's ${label} database, compiled to WebAssembly.`,
    bytes,
    async ready() {
      return null; // cached under hashed URLs — starting it is the only test
    },
    async run(onNote) {
      onNote?.('starting');
      const { engines } = await import('./sql/engines');
      const engine = engines.find((e) => e.id === id);
      if (!engine) throw new Error(`Unknown engine ${id}`);
      const session = await engine.createSession();
      try {
        // A trivial statement forces the wasm to actually initialise.
        await session.exec('select 1;');
      } finally {
        session.destroy();
      }
    },
  };
}

/**
 * Rough sizes, used only for the dialog's copy: the wasm payloads are
 * fingerprinted build artifacts, so they are measured rather than declared.
 */
export const OFFLINE_BUNDLES: OfflineBundle[] = [
  appBundle,
  modelBundle,
  engineBundle('sqlite', 'SQLite', 1_200_000),
  engineBundle('pglite', 'Postgres', 12_000_000),
];

export const OFFLINE_TOTAL_BYTES = OFFLINE_BUNDLES.reduce((sum, b) => sum + b.bytes, 0);

export interface BundleProgress {
  id: string;
  state: 'pending' | 'running' | 'done' | 'failed';
  note?: string;
  error?: string;
}

/**
 * Download every selected bundle in order, reporting each one's state. Never
 * throws: a failed bundle is reported and the rest still run, because "the
 * Postgres engine didn't download" is no reason to skip the app's own pages.
 */
export async function downloadAll(
  bundles: OfflineBundle[],
  onUpdate: (progress: BundleProgress[]) => void
): Promise<BundleProgress[]> {
  const state: BundleProgress[] = bundles.map((b) => ({ id: b.id, state: 'pending' }));
  const push = () => onUpdate(state.map((s) => ({ ...s })));
  push();
  for (let i = 0; i < bundles.length; i++) {
    const bundle = bundles[i]!;
    state[i] = { id: bundle.id, state: 'running' };
    push();
    try {
      await bundle.run((note) => {
        state[i] = { id: bundle.id, state: 'running', note };
        push();
      });
      state[i] = { id: bundle.id, state: 'done' };
    } catch (err) {
      state[i] = {
        id: bundle.id,
        state: 'failed',
        error: err instanceof Error ? err.message : String(err),
      };
    }
    push();
  }
  return state;
}

/** True when the app is running as an installed PWA rather than in a tab. */
export function isInstalled(): boolean {
  try {
    return (
      window.matchMedia('(display-mode: standalone)').matches ||
      window.matchMedia('(display-mode: window-controls-overlay)').matches ||
      // iOS Safari's own flag, which predates display-mode.
      (navigator as unknown as { standalone?: boolean }).standalone === true
    );
  } catch {
    return false;
  }
}
