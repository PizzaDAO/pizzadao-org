import { NextResponse } from 'next/server'
import { requireCallAccess } from '@/app/lib/calls/access'
import { recordCallReviewEvent } from '@/app/lib/calls/review-audit'
import { setSegmentRedacted } from '@/app/lib/calls/recordings'
import { SEGMENT_KEY } from '@/app/lib/calls/ingest-schema'
import { withErrorHandling } from '@/app/lib/errors/error-response'
import { NotFoundError, ValidationError } from '@/app/lib/errors/api-errors'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const KEY = SEGMENT_KEY

/**
 * POST /api/admin/calls/[id]/redact-line  { "key": "c:<messageId>", "confirm": true }   hide one transcript line
 *                                         { "key": "...", "restore": true }             undo
 * Dread Pizza Roberts, or (hiding only) a Pizza Capo while calls.capoReviewEnabled is on; restoring is
 * owner-only. Non-destructive (see setSegmentRedacted). Use it for a chat message that
 * was deleted in Discord after the call was ingested, or any line that should not be public.
 */
export const POST = withErrorHandling(async (request: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params
  const body = (await request.json().catch(() => null)) as { key?: unknown; confirm?: unknown; restore?: unknown } | null
  const restore = body?.restore === true
  const auth = await requireCallAccess(id, restore ? 'restore' : 'hide')
  if (!auth.ok) return auth.response
  if (!restore && body?.confirm !== true) throw new ValidationError('Confirmation required')
  if (typeof body?.key !== 'string' || !KEY.test(body.key)) throw new ValidationError('key must be a transcript line key')

  if (!(await setSegmentRedacted(id, body.key, !restore))) throw new NotFoundError('Recording line')
  await recordCallReviewEvent({ recordingId: id, actorId: auth.session.discordId, action: 'redact', via: 'web', metadata: { kind: 'line', restore } })
  return NextResponse.json({ success: true })
})
