import { NextResponse } from 'next/server'
import { requireCallReviewer } from '@/app/lib/calls/access'
import { TRANSCRIBABLE_STATUSES } from '@/app/lib/calls/transcribe'
import { prisma } from '@/app/lib/db'
import { withErrorHandling } from '@/app/lib/errors/error-response'
import { ConflictError } from '@/app/lib/errors/api-errors'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/admin/calls/[id]/retry-transcription — after the automatic attempts gave up, reset the
 * attempt counter so the next cron run (within 15 minutes) tries again. Finished tracks are kept.
 * Dread Pizza Roberts only.
 */
export const POST = withErrorHandling(async (_request: Request, ctx: { params: Promise<{ id: string }> }) => {
  const auth = await requireCallReviewer()
  if (!auth.ok) return auth.response
  const { id } = await ctx.params
  const res = await prisma.callRecording.updateMany({
    where: { id, transcribedAt: null, status: { in: [...TRANSCRIBABLE_STATUSES] } },
    data: { transcribeAttempts: 0, transcribeError: null },
  })
  if (res.count !== 1) throw new ConflictError('This recording cannot be re-transcribed')
  return NextResponse.json({ success: true })
})
