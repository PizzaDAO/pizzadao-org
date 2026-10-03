/**
 * Who may review (approve / reject) mission submissions, per level.
 * plans/mission-verification.md §5.1 and decision D10:
 *
 *   - L1–L7: the admin roles (ADMIN_ROLE_IDS, Leonardo) plus the roles that
 *     are pinged to review (MISSION_REVIEWER_ROLE_IDS: Dread Pizza Roberts,
 *     Pizza Capo, Pepperoni Mafia).
 *   - L8 and up: Dread Pizza Roberts only.
 *
 * Every review surface (the web routes, /api/session's canReviewMissions, and
 * later the Discord buttons) goes through `canReviewMission`, so the rule
 * lives in one place. It takes either a Discord id (roles are looked up via
 * the bot, failing closed) or a role list the caller already has (e.g. an
 * interaction payload's `member.roles`).
 */
import { getUserRoles } from './discord'
import { isPepAdmin } from './pep-admin'
import { ADMIN_ROLE_IDS, DREAD_PIZZA_ROBERTS_ROLE_ID, MISSION_REVIEWER_ROLE_IDS } from '@/app/ui/constants'

/** Levels at or above this one may only be approved by Dread Pizza Roberts. */
export const DPR_ONLY_MIN_LEVEL = 8

/** Roles that may review a mission of `level`. */
export function missionReviewerRoleIds(level: number): readonly string[] {
  if (level >= DPR_ONLY_MIN_LEVEL) return [DREAD_PIZZA_ROBERTS_ROLE_ID]
  return [...new Set<string>([...ADMIN_ROLE_IDS, ...MISSION_REVIEWER_ROLE_IDS])]
}

/** Who to check: a Discord user id, or the role ids they hold. */
export type Reviewer = string | readonly string[]

async function resolveRoles(who: Reviewer): Promise<readonly string[]> {
  if (typeof who !== 'string') return who
  try {
    return await getUserRoles(who)
  } catch {
    return [] // fail closed
  }
}

/**
 * Same id-set test as the /add-money gate (isPepAdmin), with only fixed ids:
 * reviewer roles are pinned ids, never resolved by name or env.
 */
function holdsAny(roles: readonly string[], allowed: readonly string[]): Promise<boolean> {
  return isPepAdmin(roles, { baseRoleIds: allowed, config: { ids: [], names: [] } })
}

/** Whether `who` may approve or reject a submission for a mission of `level`. */
export async function canReviewMission(who: Reviewer, level: number): Promise<boolean> {
  if (!Number.isInteger(level) || level < 1) return false
  return holdsAny(await resolveRoles(who), missionReviewerRoleIds(level))
}

/**
 * The levels-agnostic view for UI gating: which submissions `who` may review.
 * `null` = none (hide the review panel); otherwise a predicate on the level.
 */
export async function missionReviewScope(who: Reviewer): Promise<((level: number) => boolean) | null> {
  const roles = await resolveRoles(who)
  const [low, high] = await Promise.all([
    holdsAny(roles, missionReviewerRoleIds(1)),
    holdsAny(roles, missionReviewerRoleIds(DPR_ONLY_MIN_LEVEL)),
  ])
  if (!low && !high) return null
  return (level: number) =>
    Number.isInteger(level) && level >= 1 && (level >= DPR_ONLY_MIN_LEVEL ? high : low)
}

/** Whether `who` may review at least one level (shows the review panel). */
export async function canReviewAnyMission(who: Reviewer): Promise<boolean> {
  return (await missionReviewScope(who)) !== null
}
