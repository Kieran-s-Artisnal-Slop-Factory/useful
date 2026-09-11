import { describe, expect, it } from 'vitest';
import {
  PRESETS,
  blindsPath,
  blindsPoints,
  blindsStrips,
  circleCss,
  clipPathCss,
  ellipseCss,
  polygonCss,
  presetPoints,
  waveEdgePoints,
  wavePath,
  wavePoints,
  waveform,
  type Point,
  type WaveKind,
} from './clipPath';

describe('PRESETS', () => {
  it('has the 23 cssportal polygons plus chevron and the pointed message from design.dev', () => {
    expect(PRESETS.length).toBe(25);
    expect(PRESETS.filter((p) => p.source === 'cssportal').length).toBe(23);
    expect(PRESETS.filter((p) => p.source === 'design.dev').map((p) => p.id)).toEqual(['chevron', 'message-pointed']);
    const ids = PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every preset has at least three points inside 0–100', () => {
    for (const preset of PRESETS) {
      expect(preset.points.length, preset.id).toBeGreaterThanOrEqual(3);
      expect(preset.label.length, preset.id).toBeGreaterThan(0);
      for (const [x, y] of preset.points) {
        expect(x, preset.id).toBeGreaterThanOrEqual(0);
        expect(x, preset.id).toBeLessThanOrEqual(100);
        expect(y, preset.id).toBeGreaterThanOrEqual(0);
        expect(y, preset.id).toBeLessThanOrEqual(100);
      }
    }
  });

  it('presetPoints returns a copy, never the shared array', () => {
    const a = presetPoints('triangle');
    a[0][0] = 99;
    expect(presetPoints('triangle')[0][0]).toBe(50);
    expect(presetPoints('no-such-preset')).toEqual(PRESETS[0].points);
  });
});

describe('basic shape functions', () => {
  it('polygonCss writes percent pairs separated by commas', () => {
    expect(polygonCss([[50, 0], [0, 100], [100, 100]])).toBe('polygon(50% 0%, 0% 100%, 100% 100%)');
    expect(polygonCss([[33.3333, 0.005]])).toBe('polygon(33.33% 0.01%)');
  });

  it('circleCss and ellipseCss use the `at` position syntax', () => {
    expect(circleCss(40, 50, 50)).toBe('circle(40% at 50% 50%)');
    expect(ellipseCss(45, 30, 50, 50)).toBe('ellipse(45% 30% at 50% 50%)');
  });
});

describe('blinds', () => {
  it('count × strip + (count − 1) × gap fills exactly 100%', () => {
    for (const count of [1, 2, 5, 12]) {
      for (const gap of [0, 4, 8]) {
        const strips = blindsStrips({ count, gap, direction: 'horizontal' });
        expect(strips.length).toBe(count);
        expect(strips[0][0]).toBe(0);
        expect(strips[count - 1][1]).toBeCloseTo(100, 6);
        for (let i = 1; i < strips.length; i++) {
          expect(strips[i][0] - strips[i - 1][1]).toBeCloseTo(gap, 6);
          expect(strips[i][1] - strips[i][0]).toBeCloseTo(strips[0][1] - strips[0][0], 6);
        }
      }
    }
  });

  it('a gap too big for the count is clamped so the strips keep a width', () => {
    const strips = blindsStrips({ count: 4, gap: 90, direction: 'vertical' });
    for (const [a, b] of strips) expect(b - a).toBeGreaterThan(0);
    expect(strips[3][1]).toBeCloseTo(100, 6);
  });

  it('traces every strip as four corners on one polygon, walking the seam between them', () => {
    const pts = blindsPoints({ count: 3, gap: 5, direction: 'horizontal' });
    expect(pts.length).toBe(12);
    // Horizontal bars span the full width; the seam sits on x = 0.
    expect(pts[0]).toEqual([0, 0]);
    expect(pts[1]).toEqual([100, 0]);
    expect(pts[3][0]).toBe(0);
    expect(pts[4][0]).toBe(0);
    expect(pts[4][1]).toBeCloseTo(pts[3][1] + 5, 6);
    const vertical = blindsPoints({ count: 3, gap: 5, direction: 'vertical' });
    expect(vertical[0]).toEqual([0, 0]);
    expect(vertical[1]).toEqual([0, 100]);
    expect(vertical[3][1]).toBe(0);
  });

  it('blindsPath writes one closed rectangle per strip', () => {
    const path = blindsPath({ count: 2, gap: 10, direction: 'horizontal' });
    expect(path).toBe('path("M 0 0 H 100 V 45 H 0 Z M 0 55 H 100 V 100 H 0 Z")');
  });
});

/**
 * How many separate crests a top-edge wave has: runs of samples sitting ON
 * the edge (y ≈ 0), separated by samples below it. A sine crest is one
 * sample, a square crest a plateau — both count once.
 */
function crestRuns(edge: Point[]): number {
  let runs = 0;
  let onCrest = false;
  for (const [, y] of edge) {
    const here = Math.abs(y) < 1e-6;
    if (here && !onCrest) runs++;
    onCrest = here;
  }
  return runs;
}

