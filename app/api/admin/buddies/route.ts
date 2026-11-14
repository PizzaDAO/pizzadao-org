import { requireAdmin } from '@/app/lib/auth-guards'
import { json, rejectUnsafeWrite } from '@/app/lib/admin-guard'
import { internalError } from '@/app/lib/errors/error-response'
import { toggleEnabled } from '@/app/lib/settings/toggles'
import { getAdminOverview } from '@/app/lib/buddy/view'
import { adminAddBuddy, adminRemoveBuddy, completeDuePairs, createPair, endPair, isSnowflake } from '@/app/lib/buddy/service'
import { introducePair, resolveUncertainIntro } from '@/app/lib/buddy/intro'
import { REFUSAL_TEXT, type PairRefusal } from '@/app/lib/buddy/rules'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

/** Admin overview: the buddy pool, pairs, and signed-up members who have no buddy yet. */
export async function GET() {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response
  try {
    return json(await getAdminOverview())
  } catch (err) {
    return internalError(err, 'admin/buddies', 'Buddy overview is unavailable')
  }
}

/**
 * Admin actions, one JSON body each:
 *   { action: 'addBuddy' | 'removeBuddy', discordId }
 *   { action: 'pair', traineeDiscordId, buddyDiscordId }   (also opens the intro thread, or records a dry run)
 *   { action: 'end', pairId, reason? }
 *   { action: 'introduce', pairId }                         (retry an intro that failed)
 *   { action: 'resolveUncertain', pairId, threadId? }       (after checking Discord for an intro whose answer was lost)
 *   { action: 'completeDue' }
 */
export async function POST(request: Request) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response
  const unsafe = rejectUnsafeWrite(request)
  if (unsafe) return unsafe
  let body: Record<string, unknown>
  try {
    body = (await request.json()) as Record<string, unknown>
  } catch {
    return json({ error: 'Invalid JSON' }, 400)
  }
  const actor = auth.session.discordId
  try {
    if (!(await toggleEnabled('buddy.enabled'))) return json({ error: 'The buddy system is switched off in settings.' }, 409)
    switch (body.action) {
      case 'addBuddy': {
        if (!isSnowflake(body.discordId)) return json({ error: 'A Discord id is required' }, 400)
        return json(await adminAddBuddy(body.discordId, actor))
      }
      case 'removeBuddy': {
        if (!isSnowflake(body.discordId)) return json({ error: 'A Discord id is required' }, 400)
        return json(await adminRemoveBuddy(body.discordId))
      }
      case 'pair': {
        if (!isSnowflake(body.traineeDiscordId) || !isSnowflake(body.buddyDiscordId)) return json({ error: 'Both Discord ids are required' }, 400)
        const made = await createPair({ traineeDiscordId: body.traineeDiscordId, buddyDiscordId: body.buddyDiscordId }, actor)
        if (!made.ok) {
          const error = made.reason in REFUSAL_TEXT ? REFUSAL_TEXT[made.reason as PairRefusal] : 'Invalid request'
          return json({ error, reason: made.reason }, 409)
        }
        // Introduce right away. A failed or dry-run intro never undoes the pair.
        const intro = await introducePair(made.pairId, actor).catch((e) => ({ mode: 'live' as const, ok: false as const, reason: (e as Error).message }))
        return json({ ok: true, pairId: made.pairId, intro })
      }
      case 'end': {
        if (typeof body.pairId !== 'string' || !body.pairId) return json({ error: 'pairId is required' }, 400)
        const reason = typeof body.reason === 'string' ? body.reason : ''
        const ended = await endPair(body.pairId, actor, reason || 'ended by an admin')
        return ended.ok ? json({ ok: true }) : json({ error: 'That pair is not active' }, 409)
      }
      case 'introduce': {
        if (typeof body.pairId !== 'string' || !body.pairId) return json({ error: 'pairId is required' }, 400)
        return json(await introducePair(body.pairId, actor))
      }
      case 'resolveUncertain': {
        if (typeof body.pairId !== 'string' || !body.pairId) return json({ error: 'pairId is required' }, 400)
        const threadId = typeof body.threadId === 'string' && body.threadId ? body.threadId : undefined
        if (threadId && !isSnowflake(threadId)) return json({ error: 'That is not a Discord thread id' }, 400)
        return (await resolveUncertainIntro(body.pairId, actor, threadId)) ? json({ ok: true }) : json({ error: 'Nothing to resolve' }, 409)
      }
      case 'completeDue':
        return json(await completeDuePairs())
      default:
        return json({ error: 'Unknown action' }, 400)
    }
  } catch (err) {
    return internalError(err, 'admin/buddies', 'Buddy action failed')
  }
}
