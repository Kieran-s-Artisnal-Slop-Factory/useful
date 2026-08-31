/**
 * Getting a playground session out as standalone files (0.4.0 plan, Phase 2).
 *
 * Pure, because the interesting part is the document it writes rather than the
 * archive: an `index.html` that links a sibling stylesheet and script, so the
 * unzipped folder opens in a browser and behaves the way the preview did. The
 * preview's own document inlines everything instead, which is why the two are
 * built by different functions rather than one with a flag.
 */

import type { ZipEntry } from '../zip';
import { scriptName, type Buffers, type ScriptLang } from './model';

/** The standalone page that ties the three files together. */
export function exportIndexHtml(html: string): string {
  return [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<title>Playground</title>',
    '<link rel="stylesheet" href="style.css">',
    '</head>',
    '<body>',
    html,
    '<script type="module" src="script.js"><\/script>',
    '</body>',
    '</html>',
    '',
  ].join('\n');
}

/**
 * The files a session exports as.
 *
 * `compiled` is the JavaScript the page will actually run — for a TS session
 * that is the stripped output, and the TypeScript original ships beside it as
 * `script.ts` so the export is the work, not just the result.
 */
export function exportFiles(
  buffers: Buffers,
  lang: ScriptLang,
  compiled: string
): ZipEntry[] {
  const files: ZipEntry[] = [
    { name: 'index.html', data: exportIndexHtml(buffers.html) },
    { name: 'style.css', data: buffers.css },
    { name: 'script.js', data: compiled },
  ];
  if (lang === 'ts') files.push({ name: scriptName(lang), data: buffers.script });
  return files;
}

/** A filename-safe slug for the archive, so a session name cannot escape it. */
export function archiveName(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return `${slug || 'playground'}.zip`;
}
