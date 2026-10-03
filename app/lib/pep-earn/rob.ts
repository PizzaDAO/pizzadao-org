/**
 * /rob: kept from UnbelievaBoat (owner decision), with anti-abuse rules.
 * The rules and their rationale are in plans/unbelievaboat-replacement.md §7.4.
 *
 *  - Robber needs ROB_MIN_ROBBER_BALANCE in their wallet and risks a fine.
 *  - Victim needs ROB_MIN_VICTIM_BALANCE (small wallets can't be robbed).
 *  - ROB_SUCCESS_PERCENT chance. Success steals a random
 *    ROB_STEAL_MIN..MAX_PERCENT of the victim's wallet, capped at ROB_STEAL_CAP.
 *    Failure: the robber pays the victim a fine of ROB_FINE_MIN..MAX_PERCENT of
 *    the robber's wallet, clamped to [ROB_FINE_FLOOR, ROB_FINE_CAP].
 *  - Robber cooldown ROB_COOLDOWN_HOURS. A victim can be targeted once per
 *    ROB_VICTIM_COOLDOWN_HOURS, by anyone, whatever the outcome.
 *  - No robbing yourself or bots. Members who joined the server less than
 *    ROB_NEW_MEMBER_DAYS ago can neither rob nor be robbed (when Discord tells
 *    us their join date, which interactions do).
 *  - Peace mode (opt-out): no robbing and not robbable. Toggling it has a
 *    PEACE_TOGGLE_COOLDOWN_HOURS cooldown, it can't be switched on within
 *    PEACE_AFTER_ROB_HOURS of a rob attempt, and after switching it off the
 *    member can't rob until the toggle cooldown has passed.
 *
 * Everything happens in one DB transaction that locks both wallets (in id
 * order, so A-robs-B racing B-robs-A can't deadlock) and claims both
 * cooldowns. Ledger: ROB_STEAL (+robber) / ROB_LOSS (-victim) on success,
 * ROB_FINE (-robber, +victim) on failure.
 *
 * Off unless PEP_ROB_ENABLED=1.
 */
import { prisma } from '../db'
import { creditInTx, debitInTx, getOrCreateEconomy } from '../economy'
import { claimCooldown, envInt } from './cooldown'
import { chance, cryptoRng, rngInt, type Rng } from './rng'

const HOUR = 3_600_000
const DAY = 24 * HOUR

export function robEnabled() {
  return process.env.PEP_ROB_ENABLED === '1'
}

export function robConfig() {
  const stealMin = envInt('ROB_STEAL_MIN_PERCENT', 5)
  const fineMin = envInt('ROB_FINE_MIN_PERCENT', 10)
  return {
    minRobberBalance: envInt('ROB_MIN_ROBBER_BALANCE', 500),
    minVictimBalance: envInt('ROB_MIN_VICTIM_BALANCE', 200),
    successPercent: Math.min(100, Math.max(0, envInt('ROB_SUCCESS_PERCENT', 40))),
    stealMinPercent: stealMin,
    stealMaxPercent: Math.max(stealMin, envInt('ROB_STEAL_MAX_PERCENT', 20)),
    stealCap: envInt('ROB_STEAL_CAP', 1000),
    fineMinPercent: fineMin,
    fineMaxPercent: Math.max(fineMin, envInt('ROB_FINE_MAX_PERCENT', 25)),
    fineFloor: envInt('ROB_FINE_FLOOR', 50),
    fineCap: envInt('ROB_FINE_CAP', 1000),
    cooldownMs: envInt('ROB_COOLDOWN_HOURS', 4) * HOUR,
    victimCooldownMs: envInt('ROB_VICTIM_COOLDOWN_HOURS', 12) * HOUR,
    newMemberMs: envInt('ROB_NEW_MEMBER_DAYS', 7) * DAY,
    peaceToggleMs: envInt('PEACE_TOGGLE_COOLDOWN_HOURS', 24) * HOUR,
    peaceAfterRobMs: envInt('PEACE_AFTER_ROB_HOURS', 12) * HOUR,
  }
}

