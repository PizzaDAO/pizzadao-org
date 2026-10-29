/**
 * /work: the PizzaDAO replacement for UnbelievaBoat's /work.
 *
 * Mirrors the live UB config (as read from the UB dashboard): 30s cooldown,
 * pays 10-100, default replies off, custom "mission-style" replies that nudge
 * members toward community actions (staff pay the advertised bonuses by hand).
 * Every payout is a WORK_REWARD ledger row.
 *
 * Tunables: settings work.* (admin page); the env vars below are the legacy values while nothing is
 * saved: WORK_MIN_PEP, WORK_MAX_PEP, WORK_COOLDOWN_SECONDS.
 * Replies: the work.prompts setting (admin page); WORK_PROMPTS_JSON (a JSON array of strings with
 * {amount}) is the legacy value while nothing is saved, else the built-in replies in ./work-prompts.
 */
import { prisma } from '../db'
import { getOrCreateEconomy } from '../economy'
import { logTransaction } from '../transactions'
import { loadSettings, type Settings } from '../settings'
import { effectiveInt, envNumber, storedOverride } from '../settings/numbers'
import { DEFAULT_WORK_PROMPTS, workPromptsBaseline } from './work-prompts'
import { claimCooldown, randInt } from './cooldown'

export { DEFAULT_WORK_PROMPTS }

/**
 * The /work replies. A saved `work.prompts` setting wins; with none it is WORK_PROMPTS_JSON if set and
 * valid, else the built-in replies. Unreadable settings use the last saved replies this instance saw.
 */
export function workPrompts(settings?: Settings): readonly string[] {
  const saved = storedOverride('work.prompts', settings)
  if (saved) return saved.value as string[]
  return workPromptsBaseline()
}

/** Settings work.* (saved rows win; the WORK_* env vars are the legacy values while nothing is saved). */
export function workConfig(settings?: Settings) {
  const env = process.env
  const min = effectiveInt('work.minPep', settings, envNumber(env.WORK_MIN_PEP))
  const max = Math.max(min, effectiveInt('work.maxPep', settings, envNumber(env.WORK_MAX_PEP)))
  return { min, max, cooldownMs: effectiveInt('work.cooldownSeconds', settings, envNumber(env.WORK_COOLDOWN_SECONDS)) * 1000 }
}

export type WorkResult =
  | { ok: true; amount: number; balance: number; prompt: string; promptIndex: number }
  | { ok: false; readyAt: Date }

export async function doWork(
  discordId: string,
  opts: { rng?: () => number; now?: Date } = {},
): Promise<WorkResult> {
  const rng = opts.rng ?? Math.random
  const now = opts.now ?? new Date()
  const settings = await loadSettings()
  const { min, max, cooldownMs } = workConfig(settings)
  const prompts = workPrompts(settings)

  await getOrCreateEconomy(discordId)

  return prisma.$transaction(async (tx) => {
    const cd = await claimCooldown(tx, discordId, 'work', cooldownMs, now)
    if (!cd.ok) return cd

    const amount = randInt(min, max, rng)
    const promptIndex = randInt(0, prompts.length - 1, rng)
    const econ = await tx.economy.update({
      where: { id: discordId },
      data: { wallet: { increment: amount } },
    })
    await logTransaction(tx, discordId, 'WORK_REWARD', amount, 'Work shift', { command: 'work', promptIndex })
    return { ok: true as const, amount, balance: econ.wallet, prompt: prompts[promptIndex], promptIndex }
  })
}
