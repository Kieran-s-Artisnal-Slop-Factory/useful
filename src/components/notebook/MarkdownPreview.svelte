<script lang="ts">
  /**
   * Rendered markdown, the way a published note shows it — through this app's
   * ONE markdown path (`renderMarkdown`: marked + DOMPurify + Prism), then two
   * client-side passes over the sanitized HTML: KaTeX for `$…$` math and
   * mermaid for the ```mermaid fences the pipeline leaves as `<pre class="mermaid">`.
   *
   * Ported from retoken's MarkdownPreview (Decision 7: retoken's remark/rehype
   * renderer is NOT ported). Two facts a reader needs:
   *
   *  - Renders are debounced, so it can sit next to a keystroke source — the
   *    first paint is immediate, later ones wait for typing to settle.
   *  - Wiki links resolve by title. A click on `a.wiki-link` is intercepted and
   *    handed to `onWikiNavigate(title)` so the notebook can switch notes (or
   *    create one) without a page load; without that callback the anchor's own
   *    `?note=` href navigates as usual.
   */
  import { tick } from 'svelte';
  import { href } from '../../lib/paths';
  import { renderMarkdown } from '../../lib/markdown';
  import { renderMathIn } from '../../lib/notebook/math';
  import { getMermaid, renderInto } from '../../lib/notebook/mermaid';

  let {
    markdown = '',
    /**
     * Maps an image src (`asset:<id>`) to something displayable. Typically
     * `store.resolve` from an AssetStore.
     */
    resolveImage = undefined,
    /** Whether a note with this title (or alias) exists; unresolved links get
     *  the "create this note" affordance. Absent = everything resolves. */
    wikiExists = undefined,
    /** The href a wiki link points at. Defaults to the notebook route. */
    wikiHref = undefined,
    /** Called instead of navigating when a wiki link is clicked. */
    onWikiNavigate = undefined,
    debounce = 250,
    /**
     * Bump to force a re-render when the markdown did not change but what it
     * points at did — an asset re-saved under the same ref.
     */
    nonce = 0,
    class: className = '',
  }: {
    markdown?: string;
    resolveImage?: ((src: string) => string | undefined) | undefined;
    wikiExists?: ((title: string) => boolean) | undefined;
    wikiHref?: ((title: string) => string) | undefined;
    onWikiNavigate?: ((title: string) => void) | undefined;
    debounce?: number;
    nonce?: number;
    class?: string;
  } = $props();

  let html = $state('');
  let container = $state<HTMLDivElement | undefined>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let renderSeq = 0;

  /** Where `[[Title]]` goes when nobody says otherwise. */
  const defaultHref = (title: string): string =>
    href('/tools/notebook/') + '?note=' + encodeURIComponent(title);

  /**
   * Draw the `<pre class="mermaid">` blocks the pipeline left behind. Lazy —
   * the ~1 MB mermaid chunk loads only when there is a diagram. A broken one
   * reports itself in place, keeping its source visible.
   */
  async function renderMermaid(seq: number) {
    const nodes = container?.querySelectorAll<HTMLElement>('pre.mermaid');
    if (!nodes || nodes.length === 0) return;
    try {
      // Bail if a newer render replaced the DOM while mermaid was loading.
      await getMermaid();
      if (seq !== renderSeq) return;
      await renderInto([...nodes]);
    } catch {
      // renderInto reports per-diagram failures in place; nothing to add.
    }
  }

  async function render(md: string) {
    const seq = ++renderSeq;
    html = renderMarkdown(md, {
      wikiLinks: { href: wikiHref ?? defaultHref, exists: wikiExists },
      resolveImage,
    });
    await tick();
    if (seq !== renderSeq || !container) return;
    // Math first: it is synchronous-ish and cheap; mermaid may take a while.
    try {
      await renderMathIn(container);
    } catch {
      // A formula that will not typeset stays as its source; nothing to add.
    }
    if (seq !== renderSeq) return;
    void renderMermaid(seq);
  }

  $effect(() => {
    const md = markdown;
    nonce; // tracked: re-render when the bytes behind a stable ref change
    clearTimeout(timer);
    // First paint is immediate; later ones wait for typing to settle.
    timer = setTimeout(() => void render(md), html === '' ? 0 : debounce);
    return () => clearTimeout(timer);
  });

  /** The title a rendered wiki link stands for, however the renderer marked it. */
  function wikiTitleOf(anchor: HTMLAnchorElement): string {
    // `renderMarkdown` stamps the title on `data-wiki`; the href is the fallback.
    const tagged = anchor.dataset['wiki'];
    if (tagged) return tagged;
    try {
      const fromHref = new URL(anchor.href, location.href).searchParams.get('note');
      if (fromHref) return fromHref;
    } catch {
      // Not a URL the browser can parse; fall through to the label.
    }
    return anchor.textContent?.trim() ?? '';
  }

  function onClick(event: MouseEvent) {
    if (!onWikiNavigate) return;
    // Modified clicks (new tab, etc.) keep their native meaning.
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey) return;
    const target = event.target instanceof Element ? event.target : null;
    const anchor = target?.closest<HTMLAnchorElement>('a.wiki-link');
    if (!anchor || !container?.contains(anchor)) return;
    const title = wikiTitleOf(anchor);
    if (!title) return;
    event.preventDefault();
    onWikiNavigate(title);
  }
