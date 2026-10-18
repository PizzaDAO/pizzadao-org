import { NextResponse } from 'next/server'
import { requireCallReviewer } from '@/app/lib/calls/access'
import { removeRecording } from '@/app/lib/calls/recordings'
import { withErrorHandling } from '@/app/lib/errors/error-response'
import { NotFoundError, ValidationError } from '@/app/lib/errors/api-errors'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/admin/calls/[id]/remove  { "confirm": true } — takedown. Dread Pizza
 * Roberts only. Deletes the call's whole R2 prefix and marks the recording
 * REJECTED with its audio deleted.
 */
export const POST = withErrorHandling(async (request: Request, ctx: { params: Promise<{ id: string }> }) => {
  const auth = await requireCallReviewer()
  if (!auth.ok) return auth.response

  const body = (await request.json().catch(() => null)) as { confirm?: unknown } | null
  if (body?.confirm !== true) throw new ValidationError('Confirmation required')

  const { id } = await ctx.params
  if (!(await removeRecording(id, auth.session.discordId))) throw new NotFoundError('Recording')
  return NextResponse.json({ success: true })
})
