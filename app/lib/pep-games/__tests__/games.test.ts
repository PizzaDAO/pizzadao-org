// @vitest-environment node
/**
 * Pure game logic: payouts, the slots paytable's house edge, blackjack hand
 * values and settlement, the crypto RNG. DB behaviour (stakes, double
 * settlement, races) is covered by app/lib/pep-economy.concurrency.test.ts.
 */
import { describe, it, expect, afterEach } from 'vitest'
import { cryptoRng, rngInt, shuffle } from '../../pep-earn/rng'
import { parseRouletteSpace, rouletteColor, rouletteMultiplier, RED_NUMBERS } from '../roulette'
import { SLOT_SYMBOLS, SLOT_WEIGHTS, slotMultiplier, spinReel, type SlotSymbol } from '../slots'
import { dealerPlay, deal, handValue, isBlackjack, newDeck, settleHand, type BjState } from '../blackjack'
import { assertBet, gameConfig } from '../config'

/** Scripted Rng: returns the given values in order. */
const seq = (...vals: number[]) => {
  let i = 0
  return () => vals[i++ % vals.length]
}

describe('rng', () => {
  it('cryptoRng stays in [0, 1) and rngInt covers its range', () => {
    const seen = new Set<number>()
    for (let i = 0; i < 2000; i++) {
      const x = cryptoRng()
      expect(x).toBeGreaterThanOrEqual(0)
      expect(x).toBeLessThan(1)
      seen.add(rngInt(cryptoRng, 1, 6))
    }
    expect([...seen].sort()).toEqual([1, 2, 3, 4, 5, 6])
  })

  it('shuffle is a permutation', () => {
    const a = Array.from({ length: 52 }, (_, i) => i)
    expect(shuffle(a, cryptoRng).sort((x, y) => x - y)).toEqual(a)
  })
})

describe('bets', () => {
  afterEach(() => {
    delete process.env.GAME_MAX_BET
  })
  it('accepts whole bets from 10 to the max (default 5,000)', () => {
    expect(gameConfig()).toMatchObject({ minBet: 10, maxBet: 5000 })
    for (const ok of [10, 5000]) expect(() => assertBet(ok)).not.toThrow()
    for (const bad of [9, 5001, 10.5, -10, NaN, '100']) expect(() => assertBet(bad)).toThrow(/Bet must be/)
    process.env.GAME_MAX_BET = '100'
    expect(() => assertBet(101)).toThrow()
  })
})

describe('roulette', () => {
  it('parses spaces', () => {
    expect(parseRouletteSpace(' Red ')).toEqual({ kind: 'red' })
    expect(parseRouletteSpace('0')).toEqual({ kind: 'number', n: 0 })
    expect(parseRouletteSpace('36')).toEqual({ kind: 'number', n: 36 })
    for (const bad of ['37', '-1', 'green', '', '1.5']) expect(() => parseRouletteSpace(bad)).toThrow()
  })

  it('has 18 red, 18 black and a green zero', () => {
    expect(RED_NUMBERS.size).toBe(18)
    expect(rouletteColor(0)).toBe('green')
    expect(Array.from({ length: 36 }, (_, i) => rouletteColor(i + 1)).filter((c) => c === 'black')).toHaveLength(18)
  })

  it('pays 2x on even-money bets, 36x on a number, and zero loses outside bets', () => {
    expect(rouletteMultiplier({ kind: 'red' }, 1)).toBe(2)
    expect(rouletteMultiplier({ kind: 'black' }, 1)).toBe(0)
    expect(rouletteMultiplier({ kind: 'even' }, 0)).toBe(0)
    expect(rouletteMultiplier({ kind: 'odd' }, 0)).toBe(0)
    expect(rouletteMultiplier({ kind: 'number', n: 0 }, 0)).toBe(36)
    expect(rouletteMultiplier({ kind: 'number', n: 17 }, 18)).toBe(0)
  })

  it('has a 2.70% house edge on every bet type', () => {
    for (const space of [{ kind: 'red' as const }, { kind: 'odd' as const }, { kind: 'number' as const, n: 17 }]) {
      let ret = 0
      for (let n = 0; n <= 36; n++) ret += rouletteMultiplier(space, n)
      expect(ret / 37).toBeCloseTo(36 / 37, 10)
    }
  })
})