</script>

<!-- Click delegation only: the anchors inside are the interactive elements,
     and Enter on a focused link fires a click, so no key handler is needed. -->
<!-- svelte-ignore a11y_no_static_element_interactions a11y_click_events_have_key_events -->
<div
  class="preview markdown {className}"
  data-testid="notebook-preview"
  bind:this={container}
  onclick={onClick}
>
  <!-- eslint-disable-next-line svelte/no-at-html-tags — DOMPurify-sanitized by renderMarkdown -->
  {@html html}
</div>

<style>
  .preview {
    min-height: 8rem;
    line-height: var(--line-height);
    overflow-wrap: anywhere;
  }

  .preview :global(img) {
    max-width: 100%;
    height: auto;
  }

  .preview :global(table) {
    border-collapse: collapse;
    margin: var(--space-3) 0;
  }

  .preview :global(th),
  .preview :global(td) {
    border: 1px solid var(--border-color);
    padding: var(--space-1) var(--space-2);
    text-align: left;
  }

  .preview :global(blockquote) {
    margin: var(--space-3) 0;
    padding-left: var(--space-3);
    border-left: 3px solid var(--border-strong-color);
    color: var(--text-muted-color);
  }

  .preview :global(pre.mermaid svg) {
    max-width: 100%;
    height: auto;
  }

  /* Rendered successfully — drop the code-block chrome, it's a picture now. */
  .preview :global(pre.mermaid-rendered) {
    background: none;
    border: none;
    padding: 0;
    display: grid;
    place-items: center;
  }

  /* Failed to parse: keep the source visible, name the problem above it. */
  .preview :global(pre.mermaid-error) {
    display: block;
    border-color: var(--color-danger);
    border-left: 3px solid var(--color-danger);
    white-space: pre-wrap;
  }

  .preview :global(pre.mermaid-error)::before {
    content: '⚠ ' attr(data-error);
    display: block;
    margin-bottom: var(--space-2);
    color: var(--color-danger);
    font-weight: 600;
    font-size: var(--font-size-sm);
  }

  /* A link to a note that does not exist yet — the affordance that creates it. */
  .preview :global(a.wiki-link.missing) {
    color: var(--color-stamp);
    text-decoration-style: dashed;
  }

  /* Footnotes, as marked renders them: a ruled-off block at the foot. */
  .preview :global(section.footnotes),
  .preview :global(.footnotes) {
    margin-top: var(--space-5);
    padding-top: var(--space-3);
    border-top: 1px solid var(--border-color);
    font-size: var(--font-size-sm);
    color: var(--text-muted-color);
  }
</style>
