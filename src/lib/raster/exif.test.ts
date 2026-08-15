import { describe, expect, it } from 'vitest';
import {
  TAG,
  exifFieldsToBinaryDict,
  exifFieldsToDict,
  formatExifDate,
  hasEditedFields,
  summarizeExif,
  toDateInputValue,
  utf8Binary,
  type ExifEditFields,
} from './exif';

const empty: ExifEditFields = { artist: '', copyright: '', description: '', date: '' };

describe('formatExifDate', () => {
  it('converts datetime-local values to EXIF format', () => {
    expect(formatExifDate('2026-08-14T09:30')).toBe('2026:08:14 09:30:00');
    expect(formatExifDate('2026-08-14T09:30:45')).toBe('2026:08:14 09:30:45');
    expect(formatExifDate('2026-08-14 09:30')).toBe('2026:08:14 09:30:00');
  });

  it('rejects garbage instead of writing a malformed tag', () => {
    for (const bad of ['', 'yesterday', '2026-08-14', '14/08/2026 09:30']) {
      expect(formatExifDate(bad), `${bad} should be rejected`).toBeNull();
    }
  });
});

describe('toDateInputValue', () => {
  it('parses EXIF datetimes back into input values', () => {
    expect(toDateInputValue('2026:08:14 09:30:45')).toBe('2026-08-14T09:30');
  });

  it('formats Date objects (exifr parses dates eagerly) in local time', () => {
    expect(toDateInputValue(new Date(2026, 7, 14, 9, 5))).toBe('2026-08-14T09:05');
  });

  it('anything else becomes an empty field', () => {
    expect(toDateInputValue(undefined)).toBe('');
    expect(toDateInputValue('soon')).toBe('');
    expect(toDateInputValue(new Date('nope'))).toBe('');
  });
});

describe('exifFieldsToDict', () => {
  it('maps each edited field onto its EXIF tag', () => {
    const dict = exifFieldsToDict({
      artist: 'Kieran',
      copyright: '© 2026',
      description: 'A test',
      date: '2026-08-14T09:30',
    });
    expect(dict['0th'][TAG.Artist]).toBe('Kieran');
    expect(dict['0th'][TAG.Copyright]).toBe('© 2026');
    expect(dict['0th'][TAG.ImageDescription]).toBe('A test');
    expect(dict['0th'][TAG.DateTime]).toBe('2026:08:14 09:30:00');
    expect(dict.Exif[TAG.DateTimeOriginal]).toBe('2026:08:14 09:30:00');
    expect(dict.Exif[TAG.DateTimeDigitized]).toBe('2026:08:14 09:30:00');
  });

  it('omits empty/whitespace fields entirely', () => {
    const dict = exifFieldsToDict({ ...empty, artist: '   ' });
    expect(dict['0th']).toEqual({});
    expect(dict.Exif).toEqual({});
  });

  it('never includes a GPS IFD payload — location cannot pass through', () => {
    const dict = exifFieldsToDict({
      artist: 'a',
      copyright: 'b',
      description: 'c',
      date: '2026-08-14T09:30',
    });
    expect(dict.GPS).toEqual({});
  });

  it('hasEditedFields distinguishes something-to-embed from nothing', () => {
    expect(hasEditedFields(empty)).toBe(false);
    expect(hasEditedFields({ ...empty, date: 'invalid' })).toBe(false);
    expect(hasEditedFields({ ...empty, copyright: '©' })).toBe(true);
  });
});

describe('utf8 packing for piexifjs', () => {
  it('utf8Binary emits one char per UTF-8 byte', () => {
    // piexifjs writes charCode & 0xff per character, so multi-byte characters
    // must arrive pre-exploded into their UTF-8 bytes or readers see U+FFFD.
    expect(utf8Binary('A')).toBe('A');
    expect(utf8Binary('©')).toBe('Â©'); // 0xC2 0xA9
    expect([...utf8Binary('😀')].map((c) => c.charCodeAt(0))).toEqual([0xf0, 0x9f, 0x98, 0x80]);
  });

  it('exifFieldsToBinaryDict packs every field, keeping tags and GPS-empty', () => {
    const dict = exifFieldsToBinaryDict({
      artist: 'Ünïcode',
      copyright: '© 2026',
      description: '',
      date: '2026-08-14T09:30',
    });
    expect(dict['0th']![TAG.Copyright]).toBe('Â© 2026');
    expect(dict['0th']![TAG.Artist]).toBe(utf8Binary('Ünïcode'));
    expect(dict['0th']![TAG.ImageDescription]).toBeUndefined();
    expect(dict.Exif![TAG.DateTimeOriginal]).toBe('2026:08:14 09:30:00');
    expect(dict.GPS).toEqual({});
  });
});

describe('summarizeExif', () => {
  it('flattens scalars, dates and short arrays; skips binary/nested values', () => {
    const rows = summarizeExif({
      Make: 'TestCam',
      ISO: 200,
      Flash: false,
      DateTimeOriginal: new Date(Date.UTC(2026, 0, 2, 3, 4, 5)),
      BitsPerSample: [8, 8, 8],
      thumbnail: new Uint8Array([1, 2, 3]),
      nested: { a: 1 },
      empty: '   ',
      missing: undefined,
    });
    const byTag = Object.fromEntries(rows.map((r) => [r.tag, r.value]));
    expect(byTag.Make).toBe('TestCam');
    expect(byTag.ISO).toBe('200');
    expect(byTag.Flash).toBe('false');
    expect(byTag.DateTimeOriginal).toBe('2026-01-02T03:04:05.000Z');
    expect(byTag.BitsPerSample).toBe('8, 8, 8');
    for (const gone of ['thumbnail', 'nested', 'empty', 'missing']) {
      expect(byTag[gone], `${gone} should be skipped`).toBeUndefined();
    }
  });

  it('sorts rows and truncates very long values', () => {
    const rows = summarizeExif({ b: 'x'.repeat(500), a: 'first' });
    expect(rows[0]!.tag).toBe('a');
    expect(rows[1]!.value.length).toBeLessThanOrEqual(120);
    expect(rows[1]!.value.endsWith('…')).toBe(true);
  });

  it('handles null/undefined parses (non-EXIF sources)', () => {
    expect(summarizeExif(null)).toEqual([]);
    expect(summarizeExif(undefined)).toEqual([]);
  });
});
