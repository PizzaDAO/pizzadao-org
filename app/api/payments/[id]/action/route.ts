import { json, rejectUnsafeWrite } from '@/app/lib/admin-guard'
import { requireSession } from '@/app/lib/auth-guards'
import { applyDecision } from '@/app/lib/payments/decide'
import { loadPaymentPolicy } from '@/app/lib/payments/policy'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/payments/[id]/action {action: "WITHDRAW" | "REPLY", note?}
 * The requester withdraws their request, or answers a reviewer's question (which puts it back in the
 * queue). Ownership is enforced by the decision rules (requester only), and the action is recorded
 * as an append-only decision like any other.
 */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireSession()
  if (!auth.ok) return auth.response
  const unsafe = rejectUnsafeWrite(request)
  if (unsafe) return unsafe
  const b = (await request.json().catch(() => null)) as { action?: unknown; note?: unknown } | null
  if (!b || (b.action !== 'WITHDRAW' && b.action !== 'REPLY')) return json({ error: 'Invalid request' }, 400)
  const note = typeof b.note === 'string' ? b.note.slice(0, 2001) : undefined
  const { id } = await ctx.params
  try {
    const policy = await loadPaymentPolicy()
    const actor = { discordId: auth.session.discordId, isDpr: false, canReview: false, canMarkPaid: false }
    const out = await applyDecision(id, actor, { action: b.action, note }, policy)
    if (!out.ok) {
      // A request that is not yours looks like a request that does not exist.
      if (out.code === 'not_requester') return json({ error: 'Not found' }, 404)
      return json({ error: out.message, code: out.code }, out.status)
    }
    return json({ ok: true, status: out.nextStatus })
  } catch (e) {
    console.error('[payments] action failed:', e instanceof Error ? e.message : e)
    return json({ error: 'Could not update the request' }, 500)
  }
}
