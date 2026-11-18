/**
 * The call reviewer's role, without the session guard (so the Discord interactions route can use it).
 * Re-exported from access.ts.
 */
import { holdsAny, isDreadPizzaRoberts, resolveRoles, type Reviewer } from '@/app/lib/mission-review-access'
import { CALL_CAPO_ROLE_IDS } from '@/app/ui/constants'
import { toggleEnabled } from '@/app/lib/settings/toggles'

export type CallRole = 'owner' | 'capo'

/**
 * The reviewer's role: 'owner' (Dread Pizza Roberts), 'capo' (Pizza Capo role while the toggle is on) or
 * null. Pass a Discord id (roles are looked up, failing closed) or the role ids from an interaction
 * payload. With the toggle off a capo is null, exactly as before.
 */
export async function callReviewRole(who: Reviewer): Promise<CallRole | null> {
  // Exactly the old check first; with the toggle off nothing else is looked up.
  if (await isDreadPizzaRoberts(who)) return 'owner'
  try {
    if (!(await toggleEnabled('calls.capoReviewEnabled'))) return null
    return (await holdsAny(await resolveRoles(who), CALL_CAPO_ROLE_IDS)) ? 'capo' : null
  } catch {
    return null // fail closed
  }
}

