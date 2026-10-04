/**
 * Who may manage the $PEP shop (/admin/shop and /api/admin/shop/*): the same
 * rule as Discord /add-money and /remove-money (isPepAdmin): the admin roles
 * (ADMIN_ROLE_IDS) plus PEP_ADMIN_ROLE_IDS / PEP_ADMIN_ROLE_NAMES (default
 * "Pepperoni Mafia"). Fails closed: a roles lookup error means no access.
 */
import { NextResponse } from 'next/server'
import { getSession, type Session } from './session'
import { getUserRoles } from './discord'
import { isPepAdmin } from './pep-admin'
import { getGuildRoles } from './discord-interactions/guild-roles'
import { ADMIN_ROLE_IDS } from '@/app/ui/constants'
import type { GuardResult } from './auth-guards'

/** isPepAdmin for a role list (e.g. one the caller already fetched). */
export async function canManageShopRoles(roles: readonly string[]): Promise<boolean> {
  const guildId = process.env.DISCORD_GUILD_ID?.trim()
  try {
    return await isPepAdmin(roles, {
      baseRoleIds: ADMIN_ROLE_IDS,
      getGuildRoles: async () => (guildId ? getGuildRoles(guildId) : null),
    })
  } catch {
    return false
  }
}

/** Whether this Discord user may manage the shop (roles via the bot; false on any error). */
export async function canManageShop(discordId: string | null | undefined): Promise<boolean> {
  if (!discordId) return false
  let roles: string[]
  try {
    roles = await getUserRoles(discordId)
  } catch {
    return false
  }
  return canManageShopRoles(roles)
}

/** Route guard: 401 without a session, 403 unless the user may manage the shop. */
export async function requireShopAdmin(): Promise<GuardResult> {
  const session: Session | null = await getSession()
  if (!session?.discordId) {
    return { ok: false, response: NextResponse.json({ error: 'Not authenticated' }, { status: 401 }) }
  }
  if (!(await canManageShop(session.discordId))) {
    return { ok: false, response: NextResponse.json({ error: 'Shop admin access required' }, { status: 403 }) }
  }
  return { ok: true, session }
}
