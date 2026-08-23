<script lang="ts">
  /**
   * The Excalidraw canvas — a Svelte modal shell around a React root,
   * because Excalidraw ships only as a React component. React, Excalidraw
   * and its CSS all arrive through one lazy import when this dialog first
   * opens. Ported from retoken.
   *
   * Saving exports the scene to a PNG with `exportEmbedScene: true`, so the
   * drawing IS the image the note references AND the source it reopens
   * from. The caller decides what to do with the bytes.
   */
  import { onDestroy, onMount } from 'svelte';
  import {
    loadExcalidraw,
    sceneToBlob,
    blobToScene,
    type ExcalidrawModule,
  } from '../../lib/notebook/drawing';
  import { isDarkScheme } from '../../lib/notebook/mermaid';

  let {
    /** Existing drawing to reopen; null for a blank canvas. */
    initial = null,
    onSave,
    onCancel,
  }: {
    initial?: { blob: Blob; name?: string } | null;
    /** Receives the rendered PNG (with the scene embedded). */
    onSave: (blob: Blob) => Promise<void> | void;
    onCancel: () => void;
  } = $props();

  let host: HTMLDivElement;
  let root: { render: (node: unknown) => void; unmount: () => void } | null = null;
  let mod: ExcalidrawModule | null = null;
  /** Excalidraw's imperative handle — the live scene lives behind it. */
  let api: {
    getSceneElements: () => readonly unknown[];
    getAppState: () => Record<string, unknown>;
    getFiles: () => unknown;
  } | null = null;

  let loading = $state(true);
  let saving = $state(false);
  let error = $state<string | null>(null);

  onMount(async () => {
    try {
      const { excalidraw, react, reactDom } = await loadExcalidraw();
      mod = excalidraw;

      // Reopening: pull the embedded scene back out of the PNG.
      let scene: {
        elements: readonly unknown[];
        appState: Record<string, unknown>;
        files: unknown;
      } | null = null;
      if (initial) {
        try {
          scene = await blobToScene(excalidraw, initial.blob);
        } catch {
          error =
            'That image has no editable drawing inside it — it may have been exported elsewhere. Starting a blank canvas.';
        }
      }

      root = reactDom.createRoot(host);
      root.render(
        react.createElement(excalidraw.Excalidraw, {
          theme: isDarkScheme() ? 'dark' : 'light',
          // Only the initial scene; Excalidraw owns its state from here.
          initialData: scene
            ? {
                elements: scene.elements,
                appState: { ...scene.appState, collaborators: [] },
                files: scene.files,
              }
            : null,
          excalidrawAPI: (handle: typeof api) => (api = handle),
          // Saving and loading are the notebook's business.
          UIOptions: {
            canvasActions: { loadScene: false, saveToActiveFile: false, export: false },
          },
        })
      );
      loading = false;
    } catch (err) {
      error = 'Could not load the drawing canvas: ' + (err instanceof Error ? err.message : String(err));
      loading = false;
    }
  });

  onDestroy(() => {
    // React must tear its own tree down before Svelte removes the host.
    root?.unmount();
    root = null;
  });

  async function save() {
    if (!mod || !api || saving) return;
    saving = true;
    error = null;
    try {
      const blob = await sceneToBlob(mod, {
        elements: api.getSceneElements(),
        appState: api.getAppState(),
        files: api.getFiles(),
      });
      await onSave(blob);
    } catch (err) {
      error = 'Could not save the drawing: ' + (err instanceof Error ? err.message : String(err));
      saving = false;
    }
  }
</script>

<svelte:window onkeydown={(e) => e.key === 'Escape' && !saving && onCancel()} />

<div
  class="backdrop"
  role="presentation"
  onclick={(e) => e.target === e.currentTarget && !saving && onCancel()}
>
  <div
    class="modal"
    role="dialog"
    aria-modal="true"
    aria-labelledby="drawing-title"
    data-testid="notebook-drawing-dialog"
  >
    <div class="head">
      <h3 id="drawing-title">{initial ? 'Edit drawing' : 'New drawing'}</h3>
      <button type="button" class="close" aria-label="Close" onclick={onCancel}>×</button>
    </div>

    {#if error}
      <p class="err" role="alert" data-testid="notebook-drawing-error">{error}</p>
    {/if}

    <div class="canvas-wrap">
      {#if loading}
        <p class="muted loading" data-testid="notebook-drawing-loading">Loading the canvas…</p>
      {/if}
      <div class="canvas" data-testid="notebook-drawing-canvas" bind:this={host}></div>
    </div>

    <div class="actions">
      <span class="muted small">
        Saved as a PNG with the drawing embedded — it reopens here for editing, and an export just
        shows the image.
      </span>
      <button type="button" class="btn" onclick={onCancel} disabled={saving}>Cancel</button>
      <button
        type="button"
        class="btn btn-primary"
        data-testid="notebook-drawing-save"
        onclick={save}
        disabled={loading || saving}
      >
        {saving ? 'Saving…' : initial ? 'Update drawing' : 'Insert drawing'}
      </button>
    </div>
  </div>
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    background: rgb(0 0 0 / 0.55);
    display: grid;
    place-items: center;
    z-index: 70;
    padding: var(--space-4);
  }

  .modal {
    background: var(--surface-raised-color);
    border: 1.5px solid var(--border-strong-color);
    border-radius: var(--radius-sm);
    box-shadow: var(--shadow-2);
    padding: var(--space-4);
    width: min(72rem, 100%);
    height: min(90vh, 100%);
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .head h3 {
    margin: 0;
  }

  .close {
    border: none;
    background: none;
    color: var(--text-muted-color);
    font-size: var(--font-size-xl);
    line-height: 1;
    cursor: pointer;
    padding: 0 var(--space-2);
  }

  .close:hover {
    color: var(--text-color);
  }

  /* Excalidraw fills its container, so the container needs real height. */
  .canvas-wrap {
    position: relative;
    flex: 1;
    min-height: 0;
    border: 1px solid var(--border-color);
    border-radius: var(--radius-sm);
    overflow: hidden;
  }

  .canvas {
    width: 100%;
    height: 100%;
  }

  .loading {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    z-index: 1;
  }

  .actions {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: var(--space-3);
    flex-wrap: wrap;
  }

  .actions .small {
    margin-right: auto;
    max-width: 34rem;
  }

  .muted {
    color: var(--text-muted-color);
  }

  .small {
    font-size: var(--font-size-sm);
  }

  .err {
    margin: 0;
    color: var(--color-danger);
    font-size: var(--font-size-sm);
  }
</style>
