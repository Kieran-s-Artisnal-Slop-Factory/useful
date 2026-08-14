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
    } else {
      errors[base] = r.error;
    }
  }

  function onWidthChange() {
    // Shrinking the width truncates to the low bits, like a CPU register move.
    value = value & mask(width);
    refresh(null);
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
</style>
