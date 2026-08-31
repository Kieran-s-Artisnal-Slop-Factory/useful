<script lang="ts">
  /**
   * The one iframe previewer in the app (0.4.0 plan, decision 4). The web
   * playground mounts it to show the code someone is writing; the HTTP
   * playground mounts it to show the HTML a server sent back. They configure
   * it — they do not fork it — because the sandbox rules are the same in both
   * cases and are only worth getting right once.
   *
   * `sandbox="allow-scripts"` and nothing else. NEVER `allow-same-origin`:
   * together those two flags let the framed document remove its own sandbox,
   * and the document here is either user code or a stranger's HTML. Without
   * `allow-same-origin` the frame has an opaque origin, so it cannot read this
   * app's IndexedDB, its localStorage or its cookies — which is the entire
   * point.
   *
   * Because the origin is opaque, messages from the frame arrive with
   * `event.origin === 'null'`. Identity is therefore established by
   * `event.source === frame.contentWindow` (which no other window can forge)
   * plus the channel tag in
   * [document.ts](../lib/preview/document.ts); an origin comparison would
   * prove nothing here.
   *
   * The document assembly, the close-tag guard and the console shim are pure
   * and live in that module, where Vitest can reach them.
   */
  import { onDestroy, onMount, untrack } from 'svelte';
  import {
    appendMessage,
    injectConsoleShim,
    isConsoleMessage,
    type ConsoleMessage,
  } from '../lib/preview/document';

  let {
    /** The complete document to show. Build one with `buildPreviewDocument`. */
    srcdoc = '',
    /** Accessible name for the frame. Required — every frame is in the a11y sweep. */
    title,
    /**
     * Forward the framed page's console output and uncaught errors. On for the
     * web playground, where the messages are the user's own to act on; off by
     * default, because a stranger's page logging its own noise is not a
     * console the reader can do anything about.
     */
    consoleShim = false,
    /** Fixed width in CSS pixels (a viewport preset), or null to fill. */
    width = null,
    /** Height of the frame, as a CSS length. */
    height = '24rem',
    /** Let the reader drag the frame's size. A preset rewrites it. */
    resize = 'none',
    /** Called with the whole capped list whenever it changes. */
    onConsole = undefined,
  }: {
    srcdoc?: string;
    title: string;
    consoleShim?: boolean;
    width?: number | null;
    height?: string;
    resize?: 'none' | 'horizontal' | 'vertical' | 'both';
    onConsole?: (messages: ConsoleMessage[]) => void;
  } = $props();

  let frame = $state<HTMLIFrameElement | undefined>();
  let messages = $state<ConsoleMessage[]>([]);

  /** The last document written, so `reload()` can re-run an unchanged one. */
  let written = '';

  function write(target: HTMLIFrameElement, document: string, shim: boolean) {
    messages = [];
    onConsole?.(messages);
    written = shim ? injectConsoleShim(document) : document;
    target.srcdoc = written;
  }

  /** Re-run the current document, even though nothing about it changed. */
  export function reload(): void {
    if (!frame) return;
    // Blank first: assigning the same srcdoc string is a no-op to the browser.
    frame.srcdoc = '';
    frame.srcdoc = written;
    messages = [];
    onConsole?.(messages);
  }

  export function clearConsole(): void {
    messages = [];
    onConsole?.(messages);
  }

  export function getConsole(): ConsoleMessage[] {
    return messages;
  }

  function onMessage(event: MessageEvent) {
    // Both halves matter: the source check says it came from OUR frame, the
    // shape check says it is a console line and not something else entirely.
    if (!frame || event.source !== frame.contentWindow) return;
    if (!isConsoleMessage(event.data)) return;
    messages = appendMessage(messages, { level: event.data.level, text: event.data.text });
    onConsole?.(messages);
  }

  // The dependencies are named here and the work is untracked, deliberately.
  // `write()` reads `onConsole`, and a parent that passes an inline arrow —
  // which is the normal way to pass one — hands over a NEW function identity
  // on every render. Tracked, that made the effect depend on its own side
  // effect: write -> onConsole -> parent re-renders -> new identity -> write,
  // until Svelte gave up with `effect_update_depth_exceeded` and the preview
  // never got a document at all. `frame` stays tracked so the first run after
  // the binding lands still fires.
  $effect(() => {
    const next = srcdoc;
    const shim = consoleShim;
    const target = frame;
    untrack(() => {
      if (target) write(target, next, shim);
    });
  });

  onMount(() => {
    window.addEventListener('message', onMessage);
  });

  onDestroy(() => {
    window.removeEventListener('message', onMessage);
    // Actually drop the frame. Removing the element is not enough on its own
    // to feel safe about: navigating it to about:blank first tears down the
    // framed document, its timers and any request it still has in flight.
    if (frame) {
      frame.srcdoc = '';
      frame.src = 'about:blank';
    }
    frame = undefined;
  });
</script>

<!-- The height goes on the WRAPPER, not the box. A percentage height only
     resolves against a parent that has one, and `.frame-wrap` is the element
     with a parent to measure against — putting `height: 100%` on the box
     instead silently collapses it to the iframe's default 150px, whatever the
     caller asked for. -->
<div class="frame-wrap" style:block-size={height}>
  <div class="frame-box" style:width={width === null ? null : `${width}px`} style:resize>
    <!-- allow="" delegates no permission-policy features (camera, microphone,
         geolocation). The opaque origin already blocks them; saying so in the
         markup means a future edit has to remove a line to weaken it. -->
    <iframe
      bind:this={frame}
      {title}
      sandbox="allow-scripts"
      referrerpolicy="no-referrer"
      allow=""
    ></iframe>
  </div>
</div>

<style>
  .frame-wrap {
    display: flow-root;
  }

  .frame-box {
    block-size: 100%;
    max-width: 100%;
    overflow: hidden; /* `resize` needs a non-visible overflow to take effect. */
    border: 1px solid var(--border-strong-color);
    /* The framed page owns its own colours and almost every one of them
       assumes a white canvas. A transparent frame would show this app's
       surface through and misrepresent what the page actually looks like. */
    background: #fff;
  }

  iframe {
    display: block;
    width: 100%;
    height: 100%;
    border: 0;
  }
</style>
