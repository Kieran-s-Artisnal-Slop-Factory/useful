/**
 * SHA-3 and SHAKE (FIPS 202), hand-rolled — WebCrypto has neither, in any
 * browser.
 *
 * SHA-3 is not "SHA-2 but newer": it is a different construction (a sponge
 * over the Keccak permutation) chosen so that a break of SHA-2 would not
 * carry over. Nothing here needs it in preference to SHA-256; it is offered
 * because it is standard, because it is asked for, and because SHAKE — an
 * extendable-output function that gives you as many bytes as you ask for —
 * falls out of the same core for free.
 *
 * The state is twenty-five 64-bit lanes, held as `bigint` rather than as
 * pairs of 32-bit words. That is the slower of the two ways and by far the
 * more readable one, and it is the right trade here: this app hashes typed
 * text, not files. `sha3.test.ts` measures it so the claim stays honest.
 *
 * Pure module: no DOM, no state, no I/O.
 */

const MASK = (1n << 64n) - 1n;

/** Iota's round constants, one per round. */
const RC: bigint[] = [
  0x0000000000000001n, 0x0000000000008082n, 0x800000000000808an, 0x8000000080008000n,
  0x000000000000808bn, 0x0000000080000001n, 0x8000000080008081n, 0x8000000000008009n,
  0x000000000000008an, 0x0000000000000088n, 0x0000000080008009n, 0x000000008000000an,
  0x000000008000808bn, 0x800000000000008bn, 0x8000000000008089n, 0x8000000000008003n,
  0x8000000000008002n, 0x8000000000000080n, 0x000000000000800an, 0x800000008000000an,
  0x8000000080008081n, 0x8000000000008080n, 0x0000000080000001n, 0x8000000080008008n,
];

/** Rho's rotation offsets, indexed as x + 5y. */
const ROTATION = [
  0, 1, 62, 28, 27,
  36, 44, 6, 55, 20,
  3, 10, 43, 25, 39,
  41, 45, 15, 21, 8,
  18, 2, 61, 56, 14,
];

const rotl = (lane: bigint, by: number): bigint =>
  by === 0 ? lane : ((lane << BigInt(by)) | (lane >> BigInt(64 - by))) & MASK;

/** Keccak-f[1600]: 24 rounds of theta, rho, pi, chi, iota. */
function permute(state: bigint[]): void {
  for (let round = 0; round < 24; round += 1) {
    // Theta — parity of each column, folded back into every lane.
    const c: bigint[] = new Array(5);
    for (let x = 0; x < 5; x += 1) {
      c[x] = state[x]! ^ state[x + 5]! ^ state[x + 10]! ^ state[x + 15]! ^ state[x + 20]!;
    }
    for (let x = 0; x < 5; x += 1) {
      const d = c[(x + 4) % 5]! ^ rotl(c[(x + 1) % 5]!, 1);
      for (let y = 0; y < 5; y += 1) state[x + 5 * y] = state[x + 5 * y]! ^ d;
    }

    // Rho and pi — rotate each lane, then move it.
    const moved: bigint[] = new Array(25).fill(0n);
    for (let x = 0; x < 5; x += 1) {
      for (let y = 0; y < 5; y += 1) {
        moved[y + 5 * ((2 * x + 3 * y) % 5)] = rotl(state[x + 5 * y]!, ROTATION[x + 5 * y]!);
      }
    }

    // Chi — the only non-linear step.
    for (let y = 0; y < 5; y += 1) {
      for (let x = 0; x < 5; x += 1) {
        state[x + 5 * y] =
          moved[x + 5 * y]! ^ (~moved[((x + 1) % 5) + 5 * y]! & MASK & moved[((x + 2) % 5) + 5 * y]!);
      }
    }

    // Iota — break the symmetry the other four steps preserve.
    state[0] = state[0]! ^ RC[round]!;
  }
}

/**
 * The sponge: absorb `rate` bytes at a time, permute, then squeeze.
 *
 * `suffix` is the domain separator — `0x06` for SHA-3, `0x1f` for SHAKE — and
 * it is the only difference between the two functions. Getting it wrong
 * produces plausible-looking digests that match nothing on earth.
 */
function keccak(input: Uint8Array, rate: number, suffix: number, outputBytes: number): Uint8Array {
  const state: bigint[] = new Array(25).fill(0n);
  const block = new Uint8Array(rate);
  let offset = 0;

  const absorb = (bytes: Uint8Array): void => {
    for (let i = 0; i < rate; i += 8) {
      let lane = 0n;
      for (let b = 7; b >= 0; b -= 1) lane = (lane << 8n) | BigInt(bytes[i + b]!);
      state[i / 8] = state[i / 8]! ^ lane;
    }
    permute(state);
  };

  while (offset + rate <= input.length) {
    absorb(input.subarray(offset, offset + rate));
    offset += rate;
  }

  // pad10*1, with the domain suffix folded into the first padding byte.
  block.fill(0);
  block.set(input.subarray(offset));
  block[input.length - offset] = suffix;
  block[rate - 1] = (block[rate - 1] ?? 0) | 0x80;
  absorb(block);

  const out = new Uint8Array(outputBytes);
  let written = 0;
  while (written < outputBytes) {
    for (let i = 0; i < rate && written < outputBytes; i += 8) {
      let lane = state[i / 8]!;
      for (let b = 0; b < 8 && written < outputBytes; b += 1) {
        out[written] = Number(lane & 0xffn);
        lane >>= 8n;
        written += 1;
      }
    }
    if (written < outputBytes) permute(state);
  }
  return out;
}

const rateFor = (bits: number): number => (1600 - 2 * bits) / 8;

export const sha3_224 = (input: Uint8Array): Uint8Array => keccak(input, rateFor(224), 0x06, 28);
export const sha3_256 = (input: Uint8Array): Uint8Array => keccak(input, rateFor(256), 0x06, 32);
export const sha3_384 = (input: Uint8Array): Uint8Array => keccak(input, rateFor(384), 0x06, 48);
export const sha3_512 = (input: Uint8Array): Uint8Array => keccak(input, rateFor(512), 0x06, 64);

/** SHAKE128 — as many bytes as you ask for, at 128-bit security. */
export const shake128 = (input: Uint8Array, outputBytes = 32): Uint8Array =>
  keccak(input, rateFor(128), 0x1f, outputBytes);

/** SHAKE256 — the same at 256-bit security. */
export const shake256 = (input: Uint8Array, outputBytes = 64): Uint8Array =>
  keccak(input, rateFor(256), 0x1f, outputBytes);
