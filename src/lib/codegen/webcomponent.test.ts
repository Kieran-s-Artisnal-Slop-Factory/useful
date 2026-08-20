import { describe, expect, it } from 'vitest';
import { generateWebComponent, tagName } from './webcomponent';
import type { CodeTemplate } from './functions';
import type { NapkinField } from '../db/types';

const field = (name: string, over: Partial<NapkinField> = {}): NapkinField => ({
  name,
  label: name,
  description: '',
  type: 'number',
  required: true,
  sign: 'any',
  noZero: false,
  ...over,
});

const template: CodeTemplate = {
  name: 'Unit economics',
  description: 'Margin per unit.',
  formulaLatex: '\\frac{\\mathrm{revenue} - \\mathrm{cost}}{\\mathrm{units}}',
  formulaJson: ['Divide', ['Subtract', 'revenue', 'cost'], 'units'],
  fields: [field('revenue'), field('cost'), field('units', { type: 'integer', noZero: true })],
};

describe('tagName', () => {
  it('makes a legal custom-element name', () => {
    // A custom element name MUST contain a hyphen and start with a letter.
    expect(tagName('Unit economics')).toBe('unit-economics');
    expect(tagName('Margin')).toBe('napkin-margin');
    expect(tagName('')).toBe('napkin-napkin');
    expect(tagName('2 for 1')).toBe('napkin-2-for-1');
    for (const name of ['Unit economics', 'Margin', '', '2 for 1', '!!!']) {
      expect(tagName(name), name).toMatch(/^[a-z][a-z0-9]*-[a-z0-9-]*$/);
    }
  });
});

describe('generateWebComponent', () => {
  const source = generateWebComponent(template);

  it('defines one element and registers it', () => {
    expect(source).toContain('class UnitEconomics extends HTMLElement');
    expect(source).toContain('customElements.define("unit-economics", UnitEconomics);');
  });

  it('has no dependency, no import and no external URL', () => {
    // The whole point: droppable into any page with a plain script tag.
    expect(source).not.toMatch(/\bimport\b/);
    expect(source).not.toMatch(/https?:\/\//);
    expect(source).not.toContain('require(');
  });

  it('gives every input a part and the right constraints', () => {
    expect(source).toContain('part="input" type="number" step="any" data-key="revenue"');
    expect(source).toContain('step="1"');
    expect(source).toContain('data-key="units"');
    expect(source).toContain('part="formula"');
    expect(source).toContain('part="result"');
  });

  it('carries the same guards the tool enforces', () => {
    expect(source).toContain('"units must be a whole number"');
    expect(source).toContain('"units cannot be zero"');
  });

  it('computes with the emitted expression', () => {
    expect(source).toContain('const answer = (revenue - cost) / units;');
  });

  it('escapes a hostile label everywhere it becomes markup', () => {
    const hostile = generateWebComponent({
      ...template,
      name: 'x',
      fields: [field('a', { label: '<img src=x onerror=alert(1)>' })],
      formulaJson: ['Add', 'a', 1],
    });
    // The only place a label becomes HTML is the innerHTML template. Elsewhere
    // it is a JS string literal that reaches the page through textContent,
    // which never parses markup — so the assertion has to be about the
    // template specifically, not about the file as a whole.
    const markup = hostile.slice(hostile.indexOf('root.innerHTML'), hostile.indexOf('this._inputs'));
    expect(markup).not.toContain('<img src=x');
    expect(markup).toContain('&lt;img src=x onerror=alert(1)&gt;');
    // And the value that does reach textContent is a plain string literal.
    expect(hostile).toContain('"<img src=x onerror=alert(1)>"');
  });

  it('escapes a hostile formula in the fallback markup', () => {
    const hostile = generateWebComponent({
      ...template,
      formulaLatex: '</div><script>alert(1)</script>',
      formulaJson: ['Add', 'revenue', 1],
      fields: [field('revenue')],
    });
    expect(hostile).not.toContain('<script>alert(1)');
    expect(hostile).toContain('&lt;script&gt;');
  });

  it('shows the formula as readable text when nothing pre-rendered it', () => {
    // The renderer-only markup would be gibberish in a plain text node.
    expect(source).toContain('$\\frac{revenue - cost}{units}$');
    expect(source).not.toContain('\\mathrm{');
  });

  it('shows the styling snippet rather than only naming the parts', () => {
    expect(source).toContain('unit-economics::part(input)');
    expect(source).toContain('Parts available:');
    for (const part of ['row', 'label', 'input', 'formula', 'result', 'error']) {
      expect(source, part).toContain(`- ${part}`);
    }
  });

  it('puts a field description on its input as a title', () => {
    const described = generateWebComponent({
      ...template,
      fields: [field('revenue', { description: 'Money taken, before costs' })],
      formulaJson: 'revenue',
    });
    expect(described).toContain('title="Money taken, before costs"');
    // And omits the attribute entirely when there is nothing to say.
    expect(source).not.toContain('title=""');
  });

  it('drops pre-rendered markup straight in when it is supplied', () => {
    const withMarkup = generateWebComponent(template, '<span class="ML__latex">x</span>');
    expect(withMarkup).toContain('<span class="ML__latex">x</span>');
  });

  it('includes a helper only when the expression calls one', () => {
    expect(source).not.toContain('function _round');
    const rounded = generateWebComponent({
      ...template,
      formulaJson: ['Round', ['Divide', 'revenue', 'units'], 2],
      fields: [field('revenue'), field('units')],
    });
    expect(rounded).toContain('function _round');
  });

  it('parses as JavaScript', () => {
    // The cheapest possible guard against a generated syntax error: the file
    // is a module, so wrap it in an async function body and let the engine
    // parse without running it.
    expect(() => new Function(`return (async () => {${source}})`)).not.toThrow();
  });
});
