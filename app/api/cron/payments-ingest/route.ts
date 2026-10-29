import { NextRequest, NextResponse } from 'next/server'
import { isCronAuthorized } from '@/app/lib/cron-auth'
import { internalError } from '@/app/lib/errors/error-response'
import { runFormIngest } from '@/app/lib/payments/ingest-run'
import { loadPaymentPolicy } from '@/app/lib/payments/policy'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

/**
 * GET /api/cron/payments-ingest — every 15 minutes (Vercel Cron, Bearer CRON_SECRET). Reads new
 * Work Payment form responses into the queue. Production only, and only while the
 * `payments.formIngestEnabled` setting is on and a responses sheet id is set. Read-only on the sheet.
 */
export async function GET(request: NextRequest) {
  if (!isCronAuthorized(request.headers.get('authorization'))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (process.env.VERCEL_ENV !== 'production') return NextResponse.json({ skipped: 'not production' })
  try {
    const policy = await loadPaymentPolicy()
    if (!policy.formIngestEnabled) return NextResponse.json({ skipped: 'disabled' })
    const result = await runFormIngest()
    console.log('[cron/payments-ingest]', JSON.stringify({ seen: result.seen, created: result.created, invalid: result.invalid, old: result.old, truncated: result.truncated, skipped: result.skipped, error: result.error }))
    return NextResponse.json(result)
  } catch (err) {
    return internalError(err, 'cron/payments-ingest', 'Payments ingest failed')
  }
}
