<script lang="ts">
  /**
   * The theme preview "window" — a card, an accordion, a table and a form,
   * styled with NOTHING but the generated custom properties, so what you see
   * is exactly what the copied CSS produces.
   *
   * Lifted out of ThemesApp in 0.5.0 (plan Phase 0, decision 4) so the colour
   * extractor can show the same preview rather than grow a second one that
   * drifts. The markup, the class names and the styles are unchanged from the
   * shipped version — the Themes spec passes against this component without
   * edits, which is the proof the lift was faithful.
   *
   * `vars` is `BuiltTheme.vars` straight from buildTheme(); `scheme` pins the
   * preview to one side of `light-dark()` ('auto' leaves it to the page).
   * `testid` is required rather than defaulted: two tools mount this, and a
   * shared default would have them collide in one spec run.
   */
  let {
    vars,
    scheme = 'auto',
    testid,
  }: {
    vars: [string, string][];
    scheme?: 'auto' | 'light' | 'dark';
    testid: string;
  } = $props();

  let style = $derived(
    vars.map(([name, value]) => `${name}: ${value}`).join('; ') +
      (scheme === 'auto' ? '' : `; color-scheme: ${scheme}`)
  );
</script>

<div class="preview" data-testid={testid} {style}>
  <div class="pv-card">
    <p class="pv-title">Card</p>
    <p>Plaintext on the surface. <a href="#th" onclick={(e) => e.preventDefault()}>An inline link</a> and
      <span class="pv-badge">accent badge</span>.</p>
    <button class="pv-btn">Primary action</button>
    <button class="pv-btn secondary">Secondary</button>
  </div>

  <details class="pv-accordion">
    <summary>Accordion — click to toggle</summary>
    <p>Collapsible content styled by the same variables.</p>
  </details>

  <table class="pv-table">
    <thead>
      <tr><th>Item</th><th>State</th></tr>
    </thead>
    <tbody>
      <tr><td>First row</td><td>ready</td></tr>
      <tr><td>Second row</td><td>waiting</td></tr>
    </tbody>
  </table>

  <div class="pv-form">
    <label>
      Text field
      <input type="text" placeholder="Type here" />
    </label>
    <label>
      Select
      <select><option>Option A</option><option>Option B</option></select>
    </label>
    <label class="pv-check">
      <input type="checkbox" checked />
      Checkbox
    </label>
  </div>
</div>

<style>
  /* Everything below styles ONLY with the generated variables. */
  .preview {
    background: var(--surface);
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: calc(var(--padding) * 1.5);
    display: flex;
    flex-direction: column;
    gap: calc(var(--padding) * 1.25);
  }

  .pv-card {
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: var(--padding);
  }

  .pv-card .pv-title {
    margin-bottom: calc(var(--padding) / 2);
  }

  .pv-card p {
    margin-bottom: var(--padding);
  }

  .preview a {
    color: var(--primary);
  }

  .pv-badge {
    background: var(--accent);
    color: var(--on-accent);
    border-radius: var(--radius);
    padding: 0 calc(var(--padding) / 2);
    font-size: var(--font-size-sm);
  }

  .pv-btn {
    background: var(--primary);
    color: var(--on-primary);
    border: 1px solid var(--primary);
    border-radius: var(--radius);
    padding: calc(var(--padding) / 2) var(--padding);
    cursor: pointer;
    font-weight: 600;
  }

  .pv-btn.secondary {
    background: var(--secondary);
    color: var(--on-secondary);
    border-color: var(--secondary);
  }

  .pv-accordion {
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: var(--radius);
  }

  .pv-accordion summary {
    cursor: pointer;
    padding: calc(var(--padding) / 1.5) var(--padding);
    font-weight: 600;
  }

  .pv-accordion p {
    padding: 0 var(--padding) var(--padding);
    color: var(--neutral);
  }

  .pv-table {
    width: 100%;
    border-collapse: collapse;
  }

  .pv-table th {
    text-align: left;
    background: var(--surface-2);
    color: var(--neutral);
    border-bottom: 1px solid var(--border);
    padding: calc(var(--padding) / 2) var(--padding);
  }

  .pv-table td {
    border-bottom: 1px solid var(--border);
    padding: calc(var(--padding) / 2) var(--padding);
  }

  .pv-form {
    display: flex;
    gap: var(--padding);
    flex-wrap: wrap;
    align-items: end;
  }

  .pv-form label {
    color: var(--neutral);
    font-size: var(--font-size-sm);
    text-transform: none;
    letter-spacing: normal;
    margin-bottom: 0;
  }

  .pv-form input[type='text'],
  .pv-form select {
    display: block;
    margin-top: 4px;
    background: var(--surface-2);
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: calc(var(--padding) / 2) calc(var(--padding) / 1.5);
    width: 11rem;
  }

  .pv-check {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
  }

  .pv-check input {
    accent-color: var(--primary);
  }
</style>
