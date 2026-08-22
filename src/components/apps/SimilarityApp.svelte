<script lang="ts">
  /**
   * Similarity — one word against many, scored five ways, with the working
   * shown.
   *
   * Stateless: nothing here reaches the database. The algorithms live in
   * src/lib/text/edit.ts; this page is the table, the visualizer and the
   * explanations.
   */
  import Card from '../Card.svelte';
  import Explainer from '../Explainer.svelte';
  import {
    type Algorithm,
    ALGORITHMS,
    compare,
    jaroDetail,
    matrix,
    suggest,
  } from '../../lib/text/edit';

  /** The matrix is drawn as a real grid; past this it stops being readable. */
  const MATRIX_LIMIT = 40;
  /** Comparisons per run. The table is the bottleneck, not the algorithms. */
  const CANDIDATE_LIMIT = 200;
  /**
   * Characters per word. The three distance metrics fill an n x m table, so a
   * pasted paragraph in the word box is a million cells per candidate — the
   * one input on this page that could hang the tab, and therefore the one that
   * gets a stated limit rather than a spinner.
   */
  const WORD_LIMIT = 200;

  let typedWord = $state('');
  let typedCandidates = $state('');
  // Scoring runs on debounced copies: a pasted word list should not re-score
  // 200 candidates on every keystroke that follows it.
  let word = $state('');
  let candidateText = $state('');

  $effect(() => {
    const next = typedWord;
    const handle = setTimeout(() => (word = next), 120);
    return () => clearTimeout(handle);
  });

  $effect(() => {
    const next = typedCandidates;
    const handle = setTimeout(() => (candidateText = next), 120);
    return () => clearTimeout(handle);
  });
  let sortBy = $state<Algorithm>('jaro');
  let algorithm = $state<Algorithm>('levenshtein');
  let selectedWord = $state('');
  let step = $state(0);

  const candidates = $derived(
    candidateText
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line !== '')
  );
  const shown = $derived(candidates.slice(0, CANDIDATE_LIMIT));
  const dropped = $derived(Math.max(0, candidates.length - CANDIDATE_LIMIT));

  const overLimit = $derived(
    word.length > WORD_LIMIT || shown.some((candidate) => candidate.length > WORD_LIMIT)
  );
  const ready = $derived(word.trim() !== '' && shown.length > 0 && !overLimit);
  const rows = $derived(ready ? compare(word, shown) : []);
  const sorted = $derived(
    [...rows].sort((a, b) => b.scores[sortBy].similarity - a.scores[sortBy].similarity)
  );
  const best = $derived(ready ? suggest(word, shown, sortBy) : null);

  /** The pair the visualizer is showing: whatever was picked, else the closest. */
  const pair = $derived(
    ready ? (shown.includes(selectedWord) ? selectedWord : (sorted[0]?.word ?? '')) : ''
  );

  const tooLong = $derived(
    pair !== '' && (word.length > MATRIX_LIMIT || pair.length > MATRIX_LIMIT)
  );

  const table = $derived(
    pair !== '' && !tooLong && algorithm !== 'jaro' && algorithm !== 'jaro-winkler'
      ? matrix(word, pair, {
          transpose: algorithm === 'damerau',
          indel: algorithm === 'indel',
        })
      : null
  );

  const detail = $derived(
    pair !== '' && (algorithm === 'jaro' || algorithm === 'jaro-winkler')
      ? jaroDetail(word, pair)
      : null
  );

  // A new pair or a new algorithm means a new path — start the walk again.
  $effect(() => {
    void pair;
    void algorithm;
    step = 0;
  });

  const path = $derived(table?.path ?? []);

  const percent = (value: number): string => `${Math.round(value * 1000) / 10}%`;

  const raw = (value: number, isDistance: boolean): string =>
    isDistance ? String(value) : String(Math.round(value * 10000) / 10000);

  /** Is this cell on the traceback path, and if so at which step? */
  function stepAt(i: number, j: number): number {
    return path.findIndex((s) => s.i === i && s.j === j);
  }

  const opWords: Record<string, string> = {
    match: 'keep',
    substitute: 'substitute',
    insert: 'insert',
    delete: 'delete',
    transpose: 'swap',
  };

  function describe(index: number): string {
    const s = path[index];
    if (!s || !table) return '';
    const from = table.a[s.i - 1] ?? '';
    const to = table.b[s.j - 1] ?? '';
    if (s.op === 'match') return `Keep "${from}" — free.`;
    if (s.op === 'substitute') return `Substitute "${from}" with "${to}" — costs 1.`;
    if (s.op === 'insert') return `Insert "${to}" — costs 1.`;
    if (s.op === 'delete') return `Delete "${from}" — costs 1.`;
    return `Swap "${table.a[s.i - 2] ?? ''}${from}" into "${table.b[s.j - 2] ?? ''}${to}" — costs 1.`;
  }
