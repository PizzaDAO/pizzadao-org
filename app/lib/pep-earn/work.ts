/**
 * /work: the PizzaDAO replacement for UnbelievaBoat's /work.
 *
 * Mirrors the live UB config (as read from the UB dashboard): 30s cooldown,
 * pays 10-100, default replies off, custom "mission-style" replies that nudge
 * members toward community actions (staff pay the advertised bonuses by hand).
 * Every payout is a WORK_REWARD ledger row.
 *
 * Tunables (env): WORK_MIN_PEP, WORK_MAX_PEP, WORK_COOLDOWN_SECONDS.
 * Replies: WORK_PROMPTS_JSON (a JSON array of strings with {amount}) overrides
 * the defaults below; moving them to a sheet/DB table is specced in
 * plans/unbelievaboat-replacement.md.
 */
import { prisma } from '../db'
import { getOrCreateEconomy } from '../economy'
import { logTransaction } from '../transactions'
import { claimCooldown, envInt, randInt } from './cooldown'

export const DEFAULT_WORK_PROMPTS: readonly string[] = [
  "You tossed dough for the crew and earned {amount}. Bonus mission: invite a friend to this week's [community call](<https://app.pizzadao.org/calls>) and tag a mod for a 314 bonus.",
  'You folded pizza boxes all shift: {amount}. Bonus mission: share your best pizza gif in the gifs channel for a 69-314 bonus.',
  'You delivered a pie across town and earned {amount}. Bonus mission: post a photo of a local pizzeria to earn a bonus.',
  'You grated mountains of mozzarella: {amount}. Bonus mission: welcome a new member in general.',
  'You tended the wood-fired oven and earned {amount}. Bonus mission: claim a task on [app.pizzadao.org](<https://app.pizzadao.org/crews>).',
  'You pitched a Global Pizza Party venue and earned {amount}. Bonus mission: help plan a party in your city on [rsv.pizza](<https://rsv.pizza>).',
]

export function workPrompts(): readonly string[] {
  const raw = process.env.WORK_PROMPTS_JSON
  if (raw) {
    try {
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed) && parsed.length && parsed.every((p) => typeof p === 'string')) return parsed
    } catch {
      /* fall through to defaults */
    }
  }
  return DEFAULT_WORK_PROMPTS
}

export function workConfig() {
  const min = envInt('WORK_MIN_PEP', 10)
  const max = Math.max(min, envInt('WORK_MAX_PEP', 100))
  return { min, max, cooldownMs: envInt('WORK_COOLDOWN_SECONDS', 30) * 1000 }
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
  const { min, max, cooldownMs } = workConfig()
  const prompts = workPrompts()

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
