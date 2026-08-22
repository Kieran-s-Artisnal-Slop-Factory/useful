/**
 * SHA-256 and SHA-224 (FIPS 180-4), hand-rolled.
 *
 * SHA-256 is in WebCrypto and this app uses WebCrypto for it — but **SHA-224
 * is not**, in any browser, and it is the same compression function with
 * different initial values and a truncated output. Writing the core here is
 * what makes SHA-224 possible at all; it also gives the app a digest that
 * works outside a secure context, where `crypto.subtle` is simply absent.
 *
 * The SHA-256 export exists so the two can be checked against each other and
 * against the published vectors: if this core drifts, `sha2.test.ts` fails
 * against WebCrypto's answer, not just against itself.
 *
 * Pure module: no DOM, no state, no I/O.
 */

/** Round constants: the first 32 bits of the cube roots of the first 64 primes. */
const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

/** SHA-256: the first 32 bits of the square roots of the first 8 primes. */
const IV_256 = new Uint32Array([
  0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
]);

/** SHA-224: the second 32 bits of the square roots of the 9th to 16th primes. */
const IV_224 = new Uint32Array([
  0xc1059ed8, 0x367cd507, 0x3070dd17, 0xf70e5939, 0xffc00b31, 0x68581511, 0x64f98fa7, 0xbefa4fa4,
]);

const rotr = (value: number, by: number): number => ((value >>> by) | (value << (32 - by))) >>> 0;

function compress(input: Uint8Array, iv: Uint32Array, outputWords: number): Uint8Array {
  const blocks = Math.ceil((input.length + 9) / 64);
  const padded = new Uint8Array(blocks * 64);
  padded.set(input);
  padded[input.length] = 0x80;
  const view = new DataView(padded.buffer);
  const bits = input.length * 8;
  // Big-endian 64-bit length. JavaScript numbers hold the low 32 bits exactly
  // and the high word is the count of whole 2^32 blocks.
  view.setUint32(padded.length - 8, Math.floor(bits / 4294967296), false);
  view.setUint32(padded.length - 4, bits >>> 0, false);

  const h = Uint32Array.from(iv);
  const w = new Uint32Array(64);

  for (let block = 0; block < blocks; block += 1) {
    const offset = block * 64;
    for (let i = 0; i < 16; i += 1) w[i] = view.getUint32(offset + i * 4, false);
    for (let i = 16; i < 64; i += 1) {
      const a = w[i - 15]!;
      const b = w[i - 2]!;
      const s0 = (rotr(a, 7) ^ rotr(a, 18) ^ (a >>> 3)) >>> 0;
      const s1 = (rotr(b, 17) ^ rotr(b, 19) ^ (b >>> 10)) >>> 0;
      w[i] = (w[i - 16]! + s0 + w[i - 7]! + s1) >>> 0;
    }

    let [a, b, c, d, e, f, g, hh] = h as unknown as number[];
    for (let i = 0; i < 64; i += 1) {
      const s1 = (rotr(e!, 6) ^ rotr(e!, 11) ^ rotr(e!, 25)) >>> 0;
      const ch = ((e! & f!) ^ (~e! & g!)) >>> 0;
      const temp1 = (hh! + s1 + ch + K[i]! + w[i]!) >>> 0;
      const s0 = (rotr(a!, 2) ^ rotr(a!, 13) ^ rotr(a!, 22)) >>> 0;
      const maj = ((a! & b!) ^ (a! & c!) ^ (b! & c!)) >>> 0;
      const temp2 = (s0 + maj) >>> 0;
      hh = g;
      g = f;
      f = e;
      e = (d! + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }

    h[0] = (h[0]! + a!) >>> 0;
    h[1] = (h[1]! + b!) >>> 0;
    h[2] = (h[2]! + c!) >>> 0;
    h[3] = (h[3]! + d!) >>> 0;
    h[4] = (h[4]! + e!) >>> 0;
    h[5] = (h[5]! + f!) >>> 0;
    h[6] = (h[6]! + g!) >>> 0;
    h[7] = (h[7]! + hh!) >>> 0;
  }

  const out = new Uint8Array(outputWords * 4);
  const outView = new DataView(out.buffer);
  for (let i = 0; i < outputWords; i += 1) outView.setUint32(i * 4, h[i]!, false);
  return out;
}

/** 256-bit digest. WebCrypto has this too; keep them agreeing. */
export function sha256(input: Uint8Array): Uint8Array {
  return compress(input, IV_256, 8);
}

/** 224-bit digest — the SHA-256 core, other initial values, truncated. */
export function sha224(input: Uint8Array): Uint8Array {
  return compress(input, IV_224, 7);
}
