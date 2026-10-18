import { NextResponse } from 'next/server'
import { requireCallReviewer } from '@/app/lib/calls/access'
import { getRecording } from '@/app/lib/calls/recordings'
import { signedAudioUrl, SIGNED_URL_TTL_SEC } from '@/app/lib/calls/r2'
import { audioPastRetention, retentionDays } from '@/app/lib/calls/retention'
import { withErrorHandling } from '@/app/lib/errors/error-response'
import { NotFoundError } from '@/app/lib/errors/api-errors'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/admin/calls/[id]/audio — short-lived signed R2 URLs for the mix and
 * each speaker's track. Dread Pizza Roberts only (same gate as L8 mission
 * review). Audio is never public; expired audio is refused even before the
 * retention sweep has deleted it.
 */
export const GET = withErrorHandling(async (_request: Request, ctx: { params: Promise<{ id: string }> }) => {
  const auth = await requireCallReviewer()
  if (!auth.ok) return auth.response

  const { id } = await ctx.params
  const rec = await getRecording(id)
  if (!rec) throw new NotFoundError('Recording')
  if (rec.audioDeletedAt || audioPastRetention(rec.endedAt, new Date(), retentionDays())) {
    return NextResponse.json({ error: 'Audio has passed its retention window and was deleted' }, { status: 410 })
  }

  const [mix, tracks] = await Promise.all([
    rec.mixKey ? signedAudioUrl(rec.mixKey) : null,
    Promise.all(
      rec.speakers
        .filter((s) => s.trackKey)
        .map(async (s) => ({ discordId: s.discordId, displayName: s.displayName, url: await signedAudioUrl(s.trackKey!) })),
    ),
  ])
  return NextResponse.json({ mix, tracks, expiresInSec: SIGNED_URL_TTL_SEC }, { headers: { 'Cache-Control': 'no-store' } })
})
