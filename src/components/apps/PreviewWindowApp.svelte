<script lang="ts">
  /**
   * The web playground's popped-out preview: a window whose whole job is to
   * host the preview frame at whatever size the reader drags it to.
   *
   * **The user's code does not run here.** This page is same-origin with the
   * app — a window opened by `window.open` inherits its opener's origin — so
   * writing the previewed document straight into it would hand that code this
   * app's IndexedDB. Instead this page mounts the same
   * [SandboxedPreview](../SandboxedPreview.svelte) the inline preview uses,
   * with `sandbox="allow-scripts"` and no origin of its own. The popout moves
   * the frame to another window; it does not move the code out of the box.
   *
   * The document arrives by `postMessage` from the opener and the console
   * goes back the same way, so the log stays beside the code that wrote it.
   * Both windows are ours, so both ends check the real origin as well as the
   * channel tag.
   */
  import { onDestroy, onMount } from 'svelte';
  import SandboxedPreview from '../SandboxedPreview.svelte';
  import type { ConsoleMessage } from '../../lib/preview/document';
  import {
    consoleMessage,
    isPopoutMessage,
    readyMessage,
    type PopoutMessage,
  } from '../../lib/playground/popout';

  let srcdoc = $state('');
  let connected = $state(false);
  /** No opener at all — someone bookmarked this address or reloaded it alone. */
  let orphaned = $state(false);

  function post(message: PopoutMessage) {
    try {
      window.opener?.postMessage(message, window.location.origin);
    } catch {
      /* the opener went away mid-send; the poll below notices */
    }
  }

  function onMessage(event: MessageEvent) {
    if (event.origin !== window.location.origin) return;
    if (event.source !== window.opener) return;
    if (!isPopoutMessage(event.data)) return;
    if (event.data.type === 'document') {
      srcdoc = event.data.srcdoc;
      connected = true;
    } else if (event.data.type === 'close') {
      window.close();
    }
  }

  function relayConsole(messages: ConsoleMessage[]) {
    post(consoleMessage(messages));
  }

  let poll: ReturnType<typeof setInterval> | undefined;

  onMount(() => {
    window.addEventListener('message', onMessage);
    if (!window.opener) {
      orphaned = true;
      return;
    }
    // Announce on every load, so reopening or reloading this window gets the
    // current document rather than waiting for the next keystroke.
    post(readyMessage());
    // If the editor window goes, this one has nothing left to show.
    poll = setInterval(() => {
      if (!window.opener || window.opener.closed) {
        orphaned = true;
        connected = false;
        clearInterval(poll);
      }
    }, 1000);
  });

  onDestroy(() => {
    window.removeEventListener('message', onMessage);
    clearInterval(poll);
  });
</script>

<div class="shell">
  <h1 class="sr-only">Web playground preview</h1>

  {#if orphaned}
    <p class="notice" data-testid="pw-orphaned" role="status">
      This window shows a preview from the web playground, and that page is no longer open.
      Open the playground again and choose <strong>Popout</strong> to reconnect.
    </p>
  {:else if !connected}
    <p class="notice" data-testid="pw-waiting" role="status">Waiting for the playground…</p>
  {/if}

  <div class="frame" class:hidden={orphaned}>
    <SandboxedPreview
      {srcdoc}
      title="Web playground preview"
      consoleShim
      height="100%"
      onConsole={relayConsole}
    />
  </div>
</div>

<style>
  .shell {
    display: flex;
    flex-direction: column;
    block-size: 100dvh;
  }

  .frame {
    flex: 1;
    min-block-size: 0;
  }

  .frame.hidden {
    display: none;
  }

  /* The frame fills the window: no drawing-sheet border out here. */
  .frame :global(.frame-wrap),
  .frame :global(.frame-box) {
    block-size: 100%;
  }

  .frame :global(.frame-box) {
    border: none;
  }

  .notice {
    margin: 0;
    padding: var(--space-3) var(--space-4);
    background: var(--surface-color);
    color: var(--text-color);
    font-size: var(--font-size-sm);
    border-bottom: 1px solid var(--border-color);
  }

  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }
</style>
