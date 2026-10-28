import { NextResponse } from 'next/server'
import { requireCallReviewer } from '@/app/lib/calls/access'
import { CLAIMED, MAX_ATTEMPTS, TOO_LARGE_ERROR, TRANSCRIBABLE_STATUSES } from '@/app/lib/calls/transcribe'
import { PENDING_WINDOW_DAYS } from '@/app/lib/calls/recordings'
import { prisma } from '@/app/lib/db'
import { withErrorHandling } from '@/app/lib/errors/error-response'
import { ConflictError } from '@/app/lib/errors/api-errors'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const CLAIM_STALE_MS = 6 * 3600 * 1000
const MIN_GAP_MS = 60_000
/** Per-instance memory of the last retry per recording (the attempt cap is the real limit). */
const lastRetry = new Map<string, number>()

/**
 * POST /api/admin/calls/[id]/retry-transcription — after the automatic attempts gave up, reset the
 * attempt counter so the next cron run (within 15 minutes) tries again. Finished tracks are kept.
 * Only allowed once the attempts are used up, never while a run holds the claim (unless that claim
 * is older than the 6 hour backoff), and never for a call whose tracks are all over the upload limit.
 * Dread Pizza Roberts only.
 */
export const POST = withErrorHandling(async (_request: Request, ctx: { params: Promise<{ id: string }> }) => {
  const auth = await requireCallReviewer()
  if (!auth.ok) return auth.response
  const { id } = await ctx.params
  const now = Date.now()
  if (now - (lastRetry.get(id) ?? 0) < MIN_GAP_MS) throw new ConflictError('Please wait a minute before retrying again')
  lastRetry.set(id, now)
  const res = await prisma.callRecording.updateMany({
    where: {
      id,
      transcribedAt: null,
      status: { in: [...TRANSCRIBABLE_STATUSES] },
      transcribeAttempts: { gte: MAX_ATTEMPTS },
      AND: [
        { OR: [{ transcribeError: null }, { transcribeError: { not: TOO_LARGE_ERROR } }] },
        { OR: [{ transcribeError: null }, { transcribeError: { not: CLAIMED } }, { updatedAt: { lt: new Date(now - CLAIM_STALE_MS) } }] },
      ],
    },
    data: { transcribeAttempts: 0, transcribeError: null, retranscribeRequestedAt: new Date(now) },
  })
  if (res.count !== 1) {
    // Never-processed row outside the cron window (0 attempts): flag it so the cron picks it up whatever its age.
    const old = await prisma.callRecording.updateMany({
      where: {
        id,
        transcribedAt: null,
        status: { in: [...TRANSCRIBABLE_STATUSES] },
        transcribeAttempts: 0,
        transcribeError: null,
        retranscribeRequestedAt: null,
        startedAt: { lt: new Date(now - PENDING_WINDOW_DAYS * 86_400_000) },
        speakers: { some: { trackKey: { not: null }, talkTimeSec: { gt: 0 } } },
      },
      data: { retranscribeRequestedAt: new Date(now) },
    })
    if (old.count === 1) return NextResponse.json({ success: true })
  }
  if (res.count !== 1) throw new ConflictError('This recording cannot be re-transcribed')
  return NextResponse.json({ success: true })
})
