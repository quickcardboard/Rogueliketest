/**
 * Seeded, serializable RNG (mulberry32). The state is a single 32-bit integer
 * stored in the game state, so a saved game replays identically.
 */
export interface RngState {
  s: number;
}

export function makeRng(seed: number): RngState {
  return { s: seed >>> 0 };
}

/** Float in [0, 1). */
export function next(r: RngState): number {
  r.s = (r.s + 0x6d2b79f5) >>> 0;
  let t = r.s;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** Integer in [min, max] inclusive. */
export function int(r: RngState, min: number, max: number): number {
  return min + Math.floor(next(r) * (max - min + 1));
}

export function chance(r: RngState, p: number): boolean {
  return next(r) < p;
}

export function pick<T>(r: RngState, arr: readonly T[]): T {
  if (arr.length === 0) throw new Error('pick from empty array');
  return arr[Math.floor(next(r) * arr.length)]!;
}

/** Rounds x down or up with probability equal to its fractional part. */
export function dither(r: RngState, x: number): number {
  const f = Math.floor(x);
  return f + (next(r) < x - f ? 1 : 0);
}
