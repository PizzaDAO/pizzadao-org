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
import { getSetting } from './settings'

/**
 * Code default for the setting `missions.dprOnlyMinLevel`: levels at or above this one may only be
 * approved by Dread Pizza Roberts. The live value comes from the admin setting (it can only be
 * made stricter, i.e. lower). NOT a "who is DPR" check: use isDreadPizzaRoberts for that.
 */
export const DPR_ONLY_MIN_LEVEL = 8

/** The current DPR-only level (admin setting; fails to the strictest value if unreadable). */
export function dprOnlyMinLevel(): Promise<number> {
  return getSetting('missions.dprOnlyMinLevel')
}

/** Roles that may review a mission of `level`. */
export function missionReviewerRoleIds(level: number, dprOnlyFrom: number = DPR_ONLY_MIN_LEVEL): readonly string[] {
  if (level >= dprOnlyFrom) return [DREAD_PIZZA_ROBERTS_ROLE_ID]
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

/**
 * Whether `who` holds the Dread Pizza Roberts role. Pinned to the role id in code and independent
 * of every setting, so it gates the call-review, disavow and admin-settings surfaces without
 * moving when the mission DPR-only level is edited. Fails closed.
 */
export async function isDreadPizzaRoberts(who: Reviewer): Promise<boolean> {
  try {
    return await holdsAny(await resolveRoles(who), [DREAD_PIZZA_ROBERTS_ROLE_ID])
  } catch {
    return false
  }
}

/** Whether `who` may approve or reject a submission for a mission of `level`. */
export async function canReviewMission(who: Reviewer, level: number): Promise<boolean> {
  if (!Number.isInteger(level) || level < 1) return false
  const [roles, dprFrom] = await Promise.all([resolveRoles(who), dprOnlyMinLevel()])
  return holdsAny(roles, missionReviewerRoleIds(level, dprFrom))
}

/**
 * The levels-agnostic view for UI gating: which submissions `who` may review.
 * `null` = none (hide the review panel); otherwise a predicate on the level.
 */
export async function missionReviewScope(who: Reviewer): Promise<((level: number) => boolean) | null> {
  const [roles, dprFrom] = await Promise.all([resolveRoles(who), dprOnlyMinLevel()])
  const [low, high] = await Promise.all([
    holdsAny(roles, missionReviewerRoleIds(1, dprFrom)),
    holdsAny(roles, missionReviewerRoleIds(dprFrom, dprFrom)),
  ])
  if (!low && !high) return null
  return (level: number) =>
    Number.isInteger(level) && level >= 1 && (level >= dprFrom ? high : low)
}

/** Whether `who` may review at least one level (shows the review panel). */
export async function canReviewAnyMission(who: Reviewer): Promise<boolean> {
  return (await missionReviewScope(who)) !== null
}
