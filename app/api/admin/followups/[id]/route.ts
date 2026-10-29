import { after } from 'next/server'
import { requireCallReviewer } from '@/app/lib/calls/access'
import { json, rejectUnsafeWrite } from '@/app/lib/admin-guard'
import { approveFollowUp, dismissFollowUp, editFollowUp, FollowUpError, reresolveFollowUp, type FollowUpPatch } from '@/app/lib/followups/admin'
import { sendFollowUp } from '@/app/lib/followups/send'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

type Ctx = { params: Promise<{ id: string }> }

async function body(request: Request): Promise<Record<string, unknown> | null> {
  const b = (await request.json().catch(() => null)) as unknown
  return b && typeof b === 'object' && !Array.isArray(b) ? (b as Record<string, unknown>) : null
}

function fail(e: unknown) {
  if (e instanceof FollowUpError) return json({ error: e.message }, e.status)
  console.error('[admin followups] failed:', e instanceof Error ? e.message.slice(0, 200) : 'error')
  return json({ error: 'Something went wrong' }, 500)
}

/** PATCH { message?, dueAt?, channel?, ownerMemberId? }: edit a draft (logged with a diff). */
export async function PATCH(request: Request, ctx: Ctx) {
  const auth = await requireCallReviewer()
  if (!auth.ok) return auth.response
  const unsafe = rejectUnsafeWrite(request)
  if (unsafe) return unsafe
  const b = await body(request)
  if (!b) return json({ error: 'Bad request' }, 400)
  const patch: FollowUpPatch = {}
  if (typeof b.message === 'string') patch.message = b.message
  if (b.dueAt === null || typeof b.dueAt === 'string') patch.dueAt = b.dueAt as string | null
  if (b.channel === null || typeof b.channel === 'string') patch.channel = b.channel as FollowUpPatch['channel']
  if (typeof b.ownerMemberId === 'string') patch.ownerMemberId = b.ownerMemberId
  try {
    const r = await editFollowUp((await ctx.params).id, auth.session.discordId, patch)
    return json({ ok: true, updatedAt: r.updatedAt })
  } catch (e) {
    return fail(e)
  }
}

/**
 * POST { action: 'approve' | 'approve-escalate' | 'dismiss' | 'reresolve' }
 * Approve is the only thing that can lead to a message being sent, and only when sending is on.
 */
export async function POST(request: Request, ctx: Ctx) {
  const auth = await requireCallReviewer()
  if (!auth.ok) return auth.response
  const unsafe = rejectUnsafeWrite(request)
  if (unsafe) return unsafe
  const b = await body(request)
  const action = typeof b?.action === 'string' ? b.action : ''
  const { id } = await ctx.params
  const actor = auth.session.discordId
  try {
    if (action === 'approve' || action === 'approve-escalate') {
      if (typeof b?.expectedUpdatedAt !== 'string') return json({ error: 'expectedUpdatedAt is required' }, 400)
      await approveFollowUp(id, actor, { escalateOnly: action === 'approve-escalate', expectedUpdatedAt: b.expectedUpdatedAt })
      // Try now; if it is quiet hours, over the daily cap, or sending is off, the cron picks it up later.
      after(() => sendFollowUp(id).then(() => undefined, (e) => console.error('[admin followups] send failed:', e instanceof Error ? e.message.slice(0, 160) : 'error')))
    } else if (action === 'dismiss') await dismissFollowUp(id, actor)
    else if (action === 'reresolve') await reresolveFollowUp(id, actor)
    else return json({ error: 'Unknown action' }, 400)
    return json({ ok: true })
  } catch (e) {
    return fail(e)
  }
}
