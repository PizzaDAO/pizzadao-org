/**
 * Crime: UnbelievaBoat's /crime, moved to the web app (owner decision).
 *
 * Mirrors the live UB config: 30s cooldown, success pays 2-420, 60% chance of
 * a fine, fine is 5-55% of the current wallet (UB's "percent" fine type).
 * Fines never take the wallet below zero. Ledger: CRIME_REWARD (+) or
 * CRIME_FINE (-).
 *
 * Tunables: settings crime.* (admin page); the env vars below are the legacy values while nothing is
 * saved: CRIME_MIN_PEP, CRIME_MAX_PEP, CRIME_FAIL_PERCENT,
 * CRIME_FINE_MIN_PERCENT, CRIME_FINE_MAX_PERCENT, CRIME_COOLDOWN_SECONDS.
 */
import { prisma } from '../db'
import { getOrCreateEconomy } from '../economy'
import { logTransaction } from '../transactions'
import { loadSettings, type Settings } from '../settings'
import { effectiveInt, envNumber } from '../settings/numbers'
import { claimCooldown, randInt } from './cooldown'

/** Settings crime.* (saved rows win; the CRIME_* env vars are the legacy values while nothing is saved). */
export function crimeConfig(settings?: Settings) {
  const env = process.env
  const min = effectiveInt('crime.minPep', settings, envNumber(env.CRIME_MIN_PEP))
  const fineMin = effectiveInt('crime.fineMinPercent', settings, envNumber(env.CRIME_FINE_MIN_PERCENT))
  return {
    min,
    max: Math.max(min, effectiveInt('crime.maxPep', settings, envNumber(env.CRIME_MAX_PEP))),
    failPercent: Math.min(100, Math.max(0, effectiveInt('crime.failPercent', settings, envNumber(env.CRIME_FAIL_PERCENT)))),
    fineMinPercent: fineMin,
    fineMaxPercent: Math.max(fineMin, effectiveInt('crime.fineMaxPercent', settings, envNumber(env.CRIME_FINE_MAX_PERCENT))),
    cooldownMs: effectiveInt('crime.cooldownSeconds', settings, envNumber(env.CRIME_COOLDOWN_SECONDS)) * 1000,
  }
}

export type CrimeResult =
  | { ok: true; outcome: 'success'; amount: number; balance: number }
  | { ok: true; outcome: 'fined'; amount: number; finePercent: number; balance: number }
  | { ok: false; readyAt: Date }

export async function commitCrime(
  discordId: string,
  opts: { rng?: () => number; now?: Date } = {},
): Promise<CrimeResult> {
  const rng = opts.rng ?? Math.random
  const now = opts.now ?? new Date()
  const cfg = crimeConfig(await loadSettings())

  await getOrCreateEconomy(discordId)

  return prisma.$transaction(async (tx) => {
    const cd = await claimCooldown(tx, discordId, 'crime', cfg.cooldownMs, now)
    if (!cd.ok) return cd

    const failed = rng() * 100 < cfg.failPercent
    if (!failed) {
      const amount = randInt(cfg.min, cfg.max, rng)
      const econ = await tx.economy.update({ where: { id: discordId }, data: { wallet: { increment: amount } } })
      await logTransaction(tx, discordId, 'CRIME_REWARD', amount, 'Crime paid off', { command: 'crime' })
      return { ok: true as const, outcome: 'success' as const, amount, balance: econ.wallet }
    }

    const finePercent = randInt(cfg.fineMinPercent, cfg.fineMaxPercent, rng)
    const econ = await tx.economy.findUnique({ where: { id: discordId } })
    const wallet = Math.max(0, econ?.wallet ?? 0)
    const fine = Math.floor((wallet * finePercent) / 100)
    if (fine > 0) {
      const debit = await tx.economy.updateMany({
        where: { id: discordId, wallet: { gte: fine } },
        data: { wallet: { decrement: fine } },
      })
      if (debit.count !== 1) throw new Error('wallet changed during crime fine')
      await logTransaction(tx, discordId, 'CRIME_FINE', -fine, `Caught: fined ${finePercent}%`, { command: 'crime', finePercent })
    }
    return { ok: true as const, outcome: 'fined' as const, amount: fine, finePercent, balance: wallet - fine }
  })
}
