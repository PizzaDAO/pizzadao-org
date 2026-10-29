/**
 * Who may vote: guild members holding the voter role (Box Mafia by default) at the moment a proposal opens. That
 * role is assigned by a holder-verification bot that already requires a wallet signature, so the app does no
 * wallet verification of its own. The set is taken ONCE, at open; a role gained afterwards cannot add a vote.
 * One vote per member. The listing is strict: any Discord failure aborts the open (the proposal stays a DRAFT and
 * the cron retries) instead of opening with a partial list.
 */
import { getGuildRoles } from '@/app/lib/discord-channels'
import { resolveBoxMafiaRoleId } from '@/app/lib/box-mafia'
import { hasRole } from '@/app/lib/discord'
import { getSetting } from '@/app/lib/settings'

export interface RoleDeps {
  /** The role id that makes someone a voter, or null when it cannot be resolved (fail closed). */
  voterRoleId(): Promise<string | null>
  /** Every guild member with the role. Throws on any failure or an incomplete listing. */
  listRoleHolders(roleId: string): Promise<string[]>
}

export interface RoleSnapshot {
  roleId: string
  discordIds: string[]
}

export async function snapshotRoleHolders(deps: RoleDeps): Promise<RoleSnapshot> {
  const roleId = await deps.voterRoleId()
  if (!roleId) throw new Error('voter role not resolved')
  const ids = await deps.listRoleHolders(roleId)
  return { roleId, discordIds: [...new Set(ids)].sort() }
}

/** The configured voter role (setting), else the Box Mafia role found by the existing helper. */
export async function resolveVoterRoleId(): Promise<string | null> {
  try {
    const saved = await getSetting('proposals.voterRoleId')
    if (saved) return saved
  } catch {
    /* fall through to the built-in role */
  }
  return resolveBoxMafiaRoleId(await getGuildRoles())
}

const PAGE = 1000
const MAX_PAGES = 50

export async function listRoleHoldersStrict(roleId: string, env: NodeJS.ProcessEnv = process.env, fetchImpl: typeof fetch = fetch): Promise<string[]> {
  const guildId = env.DISCORD_GUILD_ID
  const botToken = env.DISCORD_BOT_TOKEN
  if (!guildId || !botToken) throw new Error('discord not configured')
  const out: string[] = []
  let after = '0'
  for (let page = 0; page < MAX_PAGES; page++) {
    const r = await fetchImpl(`https://discord.com/api/v10/guilds/${guildId}/members?limit=${PAGE}&after=${after}`, {
      headers: { Authorization: `Bot ${botToken}` },
      cache: 'no-store',
    })
    if (!r.ok) throw new Error(`discord members ${r.status}`)
    const members = (await r.json()) as Array<{ roles: string[]; user: { id: string } }>
    for (const m of members) if (m.roles.includes(roleId)) out.push(m.user.id)
    if (members.length < PAGE) return out
    after = members[members.length - 1].user.id
  }
  throw new Error('discord members listing too long')
}

export const defaultRoleDeps: RoleDeps = {
  voterRoleId: resolveVoterRoleId,
  listRoleHolders: (roleId) => listRoleHoldersStrict(roleId),
}

/** Live check for a proposer: holds the voter role right now. Fails closed. */
export async function holdsVoterRole(discordId: string): Promise<boolean> {
  try {
    const roleId = await resolveVoterRoleId()
    return roleId ? await hasRole(discordId, roleId) : false
  } catch {
    return false
  }
}
