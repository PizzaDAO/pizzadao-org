import { json, rejectUnsafeWrite } from '@/app/lib/admin-guard'
import { requirePaymentReviewer } from '@/app/lib/payments/access'
import { runAiCheck } from '@/app/lib/payments/ai-check'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 120

/**
 * POST /api/admin/payments/[id]/ai-check — a reviewer clicks "Run AI check". Reviewers only; there is
 * no automatic run. Off unless `payments.aiChecksEnabled` is on, and limited per day by
 * `payments.aiDailyCap`. The result is flags with reasons: AI never approves, rejects or clears.
 */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const g = await requirePaymentReviewer()
  if (!g.ok) return g.response
  const unsafe = rejectUnsafeWrite(request)
  if (unsafe) return unsafe
  const { id } = await ctx.params
  try {
    const r = await runAiCheck(id)
    if (!r.ok) {
      const status = r.code === 'not_found' ? 404 : r.code === 'failed' ? 502 : r.code === 'closed' ? 409 : r.code === 'cap_reached' ? 429 : 403
      return json({ error: r.message, code: r.code }, status)
    }
    return json({ ok: true, flags: r.flags.length })
  } catch (e) {
    console.error('[admin payments] ai check failed:', e instanceof Error ? e.message : e)
    return json({ error: 'Could not run the AI check' }, 500)
  }
}
