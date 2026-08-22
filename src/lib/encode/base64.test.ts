import { describe, expect, it } from 'vitest';
import {
  Base64Error,
  buildDataUrl,
  decodeBytes,
  decodedLength,
  decodeText,
  encodeBytes,
  encodedLength,
  encodeText,
  isValid,
  looksLikeDataUrl,
  parseDataUrl,
  validate,
} from './base64';

const bytes = (...values: number[]) => Uint8Array.from(values);

describe('encoding', () => {
  it('matches the RFC 4648 examples, padding included', () => {
    expect(encodeText('')).toBe('');
    expect(encodeText('f')).toBe('Zg==');
    expect(encodeText('fo')).toBe('Zm8=');
    expect(encodeText('foo')).toBe('Zm9v');
    expect(encodeText('foob')).toBe('Zm9vYg==');
    expect(encodeText('fooba')).toBe('Zm9vYmE=');
    expect(encodeText('foobar')).toBe('Zm9vYmFy');
  });

  it('encodes text as UTF-8, which is where btoa throws', () => {
    // btoa('café') is a DOMException; these bytes are c3 a9 for the é.
    expect(encodeText('café')).toBe('Y2Fmw6k=');
    expect(decodeText('Y2Fmw6k=')).toBe('café');
    const emoji = '👍🏽 家族';
    expect(decodeText(encodeText(emoji))).toBe(emoji);
  });

  it('uses the URL-safe alphabet and drops padding when asked', () => {
    // 0xFB 0xFF encodes to +/8= in the standard alphabet.
    const raw = bytes(0xfb, 0xff, 0xfe);
    expect(encodeBytes(raw)).toBe('+//+');
    expect(encodeBytes(raw, { url: true })).toBe('-__-');
    expect(encodeBytes(bytes(0xff), { url: true })).toBe('_w');
    expect(encodeBytes(bytes(0xff), { url: true, pad: true })).toBe('_w==');
    expect(encodeBytes(bytes(0xff), { pad: false })).toBe('/w');
  });

  it('wraps at a column when MIME asks it to', () => {
    const wrapped = encodeText('a'.repeat(100), { wrap: 76 });
    const rows = wrapped.split('\n');
    expect(rows[0]).toHaveLength(76);
    expect(rows).toHaveLength(2);
    // A wrapped body still decodes: whitespace is not data.
    expect(decodeText(wrapped)).toBe('a'.repeat(100));
  });
});

describe('decoding', () => {
  it('accepts either alphabet, with or without padding', () => {
    expect(decodeText('Zm9vYmFy')).toBe('foobar');
    expect(decodeText('Zm9vYg')).toBe('foob');
    expect([...decodeBytes('-__-')]).toEqual([0xfb, 0xff, 0xfe]);
    expect([...decodeBytes('+//+')]).toEqual([0xfb, 0xff, 0xfe]);
  });

  it('round-trips arbitrary bytes, including the ones that are not text', () => {
    const raw = Uint8Array.from({ length: 256 }, (_, i) => i);
    expect([...decodeBytes(encodeBytes(raw))]).toEqual([...raw]);
    expect([...decodeBytes(encodeBytes(raw, { url: true }))]).toEqual([...raw]);
  });

  it('names the offset where the input stopped being base64', () => {
    const bad = validate('Zm9v!mFy');
    expect(bad.ok).toBe(false);
    expect(bad.offset).toBe(4);
    expect(bad.message).toContain('not a base64 character');

    const midPad = validate('Zm9=vYmFy');
    expect(midPad.ok).toBe(false);
    expect(midPad.offset).toBe(4);

    const truncated = validate('Zm9vY');
    expect(truncated.ok).toBe(false);
    expect(truncated.message).toContain('truncated');
  });

  it('throws Base64Error rather than returning something that looks like data', () => {
    // atob('Zm9v!mFy') is not an error in every engine; this always is.
    expect(() => decodeBytes('Zm9v!mFy')).toThrow(Base64Error);
    try {
      decodeBytes('Zm9v!mFy');
    } catch (error) {
      expect((error as Base64Error).offset).toBe(4);
    }
  });

  it('refuses bytes that decode cleanly but are not UTF-8 text', () => {
    // 0xff is not a legal UTF-8 lead byte; the bytes are fine, the text is not.
    const encoded = encodeBytes(bytes(0xff, 0xfe, 0xfd));
    expect(() => decodeText(encoded)).toThrow(Base64Error);
    expect([...decodeBytes(encoded)]).toEqual([0xff, 0xfe, 0xfd]);
  });

  it('treats whitespace and empty strings as harmless', () => {
    expect(isValid('')).toBe(true);
    expect(isValid('  \n  ')).toBe(true);
    expect(decodeText(' Zm9v \n YmFy ')).toBe('foobar');
    expect([...decodeBytes('')]).toEqual([]);
  });
});

describe('sizing', () => {
  it('predicts the encoded length, which is the +33% everyone forgets', () => {
    for (const n of [0, 1, 2, 3, 4, 100, 999]) {
      const raw = Uint8Array.from({ length: n }, (_, i) => i & 0xff);
      expect(encodedLength(n)).toBe(encodeBytes(raw).length);
      expect(encodedLength(n, { url: true })).toBe(encodeBytes(raw, { url: true }).length);
      expect(encodedLength(n, { wrap: 76 })).toBe(encodeBytes(raw, { wrap: 76 }).length);
    }
  });

  it('predicts the decoded length without decoding', () => {
    expect(decodedLength('Zm9vYmFy')).toBe(6);
    expect(decodedLength('Zg==')).toBe(1);
    expect(decodedLength('Zm8=')).toBe(2);
    expect(decodedLength(' Zm9v \n YmFy ')).toBe(6);
  });
});

describe('data URLs', () => {
  it('round-trips a data URL', () => {
    const url = buildDataUrl('image/png', bytes(0x89, 0x50, 0x4e, 0x47));
    expect(url).toBe('data:image/png;base64,iVBORw==');
    const parsed = parseDataUrl(url);
    expect(parsed?.mime).toBe('image/png');
    expect(parsed?.base64).toBe(true);
    expect([...(parsed?.bytes ?? [])]).toEqual([0x89, 0x50, 0x4e, 0x47]);
  });

  it('reads the percent-encoded form and the defaulted media type', () => {
    const parsed = parseDataUrl('data:,Hello%2C%20world');
    expect(parsed?.mime).toBe('text/plain');
    expect(parsed?.base64).toBe(false);
    expect(new TextDecoder().decode(parsed?.bytes)).toBe('Hello, world');
  });

  it('keeps the parameters that follow the type', () => {
    const parsed = parseDataUrl('data:text/plain;charset=utf-8;base64,Zm9v');
    expect(parsed?.mime).toBe('text/plain');
    expect(parsed?.parameters).toEqual(['charset=utf-8']);
    expect(new TextDecoder().decode(parsed?.bytes)).toBe('foo');
  });

  it('separates "not a data URL" from "a broken data URL"', () => {
    expect(parseDataUrl('Zm9v')).toBeNull();
    expect(looksLikeDataUrl('  data:image/png;base64,AAAA')).toBe(true);
    expect(looksLikeDataUrl('https://example.com/a.png')).toBe(false);
    expect(() => parseDataUrl('data:image/png;base64,not base64!')).toThrow(Base64Error);
  });
});
