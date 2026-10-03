/**
 * /collect-income: UnbelievaBoat's role income, ported as-is (plan appendix).
 *
 * Every configured role a member holds pays its amount once per interval
 * (default: daily). Each role has its own cooldown (EconomyCooldown action
 * "income:<roleId>"), claimed inside the payout transaction, so concurrent
 * /collect-income calls pay each role once. One ROLE_INCOME ledger row per
 * role paid. Like UB: no stacking, a missed day is simply not collected.
 *
 * Config lives in code (DEFAULT_ROLE_INCOME). Staff can override it without a
 * deploy of code changes via the ROLE_INCOME_JSON env var: a JSON array of
 * { name, amount, intervalHours?, roleId? }. Roles without a roleId are
 * resolved by name against the guild's roles (GET /guilds/{id}/roles, cached),
 * ignoring case, spaces, punctuation and emoji.
 */
import { prisma } from '../db'
import { creditInTx, getOrCreateEconomy } from '../economy'
import { claimCooldown } from './cooldown'

export interface RoleIncome {
  /** Discord role name, as shown in the server. */
  name: string
  /** PEP paid per interval. */
  amount: number
  /** Hours between collections (UB: 1 day for every role). */
  intervalHours: number
  /** Discord role id. Optional: resolved by name when absent. */
  roleId?: string
}

/** Live UB role income, read from the UB dashboard on 2026-10-03. */
export const DEFAULT_ROLE_INCOME: readonly RoleIncome[] = [
  { name: 'Pizzaiolo', amount: 690, intervalHours: 24 },
  { name: 'Dread Pizza Roberts', amount: 420, intervalHours: 24, roleId: '812131585327235113' },
  { name: 'Pizza Holder', amount: 69, intervalHours: 24 },
  { name: 'Pizza Mafia', amount: 69, intervalHours: 24 },
  { name: 'Pizza Capo', amount: 69, intervalHours: 24, roleId: '839206162837798945' },
  { name: 'Crew Member', amount: 42, intervalHours: 24 },
  { name: 'Box Mafia', amount: 42, intervalHours: 24 },
  { name: 'Pizza Sticks Holder', amount: 8, intervalHours: 24 },
  { name: 'Pizza Pop Holder', amount: 8, intervalHours: 24 },
  { name: 'Pizza Tattoo Club', amount: 8, intervalHours: 24 },
  { name: 'Pockets Checked', amount: 1, intervalHours: 24 },
]

function validEntry(e: unknown): e is RoleIncome {
  const r = e as RoleIncome
  return (
    !!r &&
    typeof r.name === 'string' &&
    r.name.trim().length > 0 &&
    Number.isInteger(r.amount) &&
    r.amount > 0 &&
    typeof r.intervalHours === 'number' &&
    r.intervalHours > 0 &&
    (r.roleId === undefined || (typeof r.roleId === 'string' && /^\d{5,25}$/.test(r.roleId)))
  )
}

/** The role income table: ROLE_INCOME_JSON if set and valid, else the defaults. */
export function roleIncomeConfig(raw = process.env.ROLE_INCOME_JSON): readonly RoleIncome[] {
  if (raw) {
    try {
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed)) {
        const withDefaults = parsed.map((e) => ({ intervalHours: 24, ...e }))
        if (withDefaults.length && withDefaults.every(validEntry)) return withDefaults
      }
      console.warn('[income] ROLE_INCOME_JSON is invalid; using the built-in table')
    } catch {
      console.warn('[income] ROLE_INCOME_JSON is not JSON; using the built-in table')
    }
  }
  return DEFAULT_ROLE_INCOME
}

/** Lowercase, letters and digits only ("🍕 Pizza-Holder" -> "pizzaholder"). */
export function normalizeRoleName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '')
}

export type ResolvedRoleIncome = RoleIncome & { roleId: string }

/**
 * Attach role ids. Configured ids win; otherwise the guild role whose name
 * matches (normalized). A name matching zero or several guild roles is left
 * unresolved (listed in `unresolved`) rather than guessed.
 */
export function resolveRoleIncome(
  config: readonly RoleIncome[],
  guildRoles: ReadonlyArray<{ id: string; name: string }> | null,
): { resolved: ResolvedRoleIncome[]; unresolved: string[] } {
  const byName = new Map<string, string[]>()
  for (const r of guildRoles ?? []) {
    const k = normalizeRoleName(r.name)
    byName.set(k, [...(byName.get(k) ?? []), r.id])
  }
  const resolved: ResolvedRoleIncome[] = []
  const unresolved: string[] = []
  for (const entry of config) {
    const ids = entry.roleId ? [entry.roleId] : (byName.get(normalizeRoleName(entry.name)) ?? [])
    if (ids.length === 1) resolved.push({ ...entry, roleId: ids[0] })
    else unresolved.push(entry.name)
  }
  return { resolved, unresolved }
}

export type IncomeResult = {
  paid: Array<{ name: string; roleId: string; amount: number }>
  waiting: Array<{ name: string; roleId: string; readyAt: Date }>
  total: number
  balance: number
}

/**
 * Pay every held role whose interval has passed. `memberRoleIds` comes from
 * the interaction payload (member.roles), so no Discord call is needed here.
 */
export async function collectIncome(
  discordId: string,
  memberRoleIds: readonly string[],
  incomes: readonly ResolvedRoleIncome[],
  opts: { now?: Date } = {},
): Promise<IncomeResult> {
  const now = opts.now ?? new Date()
  const held = new Set(memberRoleIds)
  // One entry per role id, even if the config lists a role twice.
  const eligible = [...new Map(incomes.filter((r) => held.has(r.roleId)).map((r) => [r.roleId, r])).values()]

  if (eligible.length === 0) {
    const econ = await prisma.economy.findUnique({ where: { id: discordId }, select: { wallet: true } })
    return { paid: [], waiting: [], total: 0, balance: econ?.wallet ?? 0 }
  }

  await getOrCreateEconomy(discordId)

  return prisma.$transaction(async (tx) => {
    const paid: IncomeResult['paid'] = []
    const waiting: IncomeResult['waiting'] = []
    for (const role of eligible) {
      const cd = await claimCooldown(tx, discordId, `income:${role.roleId}`, role.intervalHours * 3_600_000, now)
      if (!cd.ok) {
        waiting.push({ name: role.name, roleId: role.roleId, readyAt: cd.readyAt })
        continue
      }
      await creditInTx(tx, discordId, role.amount, 'ROLE_INCOME', `Role income: ${role.name}`, {
        command: 'collect-income',
        roleId: role.roleId,
        roleName: role.name,
      })
      paid.push({ name: role.name, roleId: role.roleId, amount: role.amount })
    }
    const econ = await tx.economy.findUniqueOrThrow({ where: { id: discordId }, select: { wallet: true } })
    return { paid, waiting, total: paid.reduce((s, p) => s + p.amount, 0), balance: econ.wallet }
  })
}
