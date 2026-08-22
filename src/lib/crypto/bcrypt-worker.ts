/// <reference lib="webworker" />
/**
 * bcrypt, off the main thread.
 *
 * This worker exists for one reason: bcrypt is *deliberately* slow, and
 * `bcryptjs` is a pure-JavaScript implementation of a deliberately slow
 * algorithm. A cost-12 hash is a second or more of solid computation — on the
 * main thread that is a frozen tab, indistinguishable from a crash.
 *
 * `bcryptjs` is imported here and nowhere else, so it stays out of every
 * bundle but this worker's (`payload.spec.ts` stands over that).
 */
import bcrypt from 'bcryptjs';

export interface BcryptRequest {
  id: number;
  type: 'hash' | 'verify';
  password: string;
  cost?: number;
  hash?: string;
}

export interface BcryptResponse {
  id: number;
  ok: boolean;
  hash?: string;
  valid?: boolean;
  /** How long the work took, which is the whole point of a cost factor. */
  ms?: number;
  error?: string;
}

const scope = self as unknown as DedicatedWorkerGlobalScope;

scope.onmessage = (event: MessageEvent<BcryptRequest>) => {
  const request = event.data;
  const started = performance.now();
  try {
    if (request.type === 'hash') {
      const hash = bcrypt.hashSync(request.password, request.cost ?? 10);
      scope.postMessage({ id: request.id, ok: true, hash, ms: performance.now() - started });
      return;
    }
    const valid = bcrypt.compareSync(request.password, request.hash ?? '');
    scope.postMessage({ id: request.id, ok: true, valid, ms: performance.now() - started });
  } catch (error) {
    scope.postMessage({
      id: request.id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
