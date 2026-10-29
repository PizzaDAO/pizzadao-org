import { requireSession } from '@/app/lib/auth-guards'
import { rejectUnsafeWrite, json } from '@/app/lib/admin-guard'
import { prisma } from '@/app/lib/db'
import { loadPassportConfig } from '@/app/lib/passport/config'
import { parseVisibility } from '@/app/lib/passport/visibility'
import { findMemberIdByDiscordId } from '@/app/lib/member-utils'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** PUT /api/passport/visibility { visibility: "public" | "members" | "private" } */
export async function PUT(request: Request) {
  const auth = await requireSession()
  if (!auth.ok) return auth.response
  if (!(await loadPassportConfig()).enabled) return json({ error: 'Not found' }, 404)
  const unsafe = rejectUnsafeWrite(request)
  if (unsafe) return unsafe

  const body = (await request.json().catch(() => null)) as { visibility?: unknown } | null
  const v = body?.visibility
  if (v !== 'public' && v !== 'members' && v !== 'private') return json({ error: 'Invalid visibility' }, 400)

  const memberId = await findMemberIdByDiscordId(auth.session.discordId).catch(() => null)
  if (!memberId) return json({ error: 'No member profile' }, 404)
  await prisma.memberProfileExtras.upsert({
    where: { memberId },
    create: { memberId, passportVisibility: v },
    update: { passportVisibility: v },
  })
  return json({ visibility: parseVisibility(v) })
}
