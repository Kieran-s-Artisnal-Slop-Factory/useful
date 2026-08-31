import { describe, expect, it } from 'vitest';
import { isDisplayableImage, looksLikeSvg, looksLikeText, sniff } from './sniff';

const bytes = (...values: number[]) => Uint8Array.from(values);
const text = (value: string) => new TextEncoder().encode(value);

/** A header padded out, the way a real file's first block would be. */
const withTail = (head: number[], length = 32) =>
  Uint8Array.from([...head, ...new Array(Math.max(0, length - head.length)).fill(0x41)]);

describe('sniff', () => {
  it('recognises the image formats this app deals in', () => {
    expect(sniff(withTail([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))?.mime).toBe('image/png');
    expect(sniff(withTail([0xff, 0xd8, 0xff, 0xe0]))?.mime).toBe('image/jpeg');
    expect(sniff(withTail([...text('GIF89a')]))?.mime).toBe('image/gif');
    expect(sniff(withTail([...text('GIF87a')]))?.mime).toBe('image/gif');
    expect(sniff(withTail([...text('BM')]))?.mime).toBe('image/bmp');
    expect(sniff(withTail([0x49, 0x49, 0x2a, 0x00]))?.mime).toBe('image/tiff');
    expect(sniff(withTail([0x4d, 0x4d, 0x00, 0x2a]))?.mime).toBe('image/tiff');
    expect(sniff(withTail([0x00, 0x00, 0x01, 0x00]))?.mime).toBe('image/x-icon');
  });

  it('reads container brands rather than container wrappers', () => {
    const webp = withTail([...text('RIFF'), 0, 0, 0, 0, ...text('WEBP')]);
    expect(sniff(webp)?.mime).toBe('image/webp');
    const wav = withTail([...text('RIFF'), 0, 0, 0, 0, ...text('WAVE')]);
    expect(sniff(wav)?.mime).toBe('audio/wav');
    // The same brand without the RIFF wrapper is not a WebP.
    const notWebp = withTail([...text('XXXX'), 0, 0, 0, 0, ...text('WEBP')]);
    expect(sniff(notWebp)?.mime).not.toBe('image/webp');

    const avif = withTail([0, 0, 0, 0x20, ...text('ftypavif')]);
    expect(sniff(avif)?.mime).toBe('image/avif');
    const heic = withTail([0, 0, 0, 0x18, ...text('ftypheic')]);
    expect(sniff(heic)?.mime).toBe('image/heic');
    const mp4 = withTail([0, 0, 0, 0x18, ...text('ftypisom')]);
    expect(sniff(mp4)?.mime).toBe('video/mp4');
  });

  /**
   * The formats added when the HTTP playground learned to preview media: a
   * response that is a WebM or an M4A used to sniff as nothing at all, which
   * meant "unrecognised bytes" for two of the most ordinary things a server
   * serves.
   */
  it('recognises the web media formats a response is likely to be', () => {
    const m4a = withTail([0, 0, 0, 0x18, ...text('ftypM4A ')]);
    expect(sniff(m4a)?.mime).toBe('audio/mp4');
    expect(sniff(withTail([0, 0, 0, 0x18, ...text('ftypmp41')]))?.mime).toBe('video/mp4');
    expect(sniff(withTail([...text('fLaC'), 0, 0, 0, 0x22]))?.mime).toBe('audio/flac');
  });

  /**
   * WebM and Matroska share one magic number and differ only in a DocType
   * string further in — the reason this cannot be a plain signature row.
   */
  it('tells WebM from Matroska by the DocType, not the magic number', () => {
    const ebml = [0x1a, 0x45, 0xdf, 0xa3];
    const webm = withTail([...ebml, 0x9f, 0x42, 0x86, 0x81, 0x01, 0x42, 0x82, 0x84, ...text('webm')]);
    expect(sniff(webm)?.mime).toBe('video/webm');
    expect(sniff(webm)?.extension).toBe('webm');

    const mkv = withTail([...ebml, 0x9f, 0x42, 0x86, 0x81, 0x01, 0x42, 0x82, 0x88, ...text('matroska')]);
    expect(sniff(mkv)?.mime).toBe('video/x-matroska');

    // A header naming neither is still the container the magic number attests
    // to; guessing WebM there would put it in front of a player that fails.
    expect(sniff(withTail(ebml))?.mime).toBe('video/x-matroska');
  });

  it('recognises the non-image formats a paste might turn out to be', () => {
    expect(sniff(withTail([...text('%PDF-1.7')]))?.mime).toBe('application/pdf');
    expect(sniff(withTail([0x50, 0x4b, 0x03, 0x04]))?.mime).toBe('application/zip');
    expect(sniff(withTail([0x1f, 0x8b, 0x08]))?.mime).toBe('application/gzip');
    expect(sniff(withTail([...text('wOF2')]))?.mime).toBe('font/woff2');
  });

  it('names an extension and a label for every hit', () => {
    const png = sniff(withTail([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    expect(png).toEqual({ mime: 'image/png', extension: 'png', label: 'PNG image' });
  });

  it('calls XML-shaped text SVG, and only when it really looks like one', () => {
    expect(sniff(text('<svg xmlns="http://www.w3.org/2000/svg"></svg>'))?.mime).toBe('image/svg+xml');
    expect(sniff(text('<?xml version="1.0"?><svg></svg>'))?.mime).toBe('image/svg+xml');
    expect(sniff(text('  \n<!-- a note --><svg/>'))?.mime).toBe('image/svg+xml');
    expect(looksLikeSvg(text('<html><body></body></html>'))).toBe(false);
    expect(looksLikeSvg(text('not markup at all'))).toBe(false);
  });

  it('falls back to text, and to nothing at all', () => {
    expect(sniff(text('just some words'))?.mime).toBe('text/plain');
    expect(looksLikeText(bytes(0x41, 0x00, 0x42))).toBe(false);
    expect(looksLikeText(bytes())).toBe(false);
    // Random high bytes are not valid UTF-8 and are not text.
    expect(sniff(bytes(0xff, 0xfe, 0xfd, 0xfc))).toBeNull();
    expect(sniff(bytes())).toBeNull();
  });

  it('knows which types a browser will actually draw', () => {
    expect(isDisplayableImage('image/png')).toBe(true);
    expect(isDisplayableImage('image/svg+xml')).toBe(true);
    expect(isDisplayableImage('image/tiff')).toBe(false);
    expect(isDisplayableImage('application/pdf')).toBe(false);
  });
});
