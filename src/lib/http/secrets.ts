/**
 * Secret values for the HTTP playground — the one store in this app that a
 * backup never sees (0.4.0 plan, checklist item 7, Q1).
 *
 * **Why this file exists at all.** Everything else in the app is written
 * through [repo.ts](../db/repo.ts), which is the right default: it stamps
 * sync fields, it queues the change, and it refuses stores that are not in
 * `STORES`. That refusal is exactly what is wanted here. `http_secrets` is
 * absent from `STORES`, so `repo` cannot write it even by accident, and the
 * backup exporter — which walks `STORES` — cannot read it. The promise "your
 * API key is not in your backup" is therefore not a rule someone has to
 * remember; it is a thing the type system and the exporter both enforce
 * without being asked. `sync_outbox` set this precedent in v2.
 *
 * The cost is this module: ~80 lines of direct IndexedDB access that repo.ts
 * would otherwise have provided. That is the price of the guarantee, and it
 * is cheap.
 *
 * **What is still true.** These values are on this machine, in this browser's
 * IndexedDB, unencrypted — the same as every other row. Anything with access
 * to the profile can read them. What they will not do is leave: no backup, no
 * export, no sync queue, no network. The page says all of this in plain words
 * rather than leaving it to be assumed, because "secret" is a word people
 * reasonably read as "encrypted" and it does not mean that here.
 */
import { getDB } from '../db/db';

export const SECRETS_STORE = 'http_secrets';

export interface HttpSecret {
  id: string;
  /** The `{{name}}` this resolves. */
  name: string;
  /** The value itself. Masked everywhere it is displayed. */
  value: string;
  /** The environment it belongs to, or null for the Global scope. */
  environment_id: string | null;
  updated_at: string;
}

const newId = (): string => crypto.randomUUID();
const nowIso = (): string => new Date().toISOString();

/** Every secret, in no particular order. */
export async function allSecrets(): Promise<HttpSecret[]> {
  const rows = (await (await getDB()).getAll(SECRETS_STORE)) as HttpSecret[];
  return rows.filter(isSecret);
}

/**
 * Nothing read from a store is trusted, here least of all: a half-written row
 * that resolved to `undefined` in a header would be a silent wrong request.
 */
function isSecret(row: unknown): row is HttpSecret {
  if (typeof row !== 'object' || row === null) return false;
  const candidate = row as Partial<HttpSecret>;
  return typeof candidate.id === 'string' && typeof candidate.name === 'string' && typeof candidate.value === 'string';
}

/**
 * Create or replace a secret. Names are unique per scope — re-using one
 * overwrites rather than adding a second row nothing could tell apart, which
 * is what a "duplicate name" in a lookup table would actually mean.
 */
export async function putSecret(
  fields: { name: string; value: string; environment_id: string | null },
  id?: string
): Promise<HttpSecret> {
  const existing = id
    ? undefined
    : (await allSecrets()).find(
        (row) => row.name === fields.name && row.environment_id === fields.environment_id
      );
  const row: HttpSecret = {
    id: id ?? existing?.id ?? newId(),
    name: fields.name,
    value: fields.value,
    environment_id: fields.environment_id,
    updated_at: nowIso(),
  };
  await (await getDB()).put(SECRETS_STORE, row);
  return row;
}

/**
 * Delete for real, not a tombstone.
 *
 * Every other store in the app soft-deletes so a future sync can propagate
 * the removal. A tombstone here would keep the value in the row — that is
 * what a tombstone IS — and "deleted" has to mean the bytes are gone.
 */
export async function deleteSecret(id: string): Promise<void> {
  await (await getDB()).delete(SECRETS_STORE, id);
}

/** Drop every secret in one scope — used when its environment is deleted. */
export async function deleteSecretsFor(environmentId: string): Promise<number> {
  const doomed = (await allSecrets()).filter((row) => row.environment_id === environmentId);
  const db = await getDB();
  const tx = db.transaction(SECRETS_STORE, 'readwrite');
  for (const row of doomed) tx.objectStore(SECRETS_STORE).delete(row.id);
  await tx.done;
  return doomed.length;
}

/** The name → value map for one scope, ready to be a template `Scope`. */
export function secretValues(
  secrets: readonly HttpSecret[],
  environmentId: string | null
): Record<string, string> {
  const values: Record<string, string> = {};
  for (const row of secrets) {
    if (row.environment_id === environmentId) values[row.name] = row.value;
  }
  return values;
}

/**
 * What to show instead of a value.
 *
 * The length is deliberately NOT preserved: a mask that tracks the length
 * leaks how long the key is, which is a real hint about what kind of key it
 * is. A fixed mask says "there is a value here" and nothing else.
 */
export const MASK = '••••••••';

/** The last few characters, for telling two keys apart without showing either. */
export function secretHint(value: string): string {
  if (value.length <= 4) return MASK;
  return `${MASK}${value.slice(-4)}`;
}
