<script lang="ts">
  /**
   * Text analysis — counts, difficulty, word frequency and transformations.
   *
   * Stateless: nothing here reaches the database. Every number comes from
   * src/lib/text/analysis.ts and every transformation from transform.ts, so
   * this page is display and wiring only.
   */
  import Card from '../Card.svelte';
  import Explainer from '../Explainer.svelte';
  import { copyText, downloadText } from '../../lib/exportFile';
  import {
    counts as countText,
    formatDuration,
    frequency,
    READING_WPM,
    readability as readabilityOf,
    readingSeconds,
    SMOG_MINIMUM_SENTENCES,
    SPEAKING_WPM,
  } from '../../lib/text/analysis';
  import { applyTransform, type TransformId, TRANSFORMS } from '../../lib/text/transform';

  let text = $state('');
  /** The debounced copy every count runs on. */
  let value = $state('');
  let gramSize = $state(1);
  let dropStopWords = $state(false);
  let output = $state('');
  let appliedName = $state('');
  let copied = $state(false);
  let notice = $state('');

  $effect(() => {
    const next = text;
    const handle = setTimeout(() => (value = next), 150);
    return () => clearTimeout(handle);
  });

  const empty = $derived(value.trim() === '');
  const counts = $derived(countText(value));
  const readability = $derived(readabilityOf(value, counts));
  const rows = $derived(
    empty ? [] : frequency(value, { size: gramSize, dropStopWords, limit: 15 })
  );

  const number = (value: number): string => value.toLocaleString();
  const grade = (value: number | null): string =>
    value === null ? '—' : (Math.round(value * 10) / 10).toFixed(1);

  function transform(id: TransformId, name: string): void {
    output = applyTransform(id, text);
    appliedName = name;
    copied = false;
  }

  async function copyOutput(): Promise<void> {
    if (output === '') return;
    copied = await copyText(output);
    if (copied) setTimeout(() => (copied = false), 1500);
    else {
      notice = 'Clipboard blocked — use Download.';
      setTimeout(() => (notice = ''), 2500);
    }
  }

  function downloadOutput(): void {
    if (output === '') return;
    downloadText(output, 'text.txt', 'text/plain');
  }

  function clear(): void {
    text = '';
    output = '';
    appliedName = '';
  }
</script>

<div class="page-header">
  <h1>Text analysis</h1>
  <p class="muted">Count it, score it, see what it repeats — and change its case.</p>
</div>

