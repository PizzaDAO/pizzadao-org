/**
 * Roulette: single-zero (European) wheel, 0-36.
 *
 * Bets and total returns (stake included):
 *   red / black / even / odd  -> 2x   (0 loses)
 *   a single number 0-36       -> 36x
 * House edge 1/37 = 2.70% on every bet.
 */
import { ValidationError } from '../errors/api-errors'
import { cryptoRng, rngInt, type Rng } from '../pep-earn/rng'
import { playRound } from './config'

export const RED_NUMBERS: ReadonlySet<number> = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36])

export type RouletteSpace =
  | { kind: 'red' | 'black' | 'even' | 'odd' }
  | { kind: 'number'; n: number }

export function parseRouletteSpace(raw: unknown): RouletteSpace {
  const s = String(raw ?? '').trim().toLowerCase()
  if (s === 'red' || s === 'black' || s === 'even' || s === 'odd') return { kind: s }
  if (/^\d{1,2}$/.test(s)) {
    const n = Number(s)
    if (n >= 0 && n <= 36) return { kind: 'number', n }
  }
  throw new ValidationError('Pick red, black, even, odd, or a number from 0 to 36')
}

export function rouletteColor(n: number): 'green' | 'red' | 'black' {
  if (n === 0) return 'green'
  return RED_NUMBERS.has(n) ? 'red' : 'black'
}

/** Total return multiplier for `space` when the ball lands on `n`. */
export function rouletteMultiplier(space: RouletteSpace, n: number): number {
  switch (space.kind) {
    case 'number':
      return space.n === n ? 36 : 0
    case 'red':
    case 'black':
      return rouletteColor(n) === space.kind ? 2 : 0
    case 'even':
      return n !== 0 && n % 2 === 0 ? 2 : 0
    case 'odd':
      return n % 2 === 1 ? 2 : 0
  }
}

export function spaceLabel(space: RouletteSpace): string {
  return space.kind === 'number' ? String(space.n) : space.kind
}

export async function playRoulette(
  discordId: string,
  bet: number,
  space: RouletteSpace,
  opts: { rng?: Rng; now?: Date } = {},
) {
  const rng = opts.rng ?? cryptoRng
  return playRound(
    discordId,
    'roulette',
    bet,
    () => {
      const landed = rngInt(rng, 0, 36)
      const multiplier = rouletteMultiplier(space, landed)
      return { space: spaceLabel(space), landed, color: rouletteColor(landed), multiplier, payout: bet * multiplier }
    },
    opts,
  )
}
