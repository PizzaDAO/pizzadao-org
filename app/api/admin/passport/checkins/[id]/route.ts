import { rejectUnsafeWrite, json } from '@/app/lib/admin-guard'
import { requireAdminAuth } from '@/app/lib/passport/admin'
import { loadPassportConfig } from '@/app/lib/passport/config'
import { reviewCheckIn } from '@/app/lib/passport/stamps'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** POST /api/admin/passport/checkins/[id] { approve: boolean }: release or reject a held check-in. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminAuth()
  if (!auth.ok) return auth.response
  const unsafe = rejectUnsafeWrite(request)
  if (unsafe) return unsafe
  const { id } = await params
  const n = Number(id)
  const b = (await request.json().catch(() => null)) as { approve?: unknown } | null
  if (!Number.isInteger(n) || typeof b?.approve !== 'boolean') return json({ error: 'Invalid request' }, 400)
  const r = await reviewCheckIn(n, auth.session.discordId, b.approve, await loadPassportConfig())
  return r.ok ? json({ ok: true }) : json({ error: r.reason }, 409)
}
