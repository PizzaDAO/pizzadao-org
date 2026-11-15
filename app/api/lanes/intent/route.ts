// POST /api/lanes/intent  { slug }
//
// /join?lane=<slug> calls this before the Discord login: it checks the lane is published (and the
// lane cards setting is on) and remembers it in the httpOnly `pd_lane` cookie, so the pick survives
// the OAuth / DM login round trip and is pinned when onboarding completes (POST /api/profile).
// Returns the lane's public name for the wizard banner. 404 (and no cookie) while the setting is
// off or the lane is unknown / unpublished. DELETE forgets it.
import { NextResponse } from 'next/server'
import { enforceRateLimit } from '@/app/lib/rate-limit'
import { getPublishedLane, lanesEnabled } from '@/app/lib/lanes'
import { LANE_COOKIE, laneCookieOptions, normalizeLaneSlug } from '@/app/lib/lanes/cookie'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const limited = await enforceRateLimit(req, 'referral-search')
  if (limited) return limited
  if (!(await lanesEnabled())) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const body = (await req.json().catch(() => null)) as { slug?: unknown } | null
  const slug = normalizeLaneSlug(body?.slug)
  if (!slug) return NextResponse.json({ error: 'Invalid lane' }, { status: 400 })
  const lane = await getPublishedLane(slug).catch(() => null)
  if (!lane) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const res = NextResponse.json({ ok: true, lane: { slug: lane.slug, tag: lane.tag, title: lane.title } })
  res.cookies.set(LANE_COOKIE, lane.slug, laneCookieOptions(req))
  return res
}

export async function DELETE(req: Request) {
  const res = NextResponse.json({ ok: true })
  res.cookies.set(LANE_COOKIE, '', laneCookieOptions(req, 0))
  return res
}
