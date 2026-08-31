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

/** Where the preview sits relative to the editor. */
export type Layout = 'split' | 'editor' | 'preview' | 'popout';

export const LAYOUTS: { id: Layout; label: string; title: string }[] = [
  { id: 'split', label: 'Split', title: 'Editor and preview side by side' },
  { id: 'editor', label: 'Editor', title: 'The code only — the preview is hidden' },
  { id: 'preview', label: 'Preview', title: 'The preview only — the editor is collapsed' },
  { id: 'popout', label: 'Popout', title: 'The preview in its own window' },
];

export const isLayout = (value: unknown): value is Layout =>
  LAYOUTS.some((layout) => layout.id === value);

/** Is the editor column on screen? */
export const showsEditor = (layout: Layout): boolean => layout !== 'preview';

/**
 * Is the preview rendered IN THIS WINDOW? False for `popout`, where it is
 * rendered in another one — the document still has to be built either way,
 * because the popout is sent the same string this would have shown.
 */
export const showsPreview = (layout: Layout): boolean =>
  layout === 'split' || layout === 'preview';

/** Is there a preview running anywhere, and so a console worth showing? */
export const hasConsole = (layout: Layout): boolean => layout !== 'editor';

/** Does the one visible panel get the whole width? */
export const isSingleColumn = (layout: Layout): boolean => layout !== 'split';
