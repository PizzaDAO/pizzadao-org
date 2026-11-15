import { json, rejectUnsafeWrite } from '@/app/lib/admin-guard'
import { requireSession } from '@/app/lib/auth-guards'
import { memberIdForLanes } from '@/app/lib/lanes/member'
import { lanesEnabled, setStepDone } from '@/app/lib/lanes'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/lanes/progress {slug, stepId, done}: tick or untick a guide step for the member
 * (plans/lane-cards-mission-onboarding.md). Unknown step ids are ignored; `submit` steps cannot be
 * ticked (they follow the mission). 404 while the lane cards setting is off or the lane is not
 * published, 401 without a session, 403 without a member profile.
 */
export async function POST(request: Request) {
  if (!(await lanesEnabled())) return json({ error: 'Not found' }, 404)
  const auth = await requireSession()
  if (!auth.ok) return auth.response
  const unsafe = rejectUnsafeWrite(request)
  if (unsafe) return unsafe
  // Members only, like the guide page: a session without a member profile cannot write lane state.
  const memberId = await memberIdForLanes(auth.session.discordId)
  if (!memberId) return json({ error: 'Members only' }, 403)
  const b = (await request.json().catch(() => null)) as Record<string, unknown> | null
  if (!b || typeof b.slug !== 'string' || typeof b.stepId !== 'string' || typeof b.done !== 'boolean') {
    return json({ error: 'slug, stepId and done are required' }, 400)
  }
  const doneStepIds = await setStepDone(auth.session.discordId, b.slug, b.stepId, b.done)
  if (doneStepIds === null) return json({ error: 'Not found' }, 404)
  return json({ ok: true, doneStepIds })
}
