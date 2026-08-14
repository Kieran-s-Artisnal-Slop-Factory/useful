/**
 * The ONE sanctioned markdown → HTML path (timer descriptions, TODO bodies,
 * comments). Sanitization is not optional even in a local-only app:
 * backup-JSON import is an injection vector straight into rendered HTML.
 * Client-only (DOMPurify needs a DOM) — call from components, never during SSR.
 *
 * Fenced code blocks are syntax-highlighted with Prism (statically bundled —
 * offline PWA, no CDN). Token colors live in global.css on the blueprint
 * palette. Unknown languages render as plain escaped code.
 */
import { Marked } from 'marked';
import { markedHighlight } from 'marked-highlight';
import DOMPurify from 'dompurify';
import Prism from 'prismjs';
// Bundled grammars beyond Prism's default markup/css/clike/javascript.
import 'prismjs/components/prism-typescript';
import 'prismjs/components/prism-python';
import 'prismjs/components/prism-go';
import 'prismjs/components/prism-rust';
import 'prismjs/components/prism-bash';
import 'prismjs/components/prism-json';
import 'prismjs/components/prism-sql';
import 'prismjs/components/prism-yaml';

const escapeHtml = (s: string) =>
  s.replace(/[&<>]/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[m]!);

const ALIASES: Record<string, string> = { js: 'javascript', ts: 'typescript', py: 'python', sh: 'bash', shell: 'bash', golang: 'go', yml: 'yaml' };

const marked = new Marked(
  markedHighlight({
    highlight(code, lang) {
      const name = ALIASES[lang] ?? lang;
      const grammar = Prism.languages[name];
      // marked-highlight treats the return value as HTML — escape when Prism
      // has no grammar for the language.
      return grammar ? Prism.highlight(code, grammar, name) : escapeHtml(code);
    },
  }),
  { gfm: true }
);

export function renderMarkdown(md: string): string {
  const html = marked.parse(md, { async: false });
  return DOMPurify.sanitize(html);
}
