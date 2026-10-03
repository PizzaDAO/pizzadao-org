/**
 * Race-safe per-user cooldowns for PEP earning actions (/work, crime, and
 * later /collect-income per role). Call inside the payout's $transaction so
 * the cooldown and the payout commit or roll back together.
 *
 *   1. UPDATE ... SET lastAt = now WHERE lastAt <= now - cooldown  (1 row = ready)
 *   2. else INSERT ... ON CONFLICT DO NOTHING                     (1 row = first use)
 *   3. else read lastAt and report when the action is ready again.
 *
 * Under READ COMMITTED a concurrent second call blocks on the row lock from
 * step 1 or the insert in step 2, then re-checks and matches 0 rows, so two
 * simultaneous /work invocations cannot both pay out. No unique-violation is
 * ever raised inside the transaction (that would abort it in Postgres).
 */
import type { Prisma } from '@prisma/client'

export type CooldownResult = { ok: true } | { ok: false; readyAt: Date }

export async function claimCooldown(
  tx: Prisma.TransactionClient,
  discordId: string,
  action: string,
  cooldownMs: number,
  now: Date = new Date(),
): Promise<CooldownResult> {
  const cutoff = new Date(now.getTime() - cooldownMs)
  const moved = await tx.economyCooldown.updateMany({
    where: { discordId, action, lastAt: { lte: cutoff } },
    data: { lastAt: now },
  })
  if (moved.count === 1) return { ok: true }

  const created = await tx.economyCooldown.createMany({
    data: [{ discordId, action, lastAt: now }],
    skipDuplicates: true,
  })
  if (created.count === 1) return { ok: true }

  const row = await tx.economyCooldown.findUnique({ where: { discordId_action: { discordId, action } } })
  return { ok: false, readyAt: new Date((row?.lastAt ?? now).getTime() + cooldownMs) }
}

/** Uniform integer in [min, max]. `rng` returns [0, 1). */
export function randInt(min: number, max: number, rng: () => number = Math.random): number {
  return min + Math.floor(rng() * (max - min + 1))
}

export function envInt(name: string, fallback: number): number {
  const v = Number.parseInt(process.env[name] ?? '', 10)
  return Number.isFinite(v) ? v : fallback
}