describe('waves', () => {
  it('every waveform peaks at a quarter period and stays in −1..1', () => {
    for (const kind of ['sine', 'triangle', 'square'] as WaveKind[]) {
      expect(waveform(kind, 0.25)).toBeCloseTo(1, 6);
      expect(waveform(kind, 0.75)).toBeCloseTo(-1, 6);
    }
    expect(waveform('sawtooth', 0)).toBe(-1);
    expect(waveform('sawtooth', 0.999)).toBeCloseTo(1, 2);
    for (const kind of ['sine', 'triangle', 'square', 'sawtooth'] as WaveKind[]) {
      for (let t = -2; t < 3; t += 0.01) {
        const v = waveform(kind, t);
        expect(v).toBeGreaterThanOrEqual(-1 - 1e-9);
        expect(v).toBeLessThanOrEqual(1 + 1e-9);
      }
    }
  });

  it('the edge runs from x = 0 to x = 100 and carries `waves` peaks', () => {
    for (const kind of ['sine', 'triangle', 'square', 'sawtooth'] as WaveKind[]) {
      for (const waves of [1, 3, 6]) {
        const edge = waveEdgePoints({ waves, amplitude: 20, phase: 0, edge: 'top', kind });
        expect(edge[0][0], kind).toBe(0);
        expect(edge[edge.length - 1][0], kind).toBe(100);
        expect(crestRuns(edge), `${kind} × ${waves}`).toBe(waves);
        for (const [, y] of edge) {
          expect(y).toBeGreaterThanOrEqual(0);
          expect(y).toBeLessThanOrEqual(20);
        }
      }
    }
  });

  it('a bottom-edge wave hugs y = 100 and the polygon closes across the top', () => {
    const pts = wavePoints({ waves: 2, amplitude: 10, phase: 0, edge: 'bottom', kind: 'sine' });
    expect(pts[0]).toEqual([0, 0]);
    expect(pts[1]).toEqual([100, 0]);
    for (const [, y] of pts.slice(2)) {
      expect(y).toBeGreaterThanOrEqual(90);
      expect(y).toBeLessThanOrEqual(100);
    }
    const top = wavePoints({ waves: 2, amplitude: 10, phase: 0, edge: 'top', kind: 'sine' });
    expect(top[top.length - 2]).toEqual([100, 100]);
    expect(top[top.length - 1]).toEqual([0, 100]);
  });

  it('square steps are vertical (two points share an x) and phase shifts them', () => {
    const edge = waveEdgePoints({ waves: 1, amplitude: 20, phase: 0, edge: 'top', kind: 'square' });
    const step = edge.filter(([x]) => x === 50);
    expect(step.length).toBe(2);
    expect(step.map(([, y]) => y).sort((a, b) => a - b)).toEqual([0, 20]);
    // The far edge ends on the trough: the rising step at x = 100 has no far side.
    expect(edge[edge.length - 1]).toEqual([100, 20]);
    expect(edge.filter(([x]) => x === 100).length).toBe(1);
    const shifted = waveEdgePoints({ waves: 1, amplitude: 20, phase: 90, edge: 'top', kind: 'square' });
    expect(shifted.filter(([x]) => x === 25).length).toBe(2);
  });

  it('wavePath is the same polygon spelled as a path()', () => {
    const opts = { waves: 2, amplitude: 10, phase: 0, edge: 'top' as const, kind: 'triangle' as const };
    const path = wavePath(opts);
    expect(path.startsWith('path("M 0 5 L ')).toBe(true);
    expect(path.endsWith(' L 100 100 L 0 100 Z")')).toBe(true);
    expect(path.split(' L ').length).toBe(wavePoints(opts).length);
  });
});

describe('clipPathCss', () => {
  it('polygon: declaration, outline and the same points back', () => {
    const points: Point[] = [[50, 0], [0, 100], [100, 100]];
    const r = clipPathCss({ type: 'polygon', points });
    expect(r.css).toBe('clip-path: polygon(50% 0%, 0% 100%, 100% 100%);');
    expect(r.value).toBe('polygon(50% 0%, 0% 100%, 100% 100%)');
    expect(r.previewPath).toBe('M 50 0 L 0 100 L 100 100 Z');
    expect(r.points).toBe(points);
    expect(r.alternate).toBeNull();
  });

  it('circle and ellipse emit their own functions and an arc outline', () => {
    const c = clipPathCss({ type: 'circle', radius: 40, cx: 50, cy: 50 });
    expect(c.css).toBe('clip-path: circle(40% at 50% 50%);');
    expect(c.previewPath).toContain('A 40 40');
    expect(c.points).toBeNull();
    const e = clipPathCss({ type: 'ellipse', rx: 45, ry: 30, cx: 50, cy: 50 });
    expect(e.css).toBe('clip-path: ellipse(45% 30% at 50% 50%);');
    expect(e.previewPath).toContain('A 45 30');
  });

  it('blinds are a polygon (percent, resolution independent), never a path()', () => {
    const r = clipPathCss({ type: 'blinds', count: 4, gap: 5, direction: 'vertical' });
    expect(r.css.startsWith('clip-path: polygon(')).toBe(true);
    expect(r.css).not.toContain('path(');
    expect(r.points?.length).toBe(16);
    expect(r.previewPath.split('M ').length - 1).toBe(4);
    expect(r.alternate).toBeNull();
  });

  it('waves are a polygon with a path() alternate', () => {
    const r = clipPathCss({ type: 'wave', waves: 3, amplitude: 14, phase: 0, edge: 'top', kind: 'sine' });
    expect(r.css.startsWith('clip-path: polygon(0% 7%, ')).toBe(true);
    expect(r.css.endsWith('100% 100%, 0% 100%);')).toBe(true);
    expect(r.alternate?.css.startsWith('clip-path: path("M 0 7 L ')).toBe(true);
    expect(r.alternate?.note).toContain('pixels');
  });
});
