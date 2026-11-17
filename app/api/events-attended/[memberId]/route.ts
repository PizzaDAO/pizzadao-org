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

const PUBLIC_CACHE = 'public, s-maxage=60'

/**
 * GET /api/events-attended/[memberId]: the VISITOR view of a member's events. Database reads only. The
 * body never depends on who is asking beyond "may they see it at all", and never contains owner-only
 * data (hidden guest lists, prompts, controls), so a CDN copy of a public body is safe to share. The owner
 * gets their own view from the no-store /api/events-attended/me. Always 200: `{ enabled: false }` when
 * the feature is off, an empty list for a missing, disavowed or hidden profile (never says why).
 */
export async function GET(_req: Request, { params }: { params: Promise<{ memberId: string }> }) {
  const { memberId } = await params
  const config = await loadEventsAttendedConfig()
  if (!config.enabled) return json({ enabled: false, events: [], total: 0 })

  const session = await getSession()
  const member = await fetchMemberById(memberId).catch(() => null)
  const discordId = member?.discordId
  if (!discordId) return json({ enabled: true, events: [], total: 0 })

  if (await isHiddenSubject(discordId)) return json({ enabled: true, events: [], total: 0 })

  const extras = await prisma.memberProfileExtras.findUnique({ where: { memberId }, select: { eventsVisibility: true } })
  const visibility = parseVisibility(extras?.eventsVisibility)
  // The owner is treated as a plain member here: owner data only comes from /me.
  const viewer: Viewer = session?.discordId ? 'member' : 'anonymous'
  if (!canView(visibility, viewer)) return json({ enabled: true, events: [], total: 0 })

  const result = await loadEventsAttended(memberId, discordId, { countTickets: config.countTickets, viewerIsOwner: false }).catch(() => ({ events: [], total: 0 }))
  return NextResponse.json(
    { enabled: true, isOwner: false, ...result },
    // Only a public list is shared; a members-only list is never cached (the cache key has no session).
    { headers: { 'Cache-Control': visibility === 'public' ? PUBLIC_CACHE : 'private, no-store' } },
  )
}
