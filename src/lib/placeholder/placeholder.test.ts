/**
 * The placeholder generators.
 *
 * The image cases PARSE the SVG rather than matching strings — a generator
 * that emits `<svg width="0">` or unbalanced markup passes every substring
 * assertion ever written and produces a blank picture.
 */
import { describe, expect, it } from 'vitest';
import { mulberry32, pick, randomInt, seedFrom, shuffled } from '../random';
import {
  batchName,
  buildBatch,
  buildImage,
  DEFAULT_IMAGE_OPTIONS,
  fitFontSize,
  GENERATORS,
  harmonise,
  MAX_SIDE,
  MIN_SIDE,
} from './images';
import { SCENES, SCENE_GROUPS, sceneById } from './scenes';
import { applyRatio, matchRatio, RATIOS, SIZE_PRESETS } from './size';
import { countText, DEFAULT_TEXT_OPTIONS, generateText, LOREM_OPENING, type TextOptions } from './text';

const text = (over: Partial<TextOptions> = {}) => generateText({ ...DEFAULT_TEXT_OPTIONS, ...over });

/**
 * A tiny XML parser, so these cases test the markup rather than the string.
 *
 * The unit suite runs in node, which has no `DOMParser`, and a DOM library
 * would be a dependency added for one file. This is enough to catch what
 * matters here — an unbalanced tag, a stray `<`, a mis-typed attribute — all
 * of which sail straight past `expect(svg).toContain(...)` and produce a
 * blank picture.
 */
interface XmlNode {
  tag: string;
  attrs: Record<string, string>;
  children: XmlNode[];
}

function parseXml(markup: string): XmlNode {
  const root: XmlNode = { tag: '#root', attrs: {}, children: [] };
  const stack: XmlNode[] = [root];
  const tagRe = /<(\/)?([A-Za-z][\w:-]*)((?:\s+[\w:-]+\s*=\s*"[^"]*")*)\s*(\/)?>/g;
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = tagRe.exec(markup)) !== null) {
    const between = markup.slice(cursor, match.index);
    if (between.includes('<')) throw new Error(`stray "<" before ${match[0]}`);
    cursor = tagRe.lastIndex;

    const [, closing, tag, attrText, selfClosing] = match;
    if (closing) {
      const open = stack.pop();
      if (!open || open.tag !== tag) throw new Error(`</${tag}> closes <${open?.tag ?? 'nothing'}>`);
      continue;
    }
    const attrs: Record<string, string> = {};
    for (const attr of attrText!.matchAll(/([\w:-]+)\s*=\s*"([^"]*)"/g)) attrs[attr[1]!] = attr[2]!;
    const node: XmlNode = { tag: tag!, attrs, children: [] };
    stack[stack.length - 1]!.children.push(node);
    if (!selfClosing) stack.push(node);
  }

  if (markup.slice(cursor).includes('<')) throw new Error('unparsed markup after the last tag');
  if (stack.length !== 1) throw new Error(`unclosed <${stack[stack.length - 1]!.tag}>`);
  if (root.children.length !== 1) throw new Error(`expected one root element, got ${root.children.length}`);
  return root.children[0]!;
}

const descendants = (node: XmlNode): XmlNode[] => [node, ...node.children.flatMap(descendants)];
const findAll = (node: XmlNode, tag: string): XmlNode[] =>
  descendants(node).filter((n) => n !== node && n.tag === tag);
const findOne = (node: XmlNode, tag: string): XmlNode | undefined => findAll(node, tag)[0];

function parseSvg(markup: string): XmlNode {
  const root = parseXml(markup);
  expect(root.tag).toBe('svg');
  return root;
}

