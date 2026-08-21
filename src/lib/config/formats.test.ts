import { describe, expect, it } from 'vitest';
import { detectFormat, FORMAT_KINDS, matchesFormat, type StringFormat } from './formats';

describe('matchesFormat: email', () => {
  it('accepts ordinary addresses', () => {
    expect(matchesFormat('a@b.com', 'email')).toBe(true);
    expect(matchesFormat('first.last+tag@sub.domain.co', 'email')).toBe(true);
    expect(matchesFormat('user_name%x@host-name.org', 'email')).toBe(true);
  });

  it('rejects addresses with spaces or extra @s', () => {
    expect(matchesFormat('not@ an@ email', 'email')).toBe(false);
    expect(matchesFormat('a b@c.com', 'email')).toBe(false);
    expect(matchesFormat('a@b.com ', 'email')).toBe(false);
    expect(matchesFormat('a@@b.com', 'email')).toBe(false);
  });

  it('requires a dot in the domain and something on both sides of the @', () => {
    expect(matchesFormat('a@b', 'email')).toBe(false);
    expect(matchesFormat('@b.com', 'email')).toBe(false);
    expect(matchesFormat('a@.com', 'email')).toBe(false);
    expect(matchesFormat('a@b.', 'email')).toBe(false);
  });
});

describe('matchesFormat: uri', () => {
  it('accepts scheme://rest for any known-shape scheme', () => {
    expect(matchesFormat('https://example.com/x?y=1#z', 'uri')).toBe(true);
    expect(matchesFormat('ftp://host', 'uri')).toBe(true);
    expect(matchesFormat('custom+scheme.v2://thing', 'uri')).toBe(true);
    expect(matchesFormat('HTTPS://CAPS.EXAMPLE', 'uri')).toBe(true);
  });

  it('accepts mailto: without requiring ://', () => {
    expect(matchesFormat('mailto:a@b.com', 'uri')).toBe(true);
    expect(matchesFormat('MAILTO:a@b.com', 'uri')).toBe(true);
  });

  it('rejects prose with a colon — foo:bar is not a URI here', () => {
    expect(matchesFormat('foo:bar', 'uri')).toBe(false);
    expect(matchesFormat('note: remember the thing', 'uri')).toBe(false);
    expect(matchesFormat('12:30', 'uri')).toBe(false);
  });

  it('rejects missing schemes, bad schemes, and spaces', () => {
    expect(matchesFormat('example.com', 'uri')).toBe(false);
    expect(matchesFormat('://nothing', 'uri')).toBe(false);
    expect(matchesFormat('9scheme://x', 'uri')).toBe(false);
    expect(matchesFormat('http://has space', 'uri')).toBe(false);
    expect(matchesFormat('http://', 'uri')).toBe(false);
    expect(matchesFormat('mailto:', 'uri')).toBe(false);
  });
});

describe('matchesFormat: phone', () => {
  it('accepts common phone shapes', () => {
    expect(matchesFormat('+1 (555) 123-4567', 'phone')).toBe(true);
    expect(matchesFormat('555-1234', 'phone')).toBe(true);
    expect(matchesFormat('5551234567', 'phone')).toBe(true);
    expect(matchesFormat('555.123.4567', 'phone')).toBe(true);
  });

  it('requires at least 7 digits, whatever the punctuation', () => {
    expect(matchesFormat('123456', 'phone')).toBe(false);
    expect(matchesFormat('+123', 'phone')).toBe(false);
    expect(matchesFormat('(((((((', 'phone')).toBe(false);
    expect(matchesFormat('--- ---', 'phone')).toBe(false);
  });

  it('rejects letters, colons, and over-long strings', () => {
    expect(matchesFormat('12:30', 'phone')).toBe(false);
    expect(matchesFormat('call 5551234', 'phone')).toBe(false);
    expect(matchesFormat('1'.repeat(21), 'phone')).toBe(false);
    expect(matchesFormat('1'.repeat(20), 'phone')).toBe(true);
  });
});

