import { json } from '@/app/lib/admin-guard'
import { requirePaymentDpr } from '@/app/lib/payments/access'
import { exportApprovedCsv } from '@/app/lib/payments/store'
import { NO_STORE_HEADERS } from '@/app/lib/no-store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** GET /api/admin/payments/export — approved and paid requests as CSV. Dread Pizza Roberts only. */
export async function GET() {
  const g = await requirePaymentDpr()
  if (!g.ok) return g.response
  try {
    const csv = await exportApprovedCsv()
    return new Response(csv, {
      headers: { ...NO_STORE_HEADERS, 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="payment-requests.csv"' },
    })
  } catch (e) {
    console.error('[admin payments] export failed:', e instanceof Error ? e.message : e)
    return json({ error: 'Could not export' }, 500)
  }
}