</script>

<div class="page-header">
  <h1>Similarity</h1>
  <p class="muted">Score one word against as many others as you like, five ways.</p>
</div>

<div class="stack">
  <Card title="Words">
    <div class="grid-2">
      <div class="field">
        <label for="sim-word">Word</label>
        <input
          id="sim-word"
          data-testid="sim-word"
          type="text"
          spellcheck="false"
          bind:value={typedWord}
        />
      </div>
      <div class="field">
        <label for="sim-candidates">Compare against — one per line</label>
        <textarea
          id="sim-candidates"
          data-testid="sim-candidates"
          rows="6"
          spellcheck="false"
          placeholder={'hello\nhelp\nheat'}
          bind:value={typedCandidates}
        ></textarea>
      </div>
    </div>
    {#if dropped > 0}
      <p class="muted small" data-testid="sim-dropped">
        Comparing the first {CANDIDATE_LIMIT}; {dropped} more were left out.
      </p>
    {/if}
  </Card>

  {#if overLimit}
    <Card title="Scores">
      <p class="error" role="alert" data-testid="sim-over-limit">
        These are words, not documents. Every comparison fills a table as wide and tall as the two
        strings, so this page scores words up to {WORD_LIMIT} characters — past that it would stop
        responding rather than finish. For long texts, use <strong>Diff</strong>.
      </p>
    </Card>
  {:else if !ready}
    <Card title="Scores">
      <p class="muted" data-testid="sim-empty">
        Type a word and at least one word to compare it against.
      </p>
    </Card>
  {:else}
    <Card title="Scores">
      <div class="stack">
        <p class="summary" data-testid="sim-best">
          Closest by {ALGORITHMS.find((a) => a.id === sortBy)?.name}:
          <strong>{best?.word}</strong>
          <span class="muted">{percent(best?.likelihood ?? 0)}</span>
        </p>
        <div class="table-wrap">
          <table class="data-table scores">
            <caption class="sr-only">Similarity of each word to "{word}", by algorithm</caption>
            <thead>
              <tr>
                <th scope="col">Word</th>
                {#each ALGORITHMS as def (def.id)}
                  <th scope="col" aria-sort={sortBy === def.id ? 'descending' : 'none'}>
                    <button
                      class="sort"
                      data-testid={`sim-sort-${def.id}`}
                      onclick={() => (sortBy = def.id)}
                      aria-label={`Sort by ${def.name}`}
                    >
                      {def.name}{#if sortBy === def.id}<span aria-hidden="true"> ▾</span>{/if}
                    </button>
                  </th>
                {/each}
                <th scope="col">Show</th>
              </tr>
            </thead>
            <tbody>
              {#each sorted as row (row.word)}
                <tr data-testid="sim-row" data-word={row.word} class:picked={row.word === pair}>
                  <th scope="row">{row.word}</th>
                  {#each ALGORITHMS as def (def.id)}
                    <td data-testid={`sim-${def.id}`}>
                      <span class="score">{percent(row.scores[def.id].similarity)}</span>
                      <span class="muted small">
                        {raw(row.scores[def.id].raw, def.distance)}{def.distance
                          ? row.scores[def.id].raw === 1
                            ? ' edit'
                            : ' edits'
                          : ''}
                      </span>
                    </td>
                  {/each}
                  <td>
                    <button
                      class="btn btn-sm"
                      data-testid={`sim-pick-${row.word}`}
                      onclick={() => (selectedWord = row.word)}
                      aria-label={`Show the working for ${row.word}`}
                    >
                      Working
                    </button>
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      </div>
    </Card>

    <Card title={`How "${word}" and "${pair}" were scored`}>
      <div class="stack">
        <div class="field algorithm">
          <label for="sim-algorithm">Algorithm</label>
          <select id="sim-algorithm" data-testid="sim-algorithm" bind:value={algorithm}>
            {#each ALGORITHMS as def (def.id)}
              <option value={def.id}>{def.name}</option>
            {/each}
          </select>
          <p class="muted small">{ALGORITHMS.find((a) => a.id === algorithm)?.summary}</p>
        </div>

        {#if tooLong}
          <p class="error" role="alert" data-testid="sim-too-long">
            The table is drawn character by character, so it is only shown for words up to
            {MATRIX_LIMIT} characters. The scores above are still exact.
          </p>
        {:else if table}
          <div class="stepper">
            <button
              class="btn btn-sm"
              data-testid="sim-step-back"
              disabled={step <= 0}
              onclick={() => (step = Math.max(0, step - 1))}>Back</button
            >
            <span data-testid="sim-step-text">
              Step {Math.min(step + 1, path.length)} of {path.length}: {describe(
                Math.min(step, path.length - 1)
              )}
            </span>
            <button
              class="btn btn-sm"
              data-testid="sim-step-next"
              disabled={step >= path.length - 1}
              onclick={() => (step = Math.min(path.length - 1, step + 1))}>Next</button
            >
            <span class="muted" data-testid="sim-distance">Distance: {table.distance}</span>
          </div>

          <div class="table-wrap">
            <table class="matrix" data-testid="sim-matrix">
              <caption class="sr-only">
                The cost table for "{word}" against "{pair}" — each cell is the distance between the
                prefixes that meet there
              </caption>
              <thead>
                <tr>
                  <th scope="col"><span class="sr-only">Prefix</span></th>
                  <th scope="col">∅</th>
                  {#each table.b as ch, j (j)}
                    <th scope="col">{ch}</th>
                  {/each}
                </tr>
              </thead>
              <tbody>
                {#each table.rows as row, i (i)}
                  <tr>
                    <th scope="row">{i === 0 ? '∅' : table.a[i - 1]}</th>
                    {#each row as cost, j (j)}
                      {@const onPath = stepAt(i, j)}
                      <td
                        class:path={onPath >= 0}
                        class:now={onPath === Math.min(step, path.length - 1)}
                        data-testid={onPath === Math.min(step, path.length - 1) ? 'sim-cell-now' : undefined}
                      >
                        {cost}
                        {#if onPath >= 0}
                          <span class="op" aria-hidden="true">{opWords[path[onPath]!.op]?.[0] ?? ''}</span>
                        {/if}
                      </td>
                    {/each}
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
          <p class="muted small">
            Every cell holds the distance between the two prefixes that meet there, so the bottom-right
            corner is the answer. The highlighted route is the cheapest way to reach it.
          </p>
        {:else if detail}
          <div class="stack" data-testid="sim-jaro">
            <div class="pairing">
              <div class="strip">
                <span class="eyebrow">{word}</span>
                {#each detail.a as ch, i (i)}
                  <span class="chip" class:matched={detail.matchedA[i]}>{ch}</span>
                {/each}
              </div>
              <div class="strip">
                <span class="eyebrow">{pair}</span>
                {#each detail.b as ch, j (j)}
                  <span class="chip" class:matched={detail.matchedB[j]}>{ch}</span>
                {/each}
              </div>
            </div>
            <dl class="facts">
              <div><dt>Window</dt><dd data-testid="sim-window">±{detail.window}</dd></div>
              <div><dt>Matches</dt><dd data-testid="sim-matches">{detail.matches}</dd></div>
              <div>
                <dt>Transpositions</dt>
                <dd data-testid="sim-transpositions">{detail.transpositions}</dd>
              </div>
              <div><dt>Shared prefix</dt><dd data-testid="sim-prefix">{detail.prefix}</dd></div>
            </dl>
            <p class="formula" data-testid="sim-formula">
              ({detail.matches}/{detail.a.length} + {detail.matches}/{detail.b.length} + ({detail.matches}
              − {detail.transpositions})/{detail.matches}) ÷ 3 =
              <strong>{Math.round(detail.jaro * 10000) / 10000}</strong>
              {#if algorithm === 'jaro-winkler'}
                , then + {detail.prefix} × 0.1 × (1 − {Math.round(detail.jaro * 10000) / 10000}) =
                <strong>{Math.round(detail.jaroWinkler * 10000) / 10000}</strong>
              {/if}
            </p>
          </div>
        {/if}
      </div>
    </Card>
  {/if}

  <Explainer summary="Which algorithm should I use?" testid="explainer-similarity">
    <p>
      <strong>Jaro</strong> and <strong>Jaro-Winkler</strong> are built for short strings like names,
      and they are fast: speyl, the library these are ported from, measures Jaro at roughly 370 000
      comparisons in 27 ms, where its recursive Levenshtein takes eighteen seconds for the same work.
      Winkler adds weight for a shared start, which is usually what you want for names and identifiers.
    </p>
    <p>
      <strong>Levenshtein</strong> is the general answer — how many single-character edits apart are
      these. <strong>Damerau</strong> adds the swap, which is what most typos actually are ("teh" is one
      edit from "the", not two). <strong>Indel</strong> forbids substitution altogether, so it measures
      how much of the two strings is SHARED rather than how far apart they are — it is the longest
      common subsequence wearing a different hat.
    </p>
    <p>
      The three distance measures are turned into percentages so they can share a table: Levenshtein and
      Damerau divide by the longer word, Indel by both lengths added together. That is why the same pair
      can score differently under each.
    </p>
  </Explainer>
</div>

<style>
  .field {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  textarea,
  input[type='text'] {
    width: 100%;
    font-family: var(--font-mono);
  }

  textarea {
    resize: vertical;
  }

  .small {
    font-size: var(--font-size-sm);
  }

  .summary {
    font-size: var(--font-size-sm);
    display: flex;
    gap: var(--space-2);
    align-items: baseline;
  }

  .error {
    color: var(--color-danger);
    font-size: var(--font-size-sm);
  }

  table.scores td {
    white-space: nowrap;
  }

  table.scores .score {
    font-weight: 700;
  }

  table.scores tr.picked th,
  table.scores tr.picked td {
    background: var(--color-primary-soft);
  }

  .sort {
    background: none;
    border: 0;
    padding: 0;
    font: inherit;
    color: inherit;
    text-transform: inherit;
    letter-spacing: inherit;
    cursor: pointer;
  }

  .sort:hover {
    color: var(--color-primary);
  }

  .algorithm {
    max-width: 24rem;
  }

  .stepper {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-3);
    font-size: var(--font-size-sm);
  }

  table.matrix {
    border-collapse: collapse;
    font-family: var(--font-mono);
    font-size: var(--font-size-sm);
  }

  table.matrix th,
  table.matrix td {
    border: 1px solid var(--border-color);
    padding: var(--space-1) var(--space-2);
    text-align: center;
    min-width: 2.2rem;
  }

  table.matrix th {
    color: var(--text-muted-color);
    background: var(--surface-raised-color);
  }

  table.matrix td.path {
    background: color-mix(in srgb, var(--color-primary) 18%, transparent);
  }

  table.matrix td.now {
    background: var(--color-stamp);
    color: var(--color-on-primary);
    font-weight: 700;
  }

  .op {
    display: block;
    font-size: var(--font-size-eyebrow);
    text-transform: uppercase;
  }

  .strip {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-1);
    margin-bottom: var(--space-2);
  }

  .strip .eyebrow {
    margin-right: var(--space-2);
  }

  .chip {
    border: 1px solid var(--border-color);
    padding: var(--space-1) var(--space-2);
    font-family: var(--font-mono);
  }

  .chip.matched {
    background: color-mix(in srgb, var(--color-success) 20%, transparent);
    border-color: var(--color-success);
  }

  .facts {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-5);
    font-size: var(--font-size-sm);
  }

  .facts dt {
    font-size: var(--font-size-eyebrow);
    text-transform: uppercase;
    letter-spacing: var(--tracking-label);
    color: var(--text-muted-color);
  }

  .formula {
    font-family: var(--font-mono);
    font-size: var(--font-size-sm);
    padding: var(--space-3);
    border: 1px solid var(--border-color);
    background: var(--surface-raised-color);
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