<div class="stack">
  <Card title="Text">
    {#snippet actions()}
      <button class="btn btn-sm" data-testid="ta-clear" onclick={clear}>Clear</button>
    {/snippet}
    <div class="field">
      <label for="ta-text">Paste or type your text</label>
      <textarea
        id="ta-text"
        data-testid="ta-text"
        rows="10"
        spellcheck="false"
        placeholder="Paste the text you want to measure."
        bind:value={text}
      ></textarea>
    </div>
  </Card>

  <Card title="Counts">
    {#if empty}
      <p class="muted" data-testid="ta-empty">Nothing to count yet.</p>
    {:else}
      <div class="figures">
        <div class="figure">
          <span class="eyebrow">Words</span>
          <p class="big" data-testid="ta-words">{number(counts.words)}</p>
          <p class="muted small" data-testid="ta-unique">{number(counts.uniqueWords)} unique</p>
        </div>
        <div class="figure">
          <span class="eyebrow">Characters</span>
          <p class="big" data-testid="ta-characters">{number(counts.characters)}</p>
          <p class="muted small" data-testid="ta-characters-nospaces">
            {number(counts.charactersNoSpaces)} without spaces
          </p>
        </div>
        <div class="figure">
          <span class="eyebrow">Sentences</span>
          <p class="big" data-testid="ta-sentences">{number(counts.sentences)}</p>
        </div>
        <div class="figure">
          <span class="eyebrow">Paragraphs</span>
          <p class="big" data-testid="ta-paragraphs">{number(counts.paragraphs)}</p>
          <p class="muted small" data-testid="ta-lines">{number(counts.lines)} lines</p>
        </div>
        <div class="figure">
          <span class="eyebrow">UTF-8 bytes</span>
          <p class="big" data-testid="ta-bytes">{number(counts.bytes)}</p>
          <p class="muted small" data-testid="ta-units">
            {number(counts.codePoints)} code points · {number(counts.utf16)} UTF-16 units
          </p>
        </div>
        <div class="figure">
          <span class="eyebrow">Reading time</span>
          <p class="big" data-testid="ta-reading">{formatDuration(readingSeconds(counts.words))}</p>
          <p class="muted small" data-testid="ta-speaking">
            {formatDuration(readingSeconds(counts.words, SPEAKING_WPM))} read aloud
          </p>
        </div>
      </div>

      <Explainer summary="Why four different lengths?" testid="explainer-lengths">
        <p>
          They measure different things and they disagree. <strong>Characters</strong> counts what a
          reader would count — a family emoji or an accented letter is one. <strong>Code points</strong>
          counts Unicode values, so that emoji is seven. <strong>UTF-16 units</strong> is what
          JavaScript's <code>.length</code> returns, which is eleven. <strong>UTF-8 bytes</strong> is
          what the text weighs in a file or a request.
        </p>
        <p>
          Reading time uses {READING_WPM} words per minute and reading aloud {SPEAKING_WPM} — averages
          for adults over ordinary English prose (Brysbaert 2019). Dense technical text is slower, and
          nobody reads at exactly the average.
        </p>
      </Explainer>
    {/if}
  </Card>

  <Card title="Difficulty">
    {#if empty}
      <p class="muted">Paste some text to score it.</p>
    {:else}
      <div class="stack">
        <div class="figures">
          <div class="figure">
            <span class="eyebrow">Flesch reading ease</span>
            <p class="big" data-testid="ta-flesch">{grade(readability.flesch)}</p>
            <p class="muted small" data-testid="ta-band">{readability.band}</p>
          </div>
          <div class="figure">
            <span class="eyebrow">Flesch-Kincaid grade</span>
            <p class="big" data-testid="ta-fk">{grade(readability.fleschKincaid)}</p>
          </div>
          <div class="figure">
            <span class="eyebrow">Automated Readability Index</span>
            <p class="big" data-testid="ta-ari">{grade(readability.ari)}</p>
          </div>
          <div class="figure">
            <span class="eyebrow">SMOG grade</span>
            <p class="big" data-testid="ta-smog">{grade(readability.smog)}</p>
            {#if readability.smog === null}
              <p class="muted small" data-testid="ta-smog-note">
                Needs {readability.smogNeeds} more {readability.smogNeeds === 1 ? 'sentence' : 'sentences'}
                — SMOG was fitted on {SMOG_MINIMUM_SENTENCES}-sentence samples and means nothing below that.
              </p>
            {/if}
          </div>
        </div>

        <Explainer summary="The formulas, with this text's numbers in them" testid="explainer-formulas">
          <p>
            This text averages <strong>{(Math.round(readability.wordsPerSentence * 100) / 100).toFixed(2)}</strong>
            words per sentence,
            <strong>{(Math.round(readability.syllablesPerWord * 100) / 100).toFixed(2)}</strong> syllables
            per word and
            <strong>{(Math.round(readability.charactersPerWord * 100) / 100).toFixed(2)}</strong> characters
            per word.
          </p>
          <p>
            <code
              >206.835 − 1.015 × {(Math.round(readability.wordsPerSentence * 100) / 100).toFixed(2)} − 84.6
              × {(Math.round(readability.syllablesPerWord * 100) / 100).toFixed(2)} = {grade(
                readability.flesch
              )}</code
            > — Flesch reading ease, where higher is easier.
          </p>
          <p>
            <code
              >0.39 × {(Math.round(readability.wordsPerSentence * 100) / 100).toFixed(2)} + 11.8 × {(
                Math.round(readability.syllablesPerWord * 100) / 100
              ).toFixed(2)} − 15.59 = {grade(readability.fleschKincaid)}</code
            > — Flesch-Kincaid, a US grade level.
          </p>
          <p>
            <code
              >4.71 × {(Math.round(readability.charactersPerWord * 100) / 100).toFixed(2)} + 0.5 × {(
                Math.round(readability.wordsPerSentence * 100) / 100
              ).toFixed(2)} − 21.43 = {grade(readability.ari)}</code
            > — the Automated Readability Index, which needs no syllable guessing and is the most
            trustworthy of the four for technical writing.
          </p>
          <p>
            <strong>Every one of these is a heuristic.</strong> Syllables are counted by rule, not by
            dictionary; sentence boundaries are guessed; numerals and non-English text are not handled;
            and the formulas were fitted to English prose decades ago. A score is a smell, not a
            measurement — two texts a grade apart are not reliably different.
          </p>
        </Explainer>
      </div>
    {/if}
  </Card>

  <Card title="What it repeats">
    {#if empty}
      <p class="muted">Paste some text to see its commonest words.</p>
    {:else}
      <div class="stack">
        <div class="controls">
          <div class="field">
            <label for="ta-freq-size">Count</label>
            <select id="ta-freq-size" data-testid="ta-freq-size" bind:value={gramSize}>
              <option value={1}>Single words</option>
              <option value={2}>Pairs of words</option>
              <option value={3}>Triples</option>
            </select>
          </div>
          <div class="field checkbox">
            <label for="ta-freq-stop">
              <input
                id="ta-freq-stop"
                type="checkbox"
                data-testid="ta-freq-stop"
                bind:checked={dropStopWords}
              />
              Ignore common words (the, and, of…)
            </label>
          </div>
        </div>
        {#if rows.length === 0}
          <p class="muted">Nothing left to count once those are ignored.</p>
        {:else}
          <div class="table-wrap">
            <table class="data-table">
              <caption class="sr-only">The commonest terms in the text</caption>
              <thead>
                <tr>
                  <th scope="col">Term</th>
                  <th scope="col">Count</th>
                  <th scope="col">Share</th>
                </tr>
              </thead>
              <tbody>
                {#each rows as row (row.term)}
                  <tr data-testid="ta-freq-row" data-term={row.term}>
                    <th scope="row">{row.term}</th>
                    <td>{row.count}</td>
                    <td>{(row.share * 100).toFixed(1)}%</td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
        {/if}
      </div>
    {/if}
  </Card>

  <Card title="Transform">
    <div class="stack">
      <div class="transforms">
        {#each TRANSFORMS as def (def.id)}
          <button
            class="btn btn-sm"
            data-testid={`ta-transform-${def.id}`}
            disabled={text === ''}
            title={def.summary}
            onclick={() => transform(def.id, def.name)}
          >
            {def.name}
          </button>
        {/each}
      </div>

      {#if output === ''}
        <p class="muted" data-testid="ta-output-empty">
          Pick a transformation and the result appears here. Your text above is never changed.
        </p>
      {:else}
        <div class="field">
          <label for="ta-output">{appliedName}</label>
          <textarea id="ta-output" data-testid="ta-output" rows="6" readonly value={output}></textarea>
        </div>
        <div class="row">
          <button class="btn btn-sm" data-testid="ta-copy" onclick={copyOutput}>
            {copied ? 'Copied' : 'Copy'}
          </button>
          <button class="btn btn-sm" data-testid="ta-download" onclick={downloadOutput}>Download</button>
          {#if notice}<span class="muted small" role="status">{notice}</span>{/if}
        </div>
      {/if}

      <Explainer summary="What each transformation does" testid="explainer-transforms">
        <ul>
          {#each TRANSFORMS as def (def.id)}
            <li><strong>{def.name}</strong> — {def.summary} <code>{def.example}</code></li>
          {/each}
        </ul>
        <p>
          All of them work on whole characters, so an emoji, a flag or an accent survives being spaced
          out, struck through or alternated — splitting one in half is what a naive
          <code>split('')</code> does.
        </p>
      </Explainer>
    </div>
  </Card>
</div>

<style>
  .field {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  textarea {
    width: 100%;
    resize: vertical;
    font-family: var(--font-mono);
    font-size: var(--font-size-sm);
  }

  .figures {
    display: grid;
    gap: var(--space-4);
    grid-template-columns: repeat(auto-fit, minmax(12rem, 1fr));
  }

  .figure .big {
    font-size: var(--font-size-2xl);
    font-weight: 700;
    line-height: 1.1;
  }

  .small {
    font-size: var(--font-size-sm);
  }

  .controls {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-4);
    align-items: flex-end;
  }

  .checkbox label {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }

  .transforms {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }

  .row {
    display: flex;
    align-items: center;
    gap: var(--space-2);
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
