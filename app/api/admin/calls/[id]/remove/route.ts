import { NextResponse } from 'next/server'
import { requireCallReviewer } from '@/app/lib/calls/access'
import { rejectRecording } from '@/app/lib/calls/recordings'
import { withErrorHandling } from '@/app/lib/errors/error-response'
import { NotFoundError, ValidationError } from '@/app/lib/errors/api-errors'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/admin/calls/[id]/remove  { "confirm": true } — reject (hide) a
 * recording. Dread Pizza Roberts only. Sets status REJECTED with reviewedBy /
 * reviewedAt; keeps the row, speakers, metadata and audio, and never touches R2.
 */
export const POST = withErrorHandling(async (request: Request, ctx: { params: Promise<{ id: string }> }) => {
  const auth = await requireCallReviewer()
  if (!auth.ok) return auth.response

  const body = (await request.json().catch(() => null)) as { confirm?: unknown } | null
  if (body?.confirm !== true) throw new ValidationError('Confirmation required')

  const { id } = await ctx.params
  if (!(await rejectRecording(id, auth.session.discordId))) throw new NotFoundError('Recording')
  return NextResponse.json({ success: true })
})
