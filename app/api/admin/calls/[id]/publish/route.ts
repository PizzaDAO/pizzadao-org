import { NextResponse } from 'next/server'
import { requireCallReviewer } from '@/app/lib/calls/access'
import { publishRecording, unpublishRecording } from '@/app/lib/calls/recordings'
import { postCallRecap, type RecapResult } from '@/app/lib/calls/recap'
import { withErrorHandling } from '@/app/lib/errors/error-response'
import { ConflictError, NotFoundError, ValidationError } from '@/app/lib/errors/api-errors'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/admin/calls/[id]/publish  { "action": "publish" | "unpublish" }
 * Dread Pizza Roberts only. Publishing exposes ONLY the title, summary,
 * chapters, action items and transcript; audio is never public. Unpublishing
 * returns the call to review and deletes nothing. A first publish also posts the Discord recap
 * when CALL_RECAP_POST_ENABLED is on (see calls/recap.ts).
 */
export const POST = withErrorHandling(async (request: Request, ctx: { params: Promise<{ id: string }> }) => {
  const auth = await requireCallReviewer()
  if (!auth.ok) return auth.response

  const body = (await request.json().catch(() => null)) as { action?: unknown } | null
  if (body?.action !== 'publish' && body?.action !== 'unpublish') throw new ValidationError('action must be "publish" or "unpublish"')

  const { id } = await ctx.params
  const result =
    body.action === 'publish'
      ? await publishRecording(id, auth.session.discordId)
      : await unpublishRecording(id, auth.session.discordId)
  if (result === 'not-found') throw new NotFoundError('Recording')
  if (result === 'not-allowed') throw new ConflictError('This recording is not in a state that can be changed that way')
  if (result === 'incomplete') throw new ConflictError('A transcript and a summary are required before publishing')
  // Publishing is the human approval: only now may the recap go to Discord (gated by CALL_RECAP_POST_ENABLED, once per call).
  let recap: RecapResult | null = null
  // Only a fresh publish posts: re-clicking Publish on an already-published call ('already') never does.
  if (body.action === 'publish' && result === 'ok') recap = await postCallRecap(id).catch((err) => { console.error('[calls/publish] recap failed:', err instanceof Error ? err.message : err); return 'failed' as const })
  return NextResponse.json({ success: true, recap })
})
