import { json, rejectUnsafeWrite } from '@/app/lib/admin-guard'
import { requirePaymentDpr } from '@/app/lib/payments/access'
import { getFormSheetId, getIngestFrom, setFormSheetId, setIngestFrom } from '@/app/lib/payments/text-settings'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** GET /api/admin/payments/config — whether the responses sheet is configured (never the id itself). Top role only. */
export async function GET() {
  const g = await requirePaymentDpr()
  if (!g.ok) return g.response
  const from = await getIngestFrom()
  return json({ formSheetConfigured: (await getFormSheetId()) !== '', ingestFrom: from ? from.toISOString() : null })
}

/**
 * PUT /api/admin/payments/config {formSheetId?, ingestFrom?} — set (or clear with "") the Work Payment
 * responses sheet id, and/or the moment before which form responses are never imported (ISO date).
 * Top role only. The sheet id is stored in the database, audited masked, and never returned.
 */
export async function PUT(request: Request) {
  const g = await requirePaymentDpr()
  if (!g.ok) return g.response
  const unsafe = rejectUnsafeWrite(request)
  if (unsafe) return unsafe
  const b = (await request.json().catch(() => null)) as { formSheetId?: unknown; ingestFrom?: unknown } | null
  if (!b || (typeof b.formSheetId !== 'string' && typeof b.ingestFrom !== 'string')) return json({ error: 'Invalid request' }, 400)
  try {
    if (typeof b.ingestFrom === 'string') {
      const d = new Date(b.ingestFrom)
      if (Number.isNaN(d.getTime())) return json({ error: 'That is not a date' }, 400)
      await setIngestFrom(d, g.actor.discordId)
    }
    if (typeof b.formSheetId === 'string') {
      const r = await setFormSheetId(b.formSheetId, g.actor.discordId)
      if (!r.ok) return json({ error: r.error }, 400)
    }
    return json({ ok: true })
  } catch (e) {
    console.error('[admin payments] config failed:', e instanceof Error ? e.message : e)
    return json({ error: 'Could not save' }, 500)
  }
}
