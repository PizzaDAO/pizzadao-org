import { requireDpr, json } from '@/app/lib/admin-guard'
import { prisma } from '@/app/lib/db'
import { loadEventsAttendedConfig } from '@/app/lib/events-attended/config'
import { countGuestAttendance, GUEST_ATTENDANCE_DRY_RUN_MAX_HASHES } from '@/app/lib/events-attended/guest-attendance'
import { hashEmail } from '@/app/lib/events-attended/rsv'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/admin/events-attended/coverage: before go-live, how many of our members' verified emails and
 * linked rsv.pizza accounts rsv.pizza can match (a dry run: it returns only a count, never who).
 */
export async function GET() {
  const auth = await requireDpr()
  if (!auth.ok) return auth.response
  const config = await loadEventsAttendedConfig()
  const rows = await prisma.memberProfileExtras.findMany({
    where: { OR: [{ emailVerifiedAt: { not: null }, email: { not: null } }, { rsvLinkedEmailHash: { not: null } }] },
    select: { email: true, emailVerifiedAt: true, rsvLinkedEmailHash: true },
  })
  const hashes = new Set<string>()
  for (const r of rows) {
    if (r.email && r.emailVerifiedAt) hashes.add(hashEmail(r.email))
    if (r.rsvLinkedEmailHash) hashes.add(r.rsvLinkedEmailHash)
  }
  const all = [...hashes]
  let matched = 0
  for (let i = 0; i < all.length; i += GUEST_ATTENDANCE_DRY_RUN_MAX_HASHES) {
    const n = await countGuestAttendance(all.slice(i, i + GUEST_ATTENDANCE_DRY_RUN_MAX_HASHES), { baseUrl: config.rsvApiUrl })
    if (n === null) return json({ error: 'rsv.pizza lookup unavailable' }, 502)
    matched += n
  }
  return json({ hashesChecked: all.length, matchedMembers: matched })
}
