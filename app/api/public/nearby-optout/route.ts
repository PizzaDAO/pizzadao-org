// POST /api/public/nearby-optout?d=<discordId>&sig=<sig>
// The button on /nearby-optout (the target of the Telegram invite's opt-out link). The HMAC proves the link
// came from us for this member; it can only turn nearby invites off. Idempotent. GET is deliberately not
// supported (link scanners prefetch GETs).
import { NextRequest, NextResponse } from 'next/server'
import { verifyNearbyOptOut } from '@/app/lib/nearby-events/optout'
import { stopNearbyInvites } from '@/app/lib/reminders/prefs'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const url = new URL(req.url)
  const d = url.searchParams.get('d')
  const sig = url.searchParams.get('sig')
  if (!verifyNearbyOptOut(d, sig)) return NextResponse.json({ error: 'Invalid link' }, { status: 400 })
  try {
    await stopNearbyInvites(d!)
  } catch (e) {
    console.error('[nearby-optout] failed', e instanceof Error ? e.name : 'error')
    return NextResponse.json({ error: "Couldn't turn invites off" }, { status: 500 })
  }
  const type = req.headers.get('content-type') ?? ''
  if (type.includes('application/x-www-form-urlencoded') || type.includes('multipart/form-data')) {
    const back = new URL('/nearby-optout', req.url)
    back.searchParams.set('d', d!)
    back.searchParams.set('sig', sig!)
    back.searchParams.set('done', '1')
    return NextResponse.redirect(back, 303)
  }
  return NextResponse.json({ ok: true })
}
