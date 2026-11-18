// Owner rules for the PFP editor, enforced server-side (the UI only mirrors them):
//  - only the base kinds in the setting pfp.allowedBaseKinds are accepted (default: the platform's
//    AI mafia portrait and dress-up results made from it);
//  - saving a PFP or AI dress up needs a completed level >= pfp.minCompletedLevel (admins bypass).
import { getSetting } from '@/app/lib/settings'
import { getCurrentLevel } from '@/app/lib/missions'
import { completedLevel } from '@/app/lib/level-display'
import { isAdminDiscordId } from '@/app/lib/auth-guards'
import { ForbiddenError } from '@/app/lib/errors/api-errors'

const DEFAULT_KINDS = ['mafia', 'restyle']

export async function allowedBaseKinds(): Promise<string[]> {
  return getSetting('pfp.allowedBaseKinds').catch(() => DEFAULT_KINDS)
}

/** Refuses a base kind that is not in the allowed list (undefined/unknown kinds pass through to validation). */
export async function assertBaseKindAllowed(kind: unknown): Promise<void> {
  if (kind === undefined || kind === null) return
  if (typeof kind !== 'string' || !(await allowedBaseKinds()).includes(kind)) {
    throw new ForbiddenError('That base picture is not available. Use your mafia portrait.')
  }
}

export interface EditAccess {
  allowed: boolean
  completed: number
  minLevel: number
  bypass: boolean
}

export async function loadEditAccess(discordId: string): Promise<EditAccess> {
  const [minLevel, bypass] = await Promise.all([
    getSetting('pfp.minCompletedLevel').catch(() => 2),
    isAdminDiscordId(discordId).catch(() => false),
  ])
  if (bypass) return { allowed: true, completed: -1, minLevel, bypass }
  // Fails closed: an unreadable level counts as nothing completed.
  const completed = await getCurrentLevel(discordId).then(completedLevel).catch(() => 0)
  return { allowed: completed >= minLevel, completed, minLevel, bypass }
}

export async function assertCanEdit(discordId: string): Promise<void> {
  const a = await loadEditAccess(discordId)
  if (!a.allowed) throw new ForbiddenError(`Reach level ${a.minLevel} to make your PFP.`)
}
