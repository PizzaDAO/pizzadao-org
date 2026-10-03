/**
 * Blackjack with state across button presses (Discord components) or web
 * requests, stored in BlackjackGame.
 *
 * Rules: one 52-card deck shuffled per hand with node:crypto; dealer stands on
 * all 17s (S17); blackjack pays 3:2 (rounded down); push returns the stake; no
 * double/split/insurance. Total returns: win 2x, blackjack 2.5x, push 1x.
 * House edge with basic strategy is roughly 0.5-1% (no doubling/splitting
 * raises it a little over a full-rules game).
 *
 * Safety:
 *  - The stake is debited (GAME_BET) in the same transaction that creates the
 *    hand; one live hand per member (unique BlackjackGame.activeKey).
 *  - Every move is a conditional update on (id, status=ACTIVE, version), so a
 *    double-clicked button or two tabs can't apply a move twice.
 *  - Settlement flips ACTIVE -> SETTLED with the same conditional update and
 *    pays (GAME_WIN) in the same transaction: a hand pays out at most once.
 *  - A hand untouched for BLACKJACK_TIMEOUT_SECONDS auto-stands: on the next
 *    button press, the member's next /blackjack, or the opportunistic sweep
 *    (sweepExpiredBlackjack) run by every blackjack request.
 */
import type { Prisma } from '@prisma/client'
import { prisma } from '../db'
import { creditInTx, debitInTx, getOrCreateEconomy } from '../economy'
import { claimCooldown } from '../pep-earn/cooldown'
import { cryptoRng, shuffle, type Rng } from '../pep-earn/rng'
import { assertBet, gameConfig } from './config'

// ---------------------------------------------------------------- engine ---

const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K'] as const
const SUITS = ['S', 'H', 'D', 'C'] as const
/** Card code: rank + suit, e.g. "AS", "TD". */
export type Card = string

export function newDeck(rng: Rng): Card[] {
  const deck: Card[] = []
  for (const s of SUITS) for (const r of RANKS) deck.push(r + s)
  return shuffle(deck, rng)
}

function rankValue(card: Card): number {
  const r = card[0]
  if (r === 'A') return 11
  if (r === 'T' || r === 'J' || r === 'Q' || r === 'K') return 10
  return Number(r)
}

export function handValue(cards: readonly Card[]): { total: number; soft: boolean } {
  let total = 0
  let aces = 0
  for (const c of cards) {
    total += rankValue(c)
    if (c[0] === 'A') aces++
  }
  while (total > 21 && aces > 0) {
    total -= 10
    aces--
  }
  return { total, soft: aces > 0 }
}

export const isBlackjack = (cards: readonly Card[]) => cards.length === 2 && handValue(cards).total === 21

export interface BjState {
  deck: Card[]
  player: Card[]
  dealer: Card[]
}

export type BjOutcome = 'blackjack' | 'win' | 'dealer_bust' | 'push' | 'lose' | 'bust' | 'dealer_blackjack'

/** Draw for the dealer until 17 or more (stands on soft 17). */
export function dealerPlay(state: BjState): BjState {
  const deck = state.deck.slice()
  const dealer = state.dealer.slice()
  while (handValue(dealer).total < 17) dealer.push(deck.shift()!)
  return { ...state, deck, dealer }
}

/** Outcome and total return once the player is done (stood, bust or natural). */
export function settleHand(state: BjState, bet: number): { outcome: BjOutcome; payout: number } {
  const p = handValue(state.player).total
  const d = handValue(state.dealer).total
  const pBJ = isBlackjack(state.player)
  const dBJ = isBlackjack(state.dealer)
  if (pBJ && dBJ) return { outcome: 'push', payout: bet }
  if (pBJ) return { outcome: 'blackjack', payout: bet + Math.floor((bet * 3) / 2) }
  if (dBJ) return { outcome: 'dealer_blackjack', payout: 0 }
  if (p > 21) return { outcome: 'bust', payout: 0 }
  if (d > 21) return { outcome: 'dealer_bust', payout: bet * 2 }
  if (p > d) return { outcome: 'win', payout: bet * 2 }
  if (p === d) return { outcome: 'push', payout: bet }
  return { outcome: 'lose', payout: 0 }
}

export function deal(rng: Rng): BjState {
  const deck = newDeck(rng)
  const [p1, d1, p2, d2] = deck.splice(0, 4)
  return { deck, player: [p1, p2], dealer: [d1, d2] }
}

