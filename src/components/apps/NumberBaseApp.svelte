<script lang="ts">
  import Card from '../Card.svelte';
  import Explainer from '../Explainer.svelte';
  import {
    BASE_LABELS,
    BIT_WIDTHS,
    formatInBase,
    groupDigits,
    mask,
    maxUnsigned,
    minSigned,
    onesComplement,
    parseInBase,
    toSigned,
    twosComplement,
    type Base,
    type BitWidth,
  } from '../../lib/calc/numberBase';
  import {
    BINARY_OPS,
    OP_BY_ID,
    runOp,
    type BinaryOp,
  } from '../../lib/calc/binaryOps';

  // Stateless tool: everything below is view state — nothing ever touches
  // IndexedDB (the data suite asserts zero writes on this page).
  const BASES: Base[] = [2, 8, 10, 16];

  let width = $state<BitWidth>(8);
  let value = $state(5n); // canonical UNSIGNED value in [0, 2^width)
  let texts = $state<Record<number, string>>({ 2: '', 8: '', 10: '', 16: '' });
  let errors = $state<Record<number, string | null>>({ 2: null, 8: null, 10: null, 16: null });

  refresh(null);

  /** Rewrite every field from the canonical value, except the one being typed in. */
  function refresh(except: Base | null) {
    for (const b of BASES) {
      if (b === except) continue;
      texts[b] = formatInBase(value, b, width);
      errors[b] = null;
    }
  }

  function onInput(base: Base) {
    const r = parseInBase(texts[base] ?? '', base, width);
    if (r.ok) {
      value = r.value;
      errors[base] = null;
      refresh(base);
      step = 0;
    } else {
      errors[base] = r.error;
    }
  }

  function onWidthChange() {
    // Shrinking the width truncates to the low bits, like a CPU register move.
    value = value & mask(width);
    refresh(null);
    bValue = bValue & mask(width);
    refreshB(null);
    step = 0;
  }

  let signed = $derived(toSigned(value, width));

  interface OpRow {
    id: string;
    name: string;
    result: bigint;
  }

  let ops = $derived<OpRow[]>([
    { id: 'not', name: 'Bitwise NOT (~)', result: onesComplement(value, width) },
    { id: 'ones', name: "One's complement", result: onesComplement(value, width) },
    { id: 'twos', name: "Two's complement", result: twosComplement(value, width) },
  ]);

  function bin(v: bigint): string {
    return groupDigits(formatInBase(v, 2, width), 4);
  }

  // --- Operation visualizer ------------------------------------------------
  // Operand a is the page's value above, so the page keeps one canonical
  // number; operand b gets its own synchronised set of the same four fields,
  // entered exactly the same way. Still stateless — nothing here is written.

  let opId = $state<BinaryOp>('add');
  let opSigned = $state(false);
  let bValue = $state(3n);
  let bTexts = $state<Record<number, string>>({ 2: '', 8: '', 10: '', 16: '' });
  let bErrors = $state<Record<number, string | null>>({ 2: null, 8: null, 10: null, 16: null });
  /** Which step of the trace is being read. Reset by anything that changes it. */
  let step = $state(0);

  refreshB(null);

  function refreshB(except: Base | null) {
    for (const b of BASES) {
      if (b === except) continue;
      bTexts[b] = formatInBase(bValue, b, width);
      bErrors[b] = null;
    }
  }

  function onInputB(base: Base) {
    const r = parseInBase(bTexts[base] ?? '', base, width);
    if (r.ok) {
      bValue = r.value;
      bErrors[base] = null;
      refreshB(base);
      step = 0;
    } else {
      bErrors[base] = r.error;
    }
  }

  let opDef = $derived(OP_BY_ID[opId]);
  let run = $derived(runOp(opId, value, bValue, { width, signed: opSigned }));
  let trace = $derived(run.ok ? run.trace : null);
  let stepCount = $derived(trace?.steps.length ?? 0);
  /** Clamped rather than trusted: the trace can shrink under a stale index. */
  let stepIndex = $derived(Math.min(step, Math.max(0, stepCount - 1)));
  let current = $derived(trace ? (trace.steps[stepIndex] ?? null) : null);

  /**
   * The drawn table for the current step. Rows can carry bits that fell
   * outside the width on either side; padding them to the widest row is what
   * keeps every column of the table lined up under its bit number.
   */
  let view = $derived.by(() => {
    if (!current) return null;
    const highPad = Math.max(0, ...current.rows.map((r) => r.lostHigh?.length ?? 0));
    const lowPad = Math.max(0, ...current.rows.map((r) => r.lostLow?.length ?? 0));
    return {
      highPad,
      lowPad,
      rows: current.rows.map((r) => ({
        label: r.label,
        high: (r.lostHigh ?? '').padStart(highPad, ' '),
        bits: r.bits,
        low: (r.lostLow ?? '').padEnd(lowPad, ' '),
      })),
    };
  });

  /** Bit numbers across the top, most significant first. */
  let columns = $derived(Array.from({ length: width }, (_, i) => width - 1 - i));
