import { NextResponse } from 'next/server'
import { requireCallAccess } from '@/app/lib/calls/access'
import { recordCallReviewEvent } from '@/app/lib/calls/review-audit'
import { publishRecording, unpublishRecording } from '@/app/lib/calls/recordings'
import { postCallRecap, redactionsNewerThanSummary, type RecapResult } from '@/app/lib/calls/recap'
import { withErrorHandling } from '@/app/lib/errors/error-response'
import { ConflictError, NotFoundError, ValidationError } from '@/app/lib/errors/api-errors'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/admin/calls/[id]/publish  { "action": "publish" | "unpublish" }
 * Dread Pizza Roberts, or a Pizza Capo while calls.capoReviewEnabled is on (Discord calls that are not
 * held for the owner; a capo publish is refused when lines were hidden after the summary was written).
 * Publishing exposes ONLY the title, summary,
 * chapters, action items and transcript; audio is never public. Unpublishing
 * returns the call to review and deletes nothing. A first publish also posts the Discord recap
 * when calls.recapPostEnabled is on (see calls/recap.ts).
 */
export const POST = withErrorHandling(async (request: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params
  // The action decides which capo permission applies; both are capo-allowed, so the check is the same.
  const auth = await requireCallAccess(id, 'publish')
  if (!auth.ok) return auth.response

  const body = (await request.json().catch(() => null)) as { action?: unknown } | null
  if (body?.action !== 'publish' && body?.action !== 'unpublish') throw new ValidationError('action must be "publish" or "unpublish"')

  // A capo may not publish text the recap would not match: lines were hidden after the summary was written.
  if (body.action === 'publish' && auth.role === 'capo' && auth.rec && redactionsNewerThanSummary(auth.rec)) {
    throw new ConflictError('Lines were hidden after the summary was written; regenerate or edit the summary first')
  }

  const result =
    body.action === 'publish'
      ? await publishRecording(id, auth.session.discordId)
      : await unpublishRecording(id, auth.session.discordId)
  if (result === 'not-found') throw new NotFoundError('Recording')
  if (result === 'not-allowed') throw new ConflictError('This recording is not in a state that can be changed that way')
  if (result === 'conflict') throw new ConflictError('This recording changed while publishing; reload and check it again')
  if (result === 'transcribing') throw new ConflictError('Transcription is still pending for this call; publish once it has finished')
  if (result === 'incomplete') throw new ConflictError('A transcript and a summary are required before publishing')
  // Publishing is the human approval: only now may the recap go to Discord (gated by calls.recapPostEnabled, once per call).
  let recap: RecapResult | null = null
  // Only a fresh publish posts: re-clicking Publish on an already-published call ('already') never does.
  if (body.action === 'publish' && result === 'ok') recap = await postCallRecap(id).catch((err) => { console.error('[calls/publish] recap failed:', err instanceof Error ? err.message : err); return 'failed' as const })
  if (result === 'ok') await recordCallReviewEvent({ recordingId: id, actorId: auth.session.discordId, action: body.action, via: 'web', ...(recap ? { metadata: { recap } } : {}) })
  return NextResponse.json({ success: true, recap })
})
