import { json, rejectUnsafeWrite } from '@/app/lib/admin-guard'
import { requirePaymentReviewer } from '@/app/lib/payments/access'
import { evaluateRequest } from '@/app/lib/payments/checks'
import { setUsdAmount } from '@/app/lib/payments/decide'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/admin/payments/[id]/usd-amount {amountUsd, note, expectedUpdatedAt?}
 * Reviewers only. A request submitted in another currency has no dollar value (approval is blocked);
 * a reviewer enters it here, with the reason, as an append-only record. The checks then re-run.
 */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const g = await requirePaymentReviewer()
  if (!g.ok) return g.response
  const unsafe = rejectUnsafeWrite(request)
  if (unsafe) return unsafe
  const b = (await request.json().catch(() => null)) as { amountUsd?: unknown; note?: unknown; expectedUpdatedAt?: unknown } | null
  if (!b) return json({ error: 'Invalid request' }, 400)
  const { id } = await ctx.params
  try {
    const r = await setUsdAmount(id, g.actor, {
      amountUsd: b.amountUsd,
      note: typeof b.note === 'string' ? b.note : undefined,
      expectedUpdatedAt: typeof b.expectedUpdatedAt === 'string' ? b.expectedUpdatedAt : null,
    })
    if (!r.ok) return json({ error: r.message, code: r.code }, r.status)
    await evaluateRequest(id).catch((e) => console.error('[payments] check failed:', e instanceof Error ? e.message : e))
    return json({ ok: true })
  } catch (e) {
    console.error('[admin payments] usd amount failed:', e instanceof Error ? e.message : e)
    return json({ error: 'Could not save the amount' }, 500)
  }
}