</script>

<div class="page-header">
  <h1>Programming</h1>
</div>

<div class="stack">
  <Card title="Value">
    <div class="stack">
      <div class="row">
        <label class="inline" for="nb-width">Bit width</label>
        <select id="nb-width" data-testid="nb-width" class="narrow" bind:value={width} onchange={onWidthChange}>
          {#each BIT_WIDTHS as w (w)}
            <option value={w}>{w}-bit</option>
          {/each}
        </select>
        <span class="muted small">
          unsigned 0 … {maxUnsigned(width)} · signed {minSigned(width)} … {maxUnsigned(width) >> 1n}
        </span>
      </div>

      <div class="fields">
        {#each BASES as base (base)}
          <div>
            <label for={'nb-input-' + base}>{BASE_LABELS[base]}</label>
            <input
              id={'nb-input-' + base}
              data-testid={'nb-input-' + base}
              class="mono"
              type="text"
              autocomplete="off"
              spellcheck="false"
              bind:value={texts[base]}
              oninput={() => onInput(base)}
            />
            {#if errors[base]}
              <p class="error" data-testid={'nb-error-' + base} role="alert">{errors[base]}</p>
            {/if}
            {#if base === 10 && signed !== value}
              <p class="muted small" data-testid="nb-signed">signed: {signed}</p>
            {/if}
          </div>
        {/each}
      </div>

      <div class="stack explainers">
        <Explainer summary="Binary → decimal by hand" testid="explainer-bin-dec">
          <p>
            Each binary digit is a power of two, counted from the right starting at
            2<sup>0</sup> = 1. Add up the powers under the 1s.
          </p>
          <p><code>1011</code> = 8 + 0 + 2 + 1 = <code>11</code>.</p>
        </Explainer>
        <Explainer summary="Decimal → binary by hand" testid="explainer-dec-bin">
          <p>
            Divide by 2 repeatedly and keep the remainders; read them bottom-up.
          </p>
          <p>
            11 ÷ 2 = 5 r <code>1</code> · 5 ÷ 2 = 2 r <code>1</code> · 2 ÷ 2 = 1 r
            <code>0</code> · 1 ÷ 2 = 0 r <code>1</code> → read up: <code>1011</code>.
          </p>
        </Explainer>
        <Explainer summary="Hexadecimal ↔ binary by hand" testid="explainer-hex-bin">
          <p>
            Every hex digit is exactly four binary digits (a nibble): split the binary
            number into groups of 4 from the right and translate each group
            (0000 = 0 … 1001 = 9, 1010 = a … 1111 = f).
          </p>
          <p><code>1101 0101</code> → d, 5 → <code>0xd5</code> — and back the same way.</p>
        </Explainer>
        <Explainer summary="Octal ↔ binary by hand" testid="explainer-oct-bin">
          <p>
            Same idea with groups of THREE bits (0–7 each): split from the right,
            translate each group.
          </p>
          <p><code>11 010 101</code> → 3, 2, 5 → <code>0o325</code>.</p>
        </Explainer>
      </div>
    </div>
  </Card>

  <Card title="Operations">
    <div class="stack">
      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>Operation</th>
              <th>Binary</th>
              <th>Hex</th>
              <th>Decimal</th>
              <th>Signed</th>
            </tr>
          </thead>
          <tbody>
            {#each ops as op (op.id)}
              <tr data-testid={'nb-op-' + op.id}>
                <td>{op.name}</td>
                <td class="mono" data-testid={'nb-op-' + op.id + '-bin'}>{bin(op.result)}</td>
                <td class="mono" data-testid={'nb-op-' + op.id + '-hex'}>{formatInBase(op.result, 16, width)}</td>
                <td class="mono" data-testid={'nb-op-' + op.id + '-dec'}>{op.result}</td>
                <td class="mono">{toSigned(op.result, width)}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>

      <div class="stack explainers">
        <Explainer summary="Bitwise NOT by hand" testid="explainer-not">
          <p>
            Flip every bit inside the chosen width: each 0 becomes 1 and each 1
            becomes 0. In C-family languages this is the <code>~</code> operator —
            the width matters, because all the leading zeros flip to ones too.
          </p>
          <p>8-bit: ~<code>0000 0101</code> = <code>1111 1010</code>.</p>
        </Explainer>
        <Explainer summary="One's complement by hand" testid="explainer-ones">
          <p>
            The one's complement of a number IS the bitwise NOT — flip every bit.
            Historically it was used to represent negatives (it gives you two
            zeros, +0 and −0, which is why two's complement won).
          </p>
        </Explainer>
        <Explainer summary="Two's complement by hand" testid="explainer-twos">
          <p>
            Flip every bit, then add 1. The result is how CPUs encode the
            NEGATIVE of the number: the same bits mean {value} unsigned or
            {signed} signed, and adding a number to its two's complement always
            wraps around to zero.
          </p>
          <p>
            8-bit −5: <code>0000 0101</code> → flip → <code>1111 1010</code> → +1 →
            <code>1111 1011</code>.
          </p>
        </Explainer>
      </div>
    </div>
  </Card>

  <Card title="Operation visualizer">
    <div class="stack">
      <div class="row">
        <label class="inline" for="nb-op">Operation</label>
        <select
          id="nb-op"
          data-testid="nb-op-picker"
          class="narrow"
          bind:value={opId}
          onchange={() => (step = 0)}
        >
          {#each BINARY_OPS as op (op.id)}
            <option value={op.id}>{op.label} ({op.symbol})</option>
          {/each}
        </select>
        <label class="inline" for="nb-op-signed">
          <input
            id="nb-op-signed"
            type="checkbox"
            data-testid="nb-op-signed"
            bind:checked={opSigned}
            onchange={() => (step = 0)}
          />
          Read the operands as signed
        </label>
      </div>

      <p class="muted small" data-testid="nb-vis-signed-note">
        {#if opDef.signedMatters}
          Signed changes the answer's BITS for this operation — dividing &minus;7 by 2 is not
          dividing 249 by 2.
        {:else}
          Signed changes only how this answer is read; the bits come out the same either way.
        {/if}
      </p>

      <div>
        <p class="operand-label" data-testid="nb-b-label">
          {opDef.countsBits ? 'Shift amount (b)' : 'Operand b'} — operand a is the value above
        </p>
        <div class="fields">
          {#each BASES as base (base)}
            <div>
              <label for={'nb-b-input-' + base}>{BASE_LABELS[base]}</label>
              <input
                id={'nb-b-input-' + base}
                data-testid={'nb-b-input-' + base}
                class="mono"
                type="text"
                autocomplete="off"
                spellcheck="false"
                bind:value={bTexts[base]}
                oninput={() => onInputB(base)}
              />
              {#if bErrors[base]}
                <p class="error" data-testid={'nb-b-error-' + base} role="alert">{bErrors[base]}</p>
              {/if}
            </div>
          {/each}
        </div>
      </div>

      {#if !run.ok}
        <p class="error" data-testid="nb-vis-error" role="alert">{run.error}</p>
      {:else if trace && current && view}
        <p class="expression mono" data-testid="nb-vis-expression">
          0x{formatInBase(value, 16, width)}
          {opDef.symbol}
          0x{formatInBase(bValue, 16, width)} = 0x{formatInBase(trace.result, 16, width)}
        </p>

        <div class="table-wrap">
          <table class="data-table">
            <thead>
              <tr>
                <th>Binary</th>
                <th>Hex</th>
                <th>Decimal</th>
                <th>Signed</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td class="mono" data-testid="nb-vis-bin">{bin(trace.result)}</td>
                <td class="mono" data-testid="nb-vis-hex">{formatInBase(trace.result, 16, width)}</td>
                <td class="mono" data-testid="nb-vis-dec">{trace.result}</td>
                <td class="mono" data-testid="nb-vis-signed">{toSigned(trace.result, width)}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <p class="muted small" data-testid="nb-vis-summary">{trace.summary}</p>

        {#if trace.flags.length > 0}
          <ul class="flags">
            {#each trace.flags as f (f.id)}
              <li data-testid={'nb-vis-flag-' + f.id} class:on={f.on}>
                <strong>{f.label}: {f.on ? 'yes' : 'no'}</strong> — {f.text}
              </li>
            {/each}
          </ul>
        {/if}

        <div class="stepper">
          <button
            class="btn btn-sm"
            data-testid="nb-vis-step-back"
            disabled={stepIndex <= 0}
            onclick={() => (step = Math.max(0, stepIndex - 1))}>Back</button
          >
          <span data-testid="nb-vis-step-text">
            Step {stepIndex + 1} of {stepCount}: {current.text}
          </span>
          <button
            class="btn btn-sm"
            data-testid="nb-vis-step-next"
            disabled={stepIndex >= stepCount - 1}
            onclick={() => (step = Math.min(stepCount - 1, stepIndex + 1))}>Next</button
          >
        </div>

        <div class="table-wrap">
          <table class="bits" data-testid="nb-vis-table">
            <caption class="sr-only">
              The working for {opDef.label} at {width} bits, step {stepIndex + 1} of {stepCount}.
              Columns are numbered by bit, most significant first; dashed columns fall outside
              the width.
            </caption>
            <thead>
              <tr>
                <th scope="col"><span class="sr-only">Row</span></th>
                {#if view.highPad > 0}
                  <th colspan={view.highPad} class="outside">out</th>
                {/if}
                {#each columns as c (c)}
                  <th scope="col">{c}</th>
                {/each}
                {#if view.lowPad > 0}
                  <th colspan={view.lowPad} class="outside">out</th>
                {/if}
              </tr>
            </thead>
            <tbody>
              {#each view.rows as r (r.label)}
                <tr>
                  <th scope="row">{r.label}</th>
                  {#each [...r.high] as ch, i (i)}
                    <td class="outside">{ch === ' ' ? '' : ch}</td>
                  {/each}
                  {#each [...r.bits] as ch, i (i)}
                    <td
                      class:now={current.focus.includes(width - 1 - i)}
                      data-testid={current.focus.includes(width - 1 - i)
                        ? 'nb-vis-cell-now'
                        : undefined}>{ch === ' ' ? '' : ch}</td
                    >
                  {/each}
                  {#each [...r.low] as ch, i (i)}
                    <td class="outside">{ch === ' ' ? '' : ch}</td>
                  {/each}
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {/if}

      <div class="stack explainers">
        <Explainer summary="Carry vs signed overflow by hand" testid="explainer-carry-overflow">
          <p>
            They are two different questions about the same bits. <strong>Carry</strong> asks
            whether the answer fit when the bits are read as UNSIGNED;
            <strong>signed overflow</strong> asks whether it fit when they are read as two's
            complement. A CPU works both out on every add and lets you choose which one to
            branch on.
          </p>
          <p>
            At 8 bits, <code>0xFF + 1</code> carries but does not overflow (255 + 1 does not fit
            unsigned, while &minus;1 + 1 = 0 is perfectly fine signed), and
            <code>0x7F + 1</code> overflows but does not carry (127 + 1 = 128 fits unsigned,
            while +127 + 1 cannot be +128 in a signed byte and comes out as &minus;128).
          </p>
        </Explainer>
        <Explainer summary="Shift-and-add multiplication by hand" testid="explainer-shift-add">
          <p>
            Long multiplication with only two times tables. For each 1 in the multiplier, write
            the multiplicand shifted left into that column; for each 0, write nothing. Add the
            rows.
          </p>
          <p>
            <code>5 × 5</code> = <code>101 × 101</code> → <code>101</code> (bit 0) +
            <code>10100</code> (bit 2) = <code>11001</code> = 25. Any row bits that shift past
            the top of the width are dropped, which is exactly where the answer stops being the
            true product.
          </p>
        </Explainer>
        <Explainer summary="Binary long division by hand" testid="explainer-long-division">
          <p>
            The same algorithm as decimal long division, but the only question at each step is
            "does it go in?" — the answer is 0 or 1, never 7. Bring the next dividend bit down
            into the remainder; if the remainder now reaches the divisor, subtract it and write
            a 1; otherwise write a 0.
          </p>
          <p>
            Negative operands are divided as magnitudes and given their signs back at the end.
            That is what makes integer division truncate TOWARD ZERO — <code>-7 / 2</code> is
            <code>-3</code>, not <code>-4</code> — and why the remainder takes the sign of the
            dividend, so <code>(a / b) * b + a % b</code> still equals <code>a</code>.
          </p>
        </Explainer>
      </div>
    </div>
  </Card>
</div>

<style>
  .fields {
    display: grid;
    gap: var(--space-3);
    grid-template-columns: repeat(auto-fit, minmax(16rem, 1fr));
  }

  .mono {
    font-family: var(--font-mono, ui-monospace, monospace);
  }

  .narrow {
    width: auto;
  }

  .inline {
    display: inline;
    margin-bottom: 0;
  }

  .small {
    font-size: var(--font-size-sm);
  }

  .error {
    color: var(--color-danger);
    font-size: var(--font-size-sm);
    margin-top: var(--space-1);
  }

  .explainers {
    gap: var(--space-2);
  }

  .operand-label {
    font-size: var(--font-size-sm);
    color: var(--text-muted-color);
    margin-bottom: var(--space-2);
  }

  .expression {
    font-size: var(--font-size-sm);
  }

  .stepper {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-3);
    font-size: var(--font-size-sm);
  }

  .flags {
    list-style: none;
    padding: 0;
    display: grid;
    gap: var(--space-2);
    font-size: var(--font-size-sm);
  }

  .flags li {
    border-left: 3px solid var(--border-color);
    padding-left: var(--space-3);
  }

  .flags li.on {
    border-left-color: var(--color-warning);
  }

  table.bits {
    border-collapse: collapse;
    font-family: var(--font-mono);
    font-size: var(--font-size-sm);
  }

  table.bits th,
  table.bits td {
    border: 1px solid var(--border-color);
    padding: 2px var(--space-1);
    text-align: center;
    min-width: 1.6rem;
  }

  table.bits thead th {
    color: var(--text-muted-color);
    background: var(--surface-raised-color);
    font-weight: 400;
  }

  table.bits tbody th {
    text-align: right;
    white-space: nowrap;
    padding-inline: var(--space-2);
    color: var(--text-muted-color);
    font-weight: 400;
  }

  /* Columns outside the width are marked by a dashed border rather than a
     tinted background: the tint would sit under --text-muted-color and drop
     its contrast below the ratio the a11y sweep checks that token at. */
  table.bits th.outside,
  table.bits td.outside {
    color: var(--text-muted-color);
    border-style: dashed;
  }

  table.bits td.now {
    background: var(--color-stamp);
    color: var(--color-on-primary);
    font-weight: 700;
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