describe('random.ts', () => {
  it('is deterministic per seed and different between seeds', () => {
    const a = Array.from({ length: 5 }, mulberry32(42));
    const b = Array.from({ length: 5 }, mulberry32(42));
    const c = Array.from({ length: 5 }, mulberry32(43));
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
    for (const n of a) expect(n).toBeGreaterThanOrEqual(0);
    for (const n of a) expect(n).toBeLessThan(1);
  });

  it('turns text into a seed, and uses a typed number as itself', () => {
    expect(seedFrom('42')).toBe(42);
    expect(seedFrom(' 42 ')).toBe(42);
    expect(seedFrom('hello')).toBe(seedFrom('hello'));
    expect(seedFrom('hello')).not.toBe(seedFrom('hellp'));
    expect(seedFrom('')).toBeGreaterThanOrEqual(0);
  });

  it('picks, bounds and shuffles without touching the input', () => {
    const rng = mulberry32(7);
    for (let i = 0; i < 50; i++) {
      const n = randomInt(rng, 3, 6);
      expect(n).toBeGreaterThanOrEqual(3);
      expect(n).toBeLessThanOrEqual(6);
    }
    expect(pick(mulberry32(1), [])).toBeUndefined();
    const source = [1, 2, 3, 4, 5];
    const out = shuffled(mulberry32(3), source);
    expect(source).toEqual([1, 2, 3, 4, 5]);
    expect([...out].sort()).toEqual(source);
  });
});

describe('filler text', () => {
  it('is the same text for the same seed, and different for another', () => {
    expect(text({ seed: 'a' })).toBe(text({ seed: 'a' }));
    expect(text({ seed: 'a' })).not.toBe(text({ seed: 'b' }));
  });

  it('honours the paragraph count', () => {
    for (const count of [1, 3, 7]) {
      expect(text({ count }).split('\n\n')).toHaveLength(count);
    }
  });

  it('honours the sentence and word counts', () => {
    const sentences = text({ unit: 'sentences', count: 4, startWithLorem: false });
    expect(sentences.split('\n')).toHaveLength(1);
    expect(countText(sentences).sentences).toBe(4);

    const words = text({ unit: 'words', count: 12, startWithLorem: false });
    expect(words.split(/\s+/)).toHaveLength(12);
  });

  it('clamps a silly count rather than hanging', () => {
    expect(text({ count: 0 }).split('\n\n')).toHaveLength(1);
    expect(text({ count: -5 }).split('\n\n')).toHaveLength(1);
    expect(text({ count: 9999 }).split('\n\n')).toHaveLength(500);
    expect(text({ count: Number.NaN }).split('\n\n')).toHaveLength(1);
  });

  it('opens with the traditional words when asked, and not when not', () => {
    expect(text({ startWithLorem: true }).startsWith(LOREM_OPENING)).toBe(true);
    expect(text({ startWithLorem: false }).startsWith(LOREM_OPENING)).toBe(false);
  });

  it('wraps paragraphs in <p> for the HTML flavour', () => {
    const html = text({ count: 2, html: true });
    expect(html.split('\n')).toHaveLength(2);
    for (const line of html.split('\n')) {
      expect(line.startsWith('<p>')).toBe(true);
      expect(line.endsWith('</p>')).toBe(true);
    }
    expect(text({ count: 2, html: false })).not.toContain('<p>');
  });

  it('ignores the lorem opening for the other corpus', () => {
    // The flag belongs to lorem ipsum; the page hides it for office speak,
    // and the generator refuses it even when asked.
    expect(text({ corpus: 'office', startWithLorem: true })).not.toContain(LOREM_OPENING);
  });

  it('writes office speak from its own grammar, not from lorem', () => {
    const office = text({ corpus: 'office', count: 2, startWithLorem: false });
    expect(office.toLowerCase()).not.toContain('consectetur');
    // A sentence, not a word salad: it ends in a full stop and contains a
    // verb phrase from the grammar.
    expect(office.trim().endsWith('.')).toBe(true);
    expect(office).toMatch(/socialise|double-click|align on|circle back|unpack|operationalise|sunset|re-baselining|productise|pressure-testing/);
  });

  it('counts what it produced', () => {
    const counts = countText(text({ count: 3, startWithLorem: false }));
    expect(counts.paragraphs).toBe(3);
    expect(counts.sentences).toBeGreaterThanOrEqual(9);
    expect(counts.words).toBeGreaterThan(50);
  });
});

