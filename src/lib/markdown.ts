/**
 * The ONE sanctioned markdown → HTML path (timer descriptions, and later TODO
 * bodies/comments). Sanitization is not optional even in a local-only app:
 * backup-JSON import is an injection vector straight into rendered HTML.
 * Client-only (DOMPurify needs a DOM) — call from components, never during SSR.
 */
import { marked } from 'marked';
import DOMPurify from 'dompurify';

export function renderMarkdown(md: string): string {
  const html = marked.parse(md, { gfm: true, async: false });
  return DOMPurify.sanitize(html);
}
