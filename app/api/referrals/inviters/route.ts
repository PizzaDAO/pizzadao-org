// GET /api/referrals/inviters?q=<name or member ID>
//
// The member search behind the optional "Who invited you?" onboarding step
// (L3.1). Public: only the fields the member directory already shows (member
// ID, name, city) of onboarded members, at most 8. Rate limited per IP.
import { NextResponse } from 'next/server'
import { enforceRateLimit } from '@/app/lib/rate-limit'
import { fetchAllMembers } from '@/app/lib/sheets/members-list'
import { searchInviters } from '@/app/lib/referral-search'

export const runtime = 'nodejs'

export async function GET(req: Request) {
  const limited = await enforceRateLimit(req, 'referral-search')
  if (limited) return limited
  const q = (new URL(req.url).searchParams.get('q') ?? '').slice(0, 60)
  try {
    const members = await fetchAllMembers()
    return NextResponse.json({ members: searchInviters(members, q) })
  } catch (e) {
    console.error('[referrals] member search failed:', e)
    return NextResponse.json({ members: [], error: 'Search is unavailable right now' }, { status: 503 })
  }
}
