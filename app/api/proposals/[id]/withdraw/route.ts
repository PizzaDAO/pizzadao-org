import { rejectUnsafeWrite } from '@/app/lib/admin-guard'
import { cancelAndAnnounce } from '@/app/lib/proposals/lifecycle'
import { out, requireProposalsSession, safe, type RouteCtx } from '@/app/lib/proposals/http'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const STATUS = { not_found: 404, not_cancellable: 409, not_allowed: 403, bad_reason: 400 } as const

/**
 * POST /api/proposals/[id]/withdraw {reason?} — the proposer withdraws their own proposal while it is waiting to open
 * or open for voting (until the window ends). Nothing is counted. After that only the admin cancel applies.
 */
export const POST = safe('withdraw', async (request: Request, { params }: RouteCtx) => {
  const auth = await requireProposalsSession()
  if (!auth.ok) return auth.response
  const unsafe = rejectUnsafeWrite(request)
  if (unsafe) return unsafe
  const { id } = await params
  const body = (await request.json().catch(() => null)) as { reason?: unknown } | null
  const r = await cancelAndAnnounce(id, { discordId: auth.session.discordId, admin: false }, body?.reason)
  if (!r.ok) return out({ error: r.code }, STATUS[r.code])
  return out({ ok: true })
})
