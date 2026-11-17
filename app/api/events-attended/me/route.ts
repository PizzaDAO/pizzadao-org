import { requireSession } from '@/app/lib/auth-guards'
import { json } from '@/app/lib/admin-guard'
import { prisma } from '@/app/lib/db'
import { findMemberIdByDiscordId } from '@/app/lib/member-utils'
import { loadEventsAttendedConfig } from '@/app/lib/events-attended/config'
import { isHiddenSubject, loadEventsAttended } from '@/app/lib/events-attended'
import { parseVisibility } from '@/app/lib/profile/visibility'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/events-attended/me: the signed-in member's own view (hidden guest lists, prompt state, link
 * state, visibility). Always `no-store`, and the id comes from the session, so it can never be served
 * from the shared cache to anyone else. The profile page calls this when the viewer is the owner.
 */
export async function GET() {
  const auth = await requireSession()
  if (!auth.ok) return auth.response
  const config = await loadEventsAttendedConfig()
  if (!config.enabled) return json({ enabled: false, events: [], total: 0 })

  const discordId = auth.session.discordId
  const memberId = await findMemberIdByDiscordId(discordId).catch(() => null)
  if (!memberId || (await isHiddenSubject(discordId))) return json({ enabled: true, events: [], total: 0 })

  const extras = await prisma.memberProfileExtras.findUnique({
    where: { memberId },
    select: { eventsVisibility: true, email: true, emailVerifiedAt: true, rsvLinkedEmailHash: true },
  })
  const result = await loadEventsAttended(memberId, discordId, { countTickets: config.countTickets, viewerIsOwner: true }).catch(() => ({ events: [], total: 0 }))
  return json({
    enabled: true,
    isOwner: true,
    ...result,
    visibility: parseVisibility(extras?.eventsVisibility),
    emailState: !extras?.email ? 'none' : extras.emailVerifiedAt ? 'verified' : 'unverified',
    link: { available: true, linked: !!extras?.rsvLinkedEmailHash },
  })
}
