/**
 * A napkin-math template as a dependency-free custom element.
 *
 * The point is that the generated file is droppable into any page: no build
 * step, no framework, no CDN reference, no maths library. It is one `.js` file
 * defining one custom element whose inputs recompute on every keystroke.
 *
 * Styling is deliberately almost absent. Everything is a plain element with a
 * `part` attribute, so the host page styles it with `::part()` and nothing has
 * to be overridden — a component that ships opinions about colour is a
 * component you fight.
 */
import type { NapkinField } from '../db/types';
import { emitExpression } from './expression';
import { identifierMap } from './identifiers';
import { latexToMarkdownMath } from './latex';
import type { CodeTemplate } from './functions';

/** Escape for an HTML text node or a double-quoted attribute value. */
const escapeHtml = (text: string): string =>
  text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/** A template name as a custom-element tag: lowercase, and it must have a dash. */
export function tagName(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const base = slug || 'napkin';
  // A custom element name is required to contain a hyphen, and must not start
  // with one or with a digit.
  return /-/.test(base) && /^[a-z]/.test(base) ? base : `napkin-${base.replace(/^-+/, '')}`;
}

/** `costPerUnit` -> `CostPerUnit`, for the class name. */
const className = (tag: string): string =>
  tag
    .split('-')
    .filter(Boolean)
    .map((part) => part[0]!.toUpperCase() + part.slice(1))
    .join('');

/**
 * Emit the component.
 *
 * `formulaMarkup` is optional pre-rendered HTML for the formula — MathLive's
 * SSR entry can produce it, and passing it means the generated file shows a
 * properly typeset formula while still shipping no maths JavaScript. Without
 * it the component shows the LaTeX as plain text, which is honest and costs
 * nothing.
 */
