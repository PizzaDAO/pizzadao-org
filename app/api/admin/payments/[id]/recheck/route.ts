import { json, rejectUnsafeWrite } from '@/app/lib/admin-guard'
import { requirePaymentReviewer } from '@/app/lib/payments/access'
import { evaluateRequest } from '@/app/lib/payments/checks'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/admin/payments/[id]/recheck — re-run the automated checks. Reviewers only. Flags and the
 * lane may change; the change bumps the request's version, so any open review screen must reload
 * before it can record a decision (nobody approves flags they did not see).
 */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const g = await requirePaymentReviewer()
  if (!g.ok) return g.response
  const unsafe = rejectUnsafeWrite(request)
  if (unsafe) return unsafe
  const { id } = await ctx.params
  try {
    const r = await evaluateRequest(id)
    if (!r) return json({ error: 'This request is not waiting for review' }, 409)
    return json({ ok: true, lane: r.lane, riskScore: r.riskScore, flags: r.flags.length })
  } catch (e) {
    console.error('[admin payments] recheck failed:', e instanceof Error ? e.message : e)
    return json({ error: 'Could not re-check' }, 500)
  }
}
