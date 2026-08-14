/** Minimal typings for utif2 (no upstream types). Only what convert.ts uses. */
declare module 'utif2' {
  export interface UtifPage {
    width: number;
    height: number;
    [tag: string]: unknown;
  }
  const UTIF: {
    decode(buffer: ArrayBuffer | Uint8Array): UtifPage[];
    decodeImage(buffer: ArrayBuffer | Uint8Array, page: UtifPage): void;
    toRGBA8(page: UtifPage): Uint8Array;
    encodeImage(rgba: Uint8Array | ArrayBuffer, width: number, height: number): ArrayBuffer;
  };
  export default UTIF;
}
