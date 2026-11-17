import { after, NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/app/lib/session'
import { prisma } from '@/app/lib/db'
import { findMemberIdByDiscordId } from '@/app/lib/member-utils'
import { loadEventsAttendedConfig } from '@/app/lib/events-attended/config'
import { checkState, statesMatch, LINK_STATE_COOKIE, verifyLinkToken } from '@/app/lib/events-attended/rsv-link'
import { clearEmailMatches, refreshRsvEventsIfEnabled } from '@/app/lib/events-attended/rsv'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function back(req: NextRequest, memberId: string | null, result: 'linked' | 'failed'): NextResponse {
  const res = NextResponse.redirect(new URL(memberId ? `/profile/${encodeURIComponent(memberId)}?rsv=${result}` : '/', req.url), 303)
  res.cookies.set(LINK_STATE_COOKIE, '', { path: '/api/events-attended/link', maxAge: 0 }) // the state is single use
  // The token and state were in this URL: keep them out of any Referer.
  res.headers.set('Referrer-Policy', 'no-referrer')
  return res
}

/**
 * GET /api/events-attended/link/callback?rsv_link=&state=: rsv.pizza sends the member back here. The state
 * must equal the cookie set at start AND be one this session's Discord id minted (CSRF), and the token
 * must verify for that state and be unused. Only a sha256 of the rsv.pizza email is stored.
 */
export async function GET(req: NextRequest) {
  const session = await getSession()
  // Not signed in (say the link opened in another browser): back to the start, never a page with the token in its URL.
  if (!session?.discordId) return back(req, null, 'failed')
  const config = await loadEventsAttendedConfig()
  if (!config.enabled) return back(req, null, 'failed')

  const memberId = await findMemberIdByDiscordId(session.discordId).catch(() => null)
  const url = new URL(req.url)
  const state = url.searchParams.get('state') ?? ''
  const token = url.searchParams.get('rsv_link') ?? ''
  const cookie = req.cookies.get(LINK_STATE_COOKIE)?.value ?? ''
  if (!memberId || !state || !token || !statesMatch(cookie, state) || !checkState(state, session.discordId)) return back(req, memberId, 'failed')

  const verified = await verifyLinkToken(token, state, { jwksUrl: config.rsvJwksUrl, issuer: config.rsvLinkIssuer, audience: config.rsvLinkAudience })
  if (!verified.ok) return back(req, memberId, 'failed')

  // Single use: a token that was already redeemed is refused (the unique jti is the lock).
  try {
    await prisma.rsvLinkJti.create({ data: { jti: verified.jti, expiresAt: verified.expiresAt } })
  } catch {
    return back(req, memberId, 'failed')
  }
  void prisma.rsvLinkJti.deleteMany({ where: { expiresAt: { lt: new Date() } } }).catch(() => undefined)

  await prisma.memberProfileExtras.upsert({
    where: { memberId },
    create: { memberId, rsvLinkedEmailHash: verified.emailHash, rsvLinkedAt: new Date() },
    update: { rsvLinkedEmailHash: verified.emailHash, rsvLinkedAt: new Date() },
  })
  await clearEmailMatches(memberId).catch(() => undefined)
  after(() => refreshRsvEventsIfEnabled(memberId))
  return back(req, memberId, 'linked')
}