export type RobRefusalReason =
  | 'disabled'
  | 'self'
  | 'bot'
  | 'robber_new'
  | 'victim_new'
  | 'robber_peace'
  | 'victim_peace'
  | 'peace_recent'
  | 'robber_poor'
  | 'victim_poor'
  | 'cooldown'
  | 'victim_cooldown'

export type RobResult =
  | { ok: false; reason: RobRefusalReason; readyAt?: Date; min?: number }
  | {
      ok: true
      outcome: 'success'
      amount: number
      percent: number
      robberBalance: number
      victimBalance: number
    }
  | {
      ok: true
      outcome: 'caught'
      amount: number
      percent: number
      robberBalance: number
      victimBalance: number
    }

class Refusal extends Error {
  constructor(readonly result: Extract<RobResult, { ok: false }>) {
    super(result.reason)
  }
}

export interface RobContext {
  /** From the interaction's resolved user. */
  victimIsBot?: boolean
  /** member.joined_at of robber / victim, when known. */
  robberJoinedAt?: Date | null
  victimJoinedAt?: Date | null
}

export async function attemptRob(
  robberId: string,
  victimId: string,
  ctx: RobContext = {},
  opts: { rng?: Rng; now?: Date } = {},
): Promise<RobResult> {
  const rng = opts.rng ?? cryptoRng
  const now = opts.now ?? new Date()
  const cfg = robConfig()

  if (!robEnabled()) return { ok: false, reason: 'disabled' }
  if (robberId === victimId) return { ok: false, reason: 'self' }
  if (ctx.victimIsBot) return { ok: false, reason: 'bot' }
  const tooNew = (joined?: Date | null) => !!joined && now.getTime() - joined.getTime() < cfg.newMemberMs
  if (tooNew(ctx.robberJoinedAt)) {
    return { ok: false, reason: 'robber_new', readyAt: new Date(ctx.robberJoinedAt!.getTime() + cfg.newMemberMs) }
  }
  if (tooNew(ctx.victimJoinedAt)) return { ok: false, reason: 'victim_new' }

  // Never create a wallet for the victim: no wallet means nothing to steal.
  const victimWallet = await prisma.economy.findUnique({ where: { id: victimId }, select: { wallet: true } })
  if (!victimWallet || victimWallet.wallet < cfg.minVictimBalance) {
    return { ok: false, reason: 'victim_poor', min: cfg.minVictimBalance }
  }
  await getOrCreateEconomy(robberId)

  try {
    return await prisma.$transaction(async (tx) => {
      // Lock both wallets in a fixed order; balances read under the lock.
      const rows = await tx.$queryRaw<Array<{ id: string; wallet: number }>>`
        SELECT id, wallet FROM "Economy" WHERE id IN (${robberId}, ${victimId}) ORDER BY id FOR UPDATE`
      const robberBal = rows.find((r) => r.id === robberId)?.wallet ?? 0
      const victimBal = rows.find((r) => r.id === victimId)?.wallet ?? 0

      const peace = await tx.economyPeaceMode.findMany({ where: { discordId: { in: [robberId, victimId] } } })
      if (peace.some((p) => p.discordId === robberId)) throw new Refusal({ ok: false, reason: 'robber_peace' })
      if (peace.some((p) => p.discordId === victimId)) throw new Refusal({ ok: false, reason: 'victim_peace' })

      const toggle = await tx.economyCooldown.findUnique({
        where: { discordId_action: { discordId: robberId, action: 'peace-toggle' } },
      })
      if (toggle && now.getTime() - toggle.lastAt.getTime() < cfg.peaceToggleMs) {
        throw new Refusal({ ok: false, reason: 'peace_recent', readyAt: new Date(toggle.lastAt.getTime() + cfg.peaceToggleMs) })
      }

      if (robberBal < cfg.minRobberBalance) throw new Refusal({ ok: false, reason: 'robber_poor', min: cfg.minRobberBalance })
      if (victimBal < cfg.minVictimBalance) throw new Refusal({ ok: false, reason: 'victim_poor', min: cfg.minVictimBalance })

      const mine = await claimCooldown(tx, robberId, 'rob', cfg.cooldownMs, now)
      if (!mine.ok) throw new Refusal({ ok: false, reason: 'cooldown', readyAt: mine.readyAt })
      const theirs = await claimCooldown(tx, victimId, 'robbed', cfg.victimCooldownMs, now)
      if (!theirs.ok) throw new Refusal({ ok: false, reason: 'victim_cooldown', readyAt: theirs.readyAt })

      const meta = { command: 'rob', robberId, victimId }
      if (chance(rng, cfg.successPercent)) {
        const percent = rngInt(rng, cfg.stealMinPercent, cfg.stealMaxPercent)
        const amount = Math.min(cfg.stealCap, Math.floor((victimBal * percent) / 100), victimBal)
        if (amount > 0) {
          await debitInTx(tx, victimId, amount, 'ROB_LOSS', `Robbed by ${robberId}`, { ...meta, percent })
          await creditInTx(tx, robberId, amount, 'ROB_STEAL', `Robbed ${victimId}`, { ...meta, percent })
        }
        return {
          ok: true as const,
          outcome: 'success' as const,
          amount,
          percent,
          robberBalance: robberBal + amount,
          victimBalance: victimBal - amount,
        }
      }

      const percent = rngInt(rng, cfg.fineMinPercent, cfg.fineMaxPercent)
      const fine = Math.min(robberBal, Math.max(cfg.fineFloor, Math.min(cfg.fineCap, Math.floor((robberBal * percent) / 100))))
      if (fine > 0) {
        await debitInTx(tx, robberId, fine, 'ROB_FINE', `Caught robbing ${victimId}: fine`, { ...meta, percent })
        await creditInTx(tx, victimId, fine, 'ROB_FINE', `Caught ${robberId} robbing you: fine paid to you`, { ...meta, percent })
      }
      return {
        ok: true as const,
        outcome: 'caught' as const,
        amount: fine,
        percent,
        robberBalance: robberBal - fine,
        victimBalance: victimBal + fine,
      }
    })
  } catch (err) {
    if (err instanceof Refusal) return err.result
    throw err
  }
}

