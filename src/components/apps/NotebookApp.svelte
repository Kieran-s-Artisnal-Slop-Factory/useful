<script lang="ts">
  /**
   * Notebook — linked markdown notes, WYSIWYG or source, exportable to
   * Markdown, HTML and PDF.
   *
   * Three facts shape the component:
   *
   * **Folders are notes.** A note's `parent_id` points at another note, so the
   * sidebar is one tree and "new note inside" is the only folder operation.
   * A parent that is missing, tombstoned, the note itself or part of a cycle
   * is treated as root — the generic data suite can write exactly that, and a
   * sidebar must never fail to draw.
   *
   * **Backlinks are computed, never stored.** A stored index goes stale the
   * moment a backup is restored, and rebuilding it on load is a write on load.
   * `[[Title]]` resolves by title or alias; renaming a note pushes the old
   * title onto its aliases so old links keep working, and offers — as one
   * explicit action — to rewrite the notes that link here.
   *
   * **The markdown string is the source of truth.** The editor is a view over
   * it; autosave patches the last committed snapshot 400 ms after the last
   * change and flushes on pagehide, on visibility loss, on switching notes and
   * on unmount. Page load writes nothing: the remembered note is reopened with
   * `remember: false`, and a `?note=` deep link that resolves to nothing shows
   * a Create button rather than creating behind the reader's back.
   */
  import { onDestroy, onMount, tick } from 'svelte';
  import Card from '../Card.svelte';
  import Explainer from '../Explainer.svelte';
  import MarkdownEditor from '../notebook/MarkdownEditor.svelte';
  import { downloadBlob, downloadText } from '../../lib/exportFile';
  import { href } from '../../lib/paths';
  import { zipBlob, type ZipEntry } from '../../lib/zip';
  import {
    all,
    byIndex,
    getSingleton,
    patch,
    put,
    putSingleton,
    softDelete,
    softDeleteMany,
    withSyncFields,
  } from '../../lib/db/repo';
  import type { Note, NoteAsset, Preferences } from '../../lib/db/types';
  import {
    ancestorsOf,
    buildTree,
    descendantsOf,
    displayTitle,
    normalizeNote,
    parseTags,
  } from '../../lib/notebook/model';
  import { backlinks, findWikiLinks, resolveNote, rewriteWikiLinks } from '../../lib/notebook/wiki';
  import { AssetTooLarge, noteAssetStore, type AssetStore } from '../../lib/notebook/assets';
  import {
    addTags,
    exportFileName,
    flattenTree,
    moveTargets,
    removeTags,
    reparentForDelete,
    subtreeIds,
  } from '../../lib/notebook/bulk';
  import { externalReferences, htmlExport, markdownExport, printDocument } from '../../lib/notebook/export';
  import { renderMarkdown } from '../../lib/markdown';
  import { renderMathIn } from '../../lib/notebook/math';
  import { getMermaid, renderInto } from '../../lib/notebook/mermaid';
  import { collectMathFonts } from '../../lib/notebook/mathFonts';

  type Mode = 'wysiwyg' | 'source' | 'preview';
  type Tab = 'note' | 'bulk';
  type BulkFormat = 'md' | 'html';

  const SAVE_DEBOUNCE_MS = 400;

  // ---- the notes ----------------------------------------------------------
  let notes = $state<Note[]>([]);
  let currentId = $state<string | null>(null);
  /** The open note's editable fields — the snapshot autosave writes from. */
  let title = $state('');
  let body = $state('');
  let tagsText = $state('');
  let parentId = $state<string | null>(null);
  let aliases = $state<string[]>([]);
  /** The title as last saved; a change to it is a rename. */
  let savedTitle = $state('');
  /** After a rename: the notes still linking to the old title. */
  let renameOffer = $state<{ from: string; to: string; count: number } | null>(null);
  let assetStore = $state<AssetStore | null>(null);
  let assetCount = $state(0);
  let assetBytes = $state(0);

  // ---- chrome --------------------------------------------------------------
  let mode = $state<Mode>('wysiwyg');
  let sidebarOpen = $state(true);
  let search = $state('');
  let collapsed = $state<ReadonlySet<string>>(new Set());
  let feedback = $state<string | null>(null);
  let feedbackTimer: ReturnType<typeof setTimeout> | undefined;
  /** A `?note=` deep link that resolves to nothing. */
  let missingLink = $state<string | null>(null);
  let exportNote = $state<string | null>(null);
  let printHtml = $state('');
  let editor: MarkdownEditor | undefined = $state();
  let destroyed = false;

  // ---- bulk ----------------------------------------------------------------
  /** Note (the editor) or Bulk (select many, act once). The editor stays
   * mounted behind the Bulk panel so switching costs nothing and autosave
   * is undisturbed. */
  let tab = $state<Tab>('note');
  let selected = $state<ReadonlySet<string>>(new Set());
  let bulkFilter = $state('');
  let bulkTagsText = $state('');
  let bulkParent = $state('');
  let bulkFormat = $state<BulkFormat>('md');
  let bulkBusy = $state(false);
  let bulkNote = $state<string | null>(null);

  // ---- autosave ------------------------------------------------------------
  let saveState = $state<'saved' | 'saving' | 'error' | null>(null);
  let saveTimer: ReturnType<typeof setTimeout> | undefined;

  const current = $derived(notes.find((n) => n.id === currentId) ?? null);
  const tree = $derived(buildTree(notes));
  const filtered = $derived.by(() => {
    const q = search.trim().toLowerCase();
    if (!q) return null;
    return notes
      .filter(
        (n) =>
          displayTitle(n).toLowerCase().includes(q) ||
          n.tags.some((t) => t.toLowerCase().includes(q)) ||
          n.aliases.some((a) => a.toLowerCase().includes(q))
      )
      .sort((a, b) => displayTitle(a).localeCompare(displayTitle(b)));
  });
  const linksHere = $derived(current ? backlinks(notes, current) : []);
  const linksOut = $derived.by(() => {
    if (!current) return [];
    const seen = new Set<string>();
    const out: { title: string; note: Note | null }[] = [];
    for (const link of findWikiLinks(body)) {
      const key = link.title.trim().toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push({ title: link.title, note: resolveNote(notes, link.title) });
    }
    return out;
  });
  const breadcrumb = $derived(current ? ancestorsOf(notes, current) : []);
  /** Parents a note may move under: anything but itself and its descendants. */
  const parentOptions = $derived.by(() => {
    if (!current) return [];
    const forbidden = new Set([current.id, ...descendantsOf(tree, current.id).map((n) => n.id)]);
    return notes
      .filter((n) => !forbidden.has(n.id))
      .sort((a, b) => displayTitle(a).localeCompare(displayTitle(b)));
  });
  const fileStem = $derived((title.trim() || 'note').replace(/[^a-z0-9._-]+/gi, '-'));

  /** The Bulk checklist: the tree in sidebar order, narrowed by the filter. */
  const bulkRows = $derived.by(() => {
    const rows = flattenTree(tree);
    const q = bulkFilter.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (r) =>
        displayTitle(r.note).toLowerCase().includes(q) ||
        r.note.tags.some((t) => t.toLowerCase().includes(q))
    );
  });
  /** Selected notes that still exist, in tree order. */
  const selectedNotes = $derived(flattenTree(tree).map((r) => r.note).filter((n) => selected.has(n.id)));
  const selectedCount = $derived(selectedNotes.length);
  const bulkTargets = $derived(moveTargets(notes, selected));

  function flash(text: string) {
    feedback = text;
    clearTimeout(feedbackTimer);
    feedbackTimer = setTimeout(() => (feedback = null), 2500);
  }

  // ---- wiki links ----------------------------------------------------------

  const wikiHref = (t: string) => href('/tools/notebook/') + '?note=' + encodeURIComponent(t);
  const wikiExists = (t: string) => resolveNote(notes, t) !== null;

  /** A click on `[[Title]]` inside the preview: open it, or create it. */
  async function navigateWiki(t: string) {
    const found = resolveNote(notes, t);
    if (found) {
      await openNote(found);
      return;
    }
    // The unresolved-link affordance: the click IS the request to create.
    await createNote(t.trim() || 'Untitled', currentId);
  }

  // ---- persistence ---------------------------------------------------------

  async function refresh() {
    notes = (await all<Note>('notes')).map(normalizeNote);
  }

  async function loadAssets(noteId: string) {
    const rows = await byIndex<NoteAsset>('note_assets', 'note_id', noteId);
    assetCount = rows.length;
    assetBytes = rows.reduce((sum, r) => sum + (typeof r.bytes === 'number' ? r.bytes : 0), 0);
  }

  async function openNote(row: Note, opts: { remember?: boolean } = {}) {
    if (currentId === row.id) return;
    flushSave();
    const note = normalizeNote(row);
    currentId = note.id;
    title = note.title;
    body = note.body_md;
    tagsText = note.tags.join(', ');
    parentId = note.parent_id;
    aliases = note.aliases;
    savedTitle = note.title;
    renameOffer = null;
    exportNote = null;
    saveState = null;
    missingLink = null;
    const store = noteAssetStore(note.id);
    await store.prime?.();
    if (destroyed || currentId !== note.id) return;
    assetStore = store;
    await loadAssets(note.id);
    if (opts.remember !== false) {
      await putSingleton<Partial<Preferences>>('preferences', { notebook_last_note_id: note.id });
    }
  }

  async function createNote(newTitle: string, parent: string | null) {
    const row = await put<Note>(
      'notes',
      withSyncFields({ title: newTitle, body_md: '', aliases: [], parent_id: parent, tags: [] })
    );
    await refresh();
    const created = notes.find((n) => n.id === row.id);
    if (created) {
      if (parent) collapsed = new Set([...collapsed].filter((id) => id !== parent));
      await openNote(created);
    }
    flash('Note created.');
  }

  function closeNote() {
    flushSave();
    currentId = null;
    assetStore = null;
    saveState = null;
  }

  function scheduleSave() {
    if (!currentId) return;
    saveState = 'saving';
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => void doSave(), SAVE_DEBOUNCE_MS);
  }

  /** Write a pending autosave now. Resolves when the row is written, so a
   * caller about to patch the same row can wait for it (the bulk actions do);
   * everyone else may ignore the promise. */
  function flushSave(): Promise<void> {
    if (saveTimer === undefined) return Promise.resolve();
    clearTimeout(saveTimer);
    saveTimer = undefined;
    return doSave();
  }

  /**
   * Write the last committed snapshot. Renames push the old title to aliases
   * — except the `Untitled` a new note is born with, which is a placeholder,
   * not a name anyone linked to.
   */
  async function doSave() {
    saveTimer = undefined;
    if (!currentId) return;
    const id = currentId;
    const nextTitle = title.trim();
    const oldTitle = savedTitle.trim();
    const renamed =
      oldTitle !== '' && oldTitle.toLowerCase() !== 'untitled' && nextTitle !== '' && nextTitle !== oldTitle;
    const nextAliases = renamed
      ? [...new Set([...aliases, oldTitle])].filter((a) => a.toLowerCase() !== nextTitle.toLowerCase())
      : aliases;
    const changes = {
      title,
      body_md: body,
      aliases: nextAliases,
      parent_id: parentId,
      tags: parseTags(tagsText),
    };
    const row = await patch<Note>('notes', id, changes);
    if (destroyed) return;
    // The row is authoritative whichever note is open now: backlinks and the
    // tree read `notes`, and a switch mid-save must not leave them stale.
    if (row) notes = notes.map((n) => (n.id === id ? normalizeNote(row) : n));
    // Everything below describes the OPEN note; a switch mid-save moved on.
    if (currentId !== id) return;
    if (!row) {
      saveState = 'error';
      return;
    }
    saveState = 'saved';
    aliases = nextAliases;
    savedTitle = title;
    const normalized = normalizeNote(row);
    if (renamed) {
      const linking = backlinks(notes, { ...normalized, title: oldTitle, aliases: [] }).filter(
        (b) => b.note.id !== id
      );
      renameOffer = linking.length > 0 ? { from: oldTitle, to: nextTitle, count: linking.length } : null;
    }
  }

  /** The one explicit bulk action: rewrite `[[Old]]` to `[[New]]` everywhere. */
  async function rewriteLinks() {
    if (!renameOffer || !currentId) return;
    const { from, to } = renameOffer;
    const targets = notes.filter(
      (n) => n.id !== currentId && findWikiLinks(n.body_md).some((l) => l.title.trim().toLowerCase() === from.toLowerCase())
    );
    for (const n of targets) {
      await patch<Note>('notes', n.id, { body_md: rewriteWikiLinks(n.body_md, from, to) });
    }
    await refresh();
    renameOffer = null;
    flash(`Updated ${targets.length} linking note${targets.length === 1 ? '' : 's'}.`);
  }

  async function deleteNote(row: Note) {
    const kids = tree.children.get(row.id) ?? [];
    const prompt =
      kids.length > 0
        ? `Delete “${displayTitle(row)}”? Its ${kids.length} nested note${kids.length === 1 ? '' : 's'} move up a level.`
        : `Delete “${displayTitle(row)}”?`;
    if (!confirm(prompt)) return;
    if (currentId === row.id) {
      clearTimeout(saveTimer);
      saveTimer = undefined;
      currentId = null;
      assetStore = null;
    }
    // Children are reparented, never cascaded: a folder going away is no
    // reason for its pages to. Its images go with it — they are unreachable.
    for (const kid of kids) await patch<Note>('notes', kid.id, { parent_id: row.parent_id });
    const assets = await byIndex<NoteAsset>('note_assets', 'note_id', row.id);
    if (assets.length > 0) await softDeleteMany('note_assets', assets.map((a) => a.id));
    await softDelete('notes', row.id);
    await refresh();
    flash('Note deleted.');
  }

  async function setMode(next: Mode) {
    if (next === mode) return;
    mode = next;
    await putSingleton<Partial<Preferences>>('preferences', { notebook_mode: next });
  }

  function toggleCollapse(id: string) {
    const next = new Set(collapsed);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    collapsed = next;
  }

  // ---- editor plumbing -----------------------------------------------------

  /**
   * The editor reports changes for the note it was mounted on. When a note
   * is switched, the old editor's unmount flush arrives AFTER `currentId`
   * moved, so a change that names a different note is written straight to
   * that note — never into the one that just opened.
   */
  async function onBodyChange(md: string, noteId: string | null) {
    if (noteId && noteId !== currentId) {
      const row = await patch<Note>('notes', noteId, { body_md: md });
      if (destroyed || !row) return;
      notes = notes.map((n) => (n.id === noteId ? normalizeNote(row) : n));
      return;
    }
    body = md;
    scheduleSave();
  }

  function onTitleInput() {
    scheduleSave();
  }

  function onTagsChange() {
    scheduleSave();
  }

  function onParentChange(value: string) {
    parentId = value === '' ? null : value;
    scheduleSave();
  }

  // ---- export --------------------------------------------------------------

  /** Every asset ref in `md`, mapped to the data URL `store` holds. */
  function assetDataUrls(md = body, store: AssetStore | null = assetStore): Map<string, string> {
    const map = new Map<string, string>();
    if (!store?.resolve) return map;
    for (const match of md.matchAll(/asset:[A-Za-z0-9-]+/g)) {
      const ref = match[0];
      const url = store.resolve(ref);
      if (url) map.set(ref, url);
    }
    return map;
  }

  function downloadMarkdown() {
    const md = markdownExport({ title, body_md: body }, { assets: assetDataUrls(), inlineAssets: true });
    downloadText(md, `${fileStem}.md`, 'text/markdown');
  }

  /**
   * Render a note the way the preview does — wiki links, footnotes, maths
   * typeset, diagrams drawn — into an attached off-screen container, so the
   * maths faces can be measured, then lift the HTML out. Defaults to the
   * open note; the bulk export passes each note in turn.
   */
  async function renderForExport(
    md = body,
    assets = assetDataUrls()
  ): Promise<{ html: string; fonts: Awaited<ReturnType<typeof collectMathFonts>>; css: string }> {
    const host = document.createElement('div');
    host.className = 'prose';
    host.style.cssText = 'position:absolute;left:-99999px;top:0;width:60rem;';
    host.innerHTML = renderMarkdown(md, {
      wikiLinks: { href: wikiHref, exists: wikiExists },
      resolveImage: (src) => assets.get(src),
    });
    document.body.append(host);
    try {
      await renderMathIn(host);
      const pres = [...host.querySelectorAll<HTMLElement>('pre.mermaid')];
      if (pres.length > 0) {
        await getMermaid();
        await renderInto(pres);
      }
      const fonts = host.querySelector('.katex') ? await collectMathFonts(host) : [];
      let css = '';
      if (fonts.length > 0) {
        const response = await fetch(href('/math/katex.css'));
        if (response.ok) css = await response.text();
      }
      return { html: host.innerHTML, fonts, css };
    } finally {
      host.remove();
    }
  }

  async function downloadHtml() {
    exportNote = null;
    try {
      const rendered = await renderForExport();
      const doc = htmlExport({
        title: title.trim() || 'Untitled',
        bodyHtml: rendered.html,
        extraCss: rendered.css ? [rendered.css] : [],
        fonts: rendered.fonts,
      });
      const external = externalReferences(doc);
      if (external.length > 0) {
        exportNote = `The file references ${external.length} external URL${external.length === 1 ? '' : 's'} (links you wrote); everything else is inlined.`;
      }
      downloadText(doc, `${fileStem}.html`, 'text/html');
    } catch (err) {
      exportNote = err instanceof Error ? err.message : 'The export did not build.';
    }
  }

  /** Print / Save as PDF: the rendered note, the app's chrome hidden by the
   * print stylesheet. The filename can only come from the document title. */
  async function printNote() {
    exportNote = null;
    try {
      const rendered = await renderForExport();
      printHtml = rendered.html;
      await tick();
      printDocument(title.trim() || 'Untitled');
    } catch (err) {
      exportNote = err instanceof Error ? err.message : 'The note did not render for printing.';
    } finally {
      setTimeout(() => (printHtml = ''), 1000);
    }
  }

  // ---- bulk operations -----------------------------------------------------
  //
  // Every action below writes one patch per changed row and nothing for rows
  // that would not change, flushes the open note's autosave first (so the
  // row it patches is current) and, when the open note is among the
  // selection, updates the editable fields too — otherwise the next autosave
  // would write the old tags or parent straight back.

  function setTab(next: Tab) {
    tab = next;
    bulkNote = null;
  }

  function toggleSelected(id: string) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    selected = next;
  }

  /** Select a note and everything nested inside it. */
  function selectSubtree(id: string) {
    selected = new Set([...selected, ...subtreeIds(tree, id)]);
  }

  function selectAllVisible() {
    selected = new Set([...selected, ...bulkRows.map((r) => r.note.id)]);
  }

  function selectNone() {
    selected = new Set();
  }

  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

  /** One .zip of the selected notes, each its own Markdown or HTML file. */
  async function bulkExport() {
    if (selectedCount === 0 || bulkBusy) return;
    await flushSave();
    bulkBusy = true;
    bulkNote = null;
    try {
      const taken = new Set<string>();
      const entries: ZipEntry[] = [];
      let external = 0;
      for (const note of selectedNotes) {
        // The open note's snapshot may be newer than its row.
        const isOpen = note.id === currentId;
        const noteTitle = isOpen ? title : note.title;
        const md = isOpen ? body : note.body_md;
        let store: AssetStore;
        if (isOpen && assetStore) {
          store = assetStore;
        } else {
          const primed = noteAssetStore(note.id);
          await primed.prime();
          store = primed;
        }
        const assets = assetDataUrls(md, store);
        const name = exportFileName(noteTitle, bulkFormat, taken);
        if (bulkFormat === 'md') {
          entries.push({
            name,
            data: markdownExport({ title: noteTitle, body_md: md }, { assets, inlineAssets: true }),
          });
        } else {
          const rendered = await renderForExport(md, assets);
          const doc = htmlExport({
            title: noteTitle.trim() || 'Untitled',
            bodyHtml: rendered.html,
            extraCss: rendered.css ? [rendered.css] : [],
            fonts: rendered.fonts,
          });
          external += externalReferences(doc).length;
          entries.push({ name, data: doc });
        }
      }
      const stamp = new Date().toISOString().slice(0, 10);
      downloadBlob(zipBlob(entries), `notes-${stamp}.zip`);
      bulkNote =
        `Exported ${plural(entries.length, 'note')} as ${bulkFormat === 'md' ? 'Markdown' : 'HTML'}.` +
        (external > 0 ? ` The files reference ${plural(external, 'external URL')} (links you wrote); everything else is inlined.` : '');
    } catch (err) {
      bulkNote = err instanceof Error ? err.message : 'The export did not build.';
    } finally {
      bulkBusy = false;
    }
  }

  async function bulkTags(action: 'add' | 'remove') {
    const change = parseTags(bulkTagsText);
    if (selectedCount === 0 || change.length === 0 || bulkBusy) return;
    await flushSave();
    bulkBusy = true;
    bulkNote = null;
    try {
      let changed = 0;
      for (const note of selectedNotes) {
        const before = note.id === currentId ? parseTags(tagsText) : note.tags;
        const after = action === 'add' ? addTags(before, change) : removeTags(before, change);
        if (after.length === before.length && after.every((t, i) => t === before[i])) continue;
        const row = await patch<Note>('notes', note.id, { tags: after });
        if (!row) continue;
        changed++;
        if (note.id === currentId) tagsText = after.join(', ');
      }
      await refresh();
      bulkNote = `${action === 'add' ? 'Added' : 'Removed'} ${plural(change.length, 'tag')} on ${plural(changed, 'note')}.`;
    } finally {
      bulkBusy = false;
    }
  }

  /** Move the selection under one parent (or to the top level). */
  async function bulkMove() {
    if (selectedCount === 0 || bulkBusy) return;
    const target = bulkParent === '' ? null : bulkParent;
    // The option list already excludes the selection and its descendants; a
    // stale choice (the target was just deleted) is refused, not obeyed.
    if (target && !bulkTargets.some((n) => n.id === target)) {
      bulkNote = 'That destination is no longer available.';
      return;
    }
    await flushSave();
    bulkBusy = true;
    bulkNote = null;
    try {
      let moved = 0;
      for (const note of selectedNotes) {
        const before = note.id === currentId ? parentId : note.parent_id;
        if (before === target) continue;
        const row = await patch<Note>('notes', note.id, { parent_id: target });
        if (!row) continue;
        moved++;
        if (note.id === currentId) parentId = target;
      }
      if (target) collapsed = new Set([...collapsed].filter((id) => id !== target));
      await refresh();
      const where = target ? `under “${displayTitle(notes.find((n) => n.id === target) ?? { title: '' })}”` : 'to the top level';
      bulkNote = `Moved ${plural(moved, 'note')} ${where}.`;
    } finally {
      bulkBusy = false;
    }
  }

  /**
   * Delete the selection. Nested notes that are not themselves selected move
   * up to their nearest surviving ancestor — never cascaded — and each deleted
   * note's images go with it.
   */
  async function bulkDelete() {
    if (selectedCount === 0 || bulkBusy) return;
    const ids = new Set(selectedNotes.map((n) => n.id));
    const moves = reparentForDelete(notes, ids);
    const prompt =
      moves.size > 0
        ? `Delete ${plural(ids.size, 'note')}? ${plural(moves.size, 'nested note')} inside them move up a level.`
        : `Delete ${plural(ids.size, 'note')}?`;
    if (!confirm(prompt)) return;
    bulkBusy = true;
    bulkNote = null;
    try {
      if (currentId && ids.has(currentId)) {
        clearTimeout(saveTimer);
        saveTimer = undefined;
        currentId = null;
        assetStore = null;
      } else {
        await flushSave();
      }
      for (const [id, parent] of moves) {
        await patch<Note>('notes', id, { parent_id: parent });
        // The open note's snapshot must follow, or its next autosave would
        // write the deleted parent straight back.
        if (id === currentId) parentId = parent;
      }
      for (const id of ids) {
        const assets = await byIndex<NoteAsset>('note_assets', 'note_id', id);
        if (assets.length > 0) await softDeleteMany('note_assets', assets.map((a) => a.id));
      }
      await softDeleteMany('notes', [...ids]);
      await refresh();
      selected = new Set();
      bulkNote = `Deleted ${plural(ids.size, 'note')}.`;
    } finally {
      bulkBusy = false;
    }
  }

  /** Arrow keys move between the two tabs, as a tablist is expected to. */
  function onTabKey(event: KeyboardEvent) {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight' && event.key !== 'Home' && event.key !== 'End') return;
    event.preventDefault();
    const next: Tab = event.key === 'Home' ? 'note' : event.key === 'End' ? 'bulk' : tab === 'note' ? 'bulk' : 'note';
    setTab(next);
    (document.getElementById(`notebook-tab-${next}`) as HTMLElement | null)?.focus();
  }

  // ---- lifecycle -----------------------------------------------------------

  function onPageHide() {
    flushSave();
  }

  function onVisibility() {
    if (document.visibilityState === 'hidden') flushSave();
  }

  onMount(async () => {
    window.addEventListener('pagehide', onPageHide);
    document.addEventListener('visibilitychange', onVisibility);
    // Reading the remembered note and mode writes nothing — page loads must not.
    await refresh();
    const prefs = await getSingleton<Preferences>('preferences');
    if (destroyed) return;
    if (prefs?.notebook_mode === 'source' || prefs?.notebook_mode === 'preview') mode = prefs.notebook_mode;
    const wanted = new URLSearchParams(location.search).get('note');
    if (wanted) {
      const found = resolveNote(notes, wanted);
      if (found) await openNote(found);
      else missingLink = wanted;
      return;
    }
    const remembered = notes.find((n) => n.id === prefs?.notebook_last_note_id);
    if (remembered) await openNote(remembered, { remember: false });
  });

  onDestroy(() => {
    destroyed = true;
    window.removeEventListener('pagehide', onPageHide);
    document.removeEventListener('visibilitychange', onVisibility);
    clearTimeout(feedbackTimer);
    flushSave();
  });
