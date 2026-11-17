import { NextResponse } from 'next/server'
import { getSession } from '@/app/lib/session'
import { json } from '@/app/lib/admin-guard'
import { prisma } from '@/app/lib/db'
import { fetchMemberById } from '@/app/lib/sheets/member-repository'
import { loadEventsAttendedConfig } from '@/app/lib/events-attended/config'
import { isHiddenSubject, loadEventsAttended } from '@/app/lib/events-attended'
import { canView, parseVisibility, type Viewer } from '@/app/lib/profile/visibility'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const PUBLIC_CACHE = 'public, s-maxage=300, stale-while-revalidate=3600'

/**
 * GET /api/events-attended/[memberId]: the member's attended / ticketed / organized events. Database
 * reads only. Always answers 200: `{ enabled: false }` when the feature is off, an empty list for a
 * missing, merged, disavowed or hidden profile (never says why). The owner also gets the prompt state.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ memberId: string }> }) {
  const { memberId } = await params
  const config = await loadEventsAttendedConfig()
  if (!config.enabled) return json({ enabled: false, events: [], total: 0 })

  const session = await getSession()
  const member = await fetchMemberById(memberId).catch(() => null)
  const discordId = member?.discordId
  if (!discordId) return json({ enabled: true, events: [], total: 0 })

  const viewer: Viewer = session?.discordId ? (session.discordId === discordId ? 'owner' : 'member') : 'anonymous'

  if (await isHiddenSubject(discordId)) return json({ enabled: true, events: [], total: 0 })

  const extras = await prisma.memberProfileExtras.findUnique({
    where: { memberId },
    select: { eventsVisibility: true, email: true, emailVerifiedAt: true, rsvLinkedEmailHash: true },
  })
  const visibility = parseVisibility(extras?.eventsVisibility)
  if (!canView(visibility, viewer)) return json({ enabled: true, events: [], total: 0 })

  const result = await loadEventsAttended(memberId, discordId, { countTickets: config.countTickets, viewerIsOwner: viewer === 'owner' }).catch(() => ({ events: [], total: 0 }))

  if (viewer === 'owner') {
    const emailState = !extras?.email ? 'none' : extras.emailVerifiedAt ? 'verified' : 'unverified'
    return json({
      enabled: true,
      isOwner: true,
      ...result,
      visibility,
      emailState,
      link: { available: true, linked: !!extras?.rsvLinkedEmailHash },
    })
  }
  return NextResponse.json(
    { enabled: true, isOwner: false, ...result },
    { headers: { 'Cache-Control': visibility === 'public' ? PUBLIC_CACHE : 'private, no-store' } },
  )
}
