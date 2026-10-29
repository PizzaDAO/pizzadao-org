import { requireSession } from '@/app/lib/auth-guards'
import { json } from '@/app/lib/admin-guard'
import { prisma } from '@/app/lib/db'
import { loadPassportConfig } from '@/app/lib/passport/config'
import { listStamps } from '@/app/lib/passport/stamps'
import { parseVisibility } from '@/app/lib/passport/visibility'
import { findMemberIdByDiscordId } from '@/app/lib/member-utils'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** GET /api/passport/me: my own stamps (full dates, no delay) and visibility. 404 while the feature is off. */
export async function GET() {
  const auth = await requireSession()
  if (!auth.ok) return auth.response
  const config = await loadPassportConfig()
  if (!config.enabled) return json({ enabled: false }, 404)

  const memberId = await findMemberIdByDiscordId(auth.session.discordId).catch(() => null)
  const [stamps, extras] = await Promise.all([
    listStamps(auth.session.discordId),
    memberId
      ? prisma.memberProfileExtras.findUnique({ where: { memberId }, select: { passportVisibility: true } })
      : Promise.resolve(null),
  ])
  return json({
    enabled: true,
    memberId,
    visibility: parseVisibility(extras?.passportVisibility),
    stamps: stamps.map((s) => ({ ...s, stampedAt: s.stampedAt.toISOString() })),
  })
}
