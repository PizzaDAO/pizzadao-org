import { NextResponse } from 'next/server'
import { requireCallAccess } from '@/app/lib/calls/access'
import { recordCallReviewEvent } from '@/app/lib/calls/review-audit'
import { setSpeakerRedacted } from '@/app/lib/calls/recordings'
import { SPEAKER_ID } from '@/app/lib/calls/ingest-schema'
import { withErrorHandling } from '@/app/lib/errors/error-response'
import { NotFoundError, ValidationError } from '@/app/lib/errors/api-errors'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/admin/calls/[id]/redact  { "discordId": "...", "confirm": true }            hide a speaker's lines
 *                                    { "discordId": "...", "restore": true }            undo
 * Dread Pizza Roberts, or (hiding only) a Pizza Capo while calls.capoReviewEnabled is on; restoring is
 * owner-only. Non-destructive: the stored transcript and audio are never changed; the
 * speaker is added to / removed from the call's redacted list, which hides their lines from the
 * public page and from summary generation. The summary is not rewritten: edit it or regenerate.
 */
export const POST = withErrorHandling(async (request: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params
  const body = (await request.json().catch(() => null)) as { discordId?: unknown; confirm?: unknown; restore?: unknown } | null
  const restore = body?.restore === true
  const auth = await requireCallAccess(id, restore ? 'restore' : 'hide')
  if (!auth.ok) return auth.response
  if (!restore && body?.confirm !== true) throw new ValidationError('Confirmation required')
  if (typeof body?.discordId !== 'string' || !SPEAKER_ID.test(body.discordId)) throw new ValidationError('discordId must be a speaker id')

  const lines = await setSpeakerRedacted(id, body.discordId, !restore)
  if (lines === null) throw new NotFoundError('Recording')
  await recordCallReviewEvent({ recordingId: id, actorId: auth.session.discordId, action: 'redact', via: 'web', metadata: { kind: 'speaker', restore } })
  return NextResponse.json({ success: true, lines })
})
