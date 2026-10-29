import { json } from '@/app/lib/admin-guard'
import { requirePaymentReviewer } from '@/app/lib/payments/access'
import { loadPaymentPolicy } from '@/app/lib/payments/policy'
import { listQueue } from '@/app/lib/payments/store'
import { getFormSheetId, getIngestStatus } from '@/app/lib/payments/text-settings'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/admin/payments?filter=open|approved|closed
 * Reviewers only (admin roles and Dread Pizza Roberts). Never cached. FAST requests sort first.
 */
export async function GET(request: Request) {
  const g = await requirePaymentReviewer()
  if (!g.ok) return g.response
  const f = new URL(request.url).searchParams.get('filter')
  const filter = f === 'approved' || f === 'closed' ? f : 'open'
  try {
    const policy = await loadPaymentPolicy()
    const [queue, status, sheet] = await Promise.all([listQueue(filter, policy), getIngestStatus(), g.actor.isDpr ? getFormSheetId() : Promise.resolve('')])
    return json({
      items: queue.items,
      total: queue.total,
      hashConfigured: !!process.env.PAYMENTS_HASH_SECRET?.trim(),
      canMarkPaid: g.actor.canMarkPaid,
      isDpr: g.actor.isDpr,
      ingest: { enabled: policy.formIngestEnabled, status, sheetConfigured: g.actor.isDpr ? sheet !== '' : undefined },
      degraded: policy.degraded,
    })
  } catch (e) {
    console.error('[admin payments] list failed:', e instanceof Error ? e.message : e)
    return json({ error: 'Could not load the queue' }, 500)
  }
}
