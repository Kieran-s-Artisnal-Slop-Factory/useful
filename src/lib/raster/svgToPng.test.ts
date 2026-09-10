import { describe, expect, it } from 'vitest';
import { foreignObjectSupport, svgPixelSize } from './svgToPng';

/* The browser half of this module (blob URL → Image → canvas → PNG) cannot
   run under Vitest's Node environment; it is asserted in the Playwright suite,
   which decodes the produced PNG and checks its dimensions. What is testable
   here is the sizing and the engine check — the two places a wrong answer
   silently produces a bad picture instead of an error. */

describe('svgPixelSize', () => {
  it('prefers the width/height attributes', () => {
    expect(svgPixelSize('<svg width="640" height="480" viewBox="0 0 64 48"></svg>')).toEqual({
      width: 640,
      height: 480,
    });
  });

  it('accepts px units and decimals on those attributes', () => {
    expect(svgPixelSize('<svg width="320px" height="180.5px"></svg>')).toEqual({
      width: 320,
      height: 180.5,
    });
  });

  it('accepts single-quoted attributes', () => {
    expect(svgPixelSize("<svg width='100' height='50'></svg>")).toEqual({ width: 100, height: 50 });
  });

  it('falls back to the viewBox extent when width/height are missing', () => {
    expect(svgPixelSize('<svg viewBox="0 0 200 100"></svg>')).toEqual({ width: 200, height: 100 });
  });

  it('falls back to the viewBox when width/height are percentages', () => {
    expect(svgPixelSize('<svg width="100%" height="100%" viewBox="0 0 24 24"></svg>')).toEqual({
      width: 24,
      height: 24,
    });
  });

  it('reads a viewBox with a non-zero origin and comma separators', () => {
    expect(svgPixelSize('<svg viewBox="-10,-10,120,60"></svg>')).toEqual({ width: 120, height: 60 });
  });

  it('survives the namespace and other attributes on the root', () => {
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" role="img" width="42" height="42"><g/></svg>';
    expect(svgPixelSize(svg)).toEqual({ width: 42, height: 42 });
  });

  it('is null rather than a guess when nothing states a size', () => {
    expect(svgPixelSize('<svg></svg>')).toBeNull();
    expect(svgPixelSize('<svg width="100%" height="100%"></svg>')).toBeNull();
  });

  it('is null for a zero or negative size', () => {
    expect(svgPixelSize('<svg width="0" height="10"></svg>')).toBeNull();
    expect(svgPixelSize('<svg viewBox="0 0 0 0"></svg>')).toBeNull();
  });

  it('is null when there is no svg root at all', () => {
    expect(svgPixelSize('<div>not an svg</div>')).toBeNull();
    expect(svgPixelSize('')).toBeNull();
  });

  it('does not read a size off a NESTED element', () => {
    // The root has no size; an inner rect does. Reading the rect's would
    // produce a picture the wrong size with no error.
    expect(svgPixelSize('<svg><rect width="500" height="500"/></svg>')).toBeNull();
  });

  it('is not fooled by an attribute whose name merely ENDS with the one sought', () => {
    // A `\b` boundary matches between the hyphen and the w of stroke-width,
    // so this used to rasterise two pixels wide. Both orders, because a regex
    // that scans left to right can be wrong in only one of them.
    expect(svgPixelSize('<svg stroke-width="2" width="800" height="600"></svg>')).toEqual({
      width: 800,
      height: 600,
    });
    expect(svgPixelSize('<svg width="800" stroke-width="2" height="600"></svg>')).toEqual({
      width: 800,
      height: 600,
    });
    // And a root that ONLY has stroke-width has no size of its own.
    expect(svgPixelSize('<svg stroke-width="2" fill="none"></svg>')).toBeNull();
    expect(svgPixelSize('<svg stroke-width="2" viewBox="0 0 40 20"></svg>')).toEqual({
      width: 40,
      height: 20,
    });
  });
});

describe('foreignObjectSupport', () => {
  const CHROME =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
  const EDGE =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0';
  const FIREFOX = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0';
  const SAFARI =
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15';
  const IOS_SAFARI =
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1';

  it('clears the engines that rasterise foreignObject correctly', () => {
    expect(foreignObjectSupport(CHROME)).toBe('ok');
    expect(foreignObjectSupport(EDGE)).toBe('ok');
    expect(foreignObjectSupport(FIREFOX)).toBe('ok');
  });

  it('flags Safari, desktop and iOS', () => {
    expect(foreignObjectSupport(SAFARI)).toBe('foreign-object-unreliable');
    expect(foreignObjectSupport(IOS_SAFARI)).toBe('foreign-object-unreliable');
  });

  it('does not flag Chrome merely for carrying Safari and AppleWebKit in its UA', () => {
    expect(CHROME).toContain('Safari');
    expect(CHROME).toContain('AppleWebKit');
    expect(foreignObjectSupport(CHROME)).toBe('ok');
  });

  it('flags the iOS browsers, which are WebKit whatever badge they wear', () => {
    // Every browser on iOS is Safari underneath. A case-insensitive test for
    // "Edg" cleared EdgiOS — matching the lowercase i — and handed exactly
    // the engine this check exists for a blank PNG.
    const EDGE_IOS =
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 EdgiOS/117.0.2045.48 Mobile/15E148 Safari/604.1';
    const CHROME_IOS =
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/117.0.5938.108 Mobile/15E148 Safari/604.1';
    const FIREFOX_IOS =
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/133.0 Mobile/15E148 Safari/605.1.15';
    expect(foreignObjectSupport(EDGE_IOS)).toBe('foreign-object-unreliable');
    expect(foreignObjectSupport(CHROME_IOS)).toBe('foreign-object-unreliable');
    expect(foreignObjectSupport(FIREFOX_IOS)).toBe('foreign-object-unreliable');
  });

  it('assumes the best on an empty or unknown user agent', () => {
    expect(foreignObjectSupport('')).toBe('ok');
    expect(foreignObjectSupport('some-headless-thing/1.0')).toBe('ok');
  });
});
