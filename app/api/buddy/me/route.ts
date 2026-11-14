import { requireSession } from '@/app/lib/auth-guards'
import { json, rejectUnsafeWrite } from '@/app/lib/admin-guard'
import { internalError } from '@/app/lib/errors/error-response'
import { getMyBuddyState } from '@/app/lib/buddy/view'
import { saveOwnProfile } from '@/app/lib/buddy/service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** The signed-in member's buddy card: their opt-in state and any pairs (as buddy or trainee) with the checklist. */
export async function GET() {
  const auth = await requireSession()
  if (!auth.ok) return auth.response
  try {
    return json(await getMyBuddyState(auth.session.discordId))
  } catch (err) {
    return internalError(err, 'buddy/me', 'Buddy info is unavailable')
  }
}

/** Opt in, pause or leave: { active?, paused?, maxActive?, languages? }. Opting in needs the minimum level. */
export async function POST(request: Request) {
  const auth = await requireSession()
  if (!auth.ok) return auth.response
  const unsafe = rejectUnsafeWrite(request)
  if (unsafe) return unsafe
  let body: Record<string, unknown>
  try {
    body = (await request.json()) as Record<string, unknown>
  } catch {
    return json({ error: 'Invalid JSON' }, 400)
  }
  const bool = (v: unknown) => (typeof v === 'boolean' ? v : undefined)
  const languages = Array.isArray(body.languages) && body.languages.every((l) => typeof l === 'string') ? (body.languages as string[]) : undefined
  const maxActive = typeof body.maxActive === 'number' && Number.isFinite(body.maxActive) ? body.maxActive : undefined
  try {
    const result = await saveOwnProfile(auth.session.discordId, { active: bool(body.active), paused: bool(body.paused), maxActive, languages })
    if (!result.ok) {
      const status = result.reason === 'not_eligible' ? 403 : result.reason === 'disabled' ? 404 : 400
      return json({ error: result.reason }, status)
    }
    return json(result)
  } catch (err) {
    return internalError(err, 'buddy/me', 'Could not save')
  }
}
