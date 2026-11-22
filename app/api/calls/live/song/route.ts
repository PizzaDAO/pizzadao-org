import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/app/lib/session'
import { rejectUnsafeWrite } from '@/app/lib/admin-guard'
import { loadSettings } from '@/app/lib/settings'
import { findLiveSessionById } from '@/app/lib/calls/live-state'
import { liveAccess } from '@/app/lib/calls/live-access'
import { playClosingSong } from '@/app/lib/calls/closing-song'
import { withErrorHandling } from '@/app/lib/errors/error-response'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const noStore = { 'Cache-Control': 'no-store' }
const bodySchema = z.object({ sessionId: z.string().min(1).max(120) })
const STATUS = { ok: 200, cooldown: 429, 'not-configured': 503, rejected: 502, failed: 502 } as const

/** POST /api/calls/live/song: a live host has pizza-radio play the closing song in that call's voice channel. */
export const POST = withErrorHandling(async (request: Request) => {
  const session = await getSession().catch(() => null)
  if (!session?.discordId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: noStore })
  const unsafe = rejectUnsafeWrite(request)
  if (unsafe) return unsafe
  const parsed = bodySchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'invalid' }, { status: 400, headers: noStore })
  const access = await liveAccess(session.discordId)
  if (!access.host) return NextResponse.json({ error: 'Forbidden' }, { status: 403, headers: noStore })
  const settings = await loadSettings()
  const live = await findLiveSessionById(settings, parsed.data.sessionId)
  if (!live?.channelId) return NextResponse.json({ error: 'not-live' }, { status: 409, headers: noStore })
  const crew = settings.get('calls.closingSongCrew').trim()
  if (!crew) return NextResponse.json({ error: 'not-configured' }, { status: 503, headers: noStore })
  const result = await playClosingSong({ sessionId: live.sessionId, channelId: live.channelId, crew })
  return NextResponse.json(result === 'ok' ? { ok: true } : { error: result }, { status: STATUS[result], headers: noStore })
})
