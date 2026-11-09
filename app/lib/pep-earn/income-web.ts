/**
 * Shared by the website's daily-PEP routes: the member's Discord roles (server-side, uncached)
 * plus the role income table resolved against the guild, i.e. the same inputs the
 * /collect-income slash command uses.
 */
import { lookupGuildMembership } from '../discord'
import { getGuildRoles } from '../discord-interactions/guild-roles'
import { loadSettings } from '../settings'
import { resolveRoleIncome, roleIncomeConfig, type ResolvedRoleIncome } from './income'

export type IncomeContext =
  | { ok: false }
  | {
      ok: true
      roleIds: string[]
      incomes: ResolvedRoleIncome[]
      /** Every role in the income table (held or not), for "get the X role" hints. */
      earnRoles: Array<{ name: string; amount: number }>
    }

export async function loadIncomeContext(discordId: string): Promise<IncomeContext> {
  const membership = await lookupGuildMembership(discordId)
  if (membership.status === 'unknown') return { ok: false }
  const guildId = process.env.DISCORD_GUILD_ID?.trim()
  const config = roleIncomeConfig(process.env.ROLE_INCOME_JSON, await loadSettings())
  const { resolved, unresolved } = resolveRoleIncome(config, guildId ? await getGuildRoles(guildId) : null)
  if (unresolved.length) console.warn('[collect-income] unresolved roles:', unresolved.join(', '))
  return {
    ok: true,
    roleIds: membership.status === 'member' ? (membership.member.roles ?? []) : [],
    incomes: resolved,
    earnRoles: config.map((c) => ({ name: c.name, amount: c.amount })),
  }
}