// ------------------------------------------------------------------ view ---

export interface BlackjackView {
  id: string
  bet: number
  status: 'ACTIVE' | 'SETTLED'
  player: Card[]
  /** While ACTIVE only the dealer's up card is shown; the hole card is "??". */
  dealer: Card[]
  playerTotal: number
  dealerTotal: number | null
  outcome: BjOutcome | null
  payout: number | null
  expiresAt: string
  /** Settled because the hand timed out. */
  autoStood?: boolean
}

type GameRow = {
  id: string
  bet: number
  status: 'ACTIVE' | 'SETTLED'
  state: Prisma.JsonValue
  outcome: string | null
  payout: number | null
  expiresAt: Date
}

export function toView(g: GameRow, autoStood = false): BlackjackView {
  const s = g.state as unknown as BjState
  const active = g.status === 'ACTIVE'
  return {
    id: g.id,
    bet: g.bet,
    status: g.status,
    player: s.player,
    dealer: active ? [s.dealer[0], '??'] : s.dealer,
    playerTotal: handValue(s.player).total,
    dealerTotal: active ? null : handValue(s.dealer).total,
    outcome: (g.outcome as BjOutcome | null) ?? null,
    payout: g.payout,
    expiresAt: g.expiresAt.toISOString(),
    ...(autoStood ? { autoStood: true } : {}),
  }
}

// -------------------------------------------------------------------- db ---

type Tx = Prisma.TransactionClient

/**
 * Settle an ACTIVE hand (dealer plays unless the player bust or has a
 * natural). Returns null if someone else already moved/settled it.
 */
async function settleInTx(tx: Tx, game: { id: string; discordId: string; bet: number; version: number }, state: BjState, now: Date) {
  const playerDone = handValue(state.player).total > 21 || isBlackjack(state.player) || isBlackjack(state.dealer)
  const final = playerDone ? state : dealerPlay(state)
  const { outcome, payout } = settleHand(final, game.bet)
  const flipped = await tx.blackjackGame.updateMany({
    where: { id: game.id, status: 'ACTIVE', version: game.version },
    data: {
      status: 'SETTLED',
      activeKey: null,
      state: final as unknown as Prisma.InputJsonValue,
      outcome,
      payout,
      settledAt: now,
      version: { increment: 1 },
    },
  })
  if (flipped.count !== 1) return null
  if (payout > 0) {
    await creditInTx(tx, game.discordId, payout, 'GAME_WIN', `blackjack: ${outcome}`, {
      game: 'blackjack',
      gameId: game.id,
      bet: game.bet,
      outcome,
    })
  }
  return tx.blackjackGame.findUniqueOrThrow({ where: { id: game.id } })
}

export type BlackjackStart =
  | { ok: true; game: BlackjackView; balance: number }
  | { ok: false; reason: 'cooldown'; readyAt: Date }
  | { ok: false; reason: 'active_game'; game: BlackjackView }

/** Deal a new hand: rate limit + stake + deal (and instant settle on a natural). */
export async function startBlackjack(
  discordId: string,
  bet: number,
  opts: { rng?: Rng; now?: Date; source?: 'discord' | 'web' } = {},
): Promise<BlackjackStart> {
  assertBet(bet)
  const rng = opts.rng ?? cryptoRng
  const now = opts.now ?? new Date()
  const { cooldownMs, blackjackTimeoutMs } = gameConfig()

  // Auto-stand the member's own timed-out hand first, plus a few others.
  await sweepExpiredBlackjack({ now, discordId })
  await getOrCreateEconomy(discordId)

  try {
    return await prisma.$transaction(async (tx) => {
      const live = await tx.blackjackGame.findUnique({ where: { activeKey: discordId } })
      if (live) return { ok: false as const, reason: 'active_game' as const, game: toView(live) }

      const cd = await claimCooldown(tx, discordId, 'game', cooldownMs, now)
      if (!cd.ok) return { ok: false as const, reason: 'cooldown' as const, readyAt: cd.readyAt }

      await debitInTx(tx, discordId, bet, 'GAME_BET', 'blackjack: bet', { game: 'blackjack' })
      const state = deal(rng)
      const created = await tx.blackjackGame.create({
        data: {
          discordId,
          activeKey: discordId,
          source: opts.source ?? 'discord',
          bet,
          state: state as unknown as Prisma.InputJsonValue,
          expiresAt: new Date(now.getTime() + blackjackTimeoutMs),
        },
      })
      let row = created
      if (isBlackjack(state.player) || isBlackjack(state.dealer)) {
        row = (await settleInTx(tx, created, state, now)) ?? created
      }
      const econ = await tx.economy.findUniqueOrThrow({ where: { id: discordId }, select: { wallet: true } })
      return { ok: true as const, game: toView(row), balance: econ.wallet }
    })
  } catch (err) {
    // Lost a race to create the member's one live hand: show that hand.
    if ((err as { code?: string })?.code === 'P2002') {
      const live = await prisma.blackjackGame.findUnique({ where: { activeKey: discordId } })
      if (live) return { ok: false, reason: 'active_game', game: toView(live) }
    }
    throw err
  }
}

