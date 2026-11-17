import { NextRequest, NextResponse } from 'next/server'
import { requireSession } from '@/app/lib/auth-guards'
import { json } from '@/app/lib/admin-guard'
import { loadEventsAttendedConfig } from '@/app/lib/events-attended/config'
import { buildLinkRedirect, LINK_STATE_COOKIE, LINK_STATE_MAX_AGE_S, makeState } from '@/app/lib/events-attended/rsv-link'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/events-attended/link/start: sends the signed-in member to rsv.pizza to sign in there. The
 * state is bound to this session and also kept in an httpOnly cookie, and the callback requires both.
 */
export async function GET(req: NextRequest) {
  const auth = await requireSession()
  if (!auth.ok) return auth.response
  const config = await loadEventsAttendedConfig()
  if (!config.enabled) return json({ error: 'Not found' }, 404)

  const state = makeState(auth.session.discordId)
  const target = state ? buildLinkRedirect(config.rsvLinkUrl, state, new URL('/api/events-attended/link/callback', req.url).toString()) : null
  if (!state || !target) return json({ error: 'Unavailable' }, 503)

  const res = NextResponse.redirect(target, 303)
  res.cookies.set(LINK_STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: 'lax', // the return from rsv.pizza is a top-level navigation
    secure: process.env.NODE_ENV === 'production',
    path: '/api/events-attended/link',
    maxAge: LINK_STATE_MAX_AGE_S,
  })
  return res
}
