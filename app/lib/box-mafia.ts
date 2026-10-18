/**
 * Box Mafia suggestion (woodfired-65373).
 *
 * The dashboard nudges members who definitely lack the "Box Mafia" Discord
 * role to buy a Rare Pizzas Box. Fails closed: any unknown (no bot token,
 * Discord down, role not found by name) yields "unknown" and the card hides.
 */
import { fetchGuildMember } from './discord'
import { getGuildRoles } from './discord-interactions/guild-roles'
import { normalizeRoleName } from './pep-earn/income'

export const BOX_MAFIA_ROLE_NAME = 'Box Mafia'
export const DEFAULT_BOX_PURCHASE_URL = 'https://opensea.io/collection/rare-pizzas-box'

/** Purchase link. An explicitly empty NEXT_PUBLIC_BOX_PURCHASE_URL hides the card. */
export const BOX_PURCHASE_URL = process.env.NEXT_PUBLIC_BOX_PURCHASE_URL ?? DEFAULT_BOX_PURCHASE_URL

export type BoxMafiaStatus = 'has_role' | 'missing' | 'unknown'

/** BOX_MAFIA_ROLE_ID env override, else the single guild role named "Box Mafia". */
export function resolveBoxMafiaRoleId(
  guildRoles: ReadonlyArray<{ id: string; name: string }> | null,
): string | null {
  const override = (process.env.BOX_MAFIA_ROLE_ID ?? '').trim()
  if (/^\d{5,25}$/.test(override)) return override
  if (!guildRoles) return null
  const target = normalizeRoleName(BOX_MAFIA_ROLE_NAME)
  const matches = guildRoles.filter((r) => normalizeRoleName(r.name) === target)
  return matches.length === 1 ? matches[0].id : null
}

export function boxMafiaStatus(memberRoles: string[] | null, roleId: string | null): BoxMafiaStatus {
  if (!memberRoles || !roleId) return 'unknown'
  return memberRoles.includes(roleId) ? 'has_role' : 'missing'
}

/** Never throws. Pass `memberRoles` to reuse an already-fetched guild member. */
export async function getBoxMafiaStatus(
  discordId: string,
  memberRoles?: string[] | null,
): Promise<BoxMafiaStatus> {
  try {
    const guildId = process.env.DISCORD_GUILD_ID
    const [roles, member] = await Promise.all([
      guildId ? getGuildRoles(guildId) : Promise.resolve(null),
      memberRoles !== undefined ? Promise.resolve(null) : fetchGuildMember(discordId),
    ])
    const memberRoleIds = memberRoles !== undefined ? memberRoles : (member?.roles ?? null)
    return boxMafiaStatus(memberRoleIds, resolveBoxMafiaRoleId(roles))
  } catch {
    return 'unknown'
  }
}
