/** Minimal typings for piexifjs (no upstream types), mirroring utif2.d.ts. */
declare module 'piexifjs' {
  interface Piexif {
    /** Serialize an IFD dict ({'0th': {...}, 'Exif': {...}, 'GPS': {...}}) to EXIF bytes. */
    dump(dict: Record<string, Record<number, unknown>>): string;
    /** Insert EXIF bytes into a JPEG data URL (or binary string); returns the same form. */
    insert(exifBytes: string, jpeg: string): string;
    /** Strip all EXIF from a JPEG data URL (or binary string). */
    remove(jpeg: string): string;
    load(jpeg: string): Record<string, Record<number, unknown>>;
    ImageIFD: Record<string, number>;
    ExifIFD: Record<string, number>;
    GPSIFD: Record<string, number>;
  }
  const piexif: Piexif;
  export default piexif;
}
