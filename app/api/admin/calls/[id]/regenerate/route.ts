import { NextResponse } from 'next/server'
import { requireCallAccess } from '@/app/lib/calls/access'
import { recordCallReviewEvent } from '@/app/lib/calls/review-audit'
import { generateAndStoreSummary, getRecording } from '@/app/lib/calls/recordings'
import { withErrorHandling } from '@/app/lib/errors/error-response'
import { ConflictError, ExternalServiceError, NotFoundError } from '@/app/lib/errors/api-errors'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

/**
 * POST /api/admin/calls/[id]/regenerate — rerun the AI summary from the stored
 * transcript. Dread Pizza Roberts, or a Pizza Capo while calls.capoReviewEnabled is on. Replaces title/summary/chapters/action
 * items (reviewer edits included); a published call stays published.
 */
export const POST = withErrorHandling(async (_request: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params
  const auth = await requireCallAccess(id, 'regenerate')
  if (!auth.ok) return auth.response

  const rec = await getRecording(id)
  if (!rec) throw new NotFoundError('Recording')
  if (rec.status === 'REJECTED') throw new ConflictError('This recording was rejected')
  if (!(await generateAndStoreSummary(id))) throw new ExternalServiceError('AI summary')
  await recordCallReviewEvent({ recordingId: id, actorId: auth.session.discordId, action: 'regenerate', via: 'web' })
  return NextResponse.json({ success: true })
})
