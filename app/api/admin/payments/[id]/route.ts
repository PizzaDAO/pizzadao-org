import { json } from '@/app/lib/admin-guard'
import { requirePaymentReviewer } from '@/app/lib/payments/access'
import { requiredAyes } from '@/app/lib/payments/lane'
import { loadPaymentPolicy } from '@/app/lib/payments/policy'
import { getRequestDetail } from '@/app/lib/payments/store'
import { proposalsGateOn } from '@/app/lib/proposals/constants'
import { legacySeshAllowed, loadSeshWindow } from '@/app/lib/proposals/legacy-sesh'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** GET /api/admin/payments/[id] — one request with attachments, checks and the decision timeline. Reviewers only. */
export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const g = await requirePaymentReviewer()
  if (!g.ok) return g.response
  const { id } = await ctx.params
  try {
    const [detail, policy, proposalsOn] = await Promise.all([getRequestDetail(id, { isDpr: g.actor.isDpr }), loadPaymentPolicy(), proposalsGateOn()])
    if (!detail) return json({ error: 'Not found' }, 404)
    // Sesh grace window: the page shows the poll-link review (not the in-app proposal one) for a pre-go-live Discord poll.
    const win = proposalsOn ? await loadSeshWindow() : null
    const legacySesh = !!win && !detail.proposal && legacySeshAllowed(detail.proposalUrl, win.liveSince, win.untilDate, new Date())
    return json({
      request: detail,
      viewer: { discordId: g.actor.discordId, isDpr: g.actor.isDpr, canMarkPaid: g.actor.canMarkPaid },
      overCap: detail.amountUsd > policy.onApprovalCapUsd,
      requiredAyes: requiredAyes(detail.amountUsd, policy),
      proposalsOn: proposalsOn && !legacySesh,
      legacySesh,
      receiptUploadEnabled: policy.receiptUploadEnabled,
      aiChecksEnabled: policy.aiChecksEnabled,
    })
  } catch (e) {
    console.error('[admin payments] detail failed:', e instanceof Error ? e.message : e)
    return json({ error: 'Could not load the request' }, 500)
  }
}
