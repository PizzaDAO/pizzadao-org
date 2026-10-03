/**
 * Server-side randomness for anything that moves PEP on chance (the casino
 * games). Uses node:crypto, never Math.random, so outcomes can't be
 * predicted from earlier ones.
 *
 * Everything takes an injectable `Rng` so tests can script outcomes.
 */
import { randomInt } from 'node:crypto'

/** Uniform float in [0, 1). */
export type Rng = () => number

// crypto.randomInt allows max - min < 2^48.
const SCALE = 2 ** 47

/** crypto-backed [0, 1) with 47 bits of entropy. */
export const cryptoRng: Rng = () => randomInt(0, SCALE) / SCALE

/** Uniform integer in [min, max] (inclusive) from an Rng. */
export function rngInt(rng: Rng, min: number, max: number): number {
  return min + Math.floor(rng() * (max - min + 1))
}

/** True with probability percent/100. */
export function chance(rng: Rng, percent: number): boolean {
  return rng() * 100 < percent
}

/** Fisher-Yates shuffle (returns a new array). */
export function shuffle<T>(items: readonly T[], rng: Rng): T[] {
  const a = items.slice()
  for (let i = a.length - 1; i > 0; i--) {
    const j = rngInt(rng, 0, i)
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}
