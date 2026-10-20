import { NextResponse } from 'next/server'
import { requireCallReviewer } from '@/app/lib/calls/access'
import { redactSpeakerFromTranscript } from '@/app/lib/calls/recordings'
import { SNOWFLAKE } from '@/app/lib/calls/ingest-schema'
import { withErrorHandling } from '@/app/lib/errors/error-response'
import { NotFoundError, ValidationError } from '@/app/lib/errors/api-errors'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/admin/calls/[id]/redact  { "discordId": "...", "confirm": true }
 * Removes one speaker's lines from the stored transcript (so the public page no longer shows them).
 * Dread Pizza Roberts only. Audio is never touched. The summary is not rewritten: edit it or regenerate.
 */
export const POST = withErrorHandling(async (request: Request, ctx: { params: Promise<{ id: string }> }) => {
  const auth = await requireCallReviewer()
  if (!auth.ok) return auth.response

  const body = (await request.json().catch(() => null)) as { discordId?: unknown; confirm?: unknown } | null
  if (body?.confirm !== true) throw new ValidationError('Confirmation required')
  if (typeof body.discordId !== 'string' || !SNOWFLAKE.test(body.discordId)) throw new ValidationError('discordId must be a Discord id')

  const { id } = await ctx.params
  const removed = await redactSpeakerFromTranscript(id, body.discordId)
  if (removed === null) throw new NotFoundError('Recording')
  return NextResponse.json({ success: true, removed })
})
