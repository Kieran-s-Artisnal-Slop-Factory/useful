/**
 * The web playground's session model (0.4.0 plan, Phase 2).
 *
 * A session is three or four buffers and a name — text, all of it, which is
 * why it rides the JSON data layer and a backup byte-identically, the same
 * reasoning as the SQL playground storing SQL rather than a database.
 *
 * Nothing here is trusted on read. A backup can be hand-edited and the generic
 * data suite writes an ARRAY into every column it can, so `normalizeSession`
 * is what stands between a hostile row and the editor — the same job
 * `normalizeSprite` does for the sprite editor.
 */

import type { WebPlayground } from '../db/types';

/** The script language. TS is STRIPPED, never type-checked — see compile.ts. */
export type ScriptLang = 'js' | 'ts';

export const SCRIPT_LANGS: ScriptLang[] = ['js', 'ts'];

export interface Buffers {
  html: string;
  css: string;
  script: string;
}

/** What a brand-new session starts from: enough to show the preview works. */
export const STARTER: Buffers = {
  html: '<h1>Hello</h1>\n<p id="out">Edit any tab — the preview follows.</p>\n',
  css: 'body {\n  font-family: system-ui, sans-serif;\n  margin: 2rem;\n}\n\nh1 {\n  color: rebeccapurple;\n}\n',
  script: "document.querySelector('#out').textContent = 'Changed by script.';\n",
};

export const BLANK: Buffers = { html: '', css: '', script: '' };

const asText = (value: unknown): string => (typeof value === 'string' ? value : '');

export const isScriptLang = (value: unknown): value is ScriptLang =>
  value === 'js' || value === 'ts';

/** The buffers of a stored row, with anything that is not text replaced by ''. */
export function normalizeSession(row: Partial<WebPlayground> | null | undefined): {
  name: string;
  lang: ScriptLang;
  buffers: Buffers;
} {
  return {
    name: asText(row?.name) || 'Untitled',
    lang: isScriptLang(row?.lang) ? row.lang : 'js',
    buffers: {
      html: asText(row?.html),
      css: asText(row?.css),
      script: asText(row?.script),
    },
  };
}

/** True when a scratch session has nothing worth keeping. */
export function isEmpty(buffers: Buffers): boolean {
  return !buffers.html.trim() && !buffers.css.trim() && !buffers.script.trim();
}

/** The filename the script gets, in the editor and in the export. */
export const scriptName = (lang: ScriptLang): string => (lang === 'ts' ? 'script.ts' : 'script.js');
