import { getSession } from '@/app/lib/session'
import { json } from '@/app/lib/admin-guard'
import { prisma } from '@/app/lib/db'
import { fetchMemberById } from '@/app/lib/sheets/member-repository'
import { loadPassportConfig } from '@/app/lib/passport/config'
import { listStamps } from '@/app/lib/passport/stamps'
import { canView, monthOnly, parseVisibility, visibleStamps, type Viewer } from '@/app/lib/passport/visibility'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/passport/[memberId]: the stamps another viewer may see. Visibility-aware: month-only
 * dates, stamps older than the public delay, nothing for a private passport. Never cached.
 * Always answers 200 with `{ enabled: false }` (or an empty list) rather than leaking why.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ memberId: string }> }) {
  const { memberId } = await params
  const config = await loadPassportConfig()
  if (!config.enabled) return json({ enabled: false, stamps: [] })

  const session = await getSession()
  const member = await fetchMemberById(memberId).catch(() => null)
  const discordId = member?.discordId
  if (!discordId) return json({ enabled: true, stamps: [] })

  let viewer: Viewer = 'anonymous'
  if (session?.discordId) {
    viewer = session.discordId === discordId ? 'owner' : 'member'
  }

  const extras = await prisma.memberProfileExtras.findUnique({ where: { memberId }, select: { passportVisibility: true } })
  const visibility = parseVisibility(extras?.passportVisibility)
  if (!canView(visibility, viewer)) return json({ enabled: true, stamps: [], isOwner: false })

  const rows = visibleStamps(await listStamps(discordId), viewer, config.publicDelayHours)
  return json({
    enabled: true,
    isOwner: viewer === 'owner',
    stamps: rows.map((s) => ({
      slug: s.slug,
      name: s.name,
      city: s.city,
      countryCode: s.countryCode,
      ink: s.ink,
      logoUrl: s.logoUrl,
      verified: s.verified,
      pinned: s.pinned,
      // Other people only ever get the month; the owner sees the same shape for simplicity.
      month: monthOnly(s.stampedAt),
    })),
  })
}
