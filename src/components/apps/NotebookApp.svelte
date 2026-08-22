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
  let titleField: HTMLInputElement | undefined = $state();
  let destroyed = false;

  /**
   * True from the moment a note is asked for until its fields are on screen.
   *
   * Creating a note writes a row and re-reads the store before the snapshot
   * can be swapped, and for those few milliseconds the title, tags and parent
   * on screen still belong to the note that is on its way out — so a keystroke
   * that lands in them renames THAT note, which is never what someone pressing
   * "New note" meant. The three fields are disabled for the duration; the body
   * needs no lock because the editor reports its changes against the note id
   * it was mounted with, and they are written to that note.
   *
   * The alternative — swapping the snapshot optimistically and writing the row
   * afterwards — closes the window without a lock, but puts a note on screen
   * that does not exist yet. A lock that lasts a frame is the cheaper honesty.
   */
  let switching = $state(false);

  // ---- bulk ----------------------------------------------------------------
  /**
   * Bulk operations live in the sidebar, over the same tree the reader
   * navigates with: a checkbox on every row, and the actions appearing above
   * the search box once something is ticked. There is no separate mode — the
   * open note stays open and editable while a selection is acted on, which is
   * why every action below also updates the open note's snapshot.
   */
  let selected = $state<ReadonlySet<string>>(new Set());
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

  /** Selected notes that still exist, in tree order — the order they export in. */
  const selectedNotes = $derived(flattenTree(tree).filter((n) => selected.has(n.id)));
  const selectedCount = $derived(selectedNotes.length);
  const bulkTargets = $derived(moveTargets(notes, selected));
  /** What "Select all" takes: the search results when searching, else every note. */
  const selectableNotes = $derived(filtered ?? notes);
  /** Whether expanding the selection to nested notes would add anything. */
  const hasUnselectedNested = $derived(
    [...selected].some((id) => subtreeIds(tree, id).some((sub) => !selected.has(sub)))
  );

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
    // The fields now describe the note on screen; typing in them is safe again.
    switching = false;
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
    switching = true;
    let created: Note | undefined;
    try {
      const row = await put<Note>(
        'notes',
        withSyncFields({ title: newTitle, body_md: '', aliases: [], parent_id: parent, tags: [] })
      );
      await refresh();
      created = notes.find((n) => n.id === row.id);
      if (created) {
        if (parent) collapsed = new Set([...collapsed].filter((id) => id !== parent));
        await openNote(created);
      }
    } finally {
      // `openNote` clears it as soon as the snapshot lands; this covers the
      // path where the row cannot be found and it never runs.
      switching = false;
    }
    // A note born as "Untitled" is waiting to be named, so the caret goes
    // there with the placeholder selected — type and it is named, which is
    // what pressing "New note" and typing was always trying to do. A note
    // created from a `[[link]]` already has the name the link gave it, so its
    // title is left alone.
    if (created && newTitle === 'Untitled') {
      await tick();
      titleField?.select();
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
    // The editor debounces too (150 ms, and Milkdown holds a keystroke for
    // 200 ms more), so asking only our own timer for "everything outstanding"
    // misses the last thing typed. `flush()` is synchronous and reports
    // through `onChange`, which sets `body` and arms the timer this then
    // writes — so the order here is what makes an export or a bulk patch see
    // the current text rather than the text from half a second ago.
    editor?.flush();
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
    } else {
      // Deleting one note while another is open — which the library's per-row
      // × made possible — means that other note's row may be about to be
      // patched below. Write what it owes first, so this does not race it.
      await flushSave();
    }
    // Children are reparented, never cascaded: a folder going away is no
    // reason for its pages to. Its images go with it — they are unreachable.
    for (const kid of kids) {
      await patch<Note>('notes', kid.id, { parent_id: row.parent_id });
      // The open note's snapshot must follow it up a level, or its next
      // autosave writes the tombstoned parent back over the reparent — and a
      // parent that is not a live row reads as root, so the note would quietly
      // leave the branch it was just moved into. Same rule as `bulkDelete`.
      if (kid.id === currentId) parentId = row.parent_id;
    }
    const assets = await byIndex<NoteAsset>('note_assets', 'note_id', row.id);
    if (assets.length > 0) await softDeleteMany('note_assets', assets.map((a) => a.id));
    await softDelete('notes', row.id);
    // A tombstoned id must leave the selection: `selectedNotes` re-derives from
    // the tree and would drop it, but `moveTargets` and `hasUnselectedNested`
    // read the raw set.
    if (selected.has(row.id)) selected = new Set([...selected].filter((id) => id !== row.id));
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

  function toggleSelected(id: string) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    selected = next;
    bulkNote = null;
  }

  /**
   * Pull everything nested inside the selection into it. Ticking a note does
   * NOT take its children — a folder is a note, and "delete this note" must
   * not quietly mean "delete the twelve under it" — so taking a branch is one
   * deliberate press.
   */
  function selectNested() {
    const next = new Set(selected);
    for (const id of selected) for (const sub of subtreeIds(tree, id)) next.add(sub);
    selected = next;
    bulkNote = null;
  }

  /** Every note, or — while a search narrows the tree — every note it found. */
  function selectAll() {
    selected = new Set([...selected, ...selectableNotes.map((n) => n.id)]);
    bulkNote = null;
  }

  function selectNone() {
    selected = new Set();
    bulkNote = null;
  }

  /**
   * Folding the library away takes the checkboxes, the count and the actions
   * with it — so it takes the selection too. A tick nobody can see, on a note
   * nobody can see, is state waiting to surprise whoever opens the column back
   * up and presses Delete.
   */
  function toggleSidebar() {
    sidebarOpen = !sidebarOpen;
    if (!sidebarOpen) selectNone();
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

<!--
  One row of the library: the collapse arrow (or its spacer, so titles line up),
  the selection checkbox bulk operations read, the note itself, and the two
  per-note actions. `kids` is empty for a search result — the flat list has no
  branches to open, but keeps the spacer so both lists rule to the same margin.
-->
{#snippet noteRow(note: Note, depth: number, kids: Note[], withTags: boolean)}
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
    <input
      class="pick"
      type="checkbox"
      data-testid="notebook-bulk-check"
      data-title={displayTitle(note)}
      aria-label={`Select ${displayTitle(note)}`}
      checked={selected.has(note.id)}
      onchange={() => toggleSelected(note.id)}
    />
    <button
      class="tree-item"
      class:on={note.id === currentId}
      data-testid="notebook-note"
      data-title={displayTitle(note)}
      aria-pressed={note.id === currentId}
      onclick={() => openNote(note)}
    >
      {displayTitle(note)}
      {#if withTags && note.tags.length > 0}
        <span class="muted small">{note.tags.join(', ')}</span>
      {/if}
    </button>
    <button
      class="icon-btn"
      data-testid={'notebook-new-child-' + note.id}
      aria-label={`New note inside ${displayTitle(note)}`}
      title="New note inside"
      onclick={() => createNote('Untitled', note.id)}>+</button
    >
    <button
      class="icon-btn danger"
      data-testid={'notebook-delete-' + note.id}
      aria-label={`Delete ${displayTitle(note)}`}
      title="Delete this note"
      onclick={() => deleteNote(note)}>×</button
    >
  </div>
{/snippet}

{#snippet branch(items: Note[], depth: number)}
  {#each items as note (note.id)}
    {@const kids = tree.children.get(note.id) ?? []}
    <li>
      {@render noteRow(note, depth, kids, false)}
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
        onclick={toggleSidebar}
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
      <!--
        Bulk operations belong beside the checkboxes that feed them, not behind
        a mode: they appear the moment something is ticked and go away when the
        selection is cleared, so the column reads as a library the rest of the
        time. The open note stays open throughout.
      -->
      {#if selectedCount > 0}
        <section class="bulk" aria-label="Bulk operations" data-testid="notebook-bulk">
          <div class="bulk-head">
            <span class="label-text" data-testid="notebook-bulk-selected" aria-live="polite">
              {selectedCount} selected
            </span>
            <button class="link-btn" data-testid="notebook-bulk-select-none" onclick={selectNone}>
              Clear
            </button>
          </div>
          <div class="row">
            <button class="btn btn-sm" data-testid="notebook-bulk-select-all" onclick={selectAll}>
              {search.trim() ? `All ${selectableNotes.length} shown` : `All ${notes.length}`}
            </button>
            <button
              class="btn btn-sm"
              data-testid="notebook-bulk-select-nested"
              disabled={!hasUnselectedNested}
              title="Add every note nested inside the selection"
              onclick={selectNested}
            >
              + Nested
            </button>
          </div>

          <div class="bulk-action">
            <label class="label-text" for="notebook-bulk-format">Export</label>
            <div class="row">
              <select id="notebook-bulk-format" data-testid="notebook-bulk-format" bind:value={bulkFormat}>
                <option value="md">Markdown</option>
                <option value="html">HTML</option>
              </select>
              <button
                class="btn btn-sm"
                data-testid="notebook-bulk-export"
                disabled={bulkBusy}
                title="One file per note, in a .zip"
                onclick={bulkExport}
              >
                .zip
              </button>
            </div>
          </div>

          <div class="bulk-action">
            <label class="label-text" for="notebook-bulk-tags">Tags</label>
            <input
              id="notebook-bulk-tags"
              data-testid="notebook-bulk-tags"
              bind:value={bulkTagsText}
              placeholder="comma, separated"
            />
            <div class="row">
              <button
                class="btn btn-sm"
                data-testid="notebook-bulk-tags-add"
                disabled={bulkBusy || parseTags(bulkTagsText).length === 0}
                onclick={() => bulkTags('add')}
              >
                Add
              </button>
              <button
                class="btn btn-sm"
                data-testid="notebook-bulk-tags-remove"
                disabled={bulkBusy || parseTags(bulkTagsText).length === 0}
                onclick={() => bulkTags('remove')}
              >
                Remove
              </button>
            </div>
          </div>

          <div class="bulk-action">
            <label class="label-text" for="notebook-bulk-parent">Move under</label>
            <select id="notebook-bulk-parent" data-testid="notebook-bulk-parent" bind:value={bulkParent}>
              <option value="">— top level —</option>
              {#each bulkTargets as option (option.id)}
                <option value={option.id}>{displayTitle(option)}</option>
              {/each}
            </select>
            <button
              class="btn btn-sm"
              data-testid="notebook-bulk-move"
              disabled={bulkBusy}
              onclick={bulkMove}
            >
              Move {selectedCount}
            </button>
          </div>

          <div class="bulk-action">
            <button
              class="btn btn-sm btn-danger"
              data-testid="notebook-bulk-delete"
              disabled={bulkBusy}
              title="Nested notes that are not selected move up a level"
              onclick={bulkDelete}
            >
              Delete {selectedCount}
            </button>
          </div>

        </section>
      {/if}
      <!--
        The result line lives OUTSIDE the block it reports on: deleting the
        selection empties it, which unmounts the block — and a receipt that
        vanishes in the same tick it is written is no receipt at all. Kept
        mounted (hidden only while empty) so it reads as one status region
        rather than a new one each time.
      -->
      <p
        class="bulk-note muted small"
        data-testid="notebook-bulk-note"
        role="status"
      >{bulkNote ?? ''}</p>
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
                {@render noteRow(note, 0, [], true)}
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
      <Card>
        <!-- The card's header IS the note's title: one field, where the name
             of the thing belongs, rather than a card labelled "Note" with the
             title filed underneath it. -->
        {#snippet heading()}
          <!-- Still an <h2>: the card keeps one heading, and a textbox inside a
               heading contributes its VALUE to the accessible name, so heading
               navigation announces the note's actual title. -->
          <h2 class="note-heading">
            <input
              id="notebook-title"
              class="note-title"
              data-testid="notebook-title"
              aria-label="Note title"
              bind:this={titleField}
              bind:value={title}
              oninput={onTitleInput}
              disabled={switching}
              placeholder="Untitled"
            />
          </h2>
        {/snippet}
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
            <!-- Ancestors only: the note's own name is the card's header now,
                 so repeating it here would say it twice. The separator leads
                 each crumb rather than trailing it, which is also what stops a
                 dangling "›" where the self-crumb used to be. -->
            <nav class="crumbs muted small" aria-label="Location" data-testid="notebook-breadcrumb">
              {#each breadcrumb as crumb, i (crumb.id)}
                {#if i > 0}<span aria-hidden="true">›</span>{/if}
                <button class="crumb" onclick={() => openNote(crumb)}>{displayTitle(crumb)}</button>
              {/each}
            </nav>
          {/if}
          <div class="row wrap">
            <label class="inline" for="notebook-parent">Inside</label>
            <select
              id="notebook-parent"
              data-testid="notebook-parent"
              value={parentId ?? ''}
              onchange={(e) => onParentChange(e.currentTarget.value)}
              disabled={switching}
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
              disabled={switching}
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

  .sidebar {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    position: sticky;
    top: var(--space-3);
    min-width: 0;
    /* A sticky column cannot be scrolled to: whatever falls past the fold is
       unreachable. With the bulk block taking the top of it, the library has
       to scroll inside itself. */
    /* dvh, not vh: on a phone the URL bar is part of 100vh but not of the
       screen you can see. */
    max-height: calc(100dvh - var(--navbar-height) - var(--space-5));
    overflow-y: auto;
  }

  @media (max-width: 52rem) {
    .layout,
    .layout.closed {
      grid-template-columns: 1fr;
    }

    /* Stacked, the library is a band across the top of the page rather than a
       column beside it — the page's own scrollbar reaches all of it. */
    .sidebar {
      position: static;
      max-height: none;
      overflow-y: visible;
    }
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

  /* The card header IS the title: a field that reads as a heading, ruled
     underneath rather than boxed, so the header still reads as a header. */
  .note-heading {
    flex: 1 1 12rem;
    min-width: 0;
    font-weight: 600;
  }

  .note-title {
    width: 100%;
    min-width: 0;
    border: none;
    border-bottom: 1.5px solid transparent;
    background: none;
    padding: 0;
    font: inherit;
    font-size: var(--font-size-lg);
    letter-spacing: var(--tracking-wide);
    color: var(--text-color);
  }

  .note-title:hover {
    border-bottom-color: var(--border-color);
  }

  /* No `outline: none` here: the stamp ring is how every other field in the
     app says it has focus, and a title that opted out of it would be the one
     control that goes quiet. The rule underneath is an extra, not a swap. */
  .note-title:focus {
    border-bottom-color: var(--color-primary);
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

  /* ---- the library's rows ---- */
  .pick {
    flex: none;
    align-self: center;
    margin: 0;
  }

  .icon-btn.danger:hover {
    border-color: var(--color-danger);
    color: var(--color-danger);
  }

  /* ---- bulk operations, in the sidebar ---- */
  .bulk {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-3) var(--space-3);
    border: 1.5px solid var(--color-primary);
    background: var(--surface-color);
    /* A <select> is as wide as its longest option unless it is told it may
       shrink, and one long note title would push the whole block out of the
       column. Every level down to the control gets min-width: 0. */
    min-width: 0;
  }

  .bulk-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--space-2);
  }

  .bulk-action {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    padding-top: var(--space-2);
    border-top: 1px dashed var(--border-color);
    min-width: 0;
  }

  .bulk .row {
    min-width: 0;
  }

  /* Every control in the column is full width: at 17rem there is no room for
     a label and its field on one line. */
  .bulk-action select,
  .bulk-action input {
    width: 100%;
    min-width: 0;
  }

  .bulk .btn {
    flex: 1;
    min-width: 0;
  }

  .bulk-note:empty {
    display: none;
  }

  .link-btn {
    border: none;
    background: none;
    padding: 0;
    font: inherit;
    font-size: var(--font-size-sm);
    color: var(--color-primary);
    cursor: pointer;
    text-decoration: underline;
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
