import { NextResponse } from 'next/server'
import { requireCallReviewer } from '@/app/lib/calls/access'
import { getRecording } from '@/app/lib/calls/recordings'
import { signedAudioUrl, SIGNED_URL_TTL_SEC } from '@/app/lib/calls/r2'
import { withErrorHandling } from '@/app/lib/errors/error-response'
import { NotFoundError } from '@/app/lib/errors/api-errors'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/admin/calls/[id]/audio — short-lived signed R2 URLs for the mix and
 * each speaker's track. Dread Pizza Roberts only (same gate as L8 mission
 * review). Audio is never public and is kept indefinitely.
 */
export const GET = withErrorHandling(async (_request: Request, ctx: { params: Promise<{ id: string }> }) => {
  const auth = await requireCallReviewer()
  if (!auth.ok) return auth.response

  const { id } = await ctx.params
  const rec = await getRecording(id)
  if (!rec) throw new NotFoundError('Recording')
  // Audio is kept forever; 410 only when this recording genuinely has none stored.
  if (!rec.mixKey && !rec.speakers.some((s) => s.trackKey)) {
    return NextResponse.json({ error: 'No audio is stored for this recording' }, { status: 410 })
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
