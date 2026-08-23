import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  DRAWING_ASSETS,
  DRAWING_FONT_BYTES,
  DRAWING_FONT_FILES,
  DRAWING_SUFFIX,
  drawingFilename,
  isDrawingRef,
} from './drawing';

const provenance = readFileSync('public/excalidraw/PROVENANCE.txt', 'utf8');

describe('drawing refs', () => {
  it('recognises the .excalidraw.png convention and nothing else', () => {
    expect(isDrawingRef('images/plan.excalidraw.png')).toBe(true);
    expect(isDrawingRef('images/PLAN.EXCALIDRAW.PNG')).toBe(true);
    expect(isDrawingRef('images/plan.excalidraw.png?v=2#x')).toBe(true);
    expect(isDrawingRef('images/plan.png')).toBe(false);
    expect(isDrawingRef('images/excalidraw.png')).toBe(false);
  });

  it('names a new drawing from its title, or "drawing"', () => {
    expect(drawingFilename()).toBe('drawing' + DRAWING_SUFFIX);
    expect(drawingFilename('  ')).toBe('drawing' + DRAWING_SUFFIX);
    expect(drawingFilename('Q3 Plan — draft!')).toBe('q3-plan-draft' + DRAWING_SUFFIX);
  });
});

describe('vendored drawing fonts', () => {
  it('lists the twenty-five faces the vendoring script wrote, sorted', () => {
    expect(DRAWING_FONT_FILES).toHaveLength(25);
    expect([...DRAWING_FONT_FILES]).toEqual([...DRAWING_FONT_FILES].sort());
    expect(DRAWING_ASSETS).toHaveLength(DRAWING_FONT_FILES.length);
  });

  it('has every face on disk under public/excalidraw/fonts', () => {
    for (const name of DRAWING_FONT_FILES) {
      expect(existsSync(`public/excalidraw/fonts/${name}`), name).toBe(true);
    }
  });

  it('agrees with PROVENANCE.txt on the list and the byte total', () => {
    const listed = [...provenance.matchAll(/^[0-9a-f]{64}\s+\d+\s+fonts\/(\S+)$/gm)].map((m) => m[1]!);
    expect(listed).toEqual([...DRAWING_FONT_FILES]);
    const recorded = /^bytes:\s+(\d+)$/m.exec(provenance);
    expect(recorded, 'PROVENANCE.txt has no byte total').not.toBeNull();
    expect(DRAWING_FONT_BYTES).toBe(Number(recorded![1]));
  });
});
