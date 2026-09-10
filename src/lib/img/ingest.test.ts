import { describe, expect, it } from 'vitest';
import { MAX_INGEST_BYTES, pastedName, pickImage, refusalFor, type FileLike } from './ingest';

const file = (name: string, type = '', size = 1024): FileLike => ({ name, type, size });

describe('pickImage', () => {
  it('takes the first entry this app can actually decode', () => {
    const chosen = pickImage([file('notes.txt', 'text/plain'), file('shot.png', 'image/png')]);
    expect(chosen?.name).toBe('shot.png');
  });

  it('accepts every family convert.ts decodes', () => {
    for (const name of ['a.png', 'b.jpg', 'c.jpeg', 'd.webp', 'e.avif', 'f.tif', 'g.tiff', 'h.svg']) {
      expect(pickImage([file(name)])?.name, name).toBe(name);
    }
  });

  it('falls back to the mime type when the name carries no extension', () => {
    expect(pickImage([file('clipboard', 'image/png')])?.name).toBe('clipboard');
    expect(pickImage([file('clipboard', 'image/svg+xml')])?.name).toBe('clipboard');
  });

  it('is null when nothing in the list is an image', () => {
    expect(pickImage([file('a.txt', 'text/plain'), file('b.pdf', 'application/pdf')])).toBeNull();
    expect(pickImage([])).toBeNull();
  });

  it('does not pick a GIF, which convert.ts does not decode', () => {
    expect(pickImage([file('anim.gif', 'image/gif')])).toBeNull();
  });

  it('takes the FIRST image, not the largest — a multi-file drop means "use this one"', () => {
    const chosen = pickImage([file('first.png', 'image/png', 10), file('second.png', 'image/png', 9_000)]);
    expect(chosen?.name).toBe('first.png');
  });
});

describe('refusalFor', () => {
  it('passes a normal image', () => {
    expect(refusalFor(file('shot.png', 'image/png', 2048))).toBeNull();
  });

  it('names nothing-to-read when there is no file at all', () => {
    const refusal = refusalFor(null);
    expect(refusal?.reason).toBe('nothing-to-read');
    expect(refusal?.message).toMatch(/paste/i);
  });

  it('names not-an-image and quotes the filename back', () => {
    const refusal = refusalFor(file('report.pdf', 'application/pdf'));
    expect(refusal?.reason).toBe('not-an-image');
    expect(refusal?.message).toContain('report.pdf');
  });

  it('survives an unnamed unsupported file without an empty quote', () => {
    const refusal = refusalFor(file('', 'application/pdf'));
    expect(refusal?.reason).toBe('not-an-image');
    expect(refusal?.message).toContain('That file');
  });

  it('names too-large only ABOVE the cap, and states both sizes', () => {
    expect(refusalFor(file('big.png', 'image/png', MAX_INGEST_BYTES))).toBeNull();
    const refusal = refusalFor(file('big.png', 'image/png', MAX_INGEST_BYTES + 1));
    expect(refusal?.reason).toBe('too-large');
    expect(refusal?.message).toContain('50 MB');
  });

  it('honours a caller-supplied cap', () => {
    expect(refusalFor(file('a.png', 'image/png', 2_000_000), 1_000_000)?.reason).toBe('too-large');
    expect(refusalFor(file('a.png', 'image/png', 500_000), 1_000_000)).toBeNull();
  });

  it('rejects the wrong TYPE before it complains about the size', () => {
    const refusal = refusalFor(file('huge.pdf', 'application/pdf', MAX_INGEST_BYTES * 4));
    expect(refusal?.reason).toBe('not-an-image');
  });
});

describe('pastedName', () => {
  it('derives an extension from the mime subtype', () => {
    expect(pastedName('image/png')).toBe('pasted.png');
    expect(pastedName('image/jpeg')).toBe('pasted.jpeg');
    expect(pastedName('image/webp')).toBe('pasted.webp');
  });

  it('takes the part before the + on a structured subtype', () => {
    expect(pastedName('image/svg+xml')).toBe('pasted.svg');
  });

  it('falls back to png when the clipboard claims no type', () => {
    expect(pastedName('')).toBe('pasted.png');
    expect(pastedName('image/')).toBe('pasted.png');
  });
});
