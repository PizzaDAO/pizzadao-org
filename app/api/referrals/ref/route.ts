// POST /api/referrals/ref  { ref: "<memberId>" }
//
// /join?ref=<memberId> (a member's personal invite link, L3.1) calls this
// before the Discord login: it checks the ref is an onboarded member and
// remembers it in the httpOnly `pd_ref` cookie for 30 days, so the referral
// survives the OAuth round trip and is recorded when onboarding completes
// (POST /api/profile). Returns the inviter's public name for the
// "Who invited you?" step. DELETE forgets it.
import { NextResponse } from 'next/server'
import { enforceRateLimit } from '@/app/lib/rate-limit'
import { normalizeRef } from '@/app/lib/referral-link'
import { REF_COOKIE, refCookieOptions } from '@/app/lib/referral-cookie'
import { fetchMemberById } from '@/app/lib/sheets/member-repository'

export const runtime = 'nodejs'

export async function POST(req: Request) {
  const limited = await enforceRateLimit(req, 'referral-search')
  if (limited) return limited
  const body = (await req.json().catch(() => null)) as { ref?: unknown } | null
  const ref = normalizeRef(body?.ref)
  if (!ref) return NextResponse.json({ error: 'Invalid invite link' }, { status: 400 })

  const row = await fetchMemberById(ref).catch(() => null)
  const discordId = String(row?.discordId ?? '').trim()
  if (!row || !/^\d{15,25}$/.test(discordId)) {
    return NextResponse.json({ error: 'That invite link is not from a PizzaDAO member' }, { status: 404 })
  }
  const name = String(row['Name'] || row['Mafia Name'] || '').trim() || `Member #${ref}`
  const res = NextResponse.json({ ok: true, inviter: { memberId: ref, name } })
  res.cookies.set(REF_COOKIE, ref, refCookieOptions(req))
  return res
}

export async function DELETE(req: Request) {
  const res = NextResponse.json({ ok: true })
  res.cookies.set(REF_COOKIE, '', refCookieOptions(req, 0))
  return res
}