export type PeaceResult =
  | { ok: true; enabled: boolean; changed: boolean }
  | { ok: false; reason: 'cooldown' | 'robbed_recently'; readyAt: Date }

export async function getPeaceMode(discordId: string): Promise<boolean> {
  return !!(await prisma.economyPeaceMode.findUnique({ where: { discordId } }))
}

/** Switch peace mode on or off, subject to the toggle and after-rob cooldowns. */
export async function setPeaceMode(discordId: string, enable: boolean, opts: { now?: Date } = {}): Promise<PeaceResult> {
  const now = opts.now ?? new Date()
  const cfg = robConfig()
  type Fail = Extract<PeaceResult, { ok: false }>
  class PeaceRefusal extends Error {
    constructor(readonly result: Fail) {
      super(result.reason)
    }
  }
  try {
    return await prisma.$transaction(async (tx) => {
      const current = await tx.economyPeaceMode.findUnique({ where: { discordId } })
      if (!!current === enable) return { ok: true as const, enabled: enable, changed: false }

      if (enable) {
        const rob = await tx.economyCooldown.findUnique({ where: { discordId_action: { discordId, action: 'rob' } } })
        if (rob && now.getTime() - rob.lastAt.getTime() < cfg.peaceAfterRobMs) {
          throw new PeaceRefusal({ ok: false, reason: 'robbed_recently', readyAt: new Date(rob.lastAt.getTime() + cfg.peaceAfterRobMs) })
        }
      }
      const cd = await claimCooldown(tx, discordId, 'peace-toggle', cfg.peaceToggleMs, now)
      if (!cd.ok) throw new PeaceRefusal({ ok: false, reason: 'cooldown', readyAt: cd.readyAt })

      if (enable) {
        await tx.economyPeaceMode.createMany({ data: [{ discordId, enabledAt: now }], skipDuplicates: true })
      } else {
        await tx.economyPeaceMode.deleteMany({ where: { discordId } })
      }
      return { ok: true as const, enabled: enable, changed: true }
    })
  } catch (err) {
    if (err instanceof PeaceRefusal) return err.result
    throw err
  }
}
