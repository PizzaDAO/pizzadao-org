import { NextResponse } from 'next/server'
import { getSession } from '@/app/lib/session'
import { loadSettings } from '@/app/lib/settings'
import { memberLiveView } from '@/app/lib/calls/live-view'
import { withErrorHandling } from '@/app/lib/errors/error-response'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/calls/live?itemsAfter=<ms>: the live call for a signed-in member: who is present, the
 * live action items newer than the cursor (level-gated), Q&A and polls. Never cached.
 */
export const GET = withErrorHandling(async (request: Request) => {
  const session = await getSession().catch(() => null)
  if (!session?.discordId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: { 'Cache-Control': 'no-store' } })
  const raw = new URL(request.url).searchParams.get('itemsAfter')
  const after = raw && /^\d{1,15}$/.test(raw) ? Number(raw) : null
  const out = await memberLiveView(await loadSettings(), { discordId: session.discordId }, after)
  return NextResponse.json(out, { headers: { 'Cache-Control': 'private, no-store' } })
})
