import { requireSession } from '@/app/lib/auth-guards'
import { json, rejectUnsafeWrite } from '@/app/lib/admin-guard'
import { normalizeCrewId } from '@/app/lib/crew-id'
import { applyAll } from '@/app/lib/call-tasks/apply'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * POST /api/crew/<crewId>/proposals/apply-all  { recordingId? }
 * Applies every pending proposal that needs no decision. Proposals with an ambiguous lead or whose
 * task changed since are left pending and reported. Leads of the crew and guild admins only.
 */
export async function POST(request: Request, { params }: { params: Promise<{ crewId: string }> }) {
  const unsafe = rejectUnsafeWrite(request)
  if (unsafe) return unsafe
  const auth = await requireSession()
  if (!auth.ok) return auth.response
  const crewId = normalizeCrewId((await params).crewId)
  if (!crewId) return json({ error: 'Not found' }, 404)
  const body = (await request.json().catch(() => null)) as { recordingId?: unknown } | null
  const recordingId = typeof body?.recordingId === 'string' && body.recordingId.trim() ? body.recordingId.trim() : undefined
  const r = await applyAll(crewId, auth.session.discordId, { recordingId })
  if (r === 'forbidden') return json({ error: 'Only crew leads can decide on this' }, 403)
  if (r === 'not-db-crew') return json({ error: "This is still edited in the crew's Google Sheet" }, 409)
  return json({ ok: true, ...r })
}