describe('slots', () => {
  it('pays per the documented table: RTP 31109/32768 (94.94%), hit rate 29.4%', () => {
    const total = SLOT_SYMBOLS.reduce((s, k) => s + SLOT_WEIGHTS[k], 0)
    expect(total).toBe(32)
    let ev = 0
    let hits = 0
    for (const a of SLOT_SYMBOLS) for (const b of SLOT_SYMBOLS) for (const c of SLOT_SYMBOLS) {
      const p = (SLOT_WEIGHTS[a] * SLOT_WEIGHTS[b] * SLOT_WEIGHTS[c]) / total ** 3
      const m = slotMultiplier([a, b, c])
      ev += p * m
      if (m > 0) hits += p
    }
    expect(ev * 32768).toBeCloseTo(31109, 6)
    expect(1 - ev).toBeGreaterThan(0.05)
    expect(hits).toBeCloseTo(0.2941, 3)
  })

  it('scores combinations', () => {
    const m = (...r: SlotSymbol[]) => slotMultiplier(r)
    expect(m('pizza', 'pizza', 'pizza')).toBe(100)
    expect(m('tomato', 'tomato', 'tomato')).toBe(5)
    expect(m('pizza', 'tomato', 'pizza')).toBe(4)
    expect(m('cheese', 'pizza', 'tomato')).toBe(1)
    expect(m('cheese', 'tomato', 'tomato')).toBe(0)
  })

  it('maps reel stops to symbols by weight', () => {
    expect(spinReel(() => 0)).toBe('pizza')
    expect(spinReel(() => 2 / 32)).toBe('pepper')
    expect(spinReel(() => 31.99 / 32)).toBe('tomato')
  })
})

describe('blackjack engine', () => {
  it('counts aces as 1 or 11', () => {
    expect(handValue(['AS', 'KH'])).toEqual({ total: 21, soft: true })
    expect(handValue(['AS', 'AH', '9C'])).toEqual({ total: 21, soft: true })
    expect(handValue(['AS', 'AH', '9C', 'KD'])).toEqual({ total: 21, soft: false })
    expect(handValue(['KS', 'QH', '2C'])).toEqual({ total: 22, soft: false })
    expect(isBlackjack(['AS', 'TD'])).toBe(true)
    expect(isBlackjack(['AS', '5D', '5C'])).toBe(false)
  })

  it('deals a full shuffled deck: player gets cards 1 and 3, dealer 2 and 4', () => {
    expect(new Set(newDeck(cryptoRng)).size).toBe(52)
    const s = deal(cryptoRng)
    expect(s.deck).toHaveLength(48)
    expect(new Set([...s.deck, ...s.player, ...s.dealer]).size).toBe(52)
  })

  it('dealer draws to 17 and stands on soft 17', () => {
    const soft17: BjState = { deck: ['5C'], player: ['TS', '8S'], dealer: ['AS', '6H'] }
    expect(dealerPlay(soft17).dealer).toEqual(['AS', '6H'])
    const s: BjState = { deck: ['2C', '3D', 'KH', '9S'], player: ['TS', '8S'], dealer: ['TH', '2H'] }
    expect(dealerPlay(s).dealer).toEqual(['TH', '2H', '2C', '3D'])
  })

  it('settles: 3:2 blackjack, 2x win, push returns the stake, losses pay 0', () => {
    const st = (player: string[], dealer: string[]): BjState => ({ deck: [], player, dealer })
    expect(settleHand(st(['AS', 'KH'], ['9D', '9C']), 100)).toEqual({ outcome: 'blackjack', payout: 250 })
    expect(settleHand(st(['AS', 'KH'], ['9D', '9C']), 15)).toEqual({ outcome: 'blackjack', payout: 37 })
    expect(settleHand(st(['AS', 'KH'], ['AD', 'QC']), 100)).toEqual({ outcome: 'push', payout: 100 })
    expect(settleHand(st(['9S', 'KH'], ['AD', 'QC']), 100)).toEqual({ outcome: 'dealer_blackjack', payout: 0 })
    expect(settleHand(st(['9S', 'KH'], ['9D', '8C']), 100)).toEqual({ outcome: 'win', payout: 200 })
    expect(settleHand(st(['9S', 'KH'], ['KD', '6C', '9C']), 100)).toEqual({ outcome: 'dealer_bust', payout: 200 })
    expect(settleHand(st(['9S', 'KH'], ['9D', 'TC']), 100)).toEqual({ outcome: 'push', payout: 100 })
    expect(settleHand(st(['9S', '8H'], ['9D', 'TC']), 100)).toEqual({ outcome: 'lose', payout: 0 })
    expect(settleHand(st(['9S', '8H', 'KC'], ['KD', '6C', '9C']), 100)).toEqual({ outcome: 'bust', payout: 0 })
  })

  it('scripted rng produces a deterministic deal', () => {
    const a = deal(seq(0.1, 0.5, 0.9, 0.3))
    const b = deal(seq(0.1, 0.5, 0.9, 0.3))
    expect(a).toEqual(b)
  })
})
