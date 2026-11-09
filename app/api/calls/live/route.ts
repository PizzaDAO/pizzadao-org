import { NextResponse } from 'next/server'
import { getSession } from '@/app/lib/session'
import { loadSettings } from '@/app/lib/settings'
import { memberLiveView } from '@/app/lib/calls/live-view'
import { withErrorHandling } from '@/app/lib/errors/error-response'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/calls/live?after=<sessionId>~<ms>~<itemId>&after=...: every live call for a signed-in
 * member: who is present, the live action items newer than each call's cursor (level-gated), Q&A and
 * polls. Never cached.
 */
export const GET = withErrorHandling(async (request: Request) => {
  const session = await getSession().catch(() => null)
  if (!session?.discordId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: { 'Cache-Control': 'no-store' } })
  // One cursor per call: "<sessionId>~<createdAt ms>~<item id>" (at most 5 are read).
  const cursors = new Map<string, string>()
  for (const raw of new URL(request.url).searchParams.getAll('after').slice(0, 5)) {
    const m = /^([A-Za-z0-9_-]{1,120})~(\d{1,15}~[A-Za-z0-9_-]{1,40})$/.exec(raw)
    if (m) cursors.set(m[1], m[2])
  }
  const out = await memberLiveView(await loadSettings(), { discordId: session.discordId }, cursors)
  return NextResponse.json(out, { headers: { 'Cache-Control': 'private, no-store' } })
})
