/**
 * Slots: three independent reels, 32 weighted stops each.
 *
 *   symbol     stops   three of a kind pays
 *   🍕 pizza     2         100x
 *   🌶️ pepper    3          50x
 *   🍄 mushroom  5          20x
 *   🧀 cheese    7           8x
 *   🍅 tomato   15           5x
 *   any two 🍕 (not three)    4x
 *   exactly one 🍕            1x (stake back)
 *
 * Multipliers are total returns (stake included). Exact return to player is
 * 31109/32768 = 94.94%, i.e. a 5.06% house edge; 29.4% of spins return
 * something. slots.test.ts recomputes these numbers from the tables below.
 */
import { cryptoRng, type Rng } from '../pep-earn/rng'
import { playRound } from './config'

export const SLOT_SYMBOLS = ['pizza', 'pepper', 'mushroom', 'cheese', 'tomato'] as const
export type SlotSymbol = (typeof SLOT_SYMBOLS)[number]

export const SLOT_WEIGHTS: Readonly<Record<SlotSymbol, number>> = { pizza: 2, pepper: 3, mushroom: 5, cheese: 7, tomato: 15 }
export const SLOT_THREE_OF_A_KIND: Readonly<Record<SlotSymbol, number>> = { pizza: 100, pepper: 50, mushroom: 20, cheese: 8, tomato: 5 }
export const SLOT_TWO_PIZZAS = 4
export const SLOT_ONE_PIZZA = 1

export const SLOT_EMOJI: Readonly<Record<SlotSymbol, string>> = {
  pizza: '🍕',
  pepper: '🌶️',
  mushroom: '🍄',
  cheese: '🧀',
  tomato: '🍅',
}

const TOTAL_WEIGHT = SLOT_SYMBOLS.reduce((s, k) => s + SLOT_WEIGHTS[k], 0)

export function spinReel(rng: Rng): SlotSymbol {
  let r = Math.floor(rng() * TOTAL_WEIGHT)
  for (const sym of SLOT_SYMBOLS) {
    if (r < SLOT_WEIGHTS[sym]) return sym
    r -= SLOT_WEIGHTS[sym]
  }
  return SLOT_SYMBOLS[SLOT_SYMBOLS.length - 1]
}

export function slotMultiplier(reels: readonly SlotSymbol[]): number {
  if (reels[0] === reels[1] && reels[1] === reels[2]) return SLOT_THREE_OF_A_KIND[reels[0]]
  const pizzas = reels.filter((r) => r === 'pizza').length
  if (pizzas === 2) return SLOT_TWO_PIZZAS
  if (pizzas === 1) return SLOT_ONE_PIZZA
  return 0
}

export async function playSlots(discordId: string, bet: number, opts: { rng?: Rng; now?: Date } = {}) {
  const rng = opts.rng ?? cryptoRng
  return playRound(
    discordId,
    'slots',
    bet,
    () => {
      const reels = [spinReel(rng), spinReel(rng), spinReel(rng)]
      const multiplier = slotMultiplier(reels)
      return { reels, multiplier, payout: bet * multiplier }
    },
    opts,
  )
}