describe('matchesFormat: date', () => {
  it('accepts YYYY-MM-DD with sane month and day', () => {
    expect(matchesFormat('2024-01-31', 'date')).toBe(true);
    expect(matchesFormat('1999-12-01', 'date')).toBe(true);
  });

  it('rejects out-of-range months and days', () => {
    expect(matchesFormat('2024-13-40', 'date')).toBe(false);
    expect(matchesFormat('2024-00-10', 'date')).toBe(false);
    expect(matchesFormat('2024-01-00', 'date')).toBe(false);
    expect(matchesFormat('2024-01-32', 'date')).toBe(false);
  });

  it('rejects unpadded and truncated forms', () => {
    expect(matchesFormat('2024-1-2', 'date')).toBe(false);
    expect(matchesFormat('24-01-01', 'date')).toBe(false);
    expect(matchesFormat('2024-01', 'date')).toBe(false);
    expect(matchesFormat('2024-01-02T00:00', 'date')).toBe(false);
  });
});

describe('matchesFormat: date-time', () => {
  it('accepts ISO date-times with and without seconds, fraction, and offset', () => {
    expect(matchesFormat('2024-01-02T03:04', 'date-time')).toBe(true);
    expect(matchesFormat('2024-01-02T03:04:05', 'date-time')).toBe(true);
    expect(matchesFormat('2024-01-02T03:04:05.123Z', 'date-time')).toBe(true);
    expect(matchesFormat('2024-01-02T03:04:05+05:30', 'date-time')).toBe(true);
    expect(matchesFormat('2024-01-02T03:04:05-08:00', 'date-time')).toBe(true);
  });

  it('rejects a space where the T should be', () => {
    expect(matchesFormat('2024-01-02 03:04', 'date-time')).toBe(false);
  });

  it('rejects out-of-range time and date parts', () => {
    expect(matchesFormat('2024-01-02T25:00', 'date-time')).toBe(false);
    expect(matchesFormat('2024-01-02T03:60', 'date-time')).toBe(false);
    expect(matchesFormat('2024-01-02T03:04:61', 'date-time')).toBe(false);
    expect(matchesFormat('2024-13-01T00:00', 'date-time')).toBe(false);
  });

  it('rejects a bare time or a bare date', () => {
    expect(matchesFormat('12:30', 'date-time')).toBe(false);
    expect(matchesFormat('2024-01-02', 'date-time')).toBe(false);
  });
});

describe('detectFormat', () => {
  it('lists all five formats, phone last', () => {
    expect([...FORMAT_KINDS].sort()).toEqual(['date', 'date-time', 'email', 'phone', 'uri']);
    expect(FORMAT_KINDS[FORMAT_KINDS.length - 1]).toBe('phone');
  });

  it('returns the most specific match for each format', () => {
    const cases: Array<[string, StringFormat]> = [
      ['a@b.com', 'email'],
      ['https://example.com', 'uri'],
      ['mailto:a@b.com', 'uri'],
      ['2024-01-02T03:04:05Z', 'date-time'],
      ['2024-01-02', 'date'],
      ['+1 555 123 4567', 'phone'],
    ];
    for (const [value, format] of cases) {
      expect(detectFormat(value), value).toBe(format);
    }
  });

  it('does not let phone swallow a date, even though the characters fit', () => {
    // '2024-01-02' is 8 digits and dashes — a valid phone shape.
    expect(matchesFormat('2024-01-02', 'phone')).toBe(true);
    expect(detectFormat('2024-01-02')).toBe('date');
  });

  it('does not let uri swallow a bare email', () => {
    expect(detectFormat('a@b.com')).toBe('email');
  });

  it('returns null for prose, YAML booleans, and bare times', () => {
    expect(detectFormat('NO')).toBeNull();
    expect(detectFormat('12:30')).toBeNull();
    expect(detectFormat('hello world')).toBeNull();
    expect(detectFormat('')).toBeNull();
    expect(detectFormat('not@ an@ email')).toBeNull();
  });

  it('lets an invalid date fall through to phone — the shape really does fit', () => {
    // 8 digits and dashes is a legitimate phone shape; only the date reading
    // is rejected. Callers that want strict dates ask matchesFormat directly.
    expect(matchesFormat('2024-13-40', 'date')).toBe(false);
    expect(detectFormat('2024-13-40')).toBe('phone');
  });
});
