import { describe, expect, it } from 'vitest';
import { align } from './fonts';
import type { AsciiArt } from './image';
import { ADVANCE_EM, asciiHtml, asciiSvg, colourRuns, cssColour } from './render';

const art = (lines: string[], colours: string[][] | null = null): AsciiArt => ({
  columns: Math.max(...lines.map((l) => l.length)),
  rows: lines.length,
  lines,
  colours,
});

describe('colourRuns', () => {
  it('groups neighbouring characters that share a colour', () => {
    const runs = colourRuns('abcd', ['#111111', '#111111', '#222222', '#111111']);
    expect(runs).toEqual([
      { start: 0, text: 'ab', colour: '#111111' },
      { start: 2, text: 'c', colour: '#222222' },
      { start: 3, text: 'd', colour: '#111111' },
    ]);
  });

  it('keeps the column index of each run, so nothing has to be re-counted', () => {
    const runs = colourRuns('xy', ['#000000', '#ffffff']);
    expect(runs.map((r) => r.start)).toEqual([0, 1]);
  });
});

describe('cssColour', () => {
  it('passes hex and keywords through and refuses anything that could close the declaration', () => {
    expect(cssColour('#ff8800')).toBe('#ff8800');
    expect(cssColour('  #fff ')).toBe('#fff');
    expect(cssColour('red')).toBe('red');
    expect(cssColour('#fff; background: url(http://x)')).toBe('inherit');
    expect(cssColour('expression(alert(1))')).toBe('inherit');
    expect(cssColour('')).toBe('inherit');
  });
});

describe('asciiSvg', () => {
  it('is a standalone document sized on the character grid', () => {
    const svg = asciiSvg(art(['##', '##']), { fontSize: 10, cellAspect: 0.5 });
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
    // 2 columns × 10px × 0.6 advance = 12 wide; rows are twice as tall as
    // they are wide, so 2 × 12 = 24 high.
    expect(svg).toContain(`width="${Math.round(2 * 10 * ADVANCE_EM)}"`);
    expect(svg).toContain('height="24"');
    expect(svg).toContain('</svg>');
  });

  it('writes one text row per non-blank line and skips the empty ones', () => {
    const svg = asciiSvg(art(['#', '   ', '#']));
    expect(svg.match(/<text/g)).toHaveLength(2);
  });

  it('escapes the characters that would otherwise be markup', () => {
    const svg = asciiSvg(art(['<&>"']));
    expect(svg).toContain('&lt;&amp;&gt;');
    expect(svg).not.toMatch(/>[^<]*<&/);
  });

  it('pins uncoloured rows to the grid with textLength', () => {
    const svg = asciiSvg(art(['abcd']), { fontSize: 20 });
    expect(svg).toContain('lengthAdjust="spacing"');
    expect(svg).toContain(`textLength="${Math.round(4 * 20 * ADVANCE_EM)}"`);
  });

  it('places coloured runs at explicit columns and paints each one', () => {
    const svg = asciiSvg(art(['ab'], [['#ff0000', '#00ff00']]), { fontSize: 10 });
    expect(svg).toContain('<tspan x="0" fill="#ff0000">a</tspan>');
    expect(svg).toContain('<tspan x="6" fill="#00ff00">b</tspan>');
    expect(svg).not.toContain('textLength');
  });

  it('paints a background only when one is asked for', () => {
    expect(asciiSvg(art(['#']), { background: '#101010' })).toContain('<rect');
    expect(asciiSvg(art(['#']), { background: null })).not.toContain('<rect');
  });
});

describe('asciiHtml', () => {
  it('is a pre block carrying the same geometry', () => {
    const html = asciiHtml(art(['##']), { fontSize: 10, cellAspect: 0.5 });
    expect(html.startsWith('<pre style="')).toBe(true);
    expect(html).toContain('font-size: 10px');
    expect(html).toContain('line-height: 12px');
    expect(html).toContain('white-space: pre');
  });

  it('emits one span per colour run and escapes the content', () => {
    const html = asciiHtml(art(['<>'], [['#ff0000', '#ff0000']]));
    expect(html).toContain('<span style="color: #ff0000">&lt;&gt;</span>');
  });

  it('refuses a background that tries to smuggle a second declaration', () => {
    const html = asciiHtml(art(['#']), { background: '#000; color: red' });
    expect(html).toContain('background: inherit');
  });
});

describe('align', () => {
  it('pads every line to the widest and places the block', () => {
    expect(align(['ab', 'cdef'], 'left')).toEqual(['ab  ', 'cdef']);
    expect(align(['ab', 'cdef'], 'right')).toEqual(['  ab', 'cdef']);
    expect(align(['ab', 'cdef'], 'center')).toEqual([' ab ', 'cdef']);
  });

  it('keeps the block rectangular so the SVG grid holds', () => {
    for (const alignment of ['left', 'center', 'right'] as const) {
      const lines = align(['x', 'yyyyy', ''], alignment);
      expect(new Set(lines.map((l) => l.length))).toEqual(new Set([5]));
    }
  });
});