export function generateWebComponent(template: CodeTemplate, formulaMarkup?: string): string {
  const symbols = template.fields.map((f) => f.name);
  const names = identifierMap(symbols, 'javascript');
  const { expression, helpers } = emitExpression(template.formulaJson, 'javascript', names);
  const tag = tagName(template.name);
  const cls = className(tag);

  const helperSource: string[] = [];
  if (helpers.has('round')) {
    helperSource.push(
      'function _round(value, digits = 0) {',
      '  // Round half away from zero, matching the formula editor.',
      '  const factor = 10 ** digits;',
      '  const scaled = value * factor;',
      '  return (scaled >= 0 ? Math.floor(scaled + 0.5) : Math.ceil(scaled - 0.5)) / factor;',
      '}',
      ''
    );
  }
  if (helpers.has('mod')) {
    helperSource.push(
      'function _mod(a, b) {',
      '  // Floored modulo: the sign follows the divisor, as the formula editor does.',
      '  return ((a % b) + b) % b;',
      '}',
      ''
    );
  }

  const fieldData = template.fields.map((f) => ({
    key: f.name,
    id: names.get(f.name)!,
    label: f.label,
    description: f.description ?? '',
    step: f.type === 'integer' ? '1' : 'any',
    min: f.sign === 'positive' ? '0' : null,
    required: f.required,
    noZero: f.noZero,
    integer: f.type === 'integer',
  }));

  const rows = fieldData
    .map(
      (f) =>
        `      <label part="row">\n` +
        `        <span part="label">${escapeHtml(f.label)}</span>\n` +
        // The description becomes the input's own title, so it is reachable
        // by hover and by a screen reader without adding another element the
        // host page would have to style.
        `        <input part="input" type="number" step="${f.step}"` +
        (f.min !== null ? ` min="${f.min}"` : '') +
        (f.description ? ` title="${escapeHtml(f.description)}"` : '') +
        ` data-key="${escapeHtml(f.key)}" />\n` +
        `      </label>`
    )
    .join('\n');

  // Without pre-rendered markup the formula is shown as text, so it should be
  // the readable form rather than the renderer's `\mathrm{}` and `\left(`.
  const formulaBlock = formulaMarkup
    ? `      <div part="formula">${formulaMarkup}</div>`
    : `      <div part="formula">${escapeHtml(latexToMarkdownMath(template.formulaLatex))}</div>`;

  const checks = fieldData
    .map((f) => {
      const conditions: string[] = [];
      if (f.required) conditions.push(`if (!Number.isFinite(v)) return ${JSON.stringify(`${f.label} is required`)};`);
      if (f.integer) conditions.push(`if (!Number.isInteger(v)) return ${JSON.stringify(`${f.label} must be a whole number`)};`);
      if (f.min !== null) conditions.push(`if (v < 0) return ${JSON.stringify(`${f.label} cannot be negative`)};`);
      if (f.noZero) conditions.push(`if (v === 0) return ${JSON.stringify(`${f.label} cannot be zero`)};`);
      if (conditions.length === 0) return null;
      return `    if (key === ${JSON.stringify(f.key)}) {\n      ${conditions.join('\n      ')}\n    }`;
    })
    .filter(Boolean)
    .join('\n');

  // A comment that merely NAMES the parts leaves the reader to work out the
  // selector syntax; one that shows it is the same length and answers the
  // question. `::part()` is also the only way in — the shadow root means the
  // host page's own selectors cannot reach these elements at all.
  const styleHelp = [
    ' * Styling',
    ' * --------',
    ' * The markup is in a shadow root, so the only way in is ::part():',
    ' *',
    ' *   <style>',
    `  *     ${tag}::part(input) { border: 1px solid #888; }`.slice(1),
    `  *     ${tag}::part(result) { font-weight: 700; }`.slice(1),
    ' *   </style>',
    ' *',
    ' * Parts available:',
    ' *   - row      one label-and-input pair',
    ' *   - label    the field name beside its input',
    ' *   - input    the number box itself',
    ' *   - formula  the read-only formula above the fields',
    ' *   - result   the answer',
    ' *   - error    the message shown when an input breaks a rule',
  ].join('\n');

  return `/**
 * ${escapeHtml(template.name || 'Napkin calculation').replace(/\n/g, ' ')}
 *
 * Generated by the napkin-math tool. No dependencies, no build step: drop this
 * file in a page with <script type="module" src="..."></script> and use
 * <${tag}></${tag}>.
 *
${styleHelp}
 */
${helperSource.join('\n')}const FIELDS = ${JSON.stringify(
    fieldData.map((f) => ({ key: f.key, label: f.label })),
    null,
    2
  )};

/** Why this value is unacceptable, or null. Mirrors the tool's own rules. */
function problemWith(key, v) {
${checks || '    return null;'}
  return null;
}

class ${cls} extends HTMLElement {
  connectedCallback() {
    if (this.shadowRoot) return;
    const root = this.attachShadow({ mode: 'open' });
    root.innerHTML = \`
      <style>
        :host { display: block; }
        label { display: block; }
        [part="error"]:empty { display: none; }
      </style>
${formulaBlock}
${rows}
      <output part="result"></output>
      <p part="error"></p>
    \`;
    this._inputs = [...root.querySelectorAll('input')];
    this._result = root.querySelector('[part="result"]');
    this._error = root.querySelector('[part="error"]');
    for (const input of this._inputs) input.addEventListener('input', () => this.recompute());
    this.recompute();
  }

  /** Read the inputs, check them, and show the answer or the first problem. */
  recompute() {
    const values = {};
    for (const input of this._inputs) {
      const text = input.value.trim();
      values[input.dataset.key] = text === '' ? NaN : Number(text);
    }
    for (const field of FIELDS) {
      const problem = problemWith(field.key, values[field.key]);
      if (problem) {
        this._error.textContent = problem;
        this._result.textContent = '';
        return;
      }
    }
    ${fieldData.map((f) => `const ${f.id} = values[${JSON.stringify(f.key)}];`).join('\n    ')}
    const answer = ${expression};
    if (!Number.isFinite(answer)) {
      this._error.textContent = 'That does not produce a number.';
      this._result.textContent = '';
      return;
    }
    this._error.textContent = '';
    this._result.textContent = String(answer);
    this.dispatchEvent(new CustomEvent('napkin-result', { detail: { value: answer, values } }));
  }
}

customElements.define(${JSON.stringify(tag)}, ${cls});
`;
}
