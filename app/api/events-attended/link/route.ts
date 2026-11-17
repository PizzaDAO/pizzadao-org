import { after } from 'next/server'
import { requireSession } from '@/app/lib/auth-guards'
import { rejectCrossOrigin, json } from '@/app/lib/admin-guard'
import { prisma } from '@/app/lib/db'
import { findMemberIdByDiscordId } from '@/app/lib/member-utils'
import { loadEventsAttendedConfig } from '@/app/lib/events-attended/config'
import { clearEmailMatches, refreshRsvEventsIfEnabled } from '@/app/lib/events-attended/rsv'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** DELETE /api/events-attended/link: unlink the rsv.pizza account, drop what it found, re-check the rest. */
export async function DELETE(request: Request) {
  const auth = await requireSession()
  if (!auth.ok) return auth.response
  if (!(await loadEventsAttendedConfig()).enabled) return json({ error: 'Not found' }, 404)
  const unsafe = rejectCrossOrigin(request)
  if (unsafe) return unsafe

  const memberId = await findMemberIdByDiscordId(auth.session.discordId).catch(() => null)
  if (!memberId) return json({ error: 'No member profile' }, 404)
  await prisma.memberProfileExtras.updateMany({ where: { memberId }, data: { rsvLinkedEmailHash: null, rsvLinkedAt: null } })
  await clearEmailMatches(memberId).catch(() => undefined)
  after(() => refreshRsvEventsIfEnabled(memberId))
  return json({ linked: false })
}
