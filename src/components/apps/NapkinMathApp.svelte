<script lang="ts">
  /**
   * Napkin math — self-documenting back-of-the-envelope calculations.
   *
   * Type a formula; its free variables become typed input fields; run named
   * calculations against it; keep a library of templates; generate code from
   * any of it.
   *
   * Two things shape the whole component:
   *
   * **Variables come from the engine, not from a tree walk.** `expr.unknowns`
   * already excludes bound indices and constants, so `\sum_{i=1}^{n} i` asks
   * for `n` and not `i`, and `\pi r^2` asks for `r` and not π. Walking the
   * tree gets both wrong and asks the user to supply a value for pi.
   *
   * **A result is only shown when it is a real, finite number.** The engine
   * reports `sqrt(-4)` with a real part of 0, so reading that alone would
   * display a very convincing zero for the square root of a negative.
   */
  import { onDestroy, onMount } from 'svelte';
  import Card from '../Card.svelte';
  import Explainer from '../Explainer.svelte';
  import MathField from '../MathField.svelte';
  import CodeBlock from '../CodeBlock.svelte';
  import CodeInput from '../CodeInput.svelte';
  import { copyPng, copyText, downloadBlob, downloadText } from '../../lib/exportFile';
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
  import type { NapkinCalculation, NapkinField, NapkinTemplate, Preferences } from '../../lib/db/types';
  import { boxJson, evaluateFormula, parseFormula } from '../../lib/napkin/engine';
  import type { ComparedCalculation } from '../../lib/napkin/exportImage';
  import {
    checkValues,
    describeConstraint,
    normalizeField,
    orphanedFields,
    reconcileFields,
  } from '../../lib/napkin/model';
  import {
    calculationsToJson,
    ImportError,
    parseCalculations,
    parseTemplates,
    templatesToJson,
    templateToJson,
  } from '../../lib/napkin/transfer';
  import { EXTENSIONS, generateFunction, LANGUAGE_LABELS, UnsupportedOperator, type Language } from '../../lib/codegen/functions';
  import { generateWebComponent } from '../../lib/codegen/webcomponent';
  import { allFontsCss, renderFormula } from '../../lib/codegen/formulaMarkup';

  type Target = Language | 'webcomponent';

  /**
   * Skeletons for the operations nobody can type from memory.
   *
   * Each one already parses and already has bounds, so the field list appears
   * immediately and the reader edits a working formula rather than fighting a
   * half-finished one. The index is `x` rather than `i`, because a bare `i` is
   * the imaginary unit to the engine.
   */
  const INSERTS: { id: string; label: string; title: string; latex: string }[] = [
    {
      id: 'sum',
      label: '\u2211 Sum',
      title: 'Sum over a range',
      latex: String.raw`\sum_{x=1}^{n}\left(x\right)`,
    },
    {
      id: 'product',
      label: '\u220F Product',
      title: 'Product over a range',
      latex: String.raw`\prod_{x=1}^{n}\left(x\right)`,
    },
    {
      id: 'integral',
      label: '\u222B Integral',
      title: 'Definite integral',
      latex: String.raw`\int_{0}^{1}\left(x^2\right)dx`,
    },
    {
      id: 'fraction',
      label: '\u00F7 Fraction',
      title: 'Fraction',
      latex: String.raw`\frac{a}{b}`,
    },
    {
      id: 'root',
      label: '\u221A Root',
      title: 'Square root',
      latex: String.raw`\sqrt{x}`,
    },
  ];

  const TARGETS: { id: Target; label: string }[] = [
    { id: 'python', label: LANGUAGE_LABELS.python },
    { id: 'javascript', label: LANGUAGE_LABELS.javascript },
    { id: 'go', label: LANGUAGE_LABELS.go },
    { id: 'rust', label: LANGUAGE_LABELS.rust },
    { id: 'webcomponent', label: 'Web component' },
  ];

  // ---- the open template ---------------------------------------------------
  let templates = $state<NapkinTemplate[]>([]);
  let currentId = $state<string | null>(null);
  let name = $state('');
  let description = $state('');
  let formulaLatex = $state('');
  let formulaJson = $state<unknown>(null);
  let fields = $state<NapkinField[]>([]);
  let formulaError = $state<string | null>(null);
  let dropped = $state<string[]>([]);

  // ---- calculations --------------------------------------------------------
  let calculations = $state<NapkinCalculation[]>([]);
  let inputs = $state<Record<string, number | string | null>>({});
  let calcName = $state('');
  let editingCalcId = $state<string | null>(null);
  let result = $state<number | null>(null);
  let resultNote = $state<string | null>(null);
  /** Why the last Save could not happen, shown beside the button. */
  let calcError = $state<string | null>(null);

  // ---- chrome --------------------------------------------------------------
  let sidebarOpen = $state(true);
  let search = $state('');
  let feedback = $state<string | null>(null);
  let feedbackTimer: ReturnType<typeof setTimeout> | undefined;
  let importText = $state('');
  let importError = $state<string | null>(null);
  let target = $state<Target>('python');
  let generated = $state('');
  let generateError = $state<string | null>(null);
  /** What the last generate did that is worth saying out loud. */
  let generatedNote = $state<string | null>(null);
  /**
   * Whether the web component carries the maths fonts itself.
   *
   * On, one file works anywhere. Off, the file is ~26 KB lighter per component
   * and the page supplies the faces once for all of them — which is the better
   * trade the moment there is more than one.
   */
  let embedFonts = $state(true);
  /** Set when a generated component is relying on the page for its fonts. */
  let needsSharedFonts = $state(false);
  let fileInput: HTMLInputElement | undefined = $state();
  let formulaField: ReturnType<typeof MathField> | undefined = $state();
  let destroyed = false;
  /** Bumped per formula parse; a stale parse must not overwrite a newer one. */
  let parseToken = 0;
  /** Bumped per evaluation, same reason. */
  let evalToken = 0;

  /* ---- the image export (0.5.0 Phase 3) ---------------------------------- */
  /**
   * Everything this dialog needs — the SVG builder, the Compute Engine's
   * non-canonical parse, the rasteriser — is loaded on the first click and
   * not before. The napkin page already carries MathLive; it should not also
   * carry a feature most visits never open.
   */
  let imageOpen = $state(false);
  let imageDialog: HTMLDialogElement | undefined = $state();
  /**
   * The three rows of the picture (0.6.0 Phase 1). Each can be left out, and
   * each caption can be turned off or reworded. Like theme and scale this is
   * per-session: it is never written to the template.
   */
  type ImageRowKey = 'formula' | 'substituted' | 'result';
  interface ImageRow {
    show: boolean;
    captionOn: boolean;
    caption: string;
  }
  const IMAGE_ROWS: readonly { key: ImageRowKey; title: string }[] = [
    { key: 'formula', title: 'Formula' },
    { key: 'substituted', title: 'With your values' },
    { key: 'result', title: 'Result' },
  ];
  const DEFAULT_CAPTIONS: Record<ImageRowKey, string> = {
    formula: 'Formula',
    substituted: 'With your values',
    result: 'Result',
  };
  const freshImageRows = (): Record<ImageRowKey, ImageRow> => ({
    formula: { show: true, captionOn: true, caption: DEFAULT_CAPTIONS.formula },
    substituted: { show: true, captionOn: true, caption: DEFAULT_CAPTIONS.substituted },
    result: { show: true, captionOn: true, caption: DEFAULT_CAPTIONS.result },
  });
  let imageRows = $state<Record<ImageRowKey, ImageRow>>(freshImageRows());
  let showImageTitle = $state(true);
  /** The caption the renderer gets: blank when off, and blank means none. */
  const rowLabel = (key: ImageRowKey): string =>
    imageRows[key].captionOn ? imageRows[key].caption.trim() : '';
  function resetCaptions() {
    for (const { key } of IMAGE_ROWS) {
      imageRows[key].captionOn = true;
      imageRows[key].caption = DEFAULT_CAPTIONS[key];
    }
  }
  /**
   * Comparisons (0.6.0 feedback round 1): other calculations drawn in the
   * same picture, so option 1 and option 2 of a rental sit side by side.
   *
   * A template stores no values — only a saved calculation does — so the
   * candidates are saved calculations, from this template or from any other
   * whose formula is the same string. Like every other option in this dialog
   * the list is per-session: nothing here is written, and nothing is read
   * beyond the calculation rows that already exist.
   */
  interface CompareCandidate {
    id: string;
    /** The saved calculation's own name. */
    name: string;
    templateName: string;
    /** Saved against the template that is open, rather than a twin of it. */
    ownTemplate: boolean;
    values: Record<string, number>;
  }
  interface CompareEntry {
    id: string;
    caption: string;
    candidate: CompareCandidate;
  }
  let compareCandidates = $state<CompareCandidate[]>([]);
  let compareChoice = $state('');
  let imageCompare = $state<CompareEntry[]>([]);
  /** Caption above the current calculation's rows; blank keeps the row caption. */
  let imageCurrentTitle = $state('');
  /** Candidates not yet in the picture — adding one twice says nothing new. */
  const compareOptions = $derived(
    compareCandidates.filter((c) => !imageCompare.some((e) => e.id === c.id))
  );
  const candidateLabel = (c: CompareCandidate): string =>
    c.ownTemplate ? c.name : `${c.templateName} › ${c.name}`;
  /** `revenue = 12500, cost = 4750` — what the picture will substitute. */
  const describeValues = (values: Record<string, number>): string =>
    Object.entries(values)
      .map(([key, value]) => `${key} = ${value}`)
      .join(', ') || 'no values';

  /**
   * Find every saved calculation whose template has this exact formula.
   * Reads only; a stale entry (its calculation deleted since, or the formula
   * edited out from under it) is dropped rather than drawn with the wrong
   * numbers.
   */
  async function loadCompareCandidates() {
    const wanted = formulaLatex.trim();
    const twins = new Map<string, NapkinTemplate>();
    for (const t of templates) {
      if (t.formula_latex.trim() === wanted) twins.set(t.id, t);
    }
    const rows = wanted ? await all<NapkinCalculation>('napkin_calculations') : [];
    if (destroyed) return;
    compareCandidates = rows
      .filter((c: NapkinCalculation) => twins.has(c.template_id))
      .map((c: NapkinCalculation) => ({
        id: c.id,
        name: c.name,
        templateName: twins.get(c.template_id)!.name,
        ownTemplate: c.template_id === currentId,
        values: { ...c.values },
      }))
      .sort((a, b) => Number(b.ownTemplate) - Number(a.ownTemplate) || candidateLabel(a).localeCompare(candidateLabel(b)));
    const known = new Set(compareCandidates.map((c) => c.id));
    imageCompare = imageCompare.filter((e) => known.has(e.id));
    if (!known.has(compareChoice)) compareChoice = compareOptions[0]?.id ?? '';
  }

  function addComparison() {
    const candidate = compareOptions.find((c) => c.id === compareChoice);
    if (!candidate) return;
    imageCompare.push({ id: candidate.id, caption: candidate.name, candidate });
    compareChoice = compareOptions[0]?.id ?? '';
  }

  function removeComparison(index: number) {
    imageCompare.splice(index, 1);
    if (!compareChoice) compareChoice = compareOptions[0]?.id ?? '';
  }
  let imageTheme = $state<'light' | 'dark'>('light');
  let imageTransparent = $state(false);
  let imageDecimals = $state('auto');
  let imageScale = $state('2');
  /** The rendered SVG source, and a blob URL of it for the preview. */
  let imageSvg = $state<string | null>(null);
  let imageUrl = $state<string | null>(null);
  let imageWidth = $state(0);
  let imageHeight = $state(0);
  let imageFontBytes = $state(0);
  let imageNote = $state<string | null>(null);
  let imageError = $state<string | null>(null);
  let imageBusy = $state(false);
  /** Bumped per rebuild; a stale render must not replace a newer one. */
  let imageToken = 0;

  const filtered = $derived(
    search.trim()
      ? templates.filter((t: NapkinTemplate) =>
          `${t.name} ${t.description}`.toLowerCase().includes(search.trim().toLowerCase())
        )
      : templates
  );
  const problems = $derived(checkValues(fields, readInputs()));
  /**
   * The problems worth showing right now.
   *
   * An empty required field is not a mistake, it is a field nobody has reached
   * yet — complaining about it the moment the formula appears is noise, and it
   * crowds out the field's own description. The result readout already says
   * "fill in every input", which is the honest version of the same news.
   */
  const shownProblems = $derived.by(() => {
    const raw = inputs;
    const out: Record<string, string> = {};
    for (const [key, problem] of Object.entries(problems)) {
      const value = raw[key];
      const touched = value !== undefined && value !== null && String(value).trim() !== '';
      if (touched) out[key] = problem;
    }
    return out;
  });
  /**
   * A formula is all a template needs.
   *
   * Requiring a name too is what made "Save calculation" silently refuse: the
   * button was live, the template had never been written, and the only clue
   * was a transient line at the far end of a long page.
   */
  const canSaveTemplate = $derived(formulaLatex.trim().length > 0 && !!formulaJson);
  const liveJson = $derived(
    templateToJson({ name, description, formulaLatex, formulaJson, fields })
  );
  const fileStem = $derived((name.trim() || 'template').replace(/[^a-z0-9._-]+/gi, '-'));

  /* ---- the image export -------------------------------------------------- */

  const decimalsValue = (): number | null =>
    imageDecimals === 'auto' ? null : Number(imageDecimals);

  function releaseImageUrl() {
    if (imageUrl) URL.revokeObjectURL(imageUrl);
    imageUrl = null;
  }

  /**
   * Rebuild the picture from the current options.
   *
   * The preview is an `<img>` of a blob URL rather than inlined markup. That
   * is the safe choice — an SVG in an `<img>` cannot run script, and the
   * markup here is derived from user-typed LaTeX — and also the honest one:
   * it is exactly the pipeline the PNG goes through, so a preview that draws
   * is a PNG that will draw.
   */
  async function rebuildImage() {
    const token = ++imageToken;
    imageBusy = true;
    imageError = null;
    try {
      const [{ buildCalculationSvg, comparisonRows, formatNumberLatex }, { substitutedLatex }] =
        await Promise.all([
          import('../../lib/napkin/exportImage'),
          import('../../lib/napkin/substitute'),
        ]);
      if (token !== imageToken || destroyed) return;

      const notes: string[] = [];
      const formatted = (value: number) => `= ${formatNumberLatex(value, decimalsValue())}`;

      // The current calculation first, exactly as the single picture has it.
      const calculations: ComparedCalculation[] = [];
      {
        let substituted: string | null = null;
        if (imageRows.substituted.show) {
          const subbed = await substitutedLatex(formulaLatex, readInputs());
          if (token !== imageToken || destroyed) return;
          if (subbed.ok) substituted = subbed.latex;
          else notes.push(subbed.reason);
        }
        calculations.push({
          title: imageCurrentTitle,
          substituted,
          result: imageRows.result.show && result !== null ? formatted(result) : null,
        });
      }

      // Then each comparison, substituted and evaluated from its saved values.
      // The saved `result` is not reused: the formula may have moved on since.
      for (const entry of imageCompare) {
        const values = entry.candidate.values;
        let substituted: string | null = null;
        let evaluated: string | null = null;
        if (imageRows.substituted.show) {
          const subbed = await substitutedLatex(formulaLatex, values);
          if (token !== imageToken || destroyed) return;
          if (subbed.ok) substituted = subbed.latex;
          else notes.push(`${entry.candidate.name}: ${subbed.reason}`);
        }
        if (imageRows.result.show && formulaJson) {
          const answer = await evaluateFormula(await boxJson(formulaJson), values);
          if (token !== imageToken || destroyed) return;
          if (answer.value !== null) evaluated = formatted(answer.value);
          else if (answer.error) notes.push(`${entry.candidate.name}: ${answer.error}`);
        }
        calculations.push({ title: entry.caption, substituted, result: evaluated });
      }

      const rows = comparisonRows({
        formula: imageRows.formula.show ? { label: rowLabel('formula'), latex: formulaLatex } : null,
        substitutedLabel: rowLabel('substituted'),
        resultLabel: rowLabel('result'),
        calculations,
      });
      const note = notes.length > 0 ? notes.join(' ') : null;

      if (rows.length === 0) {
        releaseImageUrl();
        imageSvg = null;
        imageError = note ?? 'Nothing selected to draw.';
        return;
      }

      const built = await buildCalculationSvg(rows, {
        title: showImageTitle ? name.trim() : '',
        theme: imageTheme,
        transparent: imageTransparent,
      });
      if (token !== imageToken || destroyed) return;
      if (!built) {
        imageError = 'The formula could not be typeset.';
        return;
      }

      releaseImageUrl();
      imageSvg = built.svg;
      imageWidth = built.width;
      imageHeight = built.height;
      imageFontBytes = built.fontBytes;
      imageNote = note;
      imageUrl = URL.createObjectURL(new Blob([built.svg], { type: 'image/svg+xml' }));
    } catch (err) {
      if (token !== imageToken || destroyed) return;
      imageError = err instanceof Error ? err.message : 'The picture could not be built.';
    } finally {
      if (token === imageToken) imageBusy = false;
    }
  }

  async function openImageDialog() {
    imageOpen = true;
    void rebuildImage();
    await loadCompareCandidates();
  }

  function closeImageDialog() {
    imageOpen = false;
    releaseImageUrl();
    imageSvg = null;
    imageError = null;
    imageNote = null;
  }

  // The dialog is opened from an effect rather than the click, because
  // `showModal()` is what brings the backdrop, the focus trap and Escape.
  $effect(() => {
    const dialog = imageDialog;
    if (!dialog) return;
    if (imageOpen && !dialog.open) dialog.showModal();
    if (!imageOpen && dialog.open) dialog.close();
  });

  // Any option change re-renders, but only while the dialog is actually open.
  $effect(() => {
    for (const { key } of IMAGE_ROWS) {
      void imageRows[key].show;
      void imageRows[key].captionOn;
      void imageRows[key].caption;
    }
    void showImageTitle;
    void imageTheme;
    void imageTransparent;
    void imageDecimals;
    void imageCurrentTitle;
    for (const entry of imageCompare) void entry.caption;
    if (imageOpen) void rebuildImage();
  });

  async function downloadImageSvg() {
    if (!imageSvg) return;
    const { imageFilename } = await import('../../lib/napkin/exportImage');
    downloadText(imageSvg, imageFilename(name, 'svg'), 'image/svg+xml');
    flash('SVG downloaded');
  }

  async function rasterize(): Promise<Blob | null> {
    if (!imageSvg) return null;
    const { svgToPngBlob } = await import('../../lib/raster/svgToPng');
    const out = await svgToPngBlob(imageSvg, { scale: Number(imageScale) });
    if (!out.ok) {
      imageError = out.message;
      return null;
    }
    return out.blob;
  }

  async function downloadImagePng() {
    const blob = await rasterize();
    if (!blob) return;
    const { imageFilename } = await import('../../lib/napkin/exportImage');
    downloadBlob(blob, imageFilename(name, 'png'));
    flash('PNG downloaded');
  }

  async function copyImagePng() {
    const blob = await rasterize();
    if (!blob) return;
    flash((await copyPng(blob)) ? 'PNG copied' : 'Could not copy the image');
  }

  function flash(text: string) {
    feedback = text;
    clearTimeout(feedbackTimer);
    feedbackTimer = setTimeout(() => (feedback = null), 2500);
  }

  /**
   * Every field's typed value as a number, or null where it is unusable.
   *
   * The bound value is a NUMBER, not a string: `bind:value` on
   * `<input type="number">` coerces, and hands back `null` for an empty or
   * unparseable box. Treating it as a string here is how this went wrong the
   * first time.
   */
  function readInputs(): Record<string, number | null> {
    const out: Record<string, number | null> = {};
    for (const field of fields) {
      const raw = inputs[field.name];
      const parsed = typeof raw === 'number' ? raw : raw === undefined || raw === null || String(raw).trim() === '' ? NaN : Number(raw);
      out[field.name] = Number.isFinite(parsed) ? parsed : null;
    }
    return out;
  }

  // ---- the formula ---------------------------------------------------------

  /**
   * Everything the Code card is showing, forgotten.
   *
   * Called whenever the formula changes or a different template is opened. A
   * generated file, and especially a refusal like "this formula uses Sum",
   * describes ONE formula — leaving either on screen after the formula moved
   * on is a statement about something that no longer exists.
   */
  function resetGenerator() {
    generated = '';
    generateError = null;
    generatedNote = null;
    needsSharedFonts = false;
  }

  /** Reparse the formula and rebuild the field list around it. */
  async function onFormulaChange(latex: string) {
    formulaLatex = latex;
    // Before the await, so a slow parse cannot leave a stale error up.
    resetGenerator();
    const mine = ++parseToken;
    const parsed = await parseFormula(latex);
    if (destroyed || mine !== parseToken) return;
    formulaError = parsed.error;
    formulaJson = parsed.json;
    dropped = orphanedFields(parsed.variables, fields).map((f) => f.label);
    fields = reconcileFields(parsed.variables, fields);
    // A field that no longer exists should not keep a stale typed value.
    const known = new Set(fields.map((f) => f.name));
    inputs = Object.fromEntries(Object.entries(inputs).filter(([key]) => known.has(key)));
    await recompute();
  }

  /** Evaluate at the current inputs, or say why there is no answer. */
  async function recompute() {
    const mine = ++evalToken;
    if (!formulaJson || fields.length === 0) {
      result = null;
      resultNote = formulaJson ? null : 'Write a formula to get started.';
      return;
    }
    const values = readInputs();
    if (Object.keys(checkValues(fields, values)).length > 0) {
      result = null;
      resultNote = null;
      return;
    }
    try {
      const expr = await boxJson(formulaJson);
      const evaluated = await evaluateFormula(expr, values);
      if (destroyed || mine !== evalToken) return;
      result = evaluated.value;
      resultNote = evaluated.error;
    } catch (err) {
      if (destroyed || mine !== evalToken) return;
      result = null;
      resultNote = err instanceof Error ? err.message : 'That did not evaluate.';
    }
  }

  // ---- persistence ---------------------------------------------------------

  async function refresh() {
    templates = (await all<NapkinTemplate>('napkin_templates')).sort(
      (a: NapkinTemplate, b: NapkinTemplate) => a.name.localeCompare(b.name)
    );
  }

  async function openTemplate(row: NapkinTemplate) {
    currentId = row.id;
    name = row.name;
    description = row.description;
    formulaLatex = row.formula_latex;
    formulaJson = row.formula_json;
    // A template saved before a property existed comes back without it.
    fields = row.fields.map(normalizeField);
    inputs = {};
    calcName = '';
    editingCalcId = null;
    resetGenerator();
    formulaError = null;
    dropped = [];
    calculations = await byIndex<NapkinCalculation>('napkin_calculations', 'template_id', row.id);
    await putSingleton<Partial<Preferences>>('preferences', { napkin_last_template_id: row.id });
    await recompute();
  }

  function newTemplate() {
    currentId = null;
    name = '';
    description = '';
    formulaLatex = '';
    formulaJson = null;
    fields = [];
    inputs = {};
    calculations = [];
    calcName = '';
    editingCalcId = null;
    calcError = null;
    resetGenerator();
    formulaError = null;
    dropped = [];
    result = null;
    resultNote = 'Write a formula to get started.';
  }

  async function saveTemplate() {
    if (!canSaveTemplate) return;
    const body = {
      // A template saved from the calculation card may never have been named.
      name: name.trim() || 'Untitled',
      description,
      formula_latex: formulaLatex,
      formula_json: formulaJson,
      fields: fields.map((f) => ({ ...f })),
    };
    if (currentId) {
      await patch<NapkinTemplate>('napkin_templates', currentId, body);
    } else {
      const row = await put<NapkinTemplate>('napkin_templates', withSyncFields(body));
      currentId = row.id;
      await putSingleton<Partial<Preferences>>('preferences', { napkin_last_template_id: row.id });
    }
    await refresh();
    flash('Template saved.');
  }

  async function deleteTemplate(row: NapkinTemplate) {
    if (!confirm(`Delete “${row.name}” and every calculation saved against it?`)) return;
    const owned = (
      await byIndex<NapkinCalculation>('napkin_calculations', 'template_id', row.id)
    ).map((c: NapkinCalculation) => c.id);
    // Children first: a calculation whose template is gone is unreachable.
    if (owned.length > 0) await softDeleteMany('napkin_calculations', owned);
    await softDelete('napkin_templates', row.id);
    await refresh();
    if (currentId === row.id) newTemplate();
    flash('Template deleted.');
  }

  async function saveCalculation() {
    // Saving a calculation means you want to keep this formula, so save the
    // template first rather than refusing and making the reader guess.
    if (!currentId) {
      if (!canSaveTemplate) {
        calcError = 'Write a formula first.';
        return;
      }
      await saveTemplate();
      if (!currentId) return;
    }
    calcError = null;
    const values: Record<string, number> = {};
    for (const [key, value] of Object.entries(readInputs())) {
      if (value !== null) values[key] = value;
    }
    const body = { template_id: currentId, name: calcName.trim() || 'Untitled', values, result };
    if (editingCalcId) {
      await patch<NapkinCalculation>('napkin_calculations', editingCalcId, body);
    } else {
      await put<NapkinCalculation>('napkin_calculations', withSyncFields(body));
    }
    calculations = await byIndex<NapkinCalculation>(
      'napkin_calculations',
      'template_id',
      currentId
    );
    editingCalcId = null;
    calcName = '';
    flash('Calculation saved.');
  }

  async function recallCalculation(row: NapkinCalculation) {
    editingCalcId = row.id;
    calcName = row.name;
    inputs = { ...row.values };
    await recompute();
  }

  async function deleteCalculation(row: NapkinCalculation) {
    await softDelete('napkin_calculations', row.id);
    calculations = calculations.filter((c: NapkinCalculation) => c.id !== row.id);
    if (editingCalcId === row.id) {
      editingCalcId = null;
      calcName = '';
    }
  }

  // ---- transfer ------------------------------------------------------------

  async function copyJson() {
    flash((await copyText(liveJson)) ? 'Copied the template JSON.' : 'Clipboard blocked — download instead.');
  }

  function downloadTemplate() {
    downloadText(liveJson, `${fileStem}.json`, 'application/json');
  }

  function downloadAllTemplates() {
    const docs = templates.map((t: NapkinTemplate) => ({
      name: t.name,
      description: t.description,
      formulaLatex: t.formula_latex,
      formulaJson: t.formula_json,
      fields: t.fields,
    }));
    downloadText(templatesToJson(docs), 'napkin-templates.json', 'application/json');
  }

  function downloadCalculations() {
    downloadText(
      calculationsToJson(
        name,
        calculations.map((c: NapkinCalculation) => ({
          name: c.name,
          values: c.values,
          result: c.result,
        }))
      ),
      `${fileStem}-calculations.json`,
      'application/json'
    );
  }

  /** Import whichever of the two documents the text turns out to be. */
  async function runImport(text: string) {
    importError = null;
    const trimmed = text.trim();
    if (!trimmed) {
      importError = 'Paste some JSON first.';
      return;
    }
    try {
      // Calculations first: they are the narrower shape, and trying a template
      // parse on them gives a less useful message.
      if (trimmed.includes('useful-napkin-calculations')) {
        if (!currentId) {
          importError = 'Open a template before importing calculations for it.';
          return;
        }
        const docs = parseCalculations(trimmed, fields);
        for (const doc of docs) {
          await put<NapkinCalculation>(
            'napkin_calculations',
            withSyncFields({
              template_id: currentId,
              name: doc.name,
              values: doc.values,
              result: doc.result,
            })
          );
        }
        calculations = await byIndex<NapkinCalculation>(
          'napkin_calculations',
          'template_id',
          currentId
        );
        flash(`Imported ${docs.length} calculation${docs.length === 1 ? '' : 's'}.`);
        importText = '';
        return;
      }

      const docs = parseTemplates(trimmed);
      let last: NapkinTemplate | null = null;
      for (const doc of docs) {
        // The formula is reparsed rather than trusted, so a file whose
        // MathJSON disagrees with its LaTeX cannot mislead the generator.
        const parsed = await parseFormula(doc.formulaLatex);
        last = await put<NapkinTemplate>(
          'napkin_templates',
          withSyncFields({
            name: doc.name,
            description: doc.description,
            formula_latex: doc.formulaLatex,
            formula_json: parsed.json,
            fields: reconcileFields(parsed.variables, doc.fields),
          })
        );
      }
      await refresh();
      if (last) await openTemplate(last);
      flash(`Imported ${docs.length} template${docs.length === 1 ? '' : 's'}.`);
      importText = '';
    } catch (err) {
      importError =
        err instanceof ImportError ? err.message : err instanceof Error ? err.message : 'That did not import.';
    }
  }

  async function onImportFile(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    await runImport(await file.text());
  }

  // ---- code generation -----------------------------------------------------

  async function generate() {
    resetGenerator();
    if (!formulaJson) {
      generateError = 'Write a formula first.';
      return;
    }
    const template = {
      name: name.trim() || 'calculation',
      description,
      formulaLatex,
      formulaJson,
      fields,
    };
    try {
      if (target === 'webcomponent') {
        // The typeset formula, with the layout rules and — unless the reader
        // asked otherwise — the few KaTeX faces it needs inlined.
        const rendered = await renderFormula(formulaLatex, { embedFonts });
        generated = generateWebComponent(template, rendered ?? undefined);
        needsSharedFonts = !!rendered && !embedFonts;
        generatedNote = !rendered
          ? 'The formula is shown as text: it could not be typeset.'
          : embedFonts
            ? `Typeset formula, ${Math.round(rendered.fontBytes / 1024)} KB of fonts inlined.`
            : `Typeset formula, fonts left out. The page must supply ${listOf(rendered.families)} — see below.`;
      } else {
        generated = generateFunction(template, target);
      }
    } catch (err) {
      // A named refusal, not a silently wrong function.
      generateError =
        err instanceof UnsupportedOperator
          ? err.message
          : err instanceof Error
            ? err.message
            : 'That formula could not be turned into code.';
    }
  }

  /** The Prism grammar for whatever the Code card is currently showing. */
  const generatedLanguage = $derived(target === 'webcomponent' ? 'javascript' : target);

  const generatedFilename = $derived(
    target === 'webcomponent' ? `${fileStem}.js` : `${fileStem}.${EXTENSIONS[target as Language]}`
  );

  /** "a", "a and b", "a, b and c" — three faces joined by "and" reads badly. */
  function listOf(items: readonly string[]): string {
    if (items.length <= 1) return items[0] ?? '';
    return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
  }

  /** The shared stylesheet: every face, for a page hosting several components. */
  async function downloadFontsCss() {
    try {
      downloadText(await allFontsCss(), 'napkin-math-fonts.css', 'text/css');
      flash('Downloaded the shared fonts stylesheet.');
    } catch (err) {
      generateError = err instanceof Error ? err.message : 'Could not build the fonts stylesheet.';
    }
  }

  async function copyGenerated() {
    flash((await copyText(generated)) ? 'Copied the code.' : 'Clipboard blocked — download instead.');
  }

  function downloadGenerated() {
    downloadText(generated, generatedFilename, 'text/plain');
  }

  // ---- lifecycle -----------------------------------------------------------

  onMount(async () => {
    // Reading the remembered template writes nothing — page loads must not.
    await refresh();
    const prefs = await getSingleton<Preferences>('preferences');
    const remembered = templates.find(
      (t: NapkinTemplate) => t.id === prefs?.napkin_last_template_id
    );
    if (remembered) await openTemplate(remembered);
    else newTemplate();
  });

  onDestroy(() => {
    destroyed = true;
    clearTimeout(feedbackTimer);
  });
