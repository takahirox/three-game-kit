/** Deterministic mulberry32 generator so every run with the same seed and inputs replays identically. */
export interface Rng {
  next(): number;
  range(min: number, max: number): number;
  int(maxExclusive: number): number;
  pick<T>(items: readonly T[]): T;
  readonly state: number;
}

export function createRng(seed: number): Rng {
  let state = (seed >>> 0) || 1;
  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    range: (min, max) => min + (max - min) * next(),
    int: (maxExclusive) => Math.min(maxExclusive - 1, Math.floor(next() * maxExclusive)),
    pick: (items) => items[Math.min(items.length - 1, Math.floor(next() * items.length))]!,
    get state() { return state; },
  };
}
