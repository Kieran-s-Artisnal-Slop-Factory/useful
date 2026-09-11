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
  DEFAULT_BATCH_VARIATION,
  DEFAULT_IMAGE_OPTIONS,
  DEFAULT_PALETTE,
  paletteOf,
  varyOptions,
  type BatchVariation,
  type ImageOptions,
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

describe('mosaic and swirl', () => {
  const palette = ['#112233', '#445566', '#778899', '#aabbcc'];
  const draw = (over: Partial<ImageOptions>) =>
    buildImage({ ...DEFAULT_IMAGE_OPTIONS, background: '#ffffff', palette, width: 400, height: 300, ...over });
  const fills = (svg: string): string[] => [...svg.matchAll(/fill="([^"]+)"/g)].map((m) => m[1]!);

  it('draws both as SVG that parses, deterministically per seed', () => {
    for (const generator of ['mosaic', 'swirl'] as const) {
      const svg = draw({ generator, seed: 'one' });
      expect(svg.startsWith('<svg'), generator).toBe(true);
      const root = parseSvg(svg);
      expect(root.attrs.viewBox, generator).toBe('0 0 400 300');
      expect(svg, generator).toBe(draw({ generator, seed: 'one' }));
      expect(svg, generator).not.toBe(draw({ generator, seed: 'two' }));
    }
  });

  it('paints only with the palette and the background', () => {
    for (const generator of ['mosaic', 'swirl'] as const) {
      const used = new Set(fills(draw({ generator })));
      expect(used.size, generator).toBeGreaterThan(1);
      for (const fill of used) expect([...palette, '#ffffff'], generator).toContain(fill);
    }
    // Every palette colour gets used by the mosaic, and the swirl uses two.
    expect(new Set(fills(draw({ generator: 'mosaic', cutRatio: 0 }))).size).toBe(5);
    expect(new Set(fills(draw({ generator: 'swirl' })))).toEqual(new Set(['#112233', '#445566']));
    // A one-colour palette: the swirl's second tone is the background.
    expect(new Set(fills(draw({ generator: 'swirl', palette: ['#112233'] })))).toEqual(new Set(['#112233', '#ffffff']));
  });

  it('cuts nothing at 0, everything at 1, and something in between', () => {
    const backgroundRects = (cutRatio: number) =>
      findAll(parseSvg(draw({ generator: 'mosaic', cutRatio })), 'rect').filter((r) => r.attrs.fill === '#ffffff').length;
    const blocks = (cutRatio: number) => findAll(parseSvg(draw({ generator: 'mosaic', cutRatio })), 'rect').length - 1;
    // Only the backdrop is background-coloured when nothing is cut.
    expect(backgroundRects(0)).toBe(1);
    // 8% of 300 is a 24px block: 17 columns × 13 rows.
    expect(blocks(0)).toBe(17 * 13);
    expect(blocks(1)).toBe(0);
    expect(blocks(0.5)).toBeGreaterThan(0);
    expect(blocks(0.5)).toBeLessThan(17 * 13);
    // A bigger block means fewer of them.
    expect(blocks(0) > findAll(parseSvg(draw({ generator: 'mosaic', cutRatio: 0, blockSize: 20 })), 'rect').length - 1).toBe(true);
  });

  it('draws the swirl as one filled path that grows with the turns', () => {
    const path = (turns: number) => findOne(parseSvg(draw({ generator: 'swirl', turns })), 'path')!;
    expect(findAll(parseSvg(draw({ generator: 'swirl' })), 'path')).toHaveLength(1);
    expect(path(2).attrs.d!.length).toBeLessThan(path(6).attrs.d!.length);
    expect(path(2).attrs.d!.endsWith('Z')).toBe(true);
    // A wider arm covers more of the frame — its path runs further round.
    const wide = draw({ generator: 'swirl', armWidth: 0.8 });
    const narrow = draw({ generator: 'swirl', armWidth: 0.2 });
    expect(wide).not.toBe(narrow);
  });

  it('falls back to the default palette and caps at four', () => {
    expect(paletteOf({ ...DEFAULT_IMAGE_OPTIONS, palette: [] })).toEqual(DEFAULT_PALETTE);
    expect(paletteOf({ ...DEFAULT_IMAGE_OPTIONS, palette: [' ', ''] })).toEqual(DEFAULT_PALETTE);
    expect(paletteOf({ ...DEFAULT_IMAGE_OPTIONS, palette: ['#000', ' #fff ', 'red', 'blue', 'green'] })).toEqual([
      '#000',
      '#fff',
      'red',
      'blue',
    ]);
    expect(DEFAULT_PALETTE).toHaveLength(4);
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

describe('batch variation', () => {
  const base: ImageOptions = {
    ...DEFAULT_IMAGE_OPTIONS,
    gradient: { ...DEFAULT_IMAGE_OPTIONS.gradient, stops: [{ color: '#112233', position: null }, { color: '#445566', position: null }] },
  };
  const vary = (over: Partial<BatchVariation>, i: number, n = 5, seed = 7) =>
    varyOptions(base, i, n, { ...DEFAULT_BATCH_VARIATION, ...over }, mulberry32(seed));
  const items = (over: Partial<BatchVariation>, n = 5, seed = 7) => {
    const rng = mulberry32(seed);
    return Array.from({ length: n }, (_, i) => varyOptions(base, i, n, { ...DEFAULT_BATCH_VARIATION, ...over }, rng));
  };

  it('with everything off is the batch as it was before variation existed', () => {
    for (const generator of ['flow', 'noise', 'gradient', 'scene'] as const) {
      const options = { ...base, generator, seed: 'x' };
      const plain = buildBatch(options, 4);
      const explicit = buildBatch(options, 4, DEFAULT_BATCH_VARIATION);
      expect(explicit.map((b) => [b.name, b.svg])).toEqual(plain.map((b) => [b.name, b.svg]));
      // The pre-existing contract, spelled out: the seed varied per item and
      // nothing else, so item n is what that seed draws on its own.
      expect(plain.map((b) => b.svg)).toEqual([
        buildImage(options),
        buildImage({ ...options, seed: 'x-2' }),
        buildImage({ ...options, seed: 'x-3' }),
        buildImage({ ...options, seed: 'x-4' }),
      ]);
      expect(plain.map((b) => b.name)).toEqual([1, 2, 3, 4].map((i) => `${generator}-1200x675-${i}.svg`));
    }
    expect(varyOptions(base, 2, 5, DEFAULT_BATCH_VARIATION, mulberry32(1))).toEqual(base);
  });

  it('is deterministic for a seed, and leaves the base alone', () => {
    const all: Partial<BatchVariation> = {
      background: true,
      ink: true,
      stop1: true,
      stop2: true,
      randomSeed: true,
      scenes: ['lake', 'coast'],
    };
    const before = JSON.stringify(base);
    expect(items(all, 6, 3)).toEqual(items(all, 6, 3));
    expect(items(all, 6, 3)).not.toEqual(items(all, 6, 4));
    expect(JSON.stringify(base)).toBe(before);
    const a = buildBatch({ ...base, generator: 'flow' }, 3, { ...DEFAULT_BATCH_VARIATION, background: true });
    const b = buildBatch({ ...base, generator: 'flow' }, 3, { ...DEFAULT_BATCH_VARIATION, background: true });
    expect(a.map((x) => x.svg)).toEqual(b.map((x) => x.svg));
  });

  it('applies a size per index, item 0 included, and names the file from it', () => {
    const sizes = [
      { width: 300, height: 200 },
      { width: 640, height: 360 },
      { width: 100, height: 100 },
    ];
    expect(vary({ sizes }, 0)).toMatchObject(sizes[0]!);
    expect(vary({ sizes }, 2)).toMatchObject(sizes[2]!);
    // A shorter list leaves the rest at the base size.
    expect(vary({ sizes }, 4)).toMatchObject({ width: 1200, height: 675 });
    const batch = buildBatch(base, 3, { ...DEFAULT_BATCH_VARIATION, sizes });
    expect(batch.map((b) => b.name)).toEqual(['solid-300x200-1.svg', 'solid-640x360-2.svg', 'solid-100x100-3.svg']);
    expect(parseSvg(batch[1]!.svg).attrs.viewBox).toBe('0 0 640 360');
    expect(batch[1]!.options.width).toBe(640);
  });

  it('rolls a background and an ink per item that are colours and differ', () => {
    const backgrounds = items({ background: true }).map((o) => o.background);
    const inks = items({ ink: true }).map((o) => o.foreground);
    for (const c of [...backgrounds, ...inks]) expect(c).toMatch(/^#[0-9a-f]{6}$/);
    expect(new Set(backgrounds).size).toBe(5);
    expect(new Set(inks).size).toBe(5);
    expect(vary({ background: true }, 1).foreground).toBe(base.foreground);
  });

  it('offsets the gradient angle by i × offset and wraps at 360', () => {
    // Base angle 135: 135, 165, 195, 225, 255, ... 345, 375 → 15.
    expect(items({ angleOffset: 30 }, 9).map((o) => o.gradient.angle)).toEqual([
      135, 165, 195, 225, 255, 285, 315, 345, 15,
    ]);
    expect(vary({ angleOffset: -200 }, 1).gradient.angle).toBe(295);
    expect(vary({ angleOffset: 30 }, 1).gradient.stops).toEqual(base.gradient.stops);
  });

  it('re-rolls a stop until it differs from the other one', () => {
    for (const o of items({ stop1: true })) {
      expect(o.gradient.stops[0]!.color).not.toBe('#112233');
      expect(o.gradient.stops[0]!.color).not.toBe(o.gradient.stops[1]!.color);
      expect(o.gradient.stops[1]!.color).toBe('#445566');
    }
    for (const o of items({ stop2: true })) {
      expect(o.gradient.stops[1]!.color).not.toBe('#445566');
      expect(o.gradient.stops[0]!.color).toBe('#112233');
    }
    for (const o of items({ stop1: true, stop2: true })) {
      expect(o.gradient.stops[0]!.color).not.toBe(o.gradient.stops[1]!.color);
    }
    // An rng that repeats itself: stop 2's first roll matches stop 1, so it
    // has to roll again and land somewhere else.
    let calls = 0;
    const rng = () => [0.1, 0.2, 0.3, 0.1, 0.2, 0.3, 0.9, 0.5, 0.5][calls++ % 9]!;
    const same = varyOptions(base, 0, 1, { ...DEFAULT_BATCH_VARIATION, stop1: true, stop2: true }, rng);
    expect(same.gradient.stops[0]!.color).not.toBe(same.gradient.stops[1]!.color);
    expect(calls).toBe(9);
  });

  it('cycles the gradient kind between the two SVG can draw', () => {
    expect(items({ cycleKind: true }, 4).map((o) => o.gradient.kind)).toEqual(['linear', 'radial', 'linear', 'radial']);
    const radial = { ...base, gradient: { ...base.gradient, kind: 'radial' as const } };
    const rng = mulberry32(1);
    expect(
      [0, 1, 2].map((i) => varyOptions(radial, i, 3, { ...DEFAULT_BATCH_VARIATION, cycleKind: true }, rng).gradient.kind)
    ).toEqual(['radial', 'linear', 'radial']);
  });

  it('steps the grain and blur by i × delta and clamps them to the sliders', () => {
    expect(items({ grainDelta: 0.03 }, 4).map((o) => o.frequency)).toEqual([0.012, 0.042, 0.072, 0.08]);
    expect(items({ grainDelta: -0.01 }, 3).map((o) => o.frequency)).toEqual([0.012, 0.002, 0.002]);
    expect(items({ blurDelta: 3 }, 4).map((o) => o.blur)).toEqual([0, 3, 6, 8]);
  });

  it('gives each item twelve alphanumerics as a seed when asked', () => {
    const seeds = items({ randomSeed: true }).map((o) => o.seed);
    for (const seed of seeds) expect(seed).toMatch(/^[A-Za-z0-9]{12}$/);
    expect(new Set(seeds).size).toBe(5);
    // The rule replaces the batch's own "-n" suffix rather than adding to it.
    const batch = buildBatch({ ...base, generator: 'flow' }, 2, { ...DEFAULT_BATCH_VARIATION, randomSeed: true });
    expect(batch[1]!.options.seed).toMatch(/^[A-Za-z0-9]{12}$/);
    expect(batch[1]!.svg).toBe(buildImage(batch[1]!.options));
  });

  it('steps the line count and wraps at 400 back to zero plus the remainder', () => {
    // Base 90: 90, 250, 410 → 10, 570 → 170.
    expect(items({ lineDelta: 160 }, 4).map((o) => o.density)).toEqual([90, 250, 10, 170]);
    expect(items({ lineDelta: 310 }, 2).map((o) => o.density)).toEqual([90, 400]);
  });

  it('steps the opacity and clamps it to 0.05–1', () => {
    expect(items({ opacityDelta: 0.2 }, 4).map((o) => o.opacity)).toEqual([0.55, 0.75, 0.95, 1]);
    expect(items({ opacityDelta: -0.3 }, 3).map((o) => o.opacity)).toEqual([0.55, 0.25, 0.05]);
  });

  it('steps the icon size, wraps at 0.95 and never goes under 0.1', () => {
    // Base 0.5: 0.5, 0.8, 1.1 → 0.15, 1.4 → 0.45.
    expect(items({ sizeDelta: 0.3 }, 4).map((o) => o.iconScale)).toEqual([0.5, 0.8, 0.15, 0.45]);
    // 0.5 + 0.45 = 0.95 stays; 0.5 + 0.5 = 1 → 0.05 → floored to 0.1.
    expect(vary({ sizeDelta: 0.45 }, 1).iconScale).toBe(0.95);
    expect(vary({ sizeDelta: 0.5 }, 1).iconScale).toBe(0.1);
  });

  it('draws the icon each item was given, cycling a short list', () => {
    const icons = ['<svg viewBox="0 0 24 24"><path d="M1 1"/></svg>', '<svg viewBox="0 0 24 24"><path d="M2 2"/></svg>'];
    expect(items({ randomIcon: icons }, 3).map((o) => o.iconSvg)).toEqual([icons[0], icons[1], icons[0]]);
    expect(vary({ randomIcon: [] }, 0).iconSvg).toBe(base.iconSvg);
    const batch = buildBatch({ ...base, generator: 'icon' }, 2, { ...DEFAULT_BATCH_VARIATION, randomIcon: icons });
    expect(batch[0]!.svg).toContain('M1 1');
    expect(batch[1]!.svg).toContain('M2 2');
  });

  it('picks a scene per item from the allowed set only', () => {
    const allowed = ['pitch', 'hoop', 'track'] as const;
    const picked = items({ scenes: [...allowed] }, 30, 11).map((o) => o.scene);
    for (const scene of picked) expect(allowed).toContain(scene);
    expect(new Set(picked).size).toBe(3);
    expect(vary({ scenes: [] }, 0).scene).toBe(base.scene);
    expect(vary({ scenes: ['subway'] }, 4).scene).toBe('subway');
    const batch = buildBatch({ ...base, generator: 'scene' }, 3, { ...DEFAULT_BATCH_VARIATION, scenes: ['subway'] });
    expect(new Set(batch.map((b) => b.svg)).size).toBe(1);
  });

  it('shuffles the palette per item, keeping the same colours', () => {
    const palette = ['#111111', '#222222', '#333333', '#444444'];
    const shuffledBase = { ...base, palette };
    const rng = mulberry32(5);
    const palettes = Array.from({ length: 6 }, (_, i) =>
      varyOptions(shuffledBase, i, 6, { ...DEFAULT_BATCH_VARIATION, palette: 'shuffle' }, rng).palette
    );
    for (const p of palettes) expect([...p].sort()).toEqual(palette);
    expect(new Set(palettes.map((p) => p.join())).size).toBeGreaterThan(1);
    // The base is left alone, and off leaves the palette as it was.
    expect(shuffledBase.palette).toEqual(palette);
    expect(vary({ palette: 'off' }, 1).palette).toEqual(base.palette);
  });

  it('draws a new palette per item when asked, with as many colours', () => {
    const palettes = items({ palette: 'random' }).map((o) => o.palette);
    for (const p of palettes) {
      expect(p).toHaveLength(base.palette.length);
      for (const c of p) expect(c).toMatch(/^#[0-9a-f]{6}$/);
      expect([...p].sort()).not.toEqual([...base.palette].sort());
    }
    expect(new Set(palettes.map((p) => p.join())).size).toBe(5);
    const batch = buildBatch({ ...base, generator: 'mosaic' }, 2, { ...DEFAULT_BATCH_VARIATION, palette: 'random' });
    expect(batch[1]!.svg).toBe(buildImage(batch[1]!.options));
    expect(batch[1]!.svg).not.toContain(base.palette[0]!);
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
