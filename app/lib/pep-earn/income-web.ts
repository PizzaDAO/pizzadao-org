/**
 * Shared by the website's daily-PEP routes: the member's Discord roles (server-side, uncached)
 * plus the role income table resolved against the guild, i.e. the same inputs the
 * /collect-income slash command uses.
 */
import { fetchGuildMember, lookupGuildMembership } from '../discord'
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
      earnRoles: Array<{ name: string; amount: number; intervalHours: number }>
    }

/**
 * `cached: true` (status reads) uses the 60s-cached member lookup; payouts use the uncached one.
 * Fails closed ({ ok: false }) when roles can't be read or when the guild role list is unavailable
 * while some income role still needs a name lookup, so we never report a misleading "no daily PEP".
 */
export async function loadIncomeContext(discordId: string, opts: { cached?: boolean } = {}): Promise<IncomeContext> {
  let memberRoles: string[]
  if (opts.cached) {
    const m = await fetchGuildMember(discordId)
    if (!m) return { ok: false }
    memberRoles = m.roles ?? []
  } else {
    const membership = await lookupGuildMembership(discordId)
    if (membership.status === 'unknown') return { ok: false }
    memberRoles = membership.status === 'member' ? (membership.member.roles ?? []) : []
  }
  const guildId = process.env.DISCORD_GUILD_ID?.trim()
  const config = roleIncomeConfig(process.env.ROLE_INCOME_JSON, await loadSettings())
  const guildRoles = guildId ? await getGuildRoles(guildId) : null
  const { resolved, unresolved } = resolveRoleIncome(config, guildRoles)
  if (!guildRoles && unresolved.length) return { ok: false }
  if (unresolved.length) console.warn('[collect-income] unresolved roles:', unresolved.join(', '))
  return {
    ok: true,
    roleIds: memberRoles,
    incomes: resolved,
    earnRoles: config.map((c) => ({ name: c.name, amount: c.amount, intervalHours: c.intervalHours ?? 24 })),
  }
}