describe('filler images', () => {
  it('draws every generator at the requested size, and the SVG parses', () => {
    for (const generator of GENERATORS) {
      const svg = buildImage({
        ...DEFAULT_IMAGE_OPTIONS,
        generator: generator.id,
        width: 640,
        height: 360,
        iconSvg: '<svg viewBox="0 0 24 24"><path d="M4 4 L20 20"/></svg>',
      });
      const root = parseSvg(svg);
      expect(root.attrs.width, generator.id).toBe('640');
      expect(root.attrs.height, generator.id).toBe('360');
      expect(root.attrs.viewBox, generator.id).toBe('0 0 640 360');
      expect(root.children.length, generator.id).toBeGreaterThan(0);
    }
  });

  it('is the same picture for the same seed', () => {
    for (const generator of ['flow', 'material', 'noise'] as const) {
      const options = { ...DEFAULT_IMAGE_OPTIONS, generator, seed: 'abc' };
      expect(buildImage(options)).toBe(buildImage(options));
      expect(buildImage(options)).not.toBe(buildImage({ ...options, seed: 'abd' }));
    }
  });

  it('clamps sizes to something drawable', () => {
    expect(parseSvg(buildImage({ ...DEFAULT_IMAGE_OPTIONS, width: 0, height: 0 })).attrs.width).toBe(
      String(MIN_SIDE)
    );
    expect(parseSvg(buildImage({ ...DEFAULT_IMAGE_OPTIONS, width: 99999, height: 10 })).attrs.width).toBe(
      String(MAX_SIDE)
    );
  });

  it('escapes a caption rather than letting it become markup', () => {
    const svg = buildImage({
      ...DEFAULT_IMAGE_OPTIONS,
      generator: 'heading',
      heading: '<script>alert(1)</script>',
      subheading: 'a & b',
    });
    const root = parseSvg(svg);
    expect(findOne(root, 'script')).toBeUndefined();
    expect(svg).toContain('&lt;script&gt;');
    expect(svg).toContain('a &amp; b');
  });

  it('fits a caption to the width instead of overflowing it', () => {
    const short = fitFontSize('Hi', 600, 200);
    const long = fitFontSize('A rather long caption indeed', 600, 200);
    expect(short).toBeGreaterThan(long);
    expect(long).toBeGreaterThanOrEqual(8);
    expect(short).toBeLessThanOrEqual(200);
  });

  it('draws more streamlines as the density goes up, and clamps it', () => {
    const paths = (density: number) =>
      findAll(parseSvg(buildImage({ ...DEFAULT_IMAGE_OPTIONS, generator: 'flow', density })), 'path').length;
    expect(paths(40)).toBeLessThan(paths(200));
    // Clamped at both ends: 10 lines is the floor and 400 the ceiling, past
    // which the lines stop reading as lines and the file stops being small.
    expect(paths(0)).toBe(paths(10));
    expect(paths(10_000)).toBe(paths(400));
  });

  it('takes an opacity for the geometry generators, and varies around it', () => {
    for (const generator of ['material', 'planes'] as const) {
      const opacities = (value: number) =>
        findAll(parseSvg(buildImage({ ...DEFAULT_IMAGE_OPTIONS, generator, opacity: value })), 'polygon').map(
          (n) => Number(n.attrs.opacity)
        );
      const low = opacities(0.2);
      const high = opacities(0.9);
      const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
      expect(mean(low), generator).toBeLessThan(mean(high));
      // Every shape stays inside the legal range whatever the centre is.
      for (const o of [...low, ...high]) {
        expect(o, generator).toBeGreaterThan(0);
        expect(o, generator).toBeLessThanOrEqual(1);
      }
      // A spread, not a flat fill — shapes all at one opacity stop looking
      // layered, which is what the generator is for.
      expect(new Set(opacities(0.5)).size, generator).toBeGreaterThan(1);
    }
  });

  it('builds the cut-planes palette around the chosen background', () => {
    const palette = harmonise('#1e6fd9');
    expect(palette).toHaveLength(5);
    for (const colour of palette) expect(colour).toMatch(/^#[0-9a-f]{6}$/);
    // Five distinct colours, and they follow the background's hue rather than
    // being a fixed set — a few big slabs in unrelated colours look like a
    // mistake where a dozen small ones look playful.
    expect(new Set(palette).size).toBe(5);
    expect(harmonise('#d91e6f')).not.toEqual(palette);
    // A grey has no hue to build on and must not come back as five greys.
    expect(new Set(harmonise('#808080')).size).toBe(5);
    expect(harmonise('not a colour')).toHaveLength(5);
  });

  it('draws cut planes as a few big slabs rather than scattered confetti', () => {
    const root = parseSvg(buildImage({ ...DEFAULT_IMAGE_OPTIONS, generator: 'planes', width: 800, height: 450 }));
    const polygons = findAll(root, 'polygon');
    expect(polygons.length).toBeGreaterThanOrEqual(4);
    expect(polygons.length).toBeLessThanOrEqual(6);
    // Every slab is a quadrilateral that runs off the frame — that is the
    // difference between this and the small-polygon generator beside it.
    for (const polygon of polygons) {
      const points = polygon.attrs.points!.trim().split(/\s+/).map((p) => p.split(',').map(Number));
      expect(points).toHaveLength(4);
      const xs = points.map((p) => p[0]!);
      const ys = points.map((p) => p[1]!);
      expect(Math.max(...xs) - Math.min(...xs) > 800 || Math.max(...ys) - Math.min(...ys) > 450).toBe(true);
    }
    expect(findOne(root, 'feDropShadow')).toBeDefined();
  });

  it('scales the icon, and clamps it to something that still fits', () => {
    const width = (scale: number) => {
      const svg = buildImage({
        ...DEFAULT_IMAGE_OPTIONS,
        generator: 'icon',
        iconScale: scale,
        iconSvg: '<svg viewBox="0 0 24 24"><path d="M4 4 L20 20"/></svg>',
      });
      return Number(/scale\(([\d.]+)\)/.exec(findOne(parseSvg(svg), 'g')!.attrs.transform!)![1]);
    };
    expect(width(0.8)).toBeGreaterThan(width(0.3));
    expect(width(5)).toBe(width(0.95));
    expect(width(0)).toBe(width(0.1));
  });

  it('draws the icon generator without an icon rather than breaking', () => {
    const svg = buildImage({ ...DEFAULT_IMAGE_OPTIONS, generator: 'icon', iconSvg: null });
    expect(findAll(parseSvg(svg), 'rect')).toHaveLength(1);
  });

  it('gives the noise filter a seed of its own, so the grain is reproducible', () => {
    const svg = buildImage({ ...DEFAULT_IMAGE_OPTIONS, generator: 'noise', seed: 'grain' });
    const turbulence = findOne(parseSvg(svg), 'feTurbulence')!;
    expect(turbulence.attrs.seed).toBe(String(seedFrom('grain') % 65536));
  });

  it('maps a gradient def onto SVG gradient elements', () => {
    const svg = buildImage({ ...DEFAULT_IMAGE_OPTIONS, generator: 'gradient' });
    const root = parseSvg(svg);
    expect(findOne(root, 'linearGradient')).toBeDefined();
    expect(findAll(root, 'stop')).toHaveLength(DEFAULT_IMAGE_OPTIONS.gradient.stops.length);

    const radial = buildImage({
      ...DEFAULT_IMAGE_OPTIONS,
      generator: 'gradient',
      gradient: { ...DEFAULT_IMAGE_OPTIONS.gradient, kind: 'radial' },
    });
    expect(findOne(parseSvg(radial), 'radialGradient')).toBeDefined();
  });
});

describe('the drawn scenes', () => {
  it('has fifteen of them, five per group, each parsing on its own', () => {
    expect(SCENES).toHaveLength(15);
    for (const group of SCENE_GROUPS) {
      expect(SCENES.filter((s) => s.group === group), group).toHaveLength(5);
    }
    // Ids are what the page and any saved settings point at, so a duplicate
    // would silently shadow a whole drawing.
    expect(new Set(SCENES.map((s) => s.id)).size).toBe(SCENES.length);
    for (const scene of SCENES) {
      const root = parseSvg(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${scene.viewBox}">${scene.markup}</svg>`);
      expect(root.children.length, scene.id).toBeGreaterThan(1);
    }
  });

  it('crops rather than distorts, whatever the frame', () => {
    const svg = buildImage({ ...DEFAULT_IMAGE_OPTIONS, generator: 'scene', width: 400, height: 400 });
    const nested = findOne(parseSvg(svg), 'svg')!;
    expect(nested.attrs.preserveAspectRatio).toBe('xMidYMid slice');
    expect(nested.attrs.viewBox).toBe(sceneById('mountains').viewBox);
  });

  it('falls back to the first scene for an unknown id', () => {
    expect(sceneById('nope').id).toBe(SCENES[0]!.id);
  });
});

describe('batches', () => {
  it('varies the seed per item, so item n is what that seed draws on its own', () => {
    const batch = buildBatch({ ...DEFAULT_IMAGE_OPTIONS, generator: 'flow', seed: 'x' }, 3);
    expect(batch).toHaveLength(3);
    expect(new Set(batch.map((b) => b.svg)).size).toBe(3);
    expect(batch[0]!.svg).toBe(buildImage({ ...DEFAULT_IMAGE_OPTIONS, generator: 'flow', seed: 'x' }));
    expect(batch[1]!.svg).toBe(buildImage({ ...DEFAULT_IMAGE_OPTIONS, generator: 'flow', seed: 'x-2' }));
  });

  it('names files so a listing sorts the way the batch was made', () => {
    const options = { ...DEFAULT_IMAGE_OPTIONS, generator: 'noise' as const, width: 1200, height: 675 };
    expect(batchName(options, 3, 12)).toBe('noise-1200x675-03.svg');
    expect(batchName(options, 3, 9)).toBe('noise-1200x675-3.svg');
    expect(batchName(options, 1, 1, 'png')).toBe('noise-1200x675-1.png');
    expect(buildBatch(options, 12).map((b) => b.name)[0]).toBe('noise-1200x675-01.svg');
  });

  it('clamps the count', () => {
    expect(buildBatch(DEFAULT_IMAGE_OPTIONS, 0)).toHaveLength(1);
    expect(buildBatch(DEFAULT_IMAGE_OPTIONS, 999)).toHaveLength(50);
  });
});

describe('sizes and ratios', () => {
  it('recomputes the side that was NOT just edited', () => {
    const ratio = RATIOS.find((r) => r.id === '16:9')!;
    expect(applyRatio(1600, 400, ratio, 'width')).toEqual({ width: 1600, height: 900 });
    expect(applyRatio(400, 900, ratio, 'height')).toEqual({ width: 1600, height: 900 });
  });

  it('never produces a zero side', () => {
    const ratio = RATIOS.find((r) => r.id === '9:16')!;
    expect(applyRatio(1, 1, ratio, 'width').height).toBeGreaterThan(0);
    expect(applyRatio(1, 1, ratio, 'height').width).toBeGreaterThan(0);
  });

  it('recognises the ratio a size already is', () => {
    expect(matchRatio(1200, 675)?.id).toBe('16:9');
    expect(matchRatio(800, 600)?.id).toBe('4:3');
    expect(matchRatio(600, 600)?.id).toBe('1:1');
    expect(matchRatio(1000, 173)).toBeUndefined();
  });

  it('offers presets that are all valid sizes', () => {
    for (const preset of SIZE_PRESETS) {
      expect(preset.width).toBeGreaterThanOrEqual(MIN_SIDE);
      expect(preset.height).toBeGreaterThanOrEqual(MIN_SIDE);
    }
  });
});
