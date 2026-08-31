/**
 * Turning a playground's script into something a browser will run.
 *
 * For JavaScript that is nothing at all. For TypeScript it is Sucrase with the
 * `typescript` transform, which STRIPS TYPES AND NOTHING ELSE — no checking,
 * no inference, no errors for a wrong type. A misused type is a bug that
 * reaches the preview exactly as it would have without the annotation, and the
 * page says so rather than letting anyone believe otherwise.
 *
 * Sucrase is imported lazily so a JavaScript session never pays for it, and
 * `payload.spec.ts` holds it to that.
 */

import type { ScriptLang } from './model';

export type CompileResult =
  | { ok: true; code: string }
  | { ok: false; error: string };

/**
 * Strip the types, or hand JavaScript straight back.
 *
 * A syntax error is RETURNED, not thrown: the caller keeps the last preview
 * that worked and shows the message beside the editor, because a preview that
 * goes blank on every half-typed generic is unusable.
 */
export async function compileScript(source: string, lang: ScriptLang): Promise<CompileResult> {
  if (lang !== 'ts') return { ok: true, code: source };
  try {
    const { transform } = await import('sucrase');
    return { ok: true, code: transform(source, { transforms: ['typescript'] }).code };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