export type BlackjackMove =
  | { ok: true; game: BlackjackView; balance: number; stale?: boolean }
  | { ok: false; reason: 'not_found' | 'not_yours' }

/**
 * Hit or stand. A timed-out hand auto-stands whatever was pressed. A move that
 * loses a race (double click) returns the current state with `stale: true`
 * and changes nothing.
 */
export async function blackjackAction(
  discordId: string,
  gameId: string,
  action: 'hit' | 'stand',
  opts: { now?: Date } = {},
): Promise<BlackjackMove> {
  const now = opts.now ?? new Date()
  const game = await prisma.blackjackGame.findUnique({ where: { id: gameId } })
  if (!game) return { ok: false, reason: 'not_found' }
  if (game.discordId !== discordId) return { ok: false, reason: 'not_yours' }

  const balanceOf = async () =>
    (await prisma.economy.findUnique({ where: { id: discordId }, select: { wallet: true } }))?.wallet ?? 0

  if (game.status !== 'ACTIVE') return { ok: true, game: toView(game), balance: await balanceOf(), stale: true }

  const expired = game.expiresAt.getTime() <= now.getTime()
  const state = game.state as unknown as BjState

  const result = await prisma.$transaction(async (tx) => {
    if (action === 'stand' || expired) {
      const settled = await settleInTx(tx, game, state, now)
      return settled ? { row: settled, stale: false } : null
    }
    const deck = state.deck.slice()
    const next: BjState = { ...state, deck, player: [...state.player, deck.shift()!] }
    const total = handValue(next.player).total
    if (total >= 21) {
      // Bust settles; 21 stands automatically.
      const settled = await settleInTx(tx, game, next, now)
      return settled ? { row: settled, stale: false } : null
    }
    const moved = await tx.blackjackGame.updateMany({
      where: { id: game.id, status: 'ACTIVE', version: game.version },
      data: { state: next as unknown as Prisma.InputJsonValue, version: { increment: 1 } },
    })
    if (moved.count !== 1) return null
    return { row: await tx.blackjackGame.findUniqueOrThrow({ where: { id: game.id } }), stale: false }
  })

  if (!result) {
    const current = await prisma.blackjackGame.findUniqueOrThrow({ where: { id: gameId } })
    return { ok: true, game: toView(current), balance: await balanceOf(), stale: true }
  }
  return { ok: true, game: toView(result.row, expired), balance: await balanceOf() }
}

/** The member's live hand, auto-standing it first if it timed out. */
export async function getActiveBlackjack(discordId: string, opts: { now?: Date } = {}): Promise<BlackjackView | null> {
  await sweepExpiredBlackjack({ now: opts.now, discordId })
  const live = await prisma.blackjackGame.findUnique({ where: { activeKey: discordId } })
  return live ? toView(live) : null
}

/**
 * Auto-stand timed-out hands. Always includes the given member's hand, plus up
 * to `limit` others, so abandoned hands get settled without a cron.
 */
export async function sweepExpiredBlackjack(opts: { now?: Date; discordId?: string; limit?: number } = {}): Promise<number> {
  const now = opts.now ?? new Date()
  const expired = await prisma.blackjackGame.findMany({
    where: { status: 'ACTIVE', expiresAt: { lte: now } },
    orderBy: { expiresAt: 'asc' },
    take: opts.limit ?? 5,
  })
  if (opts.discordId) {
    const own = await prisma.blackjackGame.findFirst({ where: { activeKey: opts.discordId, expiresAt: { lte: now } } })
    if (own && !expired.some((g) => g.id === own.id)) expired.push(own)
  }
  let settled = 0
  for (const g of expired) {
    const done = await prisma.$transaction((tx) => settleInTx(tx, g, g.state as unknown as BjState, now))
    if (done) settled++
  }
  return settled
}
