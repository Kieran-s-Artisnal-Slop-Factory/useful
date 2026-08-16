/**
 * The engines that ship with the components, as a ready-made list for the
 * playground's `engines` prop.
 *
 * Importing this pulls both adapters into the bundle — but only their tiny
 * adapter modules: the WASM engine, its worker and the CodeMirror dialect are
 * all behind dynamic imports, so an engine nobody picks never downloads.
 */
import type { RuntimeAdapter } from './types';
import { sqliteAdapter } from './adapter';
import { pgliteAdapter } from './pglite-adapter';

export { sqliteAdapter, pgliteAdapter };

/** SQLite first — it boots in a fraction of the time Postgres does. */
export const engines: RuntimeAdapter[] = [sqliteAdapter, pgliteAdapter];

/** Look an engine up by id, for restoring a remembered choice. */
export const engineById = (id: string | null | undefined): RuntimeAdapter | undefined =>
  engines.find((engine) => engine.id === id);
