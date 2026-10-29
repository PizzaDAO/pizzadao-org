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
import { listGuildMemberRoles } from '@/app/lib/mission-verify/bulk'
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

/**
 * Every member with the role, from the shared guild lister (rate-limit retry, up to 200 pages). It returns null
 * unless the WHOLE listing was read, and that becomes an error here: a partial voter list must never be stored.
 */
export async function listRoleHolders(roleId: string, lister: typeof listGuildMemberRoles = listGuildMemberRoles): Promise<string[]> {
  const members = await lister()
  if (!members) throw new Error('guild member listing incomplete')
  const out: string[] = []
  for (const [id, roles] of members) if (roles.includes(roleId)) out.push(id)
  return out
}

export const defaultRoleDeps: RoleDeps = {
  voterRoleId: resolveVoterRoleId,
  listRoleHolders: (roleId) => listRoleHolders(roleId),
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
