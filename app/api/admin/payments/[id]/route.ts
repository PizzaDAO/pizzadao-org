import { json } from '@/app/lib/admin-guard'
import { requirePaymentReviewer } from '@/app/lib/payments/access'
import { requiredAyes } from '@/app/lib/payments/lane'
import { loadPaymentPolicy } from '@/app/lib/payments/policy'
import { getRequestDetail } from '@/app/lib/payments/store'
import { proposalsEnabled } from '@/app/lib/proposals/constants'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** GET /api/admin/payments/[id] — one request with attachments, checks and the decision timeline. Reviewers only. */
export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const g = await requirePaymentReviewer()
  if (!g.ok) return g.response
  const { id } = await ctx.params
  try {
    const [detail, policy, proposalsOn] = await Promise.all([getRequestDetail(id, { isDpr: g.actor.isDpr }), loadPaymentPolicy(), proposalsEnabled()])
    if (!detail) return json({ error: 'Not found' }, 404)
    return json({
      request: detail,
      viewer: { discordId: g.actor.discordId, isDpr: g.actor.isDpr, canMarkPaid: g.actor.canMarkPaid },
      overCap: detail.amountUsd > policy.onApprovalCapUsd,
      requiredAyes: requiredAyes(detail.amountUsd, policy),
      proposalsOn,
      receiptUploadEnabled: policy.receiptUploadEnabled,
      aiChecksEnabled: policy.aiChecksEnabled,
    })
  } catch (e) {
    console.error('[admin payments] detail failed:', e instanceof Error ? e.message : e)
    return json({ error: 'Could not load the request' }, 500)
  }
}
