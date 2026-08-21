import { describe, expect, it } from 'vitest';
import { crc32, zipBytes, zipEntries } from './zip';

const utf8 = (s: string) => new TextEncoder().encode(s);

describe('crc32', () => {
  it('matches the IEEE check value', () => {
    // The canonical test vector.
    expect(crc32(utf8('123456789'))).toBe(0xcbf43926);
    expect(crc32(new Uint8Array(0))).toBe(0);
  });
});

describe('zipBytes / zipEntries', () => {
  it('round-trips names and bytes, in order', () => {
    const archive = zipBytes([
      { name: 'a.md', data: '# A\n' },
      { name: 'nested/b.html', data: utf8('<p>b</p>') },
      { name: 'empty.txt', data: '' },
    ]);
    const back = zipEntries(archive);
    expect(back.map((e) => e.name)).toEqual(['a.md', 'nested/b.html', 'empty.txt']);
    expect(new TextDecoder().decode(back[0]!.data)).toBe('# A\n');
    expect(new TextDecoder().decode(back[1]!.data)).toBe('<p>b</p>');
    expect(back[2]!.data.length).toBe(0);
  });

  it('writes the signatures a reader looks for', () => {
    const archive = zipBytes([{ name: 'x', data: 'y' }]);
    const view = new DataView(archive.buffer);
    expect(view.getUint32(0, true)).toBe(0x04034b50);
    expect(view.getUint32(archive.length - 22, true)).toBe(0x06054b50);
    // Stored, with the UTF-8 name flag.
    expect(view.getUint16(8, true)).toBe(0);
    expect(view.getUint16(6, true) & 0x0800).toBe(0x0800);
  });

  it('keeps non-ASCII names', () => {
    const back = zipEntries(zipBytes([{ name: 'Ünïcödé — notes.md', data: 'x' }]));
    expect(back[0]!.name).toBe('Ünïcödé — notes.md');
  });

  it('normalises backslashes to forward slashes', () => {
    const back = zipEntries(zipBytes([{ name: 'dir\\file.md', data: 'x' }]));
    expect(back[0]!.name).toBe('dir/file.md');
  });

  it('refuses a corrupted payload', () => {
    const archive = zipBytes([{ name: 'a.md', data: 'hello' }]);
    // Flip a byte inside the stored data (after the 30-byte header + 4-byte name).
    archive[34] ^= 0xff;
    expect(() => zipEntries(archive)).toThrow(/checksum/);
  });

  it('refuses something that is not an archive', () => {
    expect(() => zipEntries(utf8('not a zip at all, really not'))).toThrow(/not a zip/);
  });
});
