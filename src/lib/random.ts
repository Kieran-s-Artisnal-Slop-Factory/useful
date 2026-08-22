/**
 * The app's one seeded PRNG.
 *
 * Written for the config playground's example-data generator and lifted here
 * on its second use (the placeholder generators), because two copies of a
 * PRNG is two answers to "what does seed 42 produce" — and the whole point of
 * a seed is that there is only one.
 *
 * `Math.random` is deliberately not an option anywhere that offers a seed:
 * determinism is what makes a re-generate a no-op diff, and what lets a unit
 * test assert on the output at all.
 */

/**
 * The standard mulberry32 PRNG: 32-bit state, returns floats in [0, 1).
 * Small, fast, and — unlike `Math.random` — seedable.
 */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A 32-bit seed from arbitrary text (FNV-1a).
 *
 * So a seed can be a word rather than a number: someone typing "hello" wants
 * the same picture every time, and typing a 32-bit integer is not a thing
 * people do. A number typed as text is used as itself, because that IS what
 * someone typing `42` means.
 */
export function seedFrom(text: string): number {
  const trimmed = text.trim();
  if (/^-?\d+$/.test(trimmed)) return Math.abs(Number(trimmed)) >>> 0;
  let hash = 0x811c9dc5;
  for (let i = 0; i < trimmed.length; i++) {
    hash ^= trimmed.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** An integer in [min, max], inclusive both ends. */
export function randomInt(rng: () => number, min: number, max: number): number {
  return min + Math.floor(rng() * (max - min + 1));
}

/** One item, or undefined for an empty list. */
export function pick<T>(rng: () => number, items: readonly T[]): T | undefined {
  return items.length === 0 ? undefined : items[Math.floor(rng() * items.length)];
}

/** A shuffled copy (Fisher-Yates), leaving the input alone. */
export function shuffled<T>(rng: () => number, items: readonly T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}
