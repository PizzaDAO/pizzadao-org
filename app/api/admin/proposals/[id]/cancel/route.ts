import { json, rejectUnsafeWrite, requireDpr } from '@/app/lib/admin-guard'
import { cancelAndAnnounce } from '@/app/lib/proposals/lifecycle'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const STATUS = { not_found: 404, not_cancellable: 409, not_allowed: 403, bad_reason: 400 } as const

/**
 * POST /api/admin/proposals/[id]/cancel {reason} — Dread Pizza Roberts only. Cancels a DRAFT or OPEN app proposal:
 * under the row lock it sets CANCELLED and closedAt, logs the actor and the reason, deletes the ballot rows and the
 * pending Redis hash, and updates the Discord post to "withdrawn". Ballots are never counted.
 */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireDpr()
  if (!auth.ok) return auth.response
  const unsafe = rejectUnsafeWrite(request)
  if (unsafe) return unsafe
  const { id } = await ctx.params
  const body = (await request.json().catch(() => null)) as { reason?: unknown } | null
  try {
    const r = await cancelAndAnnounce(id, { discordId: auth.session.discordId, admin: true }, body?.reason)
    if (!r.ok) return json({ error: r.code }, STATUS[r.code])
    return json({ ok: true })
  } catch (e) {
    console.error('[admin proposals] cancel failed:', (e as Error)?.name)
    return json({ error: 'Could not cancel the proposal' }, 500)
  }
}
