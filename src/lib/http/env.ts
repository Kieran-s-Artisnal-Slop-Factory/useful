/**
 * Environments, and the scope chain a `{{placeholder}}` is looked up in
 * (0.4.0 plan, Phase 4).
 *
 * The lookup order the plan fixes is **step → active environment → Global**,
 * first hit wins, with Phase 5 supplying the step scope. Secrets sit at the
 * same levels as variables but ahead of them, because a secret is the more
 * deliberate thing to have created: if someone has both a variable `token`
 * and a secret `token` in one environment, they meant the secret.
 *
 * Every level is a separate `Scope` with its own name rather than one merged
 * map, and that is not tidiness — it is what makes two things possible:
 *
 *  - the pre-send panel can say *where* each value came from, so a request
 *    that picks up the wrong `base_url` is diagnosable rather than mysterious;
 *  - masking works without the template engine knowing what a secret is. The
 *    engine reports which scope won; `Chain.secretScopes` says which scopes
 *    are secret. Neither has to know about the other.
 *
 * Pure module: no DOM, no state, no I/O.
 */

import type { Scope } from '../template/engine';
import { secretValues, type HttpSecret } from './secrets';
import type { HttpEnvironment } from '../db/types';

/**
 * The built-in environment that is always in scope.
 *
 * A fixed id rather than a generated one, so "Global" is the same row on
 * every device and a merge-import folds two copies together instead of
 * producing a second Global nobody asked for. `repo.SINGLETON_ID` is the
 * precedent for a well-known id.
 */
export const GLOBAL_ID = 'global';
export const GLOBAL_NAME = 'Global';

/** A `Scope` list plus the knowledge of which of them must never be shown. */
export interface Chain {
  scopes: Scope[];
  /** `Scope.name`s whose resolved values are masked in every preview. */
  secretScopes: Set<string>;
}

/** What a secret scope is called where the reader can see it. */
export const secretScopeName = (environmentName: string): string =>
  `${environmentName} · secrets`;

/**
 * A stored `values` column, re-shaped.
 *
 * Nothing read from a store is trusted: the generic data suite writes an
 * ARRAY into every json column, and a backup can be hand-edited. Non-object
 * values become an empty map, and keys whose values cannot be substituted
 * into a request — objects and arrays are fine to STORE, they just cannot be
 * inserted as text — are kept, because the engine gives a much better error
 * about them (`\`x\` is a list of 3`) than a silent drop here would.
 */
export function normalizeEnvironment(row: HttpEnvironment): {
  id: string;
  name: string;
  values: Record<string, unknown>;
} {
  const raw = row.values;
  const values: Record<string, unknown> =
    typeof raw === 'object' && raw !== null && !Array.isArray(raw)
      ? { ...(raw as Record<string, unknown>) }
      : {};
  return {
    id: row.id,
    name: typeof row.name === 'string' && row.name.trim() !== '' ? row.name : 'Untitled',
    values,
  };
}

/** The Global row, or a stand-in for it before anyone has written one. */
export function globalOf(environments: readonly HttpEnvironment[]) {
  const row = environments.find((env) => env.id === GLOBAL_ID);
  return row ? normalizeEnvironment(row) : { id: GLOBAL_ID, name: GLOBAL_NAME, values: {} };
}

/** Every environment except Global, by name — what the picker lists. */
export function selectableEnvironments(environments: readonly HttpEnvironment[]) {
  return environments
    .filter((env) => env.id !== GLOBAL_ID)
    .map(normalizeEnvironment)
    .sort((a, b) => a.name.localeCompare(b.name));
}

export interface ChainInput {
  environments: readonly HttpEnvironment[];
  secrets: readonly HttpSecret[];
  /** The environment selected in the toolbar, or null for Global only. */
  activeId: string | null;
  /**
   * Values extracted by earlier steps of a flow (Phase 5). Ahead of
   * everything, because a token a flow just fetched must beat the stale one
   * someone left in an environment three weeks ago.
   */
  step?: Readonly<Record<string, unknown>> | null;
  /** What to call the step scope where the reader can see it. */
  stepName?: string;
}

/**
 * Build the chain. Scopes with nothing in them are still included — an empty
 * scope costs a `hasOwnProperty` miss, and dropping it would make the
 * engine's "looked in …" message list a different set of places depending on
 * whether they happened to be filled in yet.
 */
export function buildChain(input: ChainInput): Chain {
  const { environments, secrets, activeId } = input;
  const scopes: Scope[] = [];
  const secretScopes = new Set<string>();

  if (input.step) {
    scopes.push({ name: input.stepName ?? 'earlier steps', values: input.step });
  }

  const active =
    activeId !== null && activeId !== GLOBAL_ID
      ? (environments.find((env) => env.id === activeId) ?? null)
      : null;

  if (active) {
    const shaped = normalizeEnvironment(active);
    const name = secretScopeName(shaped.name);
    secretScopes.add(name);
    scopes.push({ name, values: secretValues(secrets, shaped.id) });
    scopes.push({ name: shaped.name, values: shaped.values });
  }

  const globalEnv = globalOf(environments);
  const globalSecretName = secretScopeName(GLOBAL_NAME);
  secretScopes.add(globalSecretName);
  scopes.push({ name: globalSecretName, values: secretValues(secrets, null) });
  scopes.push({ name: GLOBAL_NAME, values: globalEnv.values });

  return { scopes, secretScopes };
}

/** Every name the chain can supply, deduplicated, in lookup order. */
export function availableNames(chain: Chain): string[] {
  const names: string[] = [];
  for (const scope of chain.scopes) {
    for (const name of Object.keys(scope.values)) if (!names.includes(name)) names.push(name);
  }
  return names;
}

/** The shape written by "Export this environment". */
export interface EnvironmentExport {
  kind: 'useful.http-environment';
  version: 1;
  name: string;
  values: Record<string, unknown>;
  /** The names of secrets that exist in this scope, WITHOUT their values. */
  secret_names: string[];
  note: string;
}

/**
 * One environment as a shareable file.
 *
 * **Secrets are not in it, and the file says so.** The names are listed and
 * the values are not — which is the useful half: whoever opens this needs to
 * know that `api_key` has to be filled in before the requests work, and
 * telling them the name costs nothing while telling them the value would be
 * the entire problem. A file that silently omitted them would be worse than
 * one that included them, because the reader would not know to go looking.
 */
export function exportEnvironment(
  environment: { name: string; values: Record<string, unknown> },
  secrets: readonly HttpSecret[],
  environmentId: string | null
): EnvironmentExport {
  const names = secrets
    .filter((row) => row.environment_id === environmentId)
    .map((row) => row.name)
    .sort();
  return {
    kind: 'useful.http-environment',
    version: 1,
    name: environment.name,
    values: environment.values,
    secret_names: names,
    note:
      names.length > 0
        ? `Secret VALUES are deliberately not in this file. The ${names.length} name${names.length === 1 ? '' : 's'} listed in secret_names must be filled in by hand wherever this is imported.`
        : 'Secret values are never included in this file. This environment had none to omit.',
  };
}

/** A filename for that export — the environment's name, made safe. */
export function environmentFilename(name: string): string {
  const slug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return `${slug || 'environment'}.http-environment.json`;
}
