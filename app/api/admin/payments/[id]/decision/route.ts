import { json, rejectUnsafeWrite } from '@/app/lib/admin-guard'
import { requirePaymentReviewer } from '@/app/lib/payments/access'
import { applyDecision } from '@/app/lib/payments/decide'
import { parseDecisionBody } from '@/app/lib/payments/decision-body'
import { loadPaymentPolicy } from '@/app/lib/payments/policy'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/admin/payments/[id]/decision
 * Reviewers only. Records one append-only decision and moves the status in a single transaction.
 * The rules (self-approval block, distinct approvers, top-role requirement, mark-paid by the top
 * role only) live in lib/payments/decide.ts. Nothing here moves money.
 */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const g = await requirePaymentReviewer()
  if (!g.ok) return g.response
  const unsafe = rejectUnsafeWrite(request)
  if (unsafe) return unsafe
  const parsed = parseDecisionBody(await request.json().catch(() => null))
  if (!parsed) return json({ error: 'Invalid request' }, 400)
  const { id } = await ctx.params
  try {
    const policy = await loadPaymentPolicy()
    const out = await applyDecision(id, g.actor, parsed.input, policy, { expectedUpdatedAt: parsed.expectedUpdatedAt })
    if (!out.ok) return json({ error: out.message, code: out.code }, out.status)
    return json({ ok: true, status: out.nextStatus, approvals: out.approvalsAfter, awaiting: out.awaiting ?? null })
  } catch (e) {
    console.error('[admin payments] decision failed:', e instanceof Error ? e.message : e)
    return json({ error: 'Could not record the decision' }, 500)
  }
}
