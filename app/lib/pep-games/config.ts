/**
 * Casino games (UnbelievaBoat's blackjack, roulette and slots), shared rules.
 * Rules, payouts and house edges are documented in
 * plans/unbelievaboat-replacement.md §7.5.
 *
 *  - Off unless the setting games.enabled (or PEP_GAMES_ENABLED=1) turns it on (Discord commands and web).
 *  - Bets are whole PEP from the wallet, GAME_MIN_BET..GAME_MAX_BET.
 *  - One game start per GAME_COOLDOWN_SECONDS per member (rate limit), claimed
 *    in the same transaction as the stake.
 *  - All randomness is node:crypto (see app/lib/pep-earn/rng.ts).
 */
import { prisma } from '../db'
import { creditInTx, debitInTx, getOrCreateEconomy } from '../economy'
import { ValidationError } from '../errors/api-errors'
import { claimCooldown } from '../pep-earn/cooldown'
import { loadSettings, type Settings } from '../settings'
import { effectiveInt, envNumber } from '../settings/numbers'
import { toggleEnabled } from '../settings/toggles'
import type { Prisma } from '@prisma/client'

export type GameName = 'blackjack' | 'roulette' | 'slots'

/** Setting `games.enabled` (env PEP_GAMES_ENABLED is the fallback and, set to off, a kill switch). Unreadable settings: off. */
export function gamesEnabled(): Promise<boolean> {
  return toggleEnabled('games.enabled')
}

/**
 * Bet limits and timings. Settings games.* (saved rows win; the GAME_* env vars are the legacy
 * values while nothing is saved). Without a snapshot, only the env vars and defaults apply.
 */
export function gameConfig(settings?: Settings) {
  const env = process.env
  const minBet = Math.max(1, effectiveInt('games.minBet', settings, envNumber(env.GAME_MIN_BET)))
  return {
    minBet,
    maxBet: Math.max(minBet, effectiveInt('games.maxBet', settings, envNumber(env.GAME_MAX_BET))),
    cooldownMs: Math.max(0, effectiveInt('games.cooldownSeconds', settings, envNumber(env.GAME_COOLDOWN_SECONDS))) * 1000,
    blackjackTimeoutMs: Math.max(30, effectiveInt('games.blackjackTimeoutSeconds', settings, envNumber(env.BLACKJACK_TIMEOUT_SECONDS))) * 1000,
  }
}

/** The config with the current settings (cached ~30s). */
export async function loadGameConfig() {
  return gameConfig(await loadSettings())
}

export function assertBet(bet: unknown, config: Pick<ReturnType<typeof gameConfig>, 'minBet' | 'maxBet'> = gameConfig()): asserts bet is number {
  const { minBet, maxBet } = config
  if (typeof bet !== 'number' || !Number.isInteger(bet) || bet < minBet || bet > maxBet) {
    throw new ValidationError(`Bet must be a whole number from ${minBet.toLocaleString('en-US')} to ${maxBet.toLocaleString('en-US')}`)
  }
}

export type CooldownRefusal = { ok: false; reason: 'cooldown'; readyAt: Date }

/**
 * Run one stateless round (roulette, slots): rate limit, stake, outcome and
 * payout in a single DB transaction. `play` decides the outcome and returns the
 * total paid back (0 = lost; bet = push; 2*bet = even-money win). The stake
 * (GAME_BET) and payout (GAME_WIN) are separate ledger rows.
 */
export async function playRound<T extends { payout: number }>(
  discordId: string,
  game: GameName,
  bet: number,
  play: () => T,
  opts: { now?: Date } = {},
): Promise<CooldownRefusal | (T & { ok: true; bet: number; balance: number })> {
  const config = await loadGameConfig()
  assertBet(bet, config)
  const now = opts.now ?? new Date()
  const { cooldownMs } = config
  await getOrCreateEconomy(discordId)

  return prisma.$transaction(async (tx) => {
    const cd = await claimCooldown(tx, discordId, 'game', cooldownMs, now)
    if (!cd.ok) return { ok: false as const, reason: 'cooldown' as const, readyAt: cd.readyAt }
    await debitInTx(tx, discordId, bet, 'GAME_BET', `${game}: bet`, { game })
    const result = play()
    if (!Number.isInteger(result.payout) || result.payout < 0) throw new Error(`bad ${game} payout ${result.payout}`)
    if (result.payout > 0) {
      await creditInTx(tx, discordId, result.payout, 'GAME_WIN', `${game}: payout`, { game, bet, ...gameMeta(result) })
    }
    const econ = await tx.economy.findUniqueOrThrow({ where: { id: discordId }, select: { wallet: true } })
    return { ...result, ok: true as const, bet, balance: econ.wallet }
  })
}

function gameMeta(result: object): Prisma.InputJsonObject {
  // Only small scalar/array fields go into the ledger metadata.
  const out: Record<string, Prisma.InputJsonValue> = {}
  for (const [k, v] of Object.entries(result)) {
    if (k === 'payout') continue
    if (typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean') out[k] = v
    else if (Array.isArray(v) && v.every((x) => typeof x === 'string' || typeof x === 'number')) out[k] = v
  }
  return out
}