</script>

{#snippet branch(items: Note[], depth: number)}
  {#each items as note (note.id)}
    {@const kids = tree.children.get(note.id) ?? []}
    <li>
      <div class="tree-row" style={`--depth:${depth}`}>
        {#if kids.length > 0}
          <button
            class="collapse-btn"
            data-testid={'notebook-collapse-' + note.id}
            aria-expanded={!collapsed.has(note.id)}
            aria-label={`${collapsed.has(note.id) ? 'Expand' : 'Collapse'} ${displayTitle(note)}`}
            onclick={() => toggleCollapse(note.id)}
          >
            {collapsed.has(note.id) ? '▸' : '▾'}
          </button>
        {:else}
          <span class="collapse-spacer" aria-hidden="true"></span>
        {/if}
        <button
          class="tree-item"
          class:on={note.id === currentId}
          data-testid="notebook-note"
          data-title={displayTitle(note)}
          aria-pressed={note.id === currentId}
          onclick={() => openNote(note)}
        >
          {displayTitle(note)}
        </button>
        <button
          class="icon-btn"
          data-testid={'notebook-new-child-' + note.id}
          aria-label={`New note inside ${displayTitle(note)}`}
          title="New note inside"
          onclick={() => createNote('Untitled', note.id)}>+</button
        >
      </div>
      {#if kids.length > 0 && !collapsed.has(note.id)}
        <ul class="tree">
          {@render branch(kids, depth + 1)}
        </ul>
      {/if}
    </li>
  {/each}
{/snippet}

<div class="page-header">
  <h1>Notebook</h1>
</div>

<div class="layout" class:closed={!sidebarOpen} data-print="hide">
  <aside class="sidebar">
    <div class="row">
      <button
        class="btn btn-sm"
        data-testid="notebook-toggle-library"
        aria-expanded={sidebarOpen}
        onclick={() => (sidebarOpen = !sidebarOpen)}
      >
        {sidebarOpen ? '‹ Notes' : '›'}
      </button>
      {#if sidebarOpen}
        <button
          class="btn btn-sm btn-primary"
          data-testid="notebook-new"
          onclick={() => createNote('Untitled', null)}
        >
          New note
        </button>
      {/if}
    </div>
    {#if sidebarOpen}
      <input
        class="search"
        data-testid="notebook-search"
        type="search"
        placeholder="Search notes and tags…"
        aria-label="Search notes"
        bind:value={search}
      />
      {#if filtered}
        {#if filtered.length === 0}
          <p class="muted small" data-testid="notebook-no-matches">Nothing matches that.</p>
        {:else}
          <ul class="tree flat" data-testid="notebook-search-results">
            {#each filtered as note (note.id)}
              <li>
                <button
                  class="tree-item"
                  class:on={note.id === currentId}
                  data-testid="notebook-note"
                  data-title={displayTitle(note)}
                  aria-pressed={note.id === currentId}
                  onclick={() => openNote(note)}
                >
                  {displayTitle(note)}
                  {#if note.tags.length > 0}
                    <span class="muted small">{note.tags.join(', ')}</span>
                  {/if}
                </button>
              </li>
            {/each}
          </ul>
        {/if}
      {:else if notes.length === 0}
        <p class="muted small" data-testid="notebook-no-notes">No notes yet.</p>
      {:else}
        <ul class="tree" data-testid="notebook-tree">
          {@render branch(tree.roots, 0)}
        </ul>
      {/if}
    {/if}
  </aside>

  <div class="stack main">
    <div class="tabs" role="tablist" aria-label="Notebook views" data-testid="notebook-tabs">
      <button
        type="button"
        role="tab"
        id="notebook-tab-note"
        class="tab"
        class:on={tab === 'note'}
        aria-selected={tab === 'note'}
        aria-controls="notebook-panel-note"
        tabindex={tab === 'note' ? 0 : -1}
        data-testid="notebook-tab-note"
        onclick={() => setTab('note')}
        onkeydown={onTabKey}
      >
        Note
      </button>
      <button
        type="button"
        role="tab"
        id="notebook-tab-bulk"
        class="tab"
        class:on={tab === 'bulk'}
        aria-selected={tab === 'bulk'}
        aria-controls="notebook-panel-bulk"
        tabindex={tab === 'bulk' ? 0 : -1}
        data-testid="notebook-tab-bulk"
        onclick={() => setTab('bulk')}
        onkeydown={onTabKey}
      >
        Bulk
        {#if selectedCount > 0}<span class="tab-count" data-testid="notebook-bulk-count">{selectedCount}</span>{/if}
      </button>
    </div>

    <!-- The Note panel stays mounted behind Bulk: remounting the editor is
         the expensive thing on this page, and autosave must not notice a tab. -->
    <div
      class="stack"
      class:panel-hidden={tab !== 'note'}
      role="tabpanel"
      id="notebook-panel-note"
      aria-labelledby="notebook-tab-note"
      data-testid="notebook-panel-note"
    >
    {#if missingLink}
      <div class="banner warn" data-testid="notebook-missing-link">
        <span>No note called “{missingLink}”.</span>
        <button
          class="btn btn-sm btn-primary"
          data-testid="notebook-create-missing"
          onclick={() => createNote(missingLink ?? 'Untitled', null)}
        >
          Create it
        </button>
      </div>
    {/if}

    {#if !current}
      <Card title="Notebook">
        <p class="muted small" data-testid="notebook-empty">
          Pick a note on the left, or start a new one. Link notes with
          <code>[[Title]]</code>; a link to a note that does not exist yet creates it when
          clicked.
        </p>
      </Card>
    {:else}
      <Card title="Note">
        {#snippet actions()}
          <span class="muted small" data-testid="notebook-save-state" aria-live="polite">
            {saveState === 'saving' ? 'Saving…' : saveState === 'saved' ? 'Saved' : saveState === 'error' ? 'Could not save' : ''}
          </span>
          <button
            class="btn btn-sm"
            data-testid="notebook-close"
            onclick={closeNote}
            title="Close this note">Close</button
          >
          <button
            class="btn btn-sm btn-danger"
            data-testid="notebook-delete"
            onclick={() => current && deleteNote(current)}>Delete</button
          >
        {/snippet}
        <div class="stack">
          {#if breadcrumb.length > 0}
            <nav class="crumbs muted small" aria-label="Location" data-testid="notebook-breadcrumb">
              {#each breadcrumb as crumb (crumb.id)}
                <button class="crumb" onclick={() => openNote(crumb)}>{displayTitle(crumb)}</button>
                <span aria-hidden="true">›</span>
              {/each}
              <span>{displayTitle({ title })}</span>
            </nav>
          {/if}
          <div class="row wrap">
            <label class="inline" for="notebook-title">Title</label>
            <input
              id="notebook-title"
              class="title-input"
              data-testid="notebook-title"
              bind:value={title}
              oninput={onTitleInput}
              placeholder="Untitled"
            />
          </div>
          <div class="row wrap">
            <label class="inline" for="notebook-parent">Inside</label>
            <select
              id="notebook-parent"
              data-testid="notebook-parent"
              value={parentId ?? ''}
              onchange={(e) => onParentChange(e.currentTarget.value)}
            >
              <option value="">— top level —</option>
              {#each parentOptions as option (option.id)}
                <option value={option.id}>{displayTitle(option)}</option>
              {/each}
            </select>
            <label class="inline" for="notebook-tags">Tags</label>
            <input
              id="notebook-tags"
              data-testid="notebook-tags"
              bind:value={tagsText}
              onchange={onTagsChange}
              placeholder="comma, separated"
            />
          </div>
          {#if aliases.length > 0}
            <p class="muted small" data-testid="notebook-aliases">
              Also answers to: {aliases.join(', ')} — old titles, kept so old links still resolve.
            </p>
          {/if}
          {#if renameOffer}
            <div class="row wrap" data-testid="notebook-rename-offer">
              <span class="muted small">
                {renameOffer.count} note{renameOffer.count === 1 ? '' : 's'} still link to “{renameOffer.from}”.
              </span>
              <button class="btn btn-sm" data-testid="notebook-rewrite-links" onclick={rewriteLinks}>
                Update {renameOffer.count === 1 ? 'it' : 'them'} to “{renameOffer.to}”
              </button>
            </div>
          {/if}
        </div>
      </Card>

      {#key currentId}
        {@const editingId = currentId}
        <div class="editor-host" data-testid="notebook-editor-host">
          <MarkdownEditor
            bind:this={editor}
            value={body}
            onChange={(md) => void onBodyChange(md, editingId)}
            assets={assetStore ?? undefined}
            debounce={150}
            {mode}
            onMode={setMode}
            {wikiExists}
            {wikiHref}
            onWikiNavigate={navigateWiki}
            placeholder="Write… Link with [[Title]], cite with Alt+0."
            minHeight="28rem"
          />
        </div>
      {/key}

      <Card title="Links">
        <div class="links">
          <div class="stack tight">
            <span class="label-text">Linked from</span>
            {#if linksHere.length === 0}
              <p class="muted small" data-testid="notebook-no-backlinks">Nothing links here yet.</p>
            {:else}
              <ul class="link-list" data-testid="notebook-backlinks">
                {#each linksHere as entry (entry.note.id)}
                  <li>
                    <button
                      class="link-item"
                      data-testid="notebook-backlink"
                      data-title={displayTitle(entry.note)}
                      onclick={() => openNote(entry.note)}
                    >
                      {displayTitle(entry.note)}
                      <span class="muted small">×{entry.count}</span>
                    </button>
                  </li>
                {/each}
              </ul>
            {/if}
          </div>
          <div class="stack tight">
            <span class="label-text">Links to</span>
            {#if linksOut.length === 0}
              <p class="muted small">No <code>[[links]]</code> in this note.</p>
            {:else}
              <ul class="link-list" data-testid="notebook-outlinks">
                {#each linksOut as entry (entry.title)}
                  <li>
                    <button
                      class="link-item"
                      class:missing={!entry.note}
                      data-testid="notebook-outlink"
                      data-title={entry.title}
                      onclick={() => navigateWiki(entry.title)}
                    >
                      {entry.title}
                      {#if !entry.note}<span class="muted small">— not yet a note; click to create</span>{/if}
                    </button>
                  </li>
                {/each}
              </ul>
            {/if}
          </div>
        </div>
      </Card>

      <Card title="Export">
        <div class="stack">
          <div class="row wrap">
            <button class="btn btn-sm" data-testid="notebook-export-md" onclick={downloadMarkdown}>
              Download Markdown
            </button>
            <button class="btn btn-sm" data-testid="notebook-export-html" onclick={downloadHtml}>
              Download HTML
            </button>
            <button class="btn btn-sm" data-testid="notebook-print" onclick={printNote}>
              Print / Save as PDF
            </button>
            <span class="muted small" data-testid="notebook-asset-summary">
              {assetCount === 0
                ? 'No images.'
                : `${assetCount} image${assetCount === 1 ? '' : 's'}, ${(assetBytes / 1024).toFixed(0)} KB`}
            </span>
          </div>
          {#if exportNote}
            <p class="muted small" data-testid="notebook-export-note">{exportNote}</p>
          {/if}
          <p class="muted small">
            Markdown keeps the source with images inlined as data URLs. HTML is one self-contained
            file — styles, images, typeset maths and diagrams inside it, nothing fetched from
            anywhere. PDF goes through the browser's print dialog, with the app's chrome hidden.
          </p>
        </div>
      </Card>
    {/if}

    {#if feedback}
      <p class="muted small" data-testid="notebook-feedback" aria-live="polite">{feedback}</p>
    {/if}

    <Explainer summary="Linking notes, and what happens when you rename one">
      <p>
        Write <code>[[Title]]</code> — or <code>[[Title|shown text]]</code> — anywhere markdown is
        rendered in this app, and it becomes a link to the note with that title. The same works
        in timer, TODO and event descriptions. A link to a note that does not exist yet is drawn
        differently, and clicking it creates the note.
      </p>
      <p>
        Renaming keeps old links working: the old title is kept as an <strong>alias</strong>, so
        <code>[[Old title]]</code> still resolves. The page also counts the notes that link by the
        old name and offers — once, as one button — to rewrite them. Nothing is rewritten unless
        you press it.
      </p>
      <p>
        <strong>Linked from</strong> is computed each time from the notes themselves, never
        stored, so a restored backup cannot leave it stale.
      </p>
    </Explainer>

    <Explainer summary="What the exports contain">
      <p>
        <strong>Markdown</strong> is the source you wrote, with pasted images inlined as
        <code>data:</code> URLs so the file stands alone. <strong>HTML</strong> is one file with
        its stylesheet, images, typeset maths (and only the maths fonts that page actually
        uses) and diagrams all inside it; it never references this app or any server.
        <strong>Print / Save as PDF</strong> uses the browser's own print dialog with a print
        stylesheet that hides the app around the note — the filename comes from the note's
        title, which is the only thing a page can suggest to that dialog.
      </p>
    </Explainer>
    </div>

    {#if tab === 'bulk'}
      <div
        class="stack"
        role="tabpanel"
        id="notebook-panel-bulk"
        aria-labelledby="notebook-tab-bulk"
        data-testid="notebook-panel-bulk"
      >
        <Card title="Bulk">
          {#snippet actions()}
            <span class="muted small" data-testid="notebook-bulk-selected" aria-live="polite">
              {selectedCount === 0 ? 'Nothing selected' : `${selectedCount} of ${notes.length} selected`}
            </span>
          {/snippet}
          <div class="stack">
            <p class="muted small">
              Tick the notes to act on — <em>all nested</em> on a note ticks everything inside it too —
              then export, tag, move or delete them in one go. Nothing is written until you press an
              action.
            </p>
            <div class="row wrap">
              <input
                class="bulk-filter"
                type="search"
                data-testid="notebook-bulk-filter"
                placeholder="Filter by title or tag…"
                aria-label="Filter the note list"
                bind:value={bulkFilter}
              />
              <button
                class="btn btn-sm"
                data-testid="notebook-bulk-select-all"
                disabled={bulkRows.length === 0}
                onclick={selectAllVisible}
              >
                Select {bulkFilter.trim() ? 'shown' : 'all'} ({bulkRows.length})
              </button>
              <button
                class="btn btn-sm"
                data-testid="notebook-bulk-select-none"
                disabled={selectedCount === 0}
                onclick={selectNone}
              >
                Select none
              </button>
            </div>
            {#if notes.length === 0}
              <p class="muted small" data-testid="notebook-bulk-empty">No notes yet.</p>
            {:else if bulkRows.length === 0}
              <p class="muted small" data-testid="notebook-bulk-no-matches">Nothing matches that.</p>
            {:else}
              <ul class="bulk-list" data-testid="notebook-bulk-list">
                {#each bulkRows as row (row.note.id)}
                  {@const kids = tree.children.get(row.note.id) ?? []}
                  <li class="bulk-row" style={`--depth:${row.depth}`}>
                    <label class="bulk-item" class:on={selected.has(row.note.id)}>
                      <input
                        type="checkbox"
                        data-testid="notebook-bulk-check"
                        data-title={displayTitle(row.note)}
                        aria-label={`Select ${displayTitle(row.note)}`}
                        checked={selected.has(row.note.id)}
                        onchange={() => toggleSelected(row.note.id)}
                      />
                      <span class="bulk-title">{displayTitle(row.note)}</span>
                      {#if row.note.tags.length > 0}
                        <span class="muted small bulk-tags">{row.note.tags.join(', ')}</span>
                      {/if}
                    </label>
                    {#if kids.length > 0}
                      <button
                        class="subtree-btn"
                        type="button"
                        data-testid={'notebook-bulk-subtree-' + row.note.id}
                        title={`Select ${displayTitle(row.note)} and everything inside it`}
                        aria-label={`Select ${displayTitle(row.note)} and everything inside it`}
                        onclick={() => selectSubtree(row.note.id)}
                      >
                        all nested
                      </button>
                    {/if}
                  </li>
                {/each}
              </ul>
            {/if}
          </div>
        </Card>

        <Card title="Actions">
          <div class="stack">
            <fieldset class="bulk-action">
              <legend>Export</legend>
              <div class="row wrap">
                <label class="inline" for="notebook-bulk-format">Format</label>
                <select id="notebook-bulk-format" data-testid="notebook-bulk-format" bind:value={bulkFormat}>
                  <option value="md">Markdown (.md)</option>
                  <option value="html">HTML (.html, self-contained)</option>
                </select>
                <button
                  class="btn btn-sm"
                  data-testid="notebook-bulk-export"
                  disabled={selectedCount === 0 || bulkBusy}
                  onclick={bulkExport}
                >
                  Export {selectedCount === 0 ? '' : selectedCount} as .zip
                </button>
              </div>
              <p class="muted small">
                One file per note inside a single .zip, named after its title. Markdown keeps the
                source with images inlined; HTML is the same self-contained document the single
                export makes.
              </p>
            </fieldset>

            <fieldset class="bulk-action">
              <legend>Tags</legend>
              <div class="row wrap">
                <label class="inline" for="notebook-bulk-tags">Tags</label>
                <input
                  id="notebook-bulk-tags"
                  data-testid="notebook-bulk-tags"
                  bind:value={bulkTagsText}
                  placeholder="comma, separated"
                />
                <button
                  class="btn btn-sm"
                  data-testid="notebook-bulk-tags-add"
                  disabled={selectedCount === 0 || bulkBusy || parseTags(bulkTagsText).length === 0}
                  onclick={() => bulkTags('add')}
                >
                  Add to {selectedCount === 0 ? 'selected' : selectedCount}
                </button>
                <button
                  class="btn btn-sm"
                  data-testid="notebook-bulk-tags-remove"
                  disabled={selectedCount === 0 || bulkBusy || parseTags(bulkTagsText).length === 0}
                  onclick={() => bulkTags('remove')}
                >
                  Remove from {selectedCount === 0 ? 'selected' : selectedCount}
                </button>
              </div>
              <p class="muted small">
                Adding keeps each note's existing tags and skips ones it already has; removing
                matches regardless of case.
              </p>
            </fieldset>

            <fieldset class="bulk-action">
              <legend>Move</legend>
              <div class="row wrap">
                <label class="inline" for="notebook-bulk-parent">Under</label>
                <select id="notebook-bulk-parent" data-testid="notebook-bulk-parent" bind:value={bulkParent}>
                  <option value="">— top level —</option>
                  {#each bulkTargets as option (option.id)}
                    <option value={option.id}>{displayTitle(option)}</option>
                  {/each}
                </select>
                <button
                  class="btn btn-sm"
                  data-testid="notebook-bulk-move"
                  disabled={selectedCount === 0 || bulkBusy}
                  onclick={bulkMove}
                >
                  Move {selectedCount === 0 ? 'selected' : selectedCount}
                </button>
              </div>
              <p class="muted small">
                Selected notes and notes nested inside them are not offered as destinations — a
                note cannot be moved inside itself.
              </p>
            </fieldset>

            <fieldset class="bulk-action">
              <legend>Delete</legend>
              <div class="row wrap">
                <button
                  class="btn btn-sm btn-danger"
                  data-testid="notebook-bulk-delete"
                  disabled={selectedCount === 0 || bulkBusy}
                  onclick={bulkDelete}
                >
                  Delete {selectedCount === 0 ? 'selected' : selectedCount}
                </button>
                <span class="muted small">
                  Nested notes that are not selected move up a level; images stored with the
                  deleted notes go with them. You will be asked to confirm.
                </span>
              </div>
            </fieldset>

            {#if bulkNote}
              <p class="muted small" data-testid="notebook-bulk-note" role="status">{bulkNote}</p>
            {/if}
          </div>
        </Card>
      </div>
    {/if}
  </div>
</div>

{#if printHtml}
  <!-- The print stylesheet shows this and hides the app; it is empty on screen. -->
  <div class="print-only prose" data-testid="notebook-print-sheet">
    <h1>{title.trim() || 'Untitled'}</h1>
    {@html printHtml}
  </div>
{/if}

<style>
  .layout {
    display: grid;
    grid-template-columns: 17rem 1fr;
    gap: var(--space-4);
    align-items: start;
  }

  .layout.closed {
    grid-template-columns: auto 1fr;
  }

  @media (max-width: 52rem) {
    .layout,
    .layout.closed {
      grid-template-columns: 1fr;
    }
  }

  .sidebar {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    position: sticky;
    top: var(--space-3);
    min-width: 0;
  }

  .main {
    min-width: 0;
  }

  .search {
    width: 100%;
  }

  .tree {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .tree-row {
    display: flex;
    align-items: stretch;
    gap: 2px;
    padding-left: calc(var(--depth, 0) * var(--space-3));
  }

  .tree-item,
  .link-item {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 2px;
    padding: var(--space-1) var(--space-2);
    border: 1px solid var(--border-color);
    background: var(--surface-color);
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;
    overflow-wrap: anywhere;
  }

  .tree-item.on {
    border-color: var(--color-primary);
    background: var(--color-primary-soft);
  }

  .link-item.missing {
    border-style: dashed;
  }

  .collapse-btn,
  .collapse-spacer {
    width: 1.2rem;
    flex: none;
  }

  .collapse-btn {
    border: none;
    background: none;
    cursor: pointer;
    color: var(--text-muted-color);
    padding: 0;
    font: inherit;
  }

  .icon-btn {
    border: 1px solid transparent;
    background: none;
    color: var(--text-muted-color);
    cursor: pointer;
    padding: 0 var(--space-2);
    font-size: var(--font-size-lg);
    line-height: 1;
  }

  .icon-btn:hover {
    border-color: var(--color-primary);
    color: var(--color-primary);
  }

  .title-input {
    flex: 1;
    min-width: 12rem;
    font-size: var(--font-size-lg);
  }

  .crumbs {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1);
    align-items: baseline;
  }

  .crumb {
    border: none;
    background: none;
    padding: 0;
    font: inherit;
    color: var(--color-primary);
    cursor: pointer;
    text-decoration: underline;
  }

  .editor-host {
    min-width: 0;
  }

  .links {
    display: flex;
    gap: var(--space-4);
    flex-wrap: wrap;
  }

  .links > div {
    flex: 1 1 16rem;
    min-width: 0;
  }

  .link-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .label-text {
    font-size: var(--font-size-eyebrow);
    letter-spacing: var(--tracking-label);
    text-transform: uppercase;
    color: var(--text-muted-color);
  }

  .banner {
    display: flex;
    gap: var(--space-3);
    align-items: center;
    flex-wrap: wrap;
    padding: var(--space-2) var(--space-3);
    border: 1px solid var(--color-warning);
  }

  .muted {
    color: var(--text-muted-color);
  }

  .small {
    font-size: var(--font-size-sm);
  }

  .inline {
    white-space: nowrap;
  }

  /* ---- tabs ---- */
  .tabs {
    display: flex;
    gap: var(--space-1);
    border-bottom: 1.5px solid var(--border-strong-color);
  }

  .tab {
    border: 1.5px solid transparent;
    border-bottom: none;
    margin-bottom: -1.5px;
    background: none;
    color: var(--text-muted-color);
    font: inherit;
    font-size: var(--font-size-sm);
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: var(--tracking-wide);
    padding: var(--space-2) var(--space-4);
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
  }

  .tab:hover {
    color: var(--text-color);
  }

  .tab.on {
    color: var(--text-color);
    background: var(--surface-color);
    border-color: var(--border-strong-color);
    /* The tab is drawn onto the sheet below: its own edge covers the rule. */
    border-bottom: 1.5px solid var(--surface-color);
  }

  .tab-count {
    font-size: var(--font-size-eyebrow);
    padding: 0 var(--space-2);
    border: 1px solid currentColor;
    line-height: 1.4;
  }

  .panel-hidden {
    display: none;
  }

  /* ---- bulk ---- */
  .bulk-filter {
    flex: 1;
    min-width: 12rem;
  }

  .bulk-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
    max-height: 24rem;
    overflow-y: auto;
  }

  .bulk-row {
    display: flex;
    align-items: stretch;
    gap: 2px;
    padding-left: calc(var(--depth, 0) * var(--space-4));
  }

  .bulk-item {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: baseline;
    gap: var(--space-2);
    padding: var(--space-1) var(--space-2);
    border: 1px solid var(--border-color);
    background: var(--surface-color);
    cursor: pointer;
    overflow-wrap: anywhere;
  }

  .bulk-item.on {
    border-color: var(--color-primary);
    background: var(--color-primary-soft);
  }

  .bulk-item input {
    margin: 0;
    align-self: center;
  }

  .bulk-tags::before {
    content: '— ';
  }

  .subtree-btn {
    border: 1px solid transparent;
    background: none;
    color: var(--text-muted-color);
    cursor: pointer;
    padding: 0 var(--space-2);
    font: inherit;
    font-size: var(--font-size-eyebrow);
    text-transform: uppercase;
    letter-spacing: var(--tracking-wide);
    white-space: nowrap;
  }

  .subtree-btn:hover {
    border-color: var(--color-primary);
    color: var(--color-primary);
  }

  .bulk-action {
    border: 1px solid var(--border-color);
    padding: var(--space-2) var(--space-3) var(--space-3);
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .bulk-action legend {
    font-size: var(--font-size-eyebrow);
    letter-spacing: var(--tracking-label);
    text-transform: uppercase;
    color: var(--text-muted-color);
    padding: 0 var(--space-1);
  }

  .print-only {
    display: none;
  }

  @media print {
    .print-only {
      display: block;
    }
  }
</style>
