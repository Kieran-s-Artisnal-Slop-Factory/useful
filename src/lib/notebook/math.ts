/**
 * Typeset the maths `renderMarkdown` left as source.
 *
 * markdown.ts emits `<span class="math math-inline" data-math="…">` and
 * `<div class="math math-display" data-math="…">` and imports nothing heavy;
 * this module is the other half. KaTeX (~280 KB) is `import()`ed on first
 * use, so a page that never shows a formula never pays for it, and its
 * stylesheet rides on the font bundle Phase 8 already vendors — one copy of
 * the twenty faces, never a second.
 *
 * Browser-only: it rewrites the DOM in place. Not unit-tested.
 */
import { ensureKatexCss } from '../math/fonts';

type Katex = typeof import('katex').default;

let katexPromise: Promise<Katex> | null = null;

/** KaTeX, loaded once. */
function loadKatex(): Promise<Katex> {
  katexPromise ??= import('katex').then((m) => m.default);
  return katexPromise;
}

/**
 * Render every `[data-math]` element under `root` exactly once.
 *
 * A node that has been rendered is marked `data-math-rendered`, so calling
 * this again after a partial re-render only touches the new formulas. A
 * formula KaTeX cannot parse keeps its source text and gets the `math-error`
 * class with the message as its title; `throwOnError: false` already turns
 * most mistakes into red text, so this is the net under the net.
 */
export async function renderMathIn(root: ParentNode): Promise<void> {
  const nodes = root.querySelectorAll<HTMLElement>('[data-math]:not([data-math-rendered])');
  if (nodes.length === 0) return;
  ensureKatexCss();
  const katex = await loadKatex();
  for (const node of nodes) {
    // Guard again after the await: a concurrent call may have got here first.
    if (node.hasAttribute('data-math-rendered')) continue;
    node.setAttribute('data-math-rendered', '');
    const source = node.getAttribute('data-math') ?? '';
    try {
      node.innerHTML = katex.renderToString(source, {
        throwOnError: false,
        displayMode: node.classList.contains('math-display'),
      });
    } catch (error) {
      node.classList.add('math-error');
      node.title = error instanceof Error ? error.message : String(error);
    }
  }
}
