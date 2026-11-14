// GET /api/learn/next
//
// The dashboard card: the next public session (when education.dashboardCardEnabled is on) and whether
// the signed-in member may schedule one. With the card switch off the answer has no session in it.
import { NextResponse } from 'next/server'
import { withErrorHandling } from '@/app/lib/errors/error-response'
import { NO_STORE_HEADERS } from '@/app/lib/no-store'
import { toggleEnabled } from '@/app/lib/settings/toggles'
import { sessionCrewIds, sessionManagerOrNull } from '@/app/lib/education-sessions/access'
import { nextPublicSession } from '@/app/lib/education-sessions/public'

export const runtime = 'nodejs'

const GET_HANDLER = async () => {
  // The first session crew the signed-in member leads (or any, for admins), for the Schedule / Manage links.
  const crews = await sessionCrewIds()
  const managed = await Promise.all(crews.map((c) => sessionManagerOrNull(c)))
  const crewId = crews.find((_, i) => managed[i]) ?? null
  if (!(await toggleEnabled('education.dashboardCardEnabled').catch(() => false))) {
    return NextResponse.json({ enabled: false, scheduleCrewId: crewId }, { headers: NO_STORE_HEADERS })
  }
  const [next, listing] = await Promise.all([nextPublicSession(), toggleEnabled('education.publicListingEnabled').catch(() => false)])
  return NextResponse.json(
    {
      enabled: true,
      listing,
      scheduleCrewId: crewId,
      next: next ? { id: next.id, title: next.title, presenter: next.presenter, startsAt: next.startsAt.toISOString(), timeZone: next.timeZone } : null,
    },
    { headers: NO_STORE_HEADERS },
  )
}

export const GET = withErrorHandling(GET_HANDLER)