</script>

<div class="page-header">
  <h1>Napkin math</h1>
</div>

<div class="layout" class:closed={!sidebarOpen}>
  <aside class="sidebar">
    <div class="row">
      <button
        class="btn btn-sm"
        data-testid="napkin-toggle-library"
        aria-expanded={sidebarOpen}
        onclick={() => (sidebarOpen = !sidebarOpen)}
      >
        {sidebarOpen ? '‹ Library' : '›'}
      </button>
      {#if sidebarOpen}
        <button class="btn btn-sm btn-primary" data-testid="napkin-new" onclick={newTemplate}>
          New
        </button>
      {/if}
    </div>
    {#if sidebarOpen}
      <input
        class="search"
        data-testid="napkin-search"
        type="search"
        placeholder="Search templates…"
        aria-label="Search templates"
        bind:value={search}
      />
      {#if filtered.length === 0}
        <p class="muted small" data-testid="napkin-no-templates">
          {templates.length === 0 ? 'No templates saved yet.' : 'Nothing matches that.'}
        </p>
      {:else}
        <ul class="library" data-testid="napkin-library">
          {#each filtered as row (row.id)}
            <li>
              <button
                class="library-item"
                class:on={row.id === currentId}
                data-testid="napkin-template"
                data-name={row.name}
                aria-pressed={row.id === currentId}
                onclick={() => openTemplate(row)}
              >
                <span class="library-name">{row.name}</span>
                {#if row.description}
                  <span class="muted small">{row.description}</span>
                {/if}
              </button>
              <button
                class="icon-btn"
                data-testid="napkin-delete-template"
                aria-label={`Delete ${row.name}`}
                onclick={() => deleteTemplate(row)}>×</button
              >
            </li>
          {/each}
        </ul>
      {/if}
    {/if}
  </aside>

  <div class="stack main">
    <Card title="Template">
      {#snippet actions()}
        <button
          class="btn btn-sm btn-primary"
          data-testid="napkin-save-template"
          disabled={!canSaveTemplate}
          onclick={saveTemplate}>Save template</button
        >
      {/snippet}
      <div class="stack">
        <div class="row wrap">
          <label class="inline" for="napkin-name">Name</label>
          <input id="napkin-name" data-testid="napkin-name" bind:value={name} placeholder="Unit economics" />
        </div>
        <div class="field">
          <label class="inline" for="napkin-formula">Formula</label>
          <MathField
            bind:this={formulaField}
            bind:value={formulaLatex}
            testid="napkin-formula"
            ariaLabel="Formula"
            onchange={onFormulaChange}
          />
          <div class="row wrap inserts" role="group" aria-label="Insert an operation">
            {#each INSERTS as item (item.id)}
              <button
                class="btn btn-sm"
                data-testid={'napkin-insert-' + item.id}
                title={item.title}
                onclick={() => formulaField?.insert(item.latex)}
              >
                {item.label}
              </button>
            {/each}
          </div>
          {#if formulaError}
            <p class="form-error" data-testid="napkin-formula-error">{formulaError}</p>
          {/if}
          <p class="muted small">
            Type a name like <code>count</code> and it becomes one variable, not five letters
            multiplied together.
          </p>
        </div>
        <div class="field">
          <label class="inline" for="napkin-description">Description</label>
          <textarea
            id="napkin-description"
            data-testid="napkin-description"
            rows="2"
            bind:value={description}
            placeholder="What this works out, and when to reach for it."
          ></textarea>
        </div>
      </div>
    </Card>

    <Card title="Fields">
      {#if fields.length === 0}
        <p class="muted small" data-testid="napkin-no-fields">
          The formula's variables appear here as soon as it has any.
        </p>
      {:else}
        {#if dropped.length > 0}
          <p class="muted small" data-testid="napkin-dropped">
            Dropped {dropped.join(', ')} — the formula no longer uses {dropped.length === 1 ? 'it' : 'them'}.
          </p>
        {/if}
        <ul class="fields" data-testid="napkin-fields">
          {#each fields as field, i (field.name)}
            <li class="row wrap" data-testid="napkin-field" data-name={field.name}>
              <code class="field-name">{field.name}</code>
              <input
                class="label-input"
                data-testid={'napkin-field-label-' + field.name}
                bind:value={fields[i]!.label}
                placeholder="Label"
                aria-label={`Label for ${field.name}`}
              />
              <input
                class="description-input"
                data-testid={'napkin-field-description-' + field.name}
                bind:value={fields[i]!.description}
                placeholder="What it means"
                aria-label={`Description of ${field.name}`}
              />
              <label class="check">
                <input
                  type="checkbox"
                  data-testid={'napkin-field-type-' + field.name}
                  checked={field.type === 'integer'}
                  onchange={(e) =>
                    (fields[i]!.type = e.currentTarget.checked ? 'integer' : 'number')}
                />
                <span>No decimals</span>
              </label>
              <select
                data-testid={'napkin-field-sign-' + field.name}
                bind:value={fields[i]!.sign}
                aria-label={`Allowed signs for ${field.name}`}
              >
                <option value="any">Positive or negative</option>
                <option value="positive">Positive only</option>
              </select>
              <label class="check">
                <input
                  type="checkbox"
                  data-testid={'napkin-field-nozero-' + field.name}
                  bind:checked={fields[i]!.noZero}
                />
                <span>No zero</span>
              </label>
              <label class="check">
                <input
                  type="checkbox"
                  data-testid={'napkin-field-required-' + field.name}
                  bind:checked={fields[i]!.required}
                />
                <span>Required</span>
              </label>
              <span class="muted small">{describeConstraint(field)}</span>
            </li>
          {/each}
        </ul>
      {/if}
    </Card>

    <Card title="Calculations">
      <div class="calc-row">
        <div class="stack tight calc-inputs">
          {#if fields.length === 0}
            <p class="muted small">Nothing to fill in yet.</p>
          {:else}
            {#each fields as field (field.name)}
              <div class="row wrap">
                <label class="inline calc-label" for={'napkin-input-' + field.name}>
                  {field.label}
                </label>
                <input
                  id={'napkin-input-' + field.name}
                  data-testid={'napkin-input-' + field.name}
                  type="number"
                  step={field.type === 'integer' ? '1' : 'any'}
                  bind:value={inputs[field.name]}
                  oninput={recompute}
                />
                {#if shownProblems[field.name]}
                  <span class="form-error small" data-testid={'napkin-problem-' + field.name}>
                    {shownProblems[field.name]}
                  </span>
                {:else if field.description}
                  <span class="muted small" data-testid={'napkin-hint-' + field.name}>
                    {field.description}
                  </span>
                {/if}
              </div>
            {/each}

            <div class="row wrap result-row">
              <span class="label-text">Result</span>
              <strong class="result" data-testid="napkin-result">
                {result === null ? '—' : result}
              </strong>
              {#if resultNote}
                <span class="muted small" data-testid="napkin-result-note">{resultNote}</span>
              {/if}
            </div>

            <div class="row wrap">
              <input
                data-testid="napkin-calc-name"
                bind:value={calcName}
                placeholder="Name this calculation"
                aria-label="Calculation name"
              />
              <button class="btn btn-sm" data-testid="napkin-save-calc" onclick={saveCalculation}>
                {editingCalcId ? 'Update' : 'Save'}
              </button>
              {#if calcError}
                <span class="form-error small" data-testid="napkin-calc-error">{calcError}</span>
              {/if}
              {#if editingCalcId}
                <button
                  class="btn btn-sm"
                  data-testid="napkin-cancel-calc"
                  onclick={() => {
                    editingCalcId = null;
                    calcName = '';
                  }}>New</button
                >
              {/if}
            </div>
          {/if}

          {#if formulaJson}
            <div class="row wrap image-row">
              <button
                class="btn btn-sm"
                data-testid="napkin-export-image"
                onclick={openImageDialog}
              >
                Export image
              </button>
              <span class="muted small">
                The formula, the same formula with your numbers written into it,
                and the answer — as a picture, for a document or a message.
              </span>
            </div>
          {/if}
        </div>

        <div class="stack tight history">
          <span class="label-text">Saved</span>
          {#if calculations.length === 0}
            <p class="muted small" data-testid="napkin-no-calcs">Nothing saved against this template.</p>
          {:else}
            <ul class="calc-list" data-testid="napkin-calcs">
              {#each calculations as row (row.id)}
                <li>
                  <button
                    class="calc-item"
                    class:on={row.id === editingCalcId}
                    data-testid="napkin-calc"
                    data-name={row.name}
                    onclick={() => recallCalculation(row)}
                  >
                    <span>{row.name}</span>
                    <span class="muted small">{row.result ?? '—'}</span>
                  </button>
                  <button
                    class="icon-btn"
                    data-testid="napkin-delete-calc"
                    aria-label={`Delete ${row.name}`}
                    onclick={() => deleteCalculation(row)}>×</button
                  >
                </li>
              {/each}
            </ul>
          {/if}
        </div>
      </div>
    </Card>

    <Card title="Code">
      <div class="stack">
        <div class="row wrap">
          <label class="inline" for="napkin-language">Language</label>
          <select id="napkin-language" data-testid="napkin-language" bind:value={target}>
            {#each TARGETS as option (option.id)}
              <option value={option.id}>{option.label}</option>
            {/each}
          </select>
          {#if target === 'webcomponent'}
            <label class="check">
              <input
                type="checkbox"
                data-testid="napkin-embed-fonts"
                bind:checked={embedFonts}
              />
              <span>Include the maths fonts</span>
            </label>
          {/if}
          <button class="btn btn-sm btn-primary" data-testid="napkin-generate" onclick={generate}>
            Generate
          </button>
          {#if generated}
            <button class="btn btn-sm" data-testid="napkin-copy-code" onclick={copyGenerated}>
              Copy text
            </button>
            <button class="btn btn-sm" data-testid="napkin-download-code" onclick={downloadGenerated}>
              Download
            </button>
          {/if}
        </div>
        {#if generateError}
          <p class="form-error" data-testid="napkin-generate-error">{generateError}</p>
        {/if}
        {#if generatedNote}
          <p class="muted small" data-testid="napkin-generate-note">{generatedNote}</p>
        {/if}
        {#if needsSharedFonts}
          <div class="row wrap">
            <button
              class="btn btn-sm"
              data-testid="napkin-download-fonts"
              onclick={downloadFontsCss}
            >
              Download the shared fonts stylesheet
            </button>
            <span class="muted small">
              Link it once per page and every component on it will find the faces.
            </span>
          </div>
        {/if}
        {#if generated}
          <CodeBlock code={generated} language={generatedLanguage} testid="napkin-code" />
        {/if}
      </div>
    </Card>

    <Card title="Export &amp; import">
      <div class="stack">
        <div class="row wrap">
          <button class="btn btn-sm" data-testid="napkin-copy-json" onclick={copyJson}>Copy JSON</button>
          <button class="btn btn-sm" data-testid="napkin-download-template" onclick={downloadTemplate}>
            Download this template
          </button>
          <button
            class="btn btn-sm"
            data-testid="napkin-download-all"
            disabled={templates.length === 0}
            onclick={downloadAllTemplates}>Download all templates</button
          >
          <button
            class="btn btn-sm"
            data-testid="napkin-download-calcs"
            disabled={calculations.length === 0}
            onclick={downloadCalculations}>Download all calculations</button
          >
        </div>
        <!-- The live JSON carries the TEMPLATE only. Sharing a formula should
             not hand over the numbers somebody ran through it. -->
        <CodeBlock code={liveJson} language="json" testid="napkin-json" maxHeight="12rem" />

        <div class="row wrap">
          <button class="btn btn-sm" data-testid="napkin-import" onclick={() => runImport(importText)}>
            Import JSON
          </button>
          <button class="btn btn-sm" data-testid="napkin-import-file" onclick={() => fileInput?.click()}>
            Choose a file…
          </button>
          <input
            class="visually-hidden"
            bind:this={fileInput}
            type="file"
            accept="application/json,.json"
            aria-label="Import a JSON file"
            onchange={onImportFile}
          />
        </div>
        <CodeInput
          bind:value={importText}
          language="json"
          rows={4}
          testid="napkin-import-text"
          ariaLabel="JSON to import"
          placeholder="Paste a template or a calculations file here."
        />
        {#if importError}
          <p class="form-error" data-testid="napkin-import-error">{importError}</p>
        {/if}
      </div>
    </Card>

    {#if feedback}
      <p class="muted small" data-testid="napkin-feedback" aria-live="polite">{feedback}</p>
    {/if}

    <Explainer summary="How the fields appear">
      <p>
        The fields come from the formula's <strong>free variables</strong> — the names it needs a
        value for. Constants are not among them: <code>π r²</code> asks for <code>r</code> alone,
        and a sum's index is bound by the sum, so <code>Σ</code> from 1 to <code>n</code> asks for
        <code>n</code> and not <code>i</code>.
      </p>
      <p>
        Editing a formula keeps the settings of every variable that survived, so adding one term
        does not reset the others. A variable the formula stopped using has its field removed —
        it would be asked for and then ignored.
      </p>
    </Explainer>

    <Explainer summary="What the generated code does and does not do">
      <p>
        Each field's rules come across as <strong>guard clauses</strong>, so a generated function
        refuses what this page refuses rather than quietly computing from a value you would have
        been warned about.
      </p>
      <p>
        Where a language disagrees with the maths, the generated file carries a small helper rather
        than the language's own function. Rounding is the clearest case: this page rounds a half
        away from zero, Python's <code>round</code> rounds to even, and JavaScript's
        <code>Math.round</code> rounds upwards — so <code>-2.5</code> would come back as three
        different numbers. The same goes for the remainder of a negative number.
      </p>
      <p>
        An operator the generator has no rule for is <strong>refused by name</strong>. It will not
        guess.
      </p>
      <h3>Sharing one copy of the maths fonts</h3>
      <p>
        A web component carries the KaTeX faces its own formula needs, so a single file works on a
        page that has never heard of this app. Put two or three components on one page and you have
        shipped those faces two or three times.
      </p>
      <p>
        To send them once instead: turn <strong>Include the maths fonts</strong> off before you
        generate, then use <strong>Download the shared fonts stylesheet</strong> for a single file
        carrying all twenty faces. Link it in the page's <code>&lt;head&gt;</code> and every
        component on the page will find them — <code>@font-face</code> belongs to the document, not
        to a shadow root, so one declaration reaches inside all of them.
      </p>
      <pre class="code snippet">&lt;link rel="stylesheet" href="napkin-math-fonts.css"&gt;
&lt;script type="module" src="rent-per-year.js"&gt;&lt;/script&gt;
&lt;script type="module" src="unit-margin.js"&gt;&lt;/script&gt;

&lt;rent-per-year&gt;&lt;/rent-per-year&gt;
&lt;unit-margin&gt;&lt;/unit-margin&gt;</pre>
      <p>
        Without the fonts a component still <em>lays out</em> correctly — the positioning is all
        CSS — it just draws in whatever serif the page has. So a missing stylesheet is a plainer
        formula, never a broken one.
      </p>
    </Explainer>
  </div>
</div>

<!-- The image export. A native <dialog>, so Escape, the focus trap and the
     backdrop cost nothing to have. -->
<dialog
  bind:this={imageDialog}
  class="image-dialog"
  data-testid="napkin-image-dialog"
  onclose={() => (imageOpen = false)}
  onclick={(e) => e.target === imageDialog && closeImageDialog()}
>
  <div class="image-head">
    <h2>Export image</h2>
    <button class="btn btn-sm" data-testid="napkin-image-close" onclick={closeImageDialog}>Close</button>
  </div>

  <div class="image-body">
    <div class="image-options">
      <fieldset>
        <legend class="eyebrow">Rows</legend>
        {#each IMAGE_ROWS as { key, title } (key)}
          <div class="image-row">
            <label class="check">
              <input type="checkbox" data-testid={`napkin-image-row-${key}`} bind:checked={imageRows[key].show} />
              <span>{title}</span>
            </label>
            <label class="check muted small">
              <input
                type="checkbox"
                aria-label={`${title} caption`}
                data-testid={`napkin-image-caption-on-${key}`}
                bind:checked={imageRows[key].captionOn}
              />
              <span>caption</span>
            </label>
            <input
              type="text"
              class="image-caption"
              aria-label={`${title} caption text`}
              placeholder="No caption"
              data-testid={`napkin-image-caption-${key}`}
              disabled={!imageRows[key].show || !imageRows[key].captionOn}
              bind:value={imageRows[key].caption}
            />
          </div>
        {/each}
        <label class="check">
          <input type="checkbox" data-testid="napkin-image-title" bind:checked={showImageTitle} />
          <span>Title</span>
        </label>
        <button
          type="button"
          class="btn btn-sm image-captions-reset"
          data-testid="napkin-image-captions-reset"
          onclick={resetCaptions}
        >
          Reset captions
        </button>
      </fieldset>

      <!-- Other saved calculations of the same formula, drawn alongside. -->
      <fieldset data-testid="napkin-image-compare">
        <legend class="eyebrow">Compare with</legend>
        {#if compareCandidates.length === 0}
          <p class="muted small" data-testid="napkin-image-compare-none">
            No stored calculation uses this formula.
          </p>
        {:else}
          <div class="image-row">
            <select
              class="image-compare-select"
              aria-label="Saved calculation to compare with"
              data-testid="napkin-image-compare-select"
              disabled={compareOptions.length === 0}
              bind:value={compareChoice}
            >
              {#each compareOptions as candidate (candidate.id)}
                <option value={candidate.id}>{candidateLabel(candidate)}</option>
              {/each}
            </select>
            <button
              type="button"
              class="btn btn-sm"
              data-testid="napkin-image-compare-add"
              disabled={!compareOptions.some((c) => c.id === compareChoice)}
              onclick={addComparison}
            >
              Add
            </button>
          </div>
        {/if}
        {#if imageCompare.length > 0}
          <div class="image-row">
            <label class="inline small" for="napkin-image-current-title">Title for this calculation</label>
            <input
              id="napkin-image-current-title"
              type="text"
              class="image-caption"
              placeholder="Current"
              data-testid="napkin-image-current-title"
              bind:value={imageCurrentTitle}
            />
          </div>
          <ul class="image-compare-list">
            {#each imageCompare as entry, i (entry.id)}
              <li data-testid={`napkin-image-compare-${i}`}>
                <div class="image-row">
                  <input
                    type="text"
                    class="image-caption"
                    aria-label={`Caption for ${entry.candidate.name}`}
                    placeholder="No caption"
                    data-testid={`napkin-image-compare-caption-${i}`}
                    bind:value={imageCompare[i]!.caption}
                  />
                  <button
                    type="button"
                    class="icon-btn"
                    aria-label={`Remove ${entry.candidate.name} from the picture`}
                    data-testid={`napkin-image-compare-remove-${i}`}
                    onclick={() => removeComparison(i)}>×</button
                  >
                </div>
                <span class="muted small">
                  {#if !entry.candidate.ownTemplate}{entry.candidate.templateName} › {/if}{entry.candidate.name}: {describeValues(entry.candidate.values)}
                </span>
              </li>
            {/each}
          </ul>
        {/if}
      </fieldset>

      <div>
        <label for="napkin-image-theme">Theme</label>
        <select id="napkin-image-theme" data-testid="napkin-image-theme" bind:value={imageTheme}>
          <option value="light">Light</option>
          <option value="dark">Dark</option>
        </select>
      </div>

      <label class="check">
        <input type="checkbox" data-testid="napkin-image-transparent" bind:checked={imageTransparent} />
        <span>Transparent background</span>
      </label>

      <div>
        <label for="napkin-image-decimals">Decimals in the result</label>
        <select id="napkin-image-decimals" data-testid="napkin-image-decimals" bind:value={imageDecimals}>
          <option value="auto">As shown on the page</option>
          <option value="0">0</option>
          <option value="1">1</option>
          <option value="2">2</option>
          <option value="3">3</option>
          <option value="4">4</option>
        </select>
      </div>

      <div>
        <label for="napkin-image-scale">PNG size</label>
        <select id="napkin-image-scale" data-testid="napkin-image-scale" bind:value={imageScale}>
          <option value="1">1x</option>
          <option value="2">2x</option>
          <option value="3">3x</option>
        </select>
      </div>
    </div>

    <div class="image-preview">
      {#if imageBusy && !imageUrl}
        <p class="muted" aria-live="polite">Rendering...</p>
      {/if}
      {#if imageError}
        <p class="form-error" data-testid="napkin-image-error" role="alert">{imageError}</p>
      {/if}
      {#if imageUrl}
        <img
          src={imageUrl}
          alt="The calculation, typeset"
          data-testid="napkin-image-preview"
          width={imageWidth}
          height={imageHeight}
        />
        <p class="muted small" data-testid="napkin-image-size">
          {imageWidth} x {imageHeight} px, {Math.round(imageFontBytes / 1024)} KB of fonts inside it
        </p>
      {/if}
      {#if imageNote}
        <p class="muted small" data-testid="napkin-image-note">{imageNote}</p>
      {/if}
    </div>
  </div>

  <div class="image-actions row wrap">
    <button
      class="btn btn-sm btn-primary"
      data-testid="napkin-download-image-svg"
      disabled={!imageSvg}
      onclick={downloadImageSvg}
    >
      Download SVG
    </button>
    <button
      class="btn btn-sm"
      data-testid="napkin-download-image-png"
      disabled={!imageSvg}
      onclick={downloadImagePng}
    >
      Download PNG
    </button>
    <button
      class="btn btn-sm"
      data-testid="napkin-copy-image-png"
      disabled={!imageSvg}
      onclick={copyImagePng}
    >
      Copy PNG
    </button>
  </div>
</dialog>

<style>
  .layout {
    display: grid;
    grid-template-columns: 16rem 1fr;
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
  }

  .main {
    min-width: 0;
  }

  .search {
    width: 100%;
  }

  .library,
  .calc-list,
  .fields {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .library li,
  .calc-list li {
    display: flex;
    align-items: stretch;
    gap: var(--space-1);
  }

  .library-item,
  .calc-item {
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
  }

  .calc-item {
    flex-direction: row;
    justify-content: space-between;
    align-items: baseline;
  }

  .library-item.on,
  .calc-item.on {
    border-color: var(--color-primary);
    background: var(--color-primary-soft);
  }

  .library-name {
    font-weight: 600;
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
    border-color: var(--color-danger);
    color: var(--color-danger);
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .field-name {
    min-width: 6rem;
  }

  .label-input {
    width: 9rem;
  }

  .description-input {
    width: 14rem;
  }

  .inserts {
    gap: var(--space-1);
  }

  .snippet {
    overflow-x: auto;
    padding: var(--space-2);
    border: 1px solid var(--border-color);
    background: var(--surface-raised-color);
    font-size: var(--font-size-sm);
    white-space: pre;
  }

  .fields li {
    padding: var(--space-1) 0;
    border-bottom: 1px solid var(--border-color);
  }

  .fields select,
  .fields input:not([type='checkbox']) {
    width: auto;
  }

  .calc-row {
    display: flex;
    gap: var(--space-4);
    flex-wrap: wrap;
    align-items: flex-start;
  }

  .calc-inputs {
    flex: 2 1 22rem;
    min-width: 0;
  }

  .history {
    flex: 1 1 14rem;
    min-width: 0;
  }

  .calc-label {
    min-width: 8rem;
  }

  .calc-inputs input[type='number'] {
    width: 10rem;
  }

  .result-row {
    align-items: baseline;
  }

  .result {
    font-size: var(--font-size-lg);
    font-variant-numeric: tabular-nums;
  }

  .label-text {
    font-size: var(--font-size-eyebrow);
    letter-spacing: var(--tracking-label);
    text-transform: uppercase;
    color: var(--text-muted-color);
  }

  .check {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    white-space: nowrap;
    margin: 0;
  }

  .check input {
    width: auto;
    margin: 0;
  }

  .inline {
    white-space: nowrap;
  }

  .muted {
    color: var(--text-muted-color);
  }

  .small {
    font-size: var(--font-size-sm);
  }

  .visually-hidden {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
  }

  /* The image export sits under Save: both are things you do WITH the
     calculation, so a rule rather than a card separates them. */
  .image-row {
    border-top: 1px dashed var(--border-color);
    padding-top: var(--space-3);
    margin-top: var(--space-1);
    align-items: baseline;
  }

  .image-row .muted {
    flex: 1 1 14rem;
  }

  /* ---- the image export dialog ------------------------------------------- */
  .image-dialog {
    width: min(56rem, calc(100vw - 2 * var(--space-4)));
    max-height: 88vh;
    background: var(--surface-raised-color);
    color: var(--text-color);
    border: 1px solid var(--border-strong-color);
    outline: 1px dashed var(--border-color);
    outline-offset: 4px;
    padding: 0;
  }

  .image-dialog::backdrop {
    background: var(--scrim-color);
  }

  .image-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    padding: var(--space-3) var(--space-4);
    border-bottom: 1px solid var(--border-color);
  }

  .image-head h2 {
    font-size: var(--font-size-sm);
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: var(--tracking-label);
  }

  .image-body {
    display: grid;
    grid-template-columns: minmax(12rem, 16rem) 1fr;
    gap: var(--space-4);
    padding: var(--space-4);
    align-items: start;
  }

  @media (max-width: 48rem) {
    .image-body {
      grid-template-columns: 1fr;
    }
  }

  .image-options {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .image-options fieldset {
    border: 1px dashed var(--border-color);
    padding: var(--space-2) var(--space-3);
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  /* One line per row: the row toggle, the caption toggle, the caption text. */
  .image-row {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: var(--space-2);
  }

  .image-row .check:first-child {
    min-width: 8.5rem;
  }

  .image-caption {
    flex: 1 1 7rem;
    min-width: 6rem;
    margin: 0;
    padding: 0.125rem var(--space-2);
    font-size: 0.875rem;
  }

  .image-captions-reset {
    align-self: flex-start;
    margin-top: var(--space-1);
  }

  .image-compare-select {
    flex: 1 1 8rem;
    min-width: 6rem;
    width: auto;
  }

  .image-compare-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .image-compare-list li {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding-top: var(--space-1);
    border-top: 1px dashed var(--border-color);
  }

  /* A checkerboard, so a transparent export does not read as a white one. */
  .image-preview {
    min-height: 8rem;
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    align-items: flex-start;
    overflow: auto;
  }

  .image-preview img {
    max-width: 100%;
    height: auto;
    border: 1px solid var(--border-color);
    background-color: #fff;
    background-image:
      linear-gradient(45deg, #e5e5e5 25%, transparent 25%),
      linear-gradient(-45deg, #e5e5e5 25%, transparent 25%),
      linear-gradient(45deg, transparent 75%, #e5e5e5 75%),
      linear-gradient(-45deg, transparent 75%, #e5e5e5 75%);
    background-size: 16px 16px;
    background-position: 0 0, 0 8px, 8px -8px, -8px 0;
  }

  .image-actions {
    padding: var(--space-3) var(--space-4);
    border-top: 1px solid var(--border-color);
  }
</style>
