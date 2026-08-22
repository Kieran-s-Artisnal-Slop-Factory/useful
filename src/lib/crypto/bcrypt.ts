/**
 * The page's side of the bcrypt worker.
 *
 * bcrypt is the one password hash in this app: slow on purpose, with a cost
 * factor that can be raised as hardware gets faster, and a salt built into the
 * output string. Two facts about it are stated wherever it appears, because
 * both surprise people:
 *
 * - **The cost is exponential.** Cost 12 is four times the work of cost 10,
 *   not 20% more. The measured time comes back with every hash so the
 *   trade-off is visible rather than described.
 * - **bcrypt truncates at 72 bytes.** Everything past the 72nd byte of a
 *   passphrase is ignored — silently, in every implementation. A long
 *   passphrase is not the protection it looks like unless it is pre-hashed.
 */
import type { BcryptRequest, BcryptResponse } from './bcrypt-worker';

export const MIN_COST = 4;
/** Capped: cost 14 in pure JavaScript is several seconds of a spinning worker. */
export const MAX_COST = 12;
export const DEFAULT_COST = 10;
/** Bytes bcrypt reads before it stops looking. */
export const PASSWORD_LIMIT = 72;

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, { resolve: (value: BcryptResponse) => void; reject: (error: Error) => void }>();

function ensureWorker(): Worker {
  if (worker) return worker;
  // The `new URL(..., import.meta.url)` form has to appear literally here for
  // the bundler to see the worker as a module of its own.
  worker = new Worker(new URL('./bcrypt-worker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = (event: MessageEvent<BcryptResponse>) => {
    const entry = pending.get(event.data.id);
    if (!entry) return;
    pending.delete(event.data.id);
    entry.resolve(event.data);
  };
  worker.onerror = (event) => {
    const error = new Error(event.message || 'The bcrypt worker failed to start.');
    for (const [, entry] of pending) entry.reject(error);
    pending.clear();
    worker?.terminate();
    worker = null;
  };
  return worker;
}

function send(request: Omit<BcryptRequest, 'id'>): Promise<BcryptResponse> {
  const id = nextId++;
  const active = ensureWorker();
  return new Promise<BcryptResponse>((resolve, reject) => {
    pending.set(id, { resolve, reject });
    active.postMessage({ ...request, id } satisfies BcryptRequest);
  });
}

export interface HashResult {
  hash: string;
  /** Milliseconds the work actually took at this cost. */
  ms: number;
  /** True when the passphrase was longer than bcrypt will read. */
  truncated: boolean;
}

export async function hashPassword(password: string, cost = DEFAULT_COST): Promise<HashResult> {
  const clamped = Math.min(MAX_COST, Math.max(MIN_COST, Math.round(cost)));
  const response = await send({ type: 'hash', password, cost: clamped });
  if (!response.ok || !response.hash) throw new Error(response.error ?? 'bcrypt failed.');
  return {
    hash: response.hash,
    ms: response.ms ?? 0,
    truncated: new TextEncoder().encode(password).length > PASSWORD_LIMIT,
  };
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  const response = await send({ type: 'verify', password, hash });
  if (!response.ok) throw new Error(response.error ?? 'That is not a bcrypt hash.');
  return Boolean(response.valid);
}

/** Read the cost factor out of a `$2b$12$…` string, or null. */
export function costOf(hash: string): number | null {
  const match = /^\$2[abxy]\$(\d{2})\$/.exec(hash.trim());
  return match ? Number(match[1]) : null;
}

/** Stop the worker — the page calls this when it unmounts. */
export function shutdown(): void {
  worker?.terminate();
  worker = null;
  pending.clear();
}
