// app/api/memes/review/route.ts
//
// Capo/DPR moderation. GET: the queue (waiting oldest first, then reported, then hidden). POST
// { id, action: approve | reject | hide | restore | clear, note? }.
import { NextRequest } from 'next/server'
import { json, rejectUnsafeWrite } from '@/app/lib/admin-guard'
import { withErrorHandling } from '@/app/lib/errors/error-response'
import { requireMemeReviewer } from '@/app/lib/memes/access'
import { reviewMeme, reviewQueue, type ReviewAction } from '@/app/lib/memes/service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const ACTIONS: readonly ReviewAction[] = ['approve', 'reject', 'hide', 'restore', 'clear']

const GET_HANDLER = async () => {
  const auth = await requireMemeReviewer()
  if (!auth.ok) return auth.response
  return json(await reviewQueue(auth.session.discordId))
}

const POST_HANDLER = async (request: NextRequest) => {
  const auth = await requireMemeReviewer()
  if (!auth.ok) return auth.response
  const unsafe = rejectUnsafeWrite(request)
  if (unsafe) return unsafe
  const body = (await request.json().catch(() => null)) as { id?: unknown; action?: unknown; note?: unknown } | null
  if (!body || typeof body.id !== 'string' || !ACTIONS.includes(body.action as ReviewAction)) return json({ error: 'Invalid request' }, 400)
  const r = await reviewMeme({ id: body.id, action: body.action as ReviewAction, reviewerId: auth.session.discordId, note: body.note })
  return r.ok ? json(r.value) : json({ error: r.error }, r.status)
}

export const GET = withErrorHandling(GET_HANDLER)
export const POST = withErrorHandling(POST_HANDLER)
